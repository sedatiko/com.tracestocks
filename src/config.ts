import path from 'path';

export const config = {
  ib: {
    host: '127.0.0.1',
    port: 7496,           // paper trading; live TWS uses 7496, live Gateway uses 4001
    clientId: 1,
    marketDataType: 2,    // 1=live, 2=frozen, 3=delayed (15 min), 4=delayed frozen
  },

  db: {
    path: path.join(process.cwd(), 'tracestocks.db'),
  },

  scanner: {
    symbols: ['AAPL', 'MSFT', 'AMD', 'GOOG'],
    minPremiumPct: 2.5,
    maxPremiumPct: 10.0,
    minDte: 20,
    maxDte: 80,
    minVolume: 1000,
  },

  optionsChain: {
    strikeRangePct: 0.10,  // scan strikes within ±10% of current price
    weeksOut: 10,
  },
} as const;
