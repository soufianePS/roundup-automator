/**
 * Agent research browser — one PERSISTENT profile the agent reuses.
 *
 * This is the SAME on-disk profile the agent's Playwright-MCP browser uses
 * (mcp.config.json → playwright → --user-data-dir data/browser-profiles/research).
 * The owner opens it once from Settings, logs into all their accounts (Pinterest,
 * PinClicks, ChatGPT, Gemini, …) and closes it. The sessions persist on disk, so
 * the agent is then already logged in — and no passwords ever touch the agent's
 * context.
 *
 * Only ONE Chromium can hold a user-data-dir at a time, so the login window and
 * the agent's browser cannot run simultaneously — close one before the other.
 */
import { chromium } from 'playwright';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { existsSync } from 'fs';
import { Logger } from './logger.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROFILE_DIR = join(__dirname, '..', '..', 'data', 'browser-profiles', 'research');

// Tabs opened on login so the owner can sign into everything in one pass.
export const DEFAULT_TABS = [
  { name: 'Pinterest', url: 'https://www.pinterest.com/login/' },
  { name: 'Pinterest Trends', url: 'https://trends.pinterest.com/' },
  { name: 'PinClicks', url: 'https://app.pinclicks.com/login' },
  { name: 'ChatGPT', url: 'https://chatgpt.com/' },
  { name: 'Gemini', url: 'https://gemini.google.com/app' },
];

let _ctx = null; // the live login-session context, if open

export const researchProfileDir = () => PROFILE_DIR;
export const isLoginSessionOpen = () => !!_ctx;
export const profileExists = () => existsSync(PROFILE_DIR);

/** Launch the persistent profile (headed) and open the login tabs. */
export async function openLoginSession(tabs = DEFAULT_TABS) {
  if (_ctx) return { ok: true, already: true };
  let ctx;
  try {
    ctx = await chromium.launchPersistentContext(PROFILE_DIR, {
      headless: false,
      viewport: null,
      args: ['--disable-blink-features=AutomationControlled', '--no-first-run', '--no-default-browser-check',
        '--disable-session-crashed-bubble', '--hide-crash-restore-bubble'],
      ignoreDefaultArgs: ['--enable-automation'],
      timeout: 30000,
    });
  } catch (e) {
    // Most common cause: the agent's browser already holds this profile.
    throw new Error(`Could not open the profile (is the agent currently browsing?): ${e.message}`);
  }
  _ctx = ctx;
  ctx.on('close', () => { _ctx = null; Logger.info('[browser] login session closed — sessions saved'); });

  const existing = ctx.pages();
  for (let i = 0; i < tabs.length; i++) {
    const page = i === 0 ? (existing[0] || await ctx.newPage()) : await ctx.newPage();
    page.goto(tabs[i].url, { waitUntil: 'domcontentloaded', timeout: 40000 }).catch(() => {});
  }
  Logger.success('[browser] login window open — log into your accounts, then CLOSE the window to save.');
  return { ok: true, tabs: tabs.map(t => t.name) };
}

/** Close the login session (also happens when the owner closes the window). */
export async function closeLoginSession() {
  if (!_ctx) return { ok: true, already: true };
  try { await _ctx.close(); } catch {}
  _ctx = null;
  return { ok: true };
}
