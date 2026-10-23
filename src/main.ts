// Suppress noisy IB informational codes before any output occurs
const _origError = console.error.bind(console);
console.error = (...args: unknown[]) => {
  const msg = args.join(' ');
  if (msg.includes('10167')) return;
  _origError(...args);
};

import { connect, disconnect } from './ib/connection';
import { getAccountBalance, printAccountBalance } from './ib/account';
import { runScan } from './scanner/scanner';
import { buyOptionLimit } from './ib/orders';
import { closeDb } from './db/database';
import { cleanEarlierScans } from './db/scanResults';
import { config } from './config';

const c = {
  reset:     '\x1b[0m',
  bold:      '\x1b[1m',
  blue:      '\x1b[34m',
  boldGreen: '\x1b[1;32m',
};

const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

function fmtExpiration(exp: string): string {
  const month = MONTHS[parseInt(exp.slice(4, 6), 10) - 1] ?? exp.slice(4, 6);
  const day   = exp.slice(6, 8);
  const year  = exp.slice(0, 4);
  return `${day}-${c.boldGreen}${month}${c.reset}-${year}`;
}

async function cmdBalance(): Promise<void> {
  const balance = await getAccountBalance();
  printAccountBalance(balance);
}

async function cmdOptscan(): Promise<void> {
  const results = await runScan(config.scanner);

  console.log(`\n--- Qualifying Contracts (${config.scanner.minPremiumPct}–${config.scanner.maxPremiumPct}% premium, DTE ${config.scanner.minDte}–${config.scanner.maxDte}) ---`);
  results.sort((a, b) => b.premiumPct - a.premiumPct);

  if (results.length === 0) {
    console.log('  No contracts matched.');
  } else {
    for (const r of results) {
      console.log(
        `${c.blue}${r.symbol.padEnd(6)}${c.reset} ${r.right} $${r.strike.toFixed(2).padStart(8)}` +
        `  exp: ${fmtExpiration(r.expiration)}  DTE: ${String(r.dte).padStart(3)}` +
        `  premium: $${r.premium.toFixed(2).padStart(6)} (${r.premiumPct.toFixed(2)}%)`,
      );
    }
  }
  console.log(`---\n${results.length} contract(s) found.`);
}

async function cmdBuy(args: string[]): Promise<void> {
  // Expected args: SYMBOL EXPIRATION STRIKE RIGHT LIMIT_PRICE
  // Example:       AAPL 20260116 200 C 5.40
  const [symbol, expiration, strikeStr, right, lmtStr] = args;

  if (!symbol || !expiration || !strikeStr || !right || !lmtStr) {
    throw new Error('Usage: buy <SYMBOL> <YYYYMMDD> <STRIKE> <C|P> <LIMIT_PRICE>');
  }
  if (right !== 'C' && right !== 'P') {
    throw new Error(`right must be 'C' or 'P', got: ${right}`);
  }
  if (!/^\d{8}$/.test(expiration)) {
    throw new Error(`expiration must be YYYYMMDD, got: ${expiration}`);
  }
  const strike = Number(strikeStr);
  const limitPrice = Number(lmtStr);
  if (!Number.isFinite(strike) || strike <= 0) throw new Error(`invalid strike: ${strikeStr}`);
  if (!Number.isFinite(limitPrice) || limitPrice <= 0) throw new Error(`invalid limit price: ${lmtStr}`);

  console.log(`\n--- Placing BUY LMT order ---`);
  console.log(`  Connected to: ${config.ib.host}:${config.ib.port}`);
  console.log(`  Contract: ${symbol} ${right} $${strike} exp ${expiration}`);
  console.log(`  Quantity: 1 contract`);
  console.log(`  Limit price: $${limitPrice.toFixed(2)} (per share; total premium $${(limitPrice * 100).toFixed(2)})`);

  const result = await buyOptionLimit({
    symbol,
    expiration,
    strike,
    right: right as 'C' | 'P',
    limitPrice,
    quantity: 1,
  });

  console.log(`\n--- Order result ---`);
  console.log(`  orderId:      ${result.orderId}`);
  console.log(`  status:       ${result.status}`);
  console.log(`  filled:       ${result.filled}`);
  console.log(`  remaining:    ${result.remaining}`);
  console.log(`  avgFillPrice: ${result.avgFillPrice}`);
  console.log(`--------------------\n`);
}

async function cmdClean(): Promise<void> {
  const count = cleanEarlierScans();
  console.log(`Cleaned ${count} earlier/expired scan(s) from database.`);
}

const COMMANDS: Record<string, (args: string[]) => Promise<void>> = {
  balance: () => cmdBalance(),
  optscan: () => cmdOptscan(),
  buy:     (args) => cmdBuy(args),
  clean:   () => cmdClean(),
};

async function main(): Promise<void> {
  const cmd = process.argv[2];
  const rest = process.argv.slice(3);

  if (!cmd || !(cmd in COMMANDS)) {
    console.error(`Usage: npm start <command> [args...]\n\nCommands:\n  balance                                              Print portfolio balance\n  optscan                                              Scan for qualifying options contracts\n  buy <SYMBOL> <YYYYMMDD> <STRIKE> <C|P> <LIMIT>       Place a BUY LMT order for 1 contract\n  clean                                                Clean earlier and expired scans`);
    process.exit(1);
  }

  if (cmd === 'clean') {
    await COMMANDS[cmd]!(rest);
    closeDb();
    return;
  }

  await connect();

  await COMMANDS[cmd]!(rest);

  disconnect();
  closeDb();
}

main().catch((err) => {
  console.error('Fatal error:', err);
  disconnect();
  closeDb();
  process.exit(1);
});
