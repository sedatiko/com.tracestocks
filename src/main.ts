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
import { closeDb } from './db/database';
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

const COMMANDS: Record<string, () => Promise<void>> = {
  balance: cmdBalance,
  optscan: cmdOptscan,
};

async function main(): Promise<void> {
  const cmd = process.argv[2];

  if (!cmd || !(cmd in COMMANDS)) {
    console.error(`Usage: npm start <command>\n\nCommands:\n  balance   Print portfolio balance\n  optscan   Scan for qualifying options contracts`);
    process.exit(1);
  }

  await connect();

  await COMMANDS[cmd]!();

  disconnect();
  closeDb();
}

main().catch((err) => {
  console.error('Fatal error:', err);
  disconnect();
  closeDb();
  process.exit(1);
});
