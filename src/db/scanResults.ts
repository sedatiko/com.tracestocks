import { getDb } from './database';
import type { ScanResult } from '../types';

const SELECT_COLS = `
  symbol,
  strike,
  expiration,
  right,
  premium,
  premium_pct      AS premiumPct,
  dte,
  volume,
  underlying_price AS underlyingPrice,
  iv,
  delta,
  gamma,
  theta,
  vega,
  scanned_at       AS scannedAt
`;

export function insertScanResult(result: ScanResult): void {
  const db = getDb();
  db.prepare(`
    INSERT INTO scan_results (
      symbol, strike, expiration, right, premium, premium_pct,
      dte, volume, underlying_price, iv, delta, gamma, theta, vega, scanned_at
    ) VALUES (
      @symbol, @strike, @expiration, @right, @premium, @premiumPct,
      @dte, @volume, @underlyingPrice, @iv, @delta, @gamma, @theta, @vega, @scannedAt
    )
  `).run({
    symbol: result.symbol,
    strike: result.strike,
    expiration: result.expiration,
    right: result.right,
    premium: result.premium,
    premiumPct: result.premiumPct,
    dte: result.dte,
    volume: result.volume ?? null,
    underlyingPrice: result.underlyingPrice ?? null,
    iv: result.iv ?? null,
    delta: result.delta ?? null,
    gamma: result.gamma ?? null,
    theta: result.theta ?? null,
    vega: result.vega ?? null,
    scannedAt: result.scannedAt,
  });
}

export interface ResultsQuery {
  symbol?: string;
  right?: 'C' | 'P';
  minDte?: number;
  maxDte?: number;
  minPremiumPct?: number;
  maxPremiumPct?: number;
  scannedAt?: string;
  scannedAfter?: string;
  limit?: number;
}

export function queryResults(q: ResultsQuery = {}): ScanResult[] {
  const db = getDb();
  const where: string[] = [];
  const params: Record<string, unknown> = {};

  if (q.symbol)        { where.push('symbol = @symbol');                      params['symbol']        = q.symbol; }
  if (q.right)         { where.push('right = @right');                        params['right']         = q.right; }
  if (q.minDte != null){ where.push('dte >= @minDte');                        params['minDte']        = q.minDte; }
  if (q.maxDte != null){ where.push('dte <= @maxDte');                        params['maxDte']        = q.maxDte; }
  if (q.minPremiumPct != null) { where.push('premium_pct >= @minPremiumPct'); params['minPremiumPct'] = q.minPremiumPct; }
  if (q.maxPremiumPct != null) { where.push('premium_pct <= @maxPremiumPct'); params['maxPremiumPct'] = q.maxPremiumPct; }
  if (q.scannedAt)     { where.push('scanned_at = @scannedAt');               params['scannedAt']     = q.scannedAt; }
  if (q.scannedAfter)  { where.push('scanned_at > @scannedAfter');            params['scannedAfter']  = q.scannedAfter; }

  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const limit = Math.min(Math.max(q.limit ?? 500, 1), 5000);

  return db.prepare(`
    SELECT ${SELECT_COLS}
    FROM scan_results
    ${whereSql}
    ORDER BY scanned_at DESC, premium_pct DESC
    LIMIT ${limit}
  `).all(params) as ScanResult[];
}

export function getRecentResults(limit = 100): ScanResult[] {
  return queryResults({ limit });
}

export interface ScanSummary {
  scannedAt: string;
  total: number;
  symbols: number;
  avgPremiumPct: number;
  maxPremiumPct: number;
}

export function getScansTimeline(limit = 50): ScanSummary[] {
  const db = getDb();
  return db.prepare(`
    SELECT
      scanned_at                       AS scannedAt,
      COUNT(*)                         AS total,
      COUNT(DISTINCT symbol)           AS symbols,
      ROUND(AVG(premium_pct), 2)       AS avgPremiumPct,
      ROUND(MAX(premium_pct), 2)       AS maxPremiumPct
    FROM scan_results
    GROUP BY scanned_at
    ORDER BY scanned_at DESC
    LIMIT ?
  `).all(limit) as ScanSummary[];
}

export interface SymbolSummary {
  symbol: string;
  scanCount: number;
  bestCallPct: number | null;
  bestPutPct: number | null;
  lastUnderlying: number | null;
  lastScanned: string;
}

export function getSymbolSummaries(): SymbolSummary[] {
  const db = getDb();
  return db.prepare(`
    SELECT
      symbol,
      COUNT(*)                                                            AS scanCount,
      ROUND(MAX(CASE WHEN right = 'C' THEN premium_pct END), 2)           AS bestCallPct,
      ROUND(MAX(CASE WHEN right = 'P' THEN premium_pct END), 2)           AS bestPutPct,
      (SELECT underlying_price FROM scan_results s2
        WHERE s2.symbol = s1.symbol AND s2.underlying_price IS NOT NULL
        ORDER BY scanned_at DESC LIMIT 1)                                 AS lastUnderlying,
      MAX(scanned_at)                                                     AS lastScanned
    FROM scan_results s1
    GROUP BY symbol
    ORDER BY symbol
  `).all() as SymbolSummary[];
}

export interface DistributionBucket {
  bucket: number;
  count: number;
}

export function getPremiumPctDistribution(bucketSize = 0.5): DistributionBucket[] {
  const db = getDb();
  return db.prepare(`
    SELECT
      ROUND((premium_pct / @bucketSize)) * @bucketSize AS bucket,
      COUNT(*)                                         AS count
    FROM scan_results
    GROUP BY bucket
    ORDER BY bucket
  `).all({ bucketSize }) as DistributionBucket[];
}
