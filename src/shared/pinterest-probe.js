/**
 * Probe a Pinterest account by briefly launching its Dolphin profile and
 * reading the logged-in username + boards. Best-effort: username is reliable,
 * boards depend on Pinterest's (flaky) DOM. Requires the Dolphin desktop app.
 */
import { launchDolphinContext } from './browser.js';
import { Logger } from './logger.js';

// Pinterest system path segments that look like /segment/ but aren't usernames.
const DENY = new Set(['engagement', 'business', 'settings', 'ideas', 'today', 'pin', 'search',
  'news_hub', 'following', 'followers', 'analytics', 'ads', 'messages', 'notifications', 'discover']);

export async function probePinterestAccount(profileId) {
  const ctx = await launchDolphinContext(profileId);
  try {
    const page = await ctx.context.newPage();
    await page.goto('https://www.pinterest.com/', { waitUntil: 'domcontentloaded', timeout: 45000 });
    await page.waitForTimeout(5000);

    // Username = first /segment/ link that isn't a Pinterest system path.
    const candidates = await page.evaluate(() => {
      const s = new Set();
      for (const a of document.querySelectorAll('a[href^="/"]')) {
        const h = a.getAttribute('href') || '';
        if (/^\/[A-Za-z0-9_]+\/?$/.test(h)) s.add(h.replace(/\//g, ''));
      }
      return [...s];
    });
    const username = candidates.find(s => s && !DENY.has(s.toLowerCase())) || null;
    if (!username) { Logger.warn(`[Pinterest] probe ${profileId}: could not detect username (logged out?)`); return { ok: false, error: 'not logged in / username not found' }; }

    // Boards from the main profile page (board cards link to /username/board-slug/).
    let boards = [];
    try {
      await page.goto(`https://www.pinterest.com/${username}/`, { waitUntil: 'domcontentloaded', timeout: 45000 });
      await page.waitForTimeout(5000);
      boards = await page.evaluate((u) => {
        const re = new RegExp('^/' + u + '/[A-Za-z0-9_%-]+/?$', 'i');
        const names = new Set();
        for (const a of document.querySelectorAll('a[href]')) {
          const h = a.getAttribute('href') || '';
          if (!re.test(h)) continue;
          if (/\/_(saved|created)\/?$/i.test(h)) continue;
          const t = (a.getAttribute('aria-label') || a.textContent || '').trim();
          if (t && t.length < 70 && !/^(created|saved|more ideas)$/i.test(t)) names.add(t);
        }
        return [...names].slice(0, 60);
      }, username);
    } catch (e) { Logger.warn(`[Pinterest] boards read failed for @${username}: ${e.message}`); }

    Logger.success(`[Pinterest] probed ${profileId}: @${username} · ${boards.length} boards`);
    return { ok: true, username, boards };
  } finally {
    await ctx.close();
  }
}
