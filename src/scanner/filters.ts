import { calcDte } from '../ib/optionsChain';
import type { OptionContract, ScanResult, ScannerConfig } from '../types';

export function applyPremiumFilter(
  contracts: OptionContract[],
  config: ScannerConfig,
): ScanResult[] {
  const now = new Date().toISOString();

  return contracts
    .filter((c) => c.right === 'C' ? c.strike > c.underlyingPrice : c.strike < c.underlyingPrice)
    .map((c): ScanResult => {
      const premiumPct = (c.premium / c.underlyingPrice) * 100;
      const r: ScanResult = {
        symbol: c.symbol,
        strike: c.strike,
        expiration: c.expiration,
        right: c.right,
        premium: c.premium,
        premiumPct: Math.round(premiumPct * 100) / 100,
        dte: calcDte(c.expiration),
        underlyingPrice: c.underlyingPrice,
        scannedAt: now,
      };
      if (c.volume !== undefined) r.volume = c.volume;
      if (c.iv     !== undefined) r.iv    = c.iv;
      if (c.delta  !== undefined) r.delta = c.delta;
      if (c.gamma  !== undefined) r.gamma = c.gamma;
      if (c.theta  !== undefined) r.theta = c.theta;
      if (c.vega   !== undefined) r.vega  = c.vega;
      return r;
    })
    .filter(
      (r) =>
        r.dte >= config.minDte &&
        r.dte <= config.maxDte &&
        r.premiumPct >= config.minPremiumPct &&
        r.premiumPct <= config.maxPremiumPct &&
        (r.volume === undefined || r.volume >= config.minVolume),
    );
}
