# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

TypeScript/Node.js tool that connects to Interactive Brokers TWS (or IB Gateway) over its local socket API to scan equity option chains for contracts whose premium is inside a configurable percentage band of the underlying. Hits are persisted to a local SQLite file (`tracestocks.db`) and exposed through a small Express + vanilla-JS dashboard.

## Commands

```bash
npm install          # install deps (better-sqlite3 builds native bindings; needs a C/C++ toolchain on Linux/macOS)
npm run balance      # CLI: connect to TWS, print account summary, disconnect
npm run optscan      # CLI: run the scanner, write hits to scan_results, print sorted table
npm run server       # start Express dashboard on PORT (default 3000)
npm run typecheck    # tsc --noEmit — there is no test suite or lint script
```

There is no `dist/` build step in the normal flow. `index.js` and `server.js` are tiny bootstraps that register `ts-node` with `transpileOnly: true` and then `require` the real entrypoints (`src/main.ts` and `src/server/server.ts`). All `npm` scripts go through these — `npm start` and `node index.js <cmd>` are equivalent.

Both CLI commands require **TWS or IB Gateway running locally and logged in** with the API enabled and `127.0.0.1` trusted. Port `7496` (TWS live), `7497` (TWS paper), `4001` (Gateway live), `4002` (Gateway paper). The configured port lives in `src/config.ts`, not env vars.

## Architecture

### Three entrypoints, one process model

- `src/main.ts` — CLI dispatcher (`balance` | `optscan`). Calls `connect()`, runs the command, then `disconnect()` + `closeDb()`. Errors are caught at the top level and force the same cleanup before `process.exit(1)`.
- `src/server/server.ts` — Express app. Read-only against SQLite; never opens an IB connection. Handles `SIGINT`/`SIGTERM` by closing the HTTP server then the DB.
- `web/` — static frontend (HTML/CSS/vanilla JS + Chart.js). Served by the Express app from `process.cwd()/web`.

`src/config.ts` is the single source of runtime config (no `.env`, no flags). The only env var read anywhere is `PORT` in the server.

### IBKR layer — event-driven, reqId-demuxed

`@stoqey/ib`'s `IBApi` is a long-lived `EventEmitter`. Every async operation in `src/ib/` follows the same pattern:

1. **Reserve a reqId** (or a contiguous range) from the module-level counter in `src/ib/optionsChain.ts` (`newReqId` / `reserveReqIds`, starts at 100). `getAccountBalance` uses the fixed reserved id `9000`.
2. **Subscribe** to the relevant `EventName.*` events with handlers that filter by `id === reqId` (or `idx = id - reqId` for batches).
3. **Issue the request** (`reqMktData`, `reqAccountSummary`, …) with that reqId.
4. **Resolve/reject** when the matching end event fires (`tickSnapshotEnd`, `accountSummaryEnd`) or an `error` arrives for the same reqId, then **always `off()` all handlers and cancel the request** to avoid leaks across calls.

Critical invariants when touching this layer:

- The IB client and the SQLite handle are both **module-level singletons** (`src/ib/connection.ts`, `src/db/database.ts`). Re-importing does not give you a fresh instance. `disconnect()` / `closeDb()` null them out so the next access reconnects.
- Connection-level errors arrive on `EventName.error` with `reqId === -1`. `connect()` rejects on that; per-request handlers must ignore it.
- IB warning code `10167` (delayed-data) is suppressed at multiple layers — the main entrypoint monkey-patches `console.error` to strip it, and `WARNING_CODES` in `optionsChain.ts` is checked in error handlers. Add new benign codes to both if needed.
- `reqMarketDataType(config.ib.marketDataType)` is called immediately after `connected` so paper accounts without a live options data subscription still get frozen quotes. Don't move this call.

### Scanner pipeline (`optscan`)

`src/scanner/scanner.ts → runScan`:

1. `getExpirations(maxDte)` enumerates weekly Fridays from the next Friday out to `maxDte`.
2. For each symbol, `getUnderlyingPrice` does a one-shot snapshot `reqMktData` on the STK contract and resolves on the first price tick.
3. For each `(symbol, expiration, right ∈ {C,P})`, `getOptionsChain` builds a strike grid `[spot·(1−r), spot·(1+r)]` with step `$1 / $5 / $10` depending on underlying price, fires N parallel snapshot `reqMktData` calls (one reqId per strike), and aggregates `tickPrice` / `tickSize` / `tickOptionComputation` until `tickSnapshotEnd` (or an `error`) arrives for every reqId. Errors per-strike are treated as "finish that strike with no data," not as failures.
4. `applyPremiumFilter` (`src/scanner/filters.ts`) keeps OTM only (calls: strike > spot, puts: strike < spot), enforces `[minPremiumPct, maxPremiumPct]` and `[minDte, maxDte]`, and skips on volume only when IB actually reported it (undefined volume passes).
5. Every survivor is `insertScanResult`-ed and pushed into the return array. Inserts and the in-memory list are not transactional with each other.

`tickOptionComputation` Greeks come in two flavours (different field codes); `PREFERRED_OPT_COMP = {13, 84}` wins over the others when both arrive for the same strike. `cleanGreek` filters IB's sentinel values (`MAX_VALUE`, ≥1e100, ≤−1, non-finite).

### Persistence (`src/db/`)

- `getDb()` opens the file lazily, sets `journal_mode = WAL`, then runs `applySchema`. The schema migration is **idempotent**: `CREATE TABLE IF NOT EXISTS` for the base table, then `PRAGMA table_info` + `ADD COLUMN` for every nullable column added since (`dte`, `volume`, `underlying_price`, `iv/delta/gamma/theta/vega`). New columns must be added through `addColumn(...)`, not by editing the original `CREATE TABLE`, or existing local DBs will not upgrade.
- `scanResults.ts` is the only module that writes SQL. `SELECT_COLS` aliases snake_case columns back to the camelCase TS field names; the row type cast in `queryResults` / `getScansTimeline` / etc. is **load-bearing** because we relabel via aliases rather than mapping in JS.
- `queryResults` clamps `limit` to `[1, 5000]` (default 500). All `WHERE` predicates use named params; do not concatenate user input.

### Web API (read-only)

Routes live in `src/server/server.ts` and call directly into `src/db/scanResults.ts`. Endpoints: `/api/health`, `/api/results` (filterable), `/api/scans` (timeline grouped by `scanned_at`), `/api/symbols` (per-symbol summary), `/api/distribution` (premium-% histogram with configurable bucket size). The frontend in `web/app.js` calls these with `fetch`. Static files come from `path.join(process.cwd(), 'web')` — so the server must be launched from the repo root.

## TypeScript conventions worth knowing

`tsconfig.json` enables `strict`, `noUncheckedIndexedAccess`, `noImplicitOverride`, and **`exactOptionalPropertyTypes`**. The last one means you cannot assign `undefined` to a declared optional field — the codebase uses the `if (x !== undefined) obj.x = x;` pattern (see `filters.ts`, `optionsChain.ts`) instead of spreading `{ ...maybe }`. Preserve that pattern when adding fields to `OptionContract` / `ScanResult`.

Shared types are in `src/types/index.ts`. `OptionContract` is the raw IBKR-side shape; `ScanResult` is the derived, persisted shape (adds `premiumPct`, `dte`, `scannedAt`).

## What's gitignored and why it matters

`tracestocks.db` (+ `-wal` / `-shm`) is local scan history — never check it in. `.claude/settings.local.json`, editor folders, and `node_modules/` / `dist/` are also ignored. The project stores no IBKR credentials anywhere; auth happens entirely inside TWS/Gateway and this app just opens a local socket.
