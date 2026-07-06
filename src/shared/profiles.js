/**
 * Browser-profile manager. Lets the app hold MULTIPLE logged-in Chromium profiles
 * under data/browser-profiles/ and switch which one is "active". Everything that
 * touches the research browser (login window, Trends fast API, the agent's
 * Playwright-MCP browser) uses the ACTIVE profile.
 *
 * Why: if one profile gets Cloudflare-blocked (e.g. PinClicks), you can spin up a
 * fresh profile and switch to it WITHOUT deleting the old one (its logins stay safe).
 *
 * The active profile name is stored in data/browser-profiles/.active (default
 * "research"). Profile dirs are created lazily on first Chromium launch.
 */
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync } from 'fs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..', '..');
const BASE = join(ROOT, 'data', 'browser-profiles');
const ACTIVE_FILE = join(BASE, '.active');
const DEFAULT = 'research';

const clean = (name) => String(name || '').trim();
const valid = (name) => /^[a-z0-9][a-z0-9_-]{0,40}$/i.test(name);

export function profileDir(name) { return join(BASE, clean(name) || DEFAULT); }

export function activeProfileName() {
  try { const n = clean(readFileSync(ACTIVE_FILE, 'utf8')); if (n) return n; } catch {}
  return DEFAULT;
}
export function activeProfileDir() { return profileDir(activeProfileName()); }

export function listProfiles() {
  let dirs = [];
  try { dirs = readdirSync(BASE, { withFileTypes: true }).filter(d => d.isDirectory()).map(d => d.name); } catch {}
  const active = activeProfileName();
  if (!dirs.includes(DEFAULT)) dirs.unshift(DEFAULT);
  if (!dirs.includes(active)) dirs.push(active); // active-but-not-yet-launched profile
  return dirs.map(name => ({ name, active: name === active, exists: existsSync(profileDir(name)) }));
}

export function setActiveProfile(name) {
  const n = clean(name);
  if (!valid(n)) throw new Error('Profile name must be letters/numbers/-/_ (max 40).');
  if (!existsSync(BASE)) mkdirSync(BASE, { recursive: true });
  writeFileSync(ACTIVE_FILE, n);
  return n;
}

/** Create (register) a new profile name and make it active. The dir is created on first launch. */
export function createProfile(name) {
  const n = clean(name);
  if (!valid(n)) throw new Error('Profile name must be letters/numbers/-/_ (max 40).');
  if (existsSync(profileDir(n))) throw new Error(`Profile "${n}" already exists.`);
  return setActiveProfile(n);
}
