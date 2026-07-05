/**
 * One-time login for the agent's RESEARCH browser profile.
 *
 * The in-app agent drives a Playwright-MCP browser that uses this same
 * persistent profile (mcp.config.json → playwright → --user-data-dir
 * data/browser-profiles/research). Logging in here ONCE means the agent is
 * already authenticated on PinClicks + Pinterest and never sees your passwords.
 *
 *   npm run browser:login
 *
 * It opens PinClicks and Pinterest Trends in tabs. Log in manually (your
 * PinClicks creds are printed to THIS terminal for convenience), then just
 * close the window — the session is saved to the profile on disk.
 *
 * Uses bundled Chromium (NOT the chrome channel) to match Playwright MCP's
 * `--browser chromium`, and a DEDICATED profile dir (never your real Chrome
 * profile) — per the recipe-app lesson that chrome-channel + real profile hangs.
 */
import { chromium } from 'playwright';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { secretOpt } from '../src/config.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROFILE_DIR = join(__dirname, '..', 'data', 'browser-profiles', 'research');

const pc = secretOpt('pinclicks') || {};
console.log('\n=== Research browser login ===');
console.log('Profile:', PROFILE_DIR);
if (pc.email) console.log(`PinClicks login → email: ${pc.email}  password: ${pc.password || '(not set)'}`);
else console.log('PinClicks creds not in secrets.json (Settings → Connections).');
console.log('\nLog into PinClicks + Pinterest in the window, then CLOSE it to save the session.\n');

const ctx = await chromium.launchPersistentContext(PROFILE_DIR, {
  headless: false,
  viewport: null,
  args: ['--disable-blink-features=AutomationControlled', '--no-first-run', '--no-default-browser-check'],
  ignoreDefaultArgs: ['--enable-automation'],
});

const p1 = ctx.pages()[0] || await ctx.newPage();
await p1.goto('https://app.pinclicks.com/login').catch(() => p1.goto('https://pinclicks.com'));
const p2 = await ctx.newPage();
await p2.goto('https://trends.pinterest.com/').catch(() => {});

ctx.on('close', () => { console.log('Session saved. You can close this terminal.'); process.exit(0); });
// Keep alive until the user closes the browser window.
await new Promise(() => {});
