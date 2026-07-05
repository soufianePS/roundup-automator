/**
 * WordPress REST client — generic parts adapted from recipe-automator
 * (dropped all recipe-specific code: WPRM, recipe schema, delete-with-media).
 * Uses global fetch (Node 18+). Sharp is optional (WebP conversion) — loaded
 * lazily so the base app runs without it installed.
 *
 * MULTI-SITE: every method takes a `site` object from the sites table:
 *   { wp_url, wp_username, wp_app_password }.
 */
import { Logger } from './logger.js';

const WEBP_QUALITY = 90;

function _wp(site) {
  if (!site || !site.wp_url || !site.wp_username || !site.wp_app_password) {
    throw new Error('WordPress creds incomplete for site (need wp_url, wp_username, wp_app_password)');
  }
  return { url: site.wp_url.replace(/\/+$/, ''), username: site.wp_username, appPassword: site.wp_app_password };
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
  /** Authors/users (needs authentication + edit context). */
  async getUsers(site) {
    const w = _wp(site);
    const r = await _fetchRetry(`${w.url}/wp-json/wp/v2/users?per_page=100&context=edit`, { headers: { Authorization: _auth(w) } });
    if (!r.ok) throw new Error(`users ${r.status}`);
    return (await r.json()).map(u => ({ id: u.id, name: u.name, slug: u.slug }));
  },

  /** Categories (public). */
  async getCategories(site) {
    const w = _wp(site);
    const r = await _fetchRetry(`${w.url}/wp-json/wp/v2/categories?per_page=100&orderby=count&order=desc`, { headers: { Authorization: _auth(w) } });
    if (!r.ok) throw new Error(`categories ${r.status}`);
    return (await r.json()).map(c => ({ id: c.id, name: c.name, count: c.count }));
  },

  /**
   * Connect + auto-discover everything we need from a WP site given only
   * url + username + application password: site name, authors, categories.
   */
  async probe(site) {
    const w = _wp(site);
    // Validate auth first — fail FAST (single attempt, short timeout) so the
    // "Connect" button gives quick feedback on a bad URL/creds.
    let authed = false, me = null;
    try {
      const r = await fetch(`${w.url}/wp-json/wp/v2/users/me?context=edit`,
        { headers: { Authorization: _auth(w) }, signal: AbortSignal.timeout(9000) });
      authed = r.ok; if (r.ok) me = await r.json();
    } catch (e) {
      const msg = /timeout|abort/i.test(e.message) ? 'timed out' : e.message;
      return { ok: false, error: `Could not reach ${w.url} (${msg})` };
    }
    if (!authed) return { ok: false, error: 'Authentication failed — check username / application password.' };

    let siteName = '';
    try { const r = await _fetchRetry(`${w.url}/wp-json`, { headers: { Authorization: _auth(w) } }); if (r.ok) siteName = (await r.json()).name || ''; } catch {}
    const users = await this.getUsers(site).catch(() => (me ? [{ id: me.id, name: me.name, slug: me.slug }] : []));
    const categories = await this.getCategories(site).catch(() => []);
    Logger.success(`[WP] connected ${w.url} — "${siteName}", ${users.length} authors, ${categories.length} categories`);
    return { ok: true, siteName, users, categories };
  },

  /** Upload an image buffer (optionally WebP-converted) → { id, url }. */
  async uploadImage(site, buffer, filename, seo = {}) {
    const w = _wp(site);
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
  async categoryId(site, name) {
    if (!name) return null;
    const w = _wp(site);
    const q = await _fetchRetry(`${w.url}/wp-json/wp/v2/categories?search=${encodeURIComponent(name)}`, { headers: { Authorization: _auth(w) } });
    if (q.ok) { const list = await q.json(); const hit = list.find(c => c.name.toLowerCase() === name.toLowerCase()); if (hit) return hit.id; }
    const c = await _fetchRetry(`${w.url}/wp-json/wp/v2/categories`, {
      method: 'POST', headers: { Authorization: _auth(w), 'Content-Type': 'application/json' }, body: JSON.stringify({ name }),
    });
    if (c.ok) return (await c.json()).id;
    return null;
  },

  /** Create a draft post → { id, link }. */
  async createDraft(site, title, contentHtml, { featuredImageId = 0, slug = '', categoryName = '', meta = {} } = {}) {
    const w = _wp(site);
    const body = { title, content: contentHtml, status: 'draft' };
    if (slug) body.slug = slug;
    if (featuredImageId) body.featured_media = featuredImageId;
    if (categoryName) { const id = await this.categoryId(site, categoryName); if (id) body.categories = [id]; }
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
