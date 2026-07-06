/**
 * Tiny SQLite helper. Uses Node's built-in `node:sqlite` (Node 22+, no dependency).
 * If your Node build doesn't expose it, install `better-sqlite3` and swap the import.
 *
 *   node src/db/db.js --init   → create data/roundup.db from schema.sql
 */
import { DatabaseSync } from 'node:sqlite';
import { readFileSync, mkdirSync, existsSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..', '..');
const DATA_DIR = join(ROOT, 'data');
const DB_PATH = join(DATA_DIR, 'roundup.db');
const SCHEMA_PATH = join(__dirname, 'schema.sql');

let _db = null;

export function getDb() {
  if (_db) return _db;
  if (!existsSync(DATA_DIR)) mkdirSync(DATA_DIR, { recursive: true });
  _db = new DatabaseSync(DB_PATH);
  _db.exec('PRAGMA journal_mode = WAL;');
  _db.exec(readFileSync(SCHEMA_PATH, 'utf8')); // idempotent (CREATE IF NOT EXISTS)
  _migrate(_db); // add columns introduced after a db already existed
  return _db;
}

// Additive migrations — each ALTER is idempotent (ignored if the column exists).
function _migrate(db) {
  const add = (table, col, decl) => { try { db.exec(`ALTER TABLE ${table} ADD COLUMN ${col} ${decl}`); } catch { /* exists */ } };
  add('sites', 'wp_site_name', 'TEXT');
  add('sites', 'wp_authors', 'TEXT');
  add('keyword_scores', 'peak_month', 'TEXT');
  add('keyword_scores', 'publish_by', 'TEXT');
  add('keyword_scores', 'ctr_intent', 'REAL');
  add('keyword_scores', 'annotations', 'TEXT');
  add('keyword_scores', 'top_pin_saves', 'INTEGER');
  add('keyword_scores', 'search_volume', 'INTEGER');
  add('keyword_scores', 'trend_points', 'TEXT');
}

export function tables() {
  const db = getDb();
  return db.prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").all().map(r => r.name);
}

// CLI: --init
if (process.argv.includes('--init')) {
  const t = tables();
  console.log(`[db] initialized ${DB_PATH}`);
  console.log(`[db] tables: ${t.join(', ')}`);
}
