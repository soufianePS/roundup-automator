/** Extract all Interest names + IDs from the /search page dropdown DOM. */
import { chromium } from 'playwright';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROFILE = join(__dirname, '..', 'data', 'browser-profiles', 'research');
const ctx = await chromium.launchPersistentContext(PROFILE, { headless: true, viewport: { width: 1500, height: 950 } });
const page = ctx.pages()[0] || await ctx.newPage();

await page.goto('https://trends.pinterest.com/search?country=US', { waitUntil: 'networkidle', timeout: 60000 }).catch(() => {});
await page.waitForTimeout(3000);
for (const b of await page.$$('button')) {
  const t = ((await b.textContent()) || '').trim();
  if (/^Interest$/i.test(t) && await b.isVisible().catch(() => false)) { await b.click(); break; }
}
await page.waitForTimeout(1500);

// checkboxes/inputs with values, or elements with ids in the open popover
const found = await page.evaluate(() => {
  const out = [];
  document.querySelectorAll('input[type="checkbox"], input[type="radio"], [role="option"], label').forEach(el => {
    const label = (el.closest('label')?.textContent || el.getAttribute('aria-label') || el.textContent || '').trim();
    const val = el.value || el.getAttribute('data-value') || el.id || el.getAttribute('data-test-id') || '';
    if (label && label.length < 40) out.push({ label, val });
  });
  return out;
});
console.log(JSON.stringify(found, null, 1));
await ctx.close();
