/**
 * Browser launchers (Playwright). Two ways to get a context:
 *   - launchDolphinContext(profileId): start a Dolphin Anty profile and attach
 *     Playwright over CDP (for Pinterest posting / PinClicks / Trends on real
 *     logged-in profiles). Uses the shared Dolphin creds from secrets.json.
 *   - launchLocalContext(profileDir): a plain persistent Chromium profile (for
 *     general scraping/research that doesn't need a Dolphin identity).
 *
 * NEVER delete/move the Chromium/Dolphin profile folders — logins are unrecoverable.
 */
import { chromium } from 'playwright';
import { DolphinAnty } from './dolphin.js';
import { Logger } from './logger.js';
import { secret } from '../config.js';

/** Start a Dolphin profile and connect Playwright over CDP. */
export async function launchDolphinContext(profileId) {
  const dolphin = new DolphinAnty({ dolphinAnty: secret('dolphinAnty') });
  const { port } = await dolphin.startAndGetCDP(profileId);
  Logger.info(`[Browser] Dolphin profile ${profileId} on CDP port ${port}`);
  const browser = await chromium.connectOverCDP(`http://localhost:${port}`);
  const context = browser.contexts()[0] || (await browser.newContext());
  return {
    browser, context, dolphin, port,
    async close() {
      try { await browser.close(); } catch {}
      try { await dolphin.stopProfile(profileId); } catch {}
    },
  };
}

/** Plain persistent Chromium context (no Dolphin). */
export async function launchLocalContext(profileDir) {
  const context = await chromium.launchPersistentContext(profileDir, {
    headless: false,
    viewport: null,
    args: [
      '--disable-blink-features=AutomationControlled',
      '--no-first-run', '--no-default-browser-check',
      '--disable-session-crashed-bubble', '--disable-infobars', '--hide-crash-restore-bubble',
    ],
    ignoreDefaultArgs: ['--enable-automation'],
    timeout: 30000,
  });
  return context;
}
