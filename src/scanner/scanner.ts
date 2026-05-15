import { getUnderlyingPrice, getOptionsChain, getExpirations } from '../ib/optionsChain';
import { applyPremiumFilter } from './filters';
import { insertScanResult } from '../db/scanResults';
import type { ScannerConfig, ScanResult } from '../types';

export async function runScan(config: ScannerConfig): Promise<ScanResult[]> {
  const expirations = getExpirations(config.maxDte);
  const allResults: ScanResult[] = [];

  console.log(`Scanning ${expirations.length} expiration(s) between ${config.minDte}-${config.maxDte} DTE… and ${config.minPremiumPct}-${config.maxPremiumPct} pct of underlying`);

  for (const symbol of config.symbols) {
    let underlyingPrice: number;
    try {
      underlyingPrice = await getUnderlyingPrice(symbol);
      console.log(`\n${symbol} last price: $${underlyingPrice.toFixed(2)}`);
    } catch (err) {
      console.error(`  Failed to get price for ${symbol}:`, err);
      continue;
    }

    for (const expiration of expirations) {
      for (const right of ['C', 'P'] as const) {
        let contracts;
        try {
          contracts = await getOptionsChain(symbol, underlyingPrice, expiration, right);
        } catch (err) {
          continue;
        }

        const hits = applyPremiumFilter(contracts, config);

        for (const result of hits) {
          insertScanResult(result);
          allResults.push(result);
        }
      }
    }
  }

  return allResults;
}
