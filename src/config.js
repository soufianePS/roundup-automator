/**
 * Config loader — merges committed defaults with local secrets.
 *
 *   config/default.json        committed, non-secret (categories, weights, …)
 *   config/secrets.json        LOCAL, gitignored (WP creds, Dolphin token, …)
 *   config/secrets.example.json committed template — copy to secrets.json and fill.
 *
 * Usage:  import { config, secret } from './config.js';
 *         config.categories        // from default.json
 *         secret('wordpress').url  // from secrets.json (throws if missing)
 */
import { readFileSync, writeFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const CONFIG_DIR = join(__dirname, '..', 'config');
const SECRETS_PATH = join(CONFIG_DIR, 'secrets.json');

function _read(name) {
  const p = join(CONFIG_DIR, name);
  if (!existsSync(p)) return null;
  try { return JSON.parse(readFileSync(p, 'utf8')); }
  catch (e) { throw new Error(`Bad JSON in config/${name}: ${e.message}`); }
}

export const config = _read('default.json') || {};

let _secrets = _read('secrets.json');
if (!_secrets) {
  // Non-fatal at import (some tools run without secrets); secret() throws on demand.
  _secrets = {};
  console.warn('[config] config/secrets.json not found — copy config/secrets.example.json and fill it.');
}

/** Get a required secrets section, with a clear error if it's missing/empty. */
export function secret(section) {
  const v = _secrets[section];
  if (v === undefined) throw new Error(`Secret section "${section}" not found in config/secrets.json`);
  return v;
}

/** Soft accessor — returns undefined instead of throwing (for optional secrets). */
export function secretOpt(section) {
  return _secrets ? _secrets[section] : undefined;
}

/** Merge one section into secrets.json and persist (used by the Settings UI). */
export function saveSecretSection(section, value) {
  _secrets = { ..._secrets, [section]: { ...(_secrets[section] || {}), ...value } };
  writeFileSync(SECRETS_PATH, JSON.stringify(_secrets, null, 2));
  return _secrets[section];
}
