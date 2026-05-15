# Trace Stocks

A TypeScript/Node.js tool that connects to **Interactive Brokers TWS** to scan
equity option chains for contracts whose premium falls inside a configurable
percentage band of the underlying price. Scan hits are persisted to a local
SQLite database and exposed through a small Express + vanilla-JS web dashboard.

---

## Features

- **IBKR integration** via [`@stoqey/ib`](https://github.com/stoqey/ib) (TWS or
  IB Gateway, on the standard local socket).
- **`balance` CLI command** — prints Net Liquidation, Cash, Gross Positions,
  Available Funds, and Buying Power from `reqAccountSummary`.
- **`optscan` CLI command** — for each symbol in
  [src/config.ts](src/config.ts):
  - fetches the underlying last price,
  - enumerates weekly expirations between `minDte` and `maxDte`,
  - requests snapshot market data for strikes within `±strikeRangePct` of the
    underlying for both calls and puts,
  - keeps contracts whose `premium / underlyingPrice` falls inside
    `[minPremiumPct, maxPremiumPct]`,
  - filters to OTM only (calls: strike > spot, puts: strike < spot),
  - persists every hit to `scan_results` in `tracestocks.db`.
- **Web dashboard** (`npm run server`) — Express API + static frontend at
  `http://localhost:3000` showing per-symbol cards, premium % distribution
  chart, recent scans timeline, and a filterable results table.
- **Frozen / delayed market data aware** — configurable
  `marketDataType` so paper accounts without live data subscriptions still
  return prices.

---

## Project layout

```
src/
  config.ts              # All runtime config (IB host/port, scanner bands, DB path)
  main.ts                # CLI entrypoint — dispatches `balance` and `optscan`
  ib/
    connection.ts        # Singleton IBApi client, connect/disconnect
    account.ts           # reqAccountSummary -> AccountBalance
    optionsChain.ts      # Snapshot market-data scanning, expiration helpers
  scanner/
    scanner.ts           # Orchestrates per-symbol / per-expiration scan loop
    filters.ts           # Premium %, DTE, volume, OTM filtering
  db/
    database.ts          # better-sqlite3 init + idempotent schema migration
    scanResults.ts       # Insert + query helpers, summaries, distributions
  server/
    server.ts            # Express JSON API + static file server
  types/
    index.ts             # Shared types (OptionContract, ScanResult, …)
web/                     # Static frontend (HTML / CSS / vanilla JS, Chart.js)
index.js                 # ts-node bootstrap -> src/main.ts
server.js                # ts-node bootstrap -> src/server/server.ts
```

---

## Prerequisites

1. **Node.js 20+** (anything supporting ES2022 will work).
2. **Interactive Brokers TWS or IB Gateway** running locally with the API
   enabled:
   - TWS → *File ▸ Global Configuration ▸ API ▸ Settings*
   - Check **Enable ActiveX and Socket Clients**
   - Add `127.0.0.1` to **Trusted IPs**
   - Note the **Socket port** (defaults: TWS live `7496`, TWS paper `7497`,
     IB Gateway live `4001`, IB Gateway paper `4002`)
3. A C/C++ build toolchain for `better-sqlite3` to compile native bindings:
   - **Windows:** install Visual Studio Build Tools (the
     "Desktop development with C++" workload) — the installer for
     `better-sqlite3` ships prebuilt binaries for most Node versions, so this
     is usually not needed.
   - **macOS:** Xcode Command Line Tools (`xcode-select --install`).
   - **Linux:** `build-essential` (apt) or `base-devel` (pacman).

---

## Clone & run on a new computer

```bash
# 1. Clone
git clone https://github.com/<your-user>/tracestocks.git
cd tracestocks

# 2. Install dependencies
npm install

# 3. Make sure TWS / IB Gateway is running and logged in.
#    Verify config.ib.port in src/config.ts matches your TWS API port.

# 4. Quick connection sanity check — prints your account balance
npm run balance

# 5. Run the option scanner (writes hits to tracestocks.db in the project root)
npm run optscan

# 6. (Optional) launch the web dashboard
npm run server
# then open http://localhost:3000
```

A fresh `tracestocks.db` is created automatically on first run; the schema is
applied idempotently by [src/db/database.ts](src/db/database.ts).

---

## Configuration

All knobs live in [src/config.ts](src/config.ts):

| Key | Purpose |
| --- | --- |
| `ib.host` / `ib.port` / `ib.clientId` | TWS/Gateway connection target. |
| `ib.marketDataType` | `1` live · `2` frozen · `3` delayed · `4` delayed-frozen. Default is `2` so paper accounts without an options market-data subscription still get frozen quotes. |
| `scanner.symbols` | Underlyings to scan. |
| `scanner.minPremiumPct` / `maxPremiumPct` | Premium-to-spot band a contract must fall inside to qualify. |
| `scanner.minDte` / `maxDte` | Days-to-expiration window. |
| `scanner.minVolume` | Minimum option volume (skipped when IB does not report it). |
| `optionsChain.strikeRangePct` | Strikes within ±this fraction of the underlying are scanned. |
| `optionsChain.weeksOut` | Used by `nearestExpiration` helper. |
| `db.path` | SQLite file location — defaults to `<cwd>/tracestocks.db`. |

The web server reads `process.env.PORT` (default `3000`); everything else is
file-driven.

---

## How the option scan works

1. `getExpirations(maxDte)` builds a list of weekly Friday expirations between
   today and `maxDte`.
2. For each symbol, `getUnderlyingPrice` issues a snapshot
   `reqMktData` on the STK contract and resolves on the first tick price.
3. For each `(symbol, expiration, right)` tuple, `getOptionsChain` builds the
   strike grid `[spot·(1−r), spot·(1+r)]` (step = $1 / $5 / $10 depending on
   underlying price), requests snapshot market data per strike, and waits for
   `tickSnapshotEnd` (or an error) on every reqId before resolving.
4. `applyPremiumFilter` computes `premiumPct`, restricts to OTM, and enforces
   the DTE/premium/volume bands.
5. Every passing contract is inserted into `scan_results` and printed to
   stdout.

IB request-IDs are reserved per request batch via a module-level counter in
[src/ib/optionsChain.ts](src/ib/optionsChain.ts) so handlers can demultiplex
`tickPrice` / `tickSize` / `tickSnapshotEnd` / `error` events back to the right
strike.

---

## Web API

| Method · path | Description |
| --- | --- |
| `GET /api/health` | Liveness probe. |
| `GET /api/results` | Filterable scan-result rows. Query params: `symbol`, `right` (`C`/`P`), `minDte`, `maxDte`, `minPremiumPct`, `maxPremiumPct`, `scannedAt`, `limit`. |
| `GET /api/scans` | Recent scans timeline (`?limit=` default 50). |
| `GET /api/symbols` | Per-symbol summary (scan count, best call/put %, last underlying, last scan time). |
| `GET /api/distribution` | Premium % histogram (`?bucketSize=` default 0.5). |

The frontend in [web/](web/) consumes these endpoints with `fetch` and
renders the dashboard.

---

## Useful scripts

```bash
npm run balance      # IB account summary
npm run optscan      # Run a scan and persist results
npm run server       # Start the web dashboard on PORT (default 3000)
npm run typecheck    # tsc --noEmit
```

---

## What is *not* committed

The repo is intentionally lean. The following are gitignored — none of them are
needed to reproduce the project on another machine:

- `tracestocks.db` (+ `*.db-wal` / `*.db-shm`) — your local scan history.
- `node_modules/` and `dist/` — regenerated by `npm install` / `tsc`.
- `.env*`, `*.pem`, `*.key` — any future secrets.
- `.vscode/`, `.idea/` — local editor settings.
- `.claude/settings.local.json` — local Claude Code permissions.
- OS / OneDrive cruft (`.DS_Store`, `Thumbs.db`, `desktop.ini`, `.fuse_hidden*`).

> Note: this project does **not** store IBKR credentials anywhere. Authentication
> happens in TWS / IB Gateway itself; the app simply opens a local socket to it.

---

## License

ISC (see `package.json`).
