import Database from 'better-sqlite3';
import { config } from '../config';

let db: Database.Database | null = null;

export function getDb(): Database.Database {
  if (!db) {
    db = new Database(config.db.path);
    db.pragma('journal_mode = WAL');
    applySchema(db);
  }
  return db;
}

interface ColumnInfo {
  cid: number;
  name: string;
  type: string;
  notnull: number;
  dflt_value: unknown;
  pk: number;
}

function applySchema(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS scan_results (
      id              INTEGER PRIMARY KEY AUTOINCREMENT,
      symbol          TEXT    NOT NULL,
      strike          REAL    NOT NULL,
      expiration      TEXT    NOT NULL,
      right           TEXT    NOT NULL CHECK(right IN ('C', 'P')),
      premium         REAL    NOT NULL,
      premium_pct     REAL    NOT NULL,
      scanned_at      TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
    );

    CREATE INDEX IF NOT EXISTS idx_scan_results_symbol
      ON scan_results (symbol);

    CREATE INDEX IF NOT EXISTS idx_scan_results_scanned_at
      ON scan_results (scanned_at);
  `);

  // Idempotent column migrations - safe on existing DBs.
  const columns = db.prepare(`PRAGMA table_info(scan_results)`).all() as ColumnInfo[];
  const have = new Set(columns.map((c) => c.name));

  const addColumn = (name: string, type: string): void => {
    if (!have.has(name)) {
      db.exec(`ALTER TABLE scan_results ADD COLUMN ${name} ${type}`);
    }
  };

  addColumn('dte',              'INTEGER');
  addColumn('volume',           'INTEGER');
  addColumn('underlying_price', 'REAL');
  addColumn('iv',               'REAL');
  addColumn('delta',            'REAL');
  addColumn('gamma',            'REAL');
  addColumn('theta',            'REAL');
  addColumn('vega',             'REAL');
}

export function closeDb(): void {
  db?.close();
  db = null;
}
