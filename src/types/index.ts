export interface OptionGreeks {
  iv?: number;
  delta?: number;
  gamma?: number;
  theta?: number;
  vega?: number;
}

export interface OptionContract extends OptionGreeks {
  symbol: string;
  strike: number;
  expiration: string; // YYYYMMDD
  right: 'C' | 'P';
  premium: number;
  underlyingPrice: number;
  volume?: number;
}

export interface ScanResult extends OptionGreeks {
  symbol: string;
  strike: number;
  expiration: string;
  right: 'C' | 'P';
  premium: number;
  premiumPct: number;
  dte: number;
  volume?: number;
  underlyingPrice?: number;
  scannedAt: string; // ISO timestamp
}

export interface ScannerConfig {
  symbols: readonly string[];
  minPremiumPct: number;
  maxPremiumPct: number;
  minDte: number;
  maxDte: number;
  minVolume: number;
}
