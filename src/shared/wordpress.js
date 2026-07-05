/**
 * WordPress REST client — generic parts adapted from recipe-automator
 * (dropped all recipe-specific code: WPRM, recipe schema, delete-with-media).
 * Uses global fetch (Node 18+). Sharp is optional (WebP conversion) — loaded
 * lazily so the base app runs without it installed.
 *
 * Credentials come from config/secrets.json → secret('wordpress').
 */
import { Logger } from './logger.js';
import { secret } from '../config.js';

const WEBP_QUALITY = 90;

function _wp() {
  const w = secret('wordpress');
  if (!w.url || !w.username || !w.appPassword) {
    throw new Error('WordPress creds incomplete in config/secrets.json (need url, username, appPassword)');
  }
  return w;
}
function _auth(w) { return 'Basic ' + Buffer.from(`${w.username}:${w.appPassword}`).toString('base64'); }

async function _fetchRetry(url, options, maxRetries = 4) {
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      const resp = await fetch(url, options);
      if ((resp.status === 408 || resp.status >= 500) && attempt < maxRetries) {
        Logger.warn(`[WP] ${resp.status} — retry ${attempt}/${maxRetries}`);
        await new Promise(r => setTimeout(r, attempt * 4000));
        continue;
      }
      return resp;
    } catch (e) {
      if (attempt === maxRetries) throw new Error(`[WP] ${options?.method || 'GET'} failed after ${maxRetries}: ${e.message}`);
      Logger.warn(`[WP] network error — retry ${attempt}/${maxRetries}: ${e.message}`);
      await new Promise(r => setTimeout(r, attempt * 4000));
    }
  }
}

export const WordPress = {
  /** Upload an image buffer (optionally WebP-converted) → { id, url }. */
  async uploadImage(buffer, filename, seo = {}) {
    const w = _wp();
    let buf = buffer, name = filename;
    try {
      const sharp = (await import('sharp')).default;
      buf = await sharp(buffer).webp({ quality: WEBP_QUALITY }).toBuffer();
      name = filename.replace(/\.(jpe?g|png|webp)$/i, '') + '.webp';
    } catch { if (!/\.(jpe?g|png|webp)$/i.test(name)) name += '.jpg'; }

    const boundary = '----FormBoundary' + Math.random().toString(36).slice(2);
    const mime = name.endsWith('.webp') ? 'image/webp' : 'image/jpeg';
    const head = Buffer.from(
      `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${name}"\r\nContent-Type: ${mime}\r\n\r\n`, 'utf8');
    let meta = '';
    if (seo.alt_text)    meta += `--${boundary}\r\nContent-Disposition: form-data; name="alt_text"\r\n\r\n${seo.alt_text}\r\n`;
    if (seo.title)       meta += `--${boundary}\r\nContent-Disposition: form-data; name="title"\r\n\r\n${seo.title}\r\n`;
    if (seo.description) meta += `--${boundary}\r\nContent-Disposition: form-data; name="caption"\r\n\r\n${seo.description}\r\n`;
    meta += `--${boundary}--\r\n`;
    const body = Buffer.concat([head, buf, Buffer.from('\r\n', 'utf8'), Buffer.from(meta, 'utf8')]);

    const resp = await _fetchRetry(`${w.url}/wp-json/wp/v2/media`, {
      method: 'POST',
      headers: { Authorization: _auth(w), 'Content-Type': `multipart/form-data; boundary=${boundary}` },
      body,
    });
    if (!resp.ok) throw new Error(`[WP] media upload failed: ${resp.status} ${(await resp.text()).slice(0, 200)}`);
    const j = await resp.json();
    Logger.info(`[WP] uploaded media ${j.id} (${name})`);
    return { id: j.id, url: j.source_url };
  },

  /** Resolve a category name → id (creates it if missing). */
  async categoryId(name) {
    if (!name) return null;
    const w = _wp();
    const q = await _fetchRetry(`${w.url}/wp-json/wp/v2/categories?search=${encodeURIComponent(name)}`, { headers: { Authorization: _auth(w) } });
    if (q.ok) { const list = await q.json(); const hit = list.find(c => c.name.toLowerCase() === name.toLowerCase()); if (hit) return hit.id; }
    const c = await _fetchRetry(`${w.url}/wp-json/wp/v2/categories`, {
      method: 'POST', headers: { Authorization: _auth(w), 'Content-Type': 'application/json' }, body: JSON.stringify({ name }),
    });
    if (c.ok) return (await c.json()).id;
    return null;
  },

  /** Create a draft post → { id, link }. */
  async createDraft(title, contentHtml, { featuredImageId = 0, slug = '', categoryName = '', meta = {} } = {}) {
    const w = _wp();
    const body = { title, content: contentHtml, status: 'draft' };
    if (slug) body.slug = slug;
    if (featuredImageId) body.featured_media = featuredImageId;
    if (categoryName) { const id = await this.categoryId(categoryName); if (id) body.categories = [id]; }
    if (meta && Object.keys(meta).length) body.meta = meta;

    const resp = await _fetchRetry(`${w.url}/wp-json/wp/v2/posts`, {
      method: 'POST', headers: { Authorization: _auth(w), 'Content-Type': 'application/json' }, body: JSON.stringify(body),
    });
    if (!resp.ok) throw new Error(`[WP] draft create failed: ${resp.status} ${(await resp.text()).slice(0, 200)}`);
    const j = await resp.json();
    Logger.success(`[WP] draft created: ${j.id}`);
    return { id: j.id, link: j.link };
  },
};
