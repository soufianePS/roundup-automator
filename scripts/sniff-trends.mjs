/**
 * Network sniffer for trends.pinterest.com — discovers the internal JSON API
 * (endpoints + params) so the app can call it directly (fast, no UI clicking).
 * Uses the logged-in research profile. Run while nothing else holds the profile.
 */
import { chromium } from 'playwright';
import { writeFileSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const PROFILE = join(ROOT, 'data', 'browser-profiles', 'research');
const OUT = join(ROOT, 'data', 'sniff');
mkdirSync(OUT, { recursive: true });

const captured = [];
const ctx = await chromium.launchPersistentContext(PROFILE, { headless: true, viewport: { width: 1400, height: 900 } });
const page = ctx.pages()[0] || await ctx.newPage();

page.on('response', async (res) => {
  const url = res.url();
  const ct = res.headers()['content-type'] || '';
  if (!ct.includes('json')) return;
  if (!/trends\.pinterest\.com|pinterest\.com\/resource|pinterest\.com\/v3/.test(url)) return;
  let body = null;
  try { body = await res.json(); } catch { return; }
  const size = JSON.stringify(body).length;
  captured.push({ url, status: res.status(), size });
  // keep full samples of the interesting (big) ones
  if (size > 500) {
    const safe = url.replace(/[^a-z0-9]/gi, '_').slice(0, 120);
    writeFileSync(join(OUT, `trends-${captured.length}-${safe}.json`), JSON.stringify({ url, body }, null, 1));
  }
});

console.log('[sniff] loading trends home…');
await page.goto('https://trends.pinterest.com/', { waitUntil: 'networkidle', timeout: 60000 }).catch(e => console.log('goto:', e.message));
await page.waitForTimeout(4000);

// Try a keyword detail page too (curve data endpoint)
console.log('[sniff] loading a keyword detail…');
await page.goto('https://trends.pinterest.com/?country=US&query=fall%20decor', { waitUntil: 'networkidle', timeout: 60000 }).catch(e => console.log('goto2:', e.message));
await page.waitForTimeout(5000);

console.log('\n[sniff] captured JSON endpoints:');
for (const c of captured) console.log(`${c.status}  ${c.size}b  ${c.url.slice(0, 180)}`);
await ctx.close();
console.log(`\n[sniff] full samples in ${OUT}`);
