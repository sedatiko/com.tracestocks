import express, { Request, Response } from 'express';
import path from 'path';
import {
  queryResults,
  getScansTimeline,
  getSymbolSummaries,
  getPremiumPctDistribution,
  type ResultsQuery,
} from '../db/scanResults';
import { closeDb } from '../db/database';

const PORT = Number(process.env['PORT'] ?? 3000);
const PUBLIC_DIR = path.join(process.cwd(), 'web');

function num(v: unknown): number | undefined {
  if (typeof v !== 'string') return undefined;
  const n = Number(v);
  return Number.isFinite(n) ? n : undefined;
}

function parseRight(v: unknown): 'C' | 'P' | undefined {
  if (v === 'C' || v === 'P') return v;
  return undefined;
}

const app = express();

app.use(express.json());

app.get('/api/health', (_req: Request, res: Response) => {
  res.json({ ok: true, time: new Date().toISOString() });
});

app.get('/api/results', (req: Request, res: Response) => {
  const q: ResultsQuery = {};
  if (typeof req.query['symbol']     === 'string') q.symbol     = String(req.query['symbol']).toUpperCase();
  const right = parseRight(req.query['right']);
  if (right) q.right = right;
  const minDte         = num(req.query['minDte']);
  const maxDte         = num(req.query['maxDte']);
  const minPremiumPct  = num(req.query['minPremiumPct']);
  const maxPremiumPct  = num(req.query['maxPremiumPct']);
  const limit          = num(req.query['limit']);
  if (minDte != null)        q.minDte        = minDte;
  if (maxDte != null)        q.maxDte        = maxDte;
  if (minPremiumPct != null) q.minPremiumPct = minPremiumPct;
  if (maxPremiumPct != null) q.maxPremiumPct = maxPremiumPct;
  if (typeof req.query['scannedAt'] === 'string') q.scannedAt = String(req.query['scannedAt']);
  if (limit != null)         q.limit         = limit;

  res.json({ results: queryResults(q) });
});

app.get('/api/scans', (req: Request, res: Response) => {
  const limit = num(req.query['limit']) ?? 50;
  res.json({ scans: getScansTimeline(limit) });
});

app.get('/api/symbols', (_req: Request, res: Response) => {
  res.json({ symbols: getSymbolSummaries() });
});

app.get('/api/distribution', (req: Request, res: Response) => {
  const bucketSize = num(req.query['bucketSize']) ?? 0.5;
  res.json({ distribution: getPremiumPctDistribution(bucketSize), bucketSize });
});

// Static frontend
app.use(express.static(PUBLIC_DIR));
app.get('/', (_req: Request, res: Response) => {
  res.sendFile(path.join(PUBLIC_DIR, 'index.html'));
});

const server = app.listen(PORT, () => {
  console.log(`tracestocks web on http://localhost:${PORT}`);
  console.log(`Serving static files from ${PUBLIC_DIR}`);
});

function shutdown(): void {
  server.close(() => {
    closeDb();
    process.exit(0);
  });
}

process.on('SIGINT',  shutdown);
process.on('SIGTERM', shutdown);
