/**
 * Thin data-access helpers over the SQLite db. All writes use prepared statements
 * (safe params) and single statements are atomic — no read-modify-write races
 * like the recipe app had with JSON/Sheets state.
 */
import { getDb } from './db.js';

const db = () => getDb();

const _json = (v, fallback) => { try { return v ? JSON.parse(v) : fallback; } catch { return fallback; } };
function _rowToSite(r) {
  if (!r) return null;
  return { ...r, categories: _json(r.categories, []), pinterest_accounts: _json(r.pinterest_accounts, []),
    wp_authors: _json(r.wp_authors, []), active: !!r.active };
}

export const Sites = {
  add(s) {
    return db().prepare(`INSERT INTO sites
      (name, slug, wp_url, wp_username, wp_app_password, wp_site_name, wp_authors, categories, pinterest_accounts, active)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0)`).run(
      s.name, s.slug ?? null, s.wp_url ?? null, s.wp_username ?? null, s.wp_app_password ?? null,
      s.wp_site_name ?? null, JSON.stringify(s.wp_authors ?? []),
      JSON.stringify(s.categories ?? []), JSON.stringify(s.pinterest_accounts ?? [])
    ).lastInsertRowid;
  },
  list() { return db().prepare('SELECT * FROM sites ORDER BY id ASC').all().map(_rowToSite); },
  get(id) { return _rowToSite(db().prepare('SELECT * FROM sites WHERE id=?').get(id)); },
  getActive() { return _rowToSite(db().prepare('SELECT * FROM sites WHERE active=1 LIMIT 1').get()); },
  update(id, s) {
    const cur = db().prepare('SELECT * FROM sites WHERE id=?').get(id);
    if (!cur) return false;
    const m = { ...cur, ...s };
    db().prepare(`UPDATE sites SET name=?, slug=?, wp_url=?, wp_username=?, wp_app_password=?,
      wp_site_name=?, wp_authors=?, categories=?, pinterest_accounts=?, updated_at=datetime('now') WHERE id=?`).run(
      m.name, m.slug ?? null, m.wp_url ?? null, m.wp_username ?? null, m.wp_app_password ?? null,
      s.wp_site_name ?? cur.wp_site_name ?? null,
      JSON.stringify(s.wp_authors ?? _json(cur.wp_authors, [])),
      JSON.stringify(s.categories ?? _json(cur.categories, [])),
      JSON.stringify(s.pinterest_accounts ?? _json(cur.pinterest_accounts, [])), id
    );
    return true;
  },
  remove(id) { db().prepare('DELETE FROM sites WHERE id=?').run(id); },
  setActive(id) {
    const tx = db();
    tx.prepare('UPDATE sites SET active=0').run();
    tx.prepare('UPDATE sites SET active=1 WHERE id=?').run(id);
  },
};

export const Topics = {
  add(keyword, title = null, type = 'roundup', priority = 0) {
    return db().prepare(
      'INSERT INTO topics (keyword, title, type, priority) VALUES (?, ?, ?, ?)'
    ).run(keyword, title, type, priority).lastInsertRowid;
  },
  nextPending() {
    return db().prepare("SELECT * FROM topics WHERE status='pending' ORDER BY priority DESC, id ASC LIMIT 1").get();
  },
  list(status = null) {
    return status
      ? db().prepare('SELECT * FROM topics WHERE status=? ORDER BY id DESC').all(status)
      : db().prepare('SELECT * FROM topics ORDER BY id DESC').all();
  },
  setStatus(id, status) {
    db().prepare("UPDATE topics SET status=?, updated_at=datetime('now') WHERE id=?").run(status, id);
  },
};

export const KeywordScores = {
  // Has this keyword already been surfaced (any state incl. dismissed)? For dedup.
  find(keyword) {
    return db().prepare('SELECT * FROM keyword_scores WHERE keyword=? COLLATE NOCASE ORDER BY id DESC LIMIT 1').get(String(keyword || '').trim());
  },
  recentKeywords(limit = 300) {
    return db().prepare('SELECT keyword FROM keyword_scores ORDER BY id DESC LIMIT ?').all(limit).map(r => r.keyword);
  },
  setLiked(id, liked) { db().prepare('UPDATE keyword_scores SET liked=? WHERE id=?').run(liked ? 1 : 0, id); },
  likedList(limit = 100) { return db().prepare('SELECT * FROM keyword_scores WHERE liked=1 AND dismissed=0 ORDER BY opportunity_score DESC LIMIT ?').all(limit); },
  save(k) {
    // Dedup: if this keyword was scored before, UPDATE that row instead of adding a
    // duplicate — so the same trend never clutters the radar twice.
    const existing = this.find(k.keyword);
    if (existing) {
      db().prepare(`UPDATE keyword_scores SET opportunity_score=?, demand=?, ctr_intent=?, momentum=?,
        competition=?, seasonal_timing=?, fit=?, title_suggestion=?, pin_description=?, hashtags=?,
        peak_month=?, publish_by=?, annotations=?, top_pin_saves=?, search_volume=?, trend_points=?,
        source_notes=?, dismissed=0, researched_at=datetime('now') WHERE id=?`).run(
        k.opportunity_score ?? null, k.demand ?? null, k.ctr_intent ?? null, k.momentum ?? null,
        k.competition ?? null, k.seasonal_timing ?? null, k.fit ?? null,
        k.title_suggestion ?? null, k.pin_description ?? null,
        Array.isArray(k.hashtags) ? k.hashtags.join(' ') : (k.hashtags ?? null),
        k.peak_month ?? null, k.publish_by ?? null,
        Array.isArray(k.annotations) ? k.annotations.join(', ') : (k.annotations ?? null),
        k.top_pin_saves ?? null, k.search_volume ?? null,
        Array.isArray(k.trend_points) ? JSON.stringify(k.trend_points) : (k.trend_points ?? null),
        k.source_notes ?? null, existing.id);
      return existing.id;
    }
    return db().prepare(`INSERT INTO keyword_scores
      (keyword, opportunity_score, demand, ctr_intent, momentum, competition, seasonal_timing, fit,
       title_suggestion, pin_description, hashtags, peak_month, publish_by,
       annotations, top_pin_saves, search_volume, trend_points, source_notes)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
      k.keyword, k.opportunity_score ?? null, k.demand ?? null, k.ctr_intent ?? null, k.momentum ?? null,
      k.competition ?? null, k.seasonal_timing ?? null, k.fit ?? null,
      k.title_suggestion ?? null, k.pin_description ?? null,
      Array.isArray(k.hashtags) ? k.hashtags.join(' ') : (k.hashtags ?? null),
      k.peak_month ?? null, k.publish_by ?? null,
      Array.isArray(k.annotations) ? k.annotations.join(', ') : (k.annotations ?? null),
      k.top_pin_saves ?? null, k.search_volume ?? null,
      Array.isArray(k.trend_points) ? JSON.stringify(k.trend_points) : (k.trend_points ?? null),
      k.source_notes ?? null
    ).lastInsertRowid;
  },
  top(limit = 25) {
    return db().prepare('SELECT * FROM keyword_scores WHERE dismissed=0 ORDER BY opportunity_score DESC LIMIT ?').all(limit);
  },
  // The most recently researched batch (newest first), then callers sort by score.
  // "Show me the 15 topics to work on now" = the agent's latest research run.
  latest(limit = 15) {
    return db().prepare('SELECT * FROM keyword_scores WHERE dismissed=0 ORDER BY id DESC LIMIT ?').all(limit);
  },
  // Rows saved OR updated since a timestamp = the last run's results (upsert bumps
  // researched_at, so this catches dedup-updated rows too — unlike an id cutoff).
  since(tsIso, limit = 60) {
    return db().prepare('SELECT * FROM keyword_scores WHERE dismissed=0 AND researched_at >= ? ORDER BY opportunity_score DESC LIMIT ?').all(String(tsIso || ''), limit);
  },
  // Soft-delete: hides from the radar but keeps the record so dedup won't re-surface it.
  remove(id) { db().prepare('UPDATE keyword_scores SET dismissed=1 WHERE id=?').run(id); },
};

export const KeywordBank = {
  upsertMany(rows, seed) {
    const stmt = db().prepare(`INSERT INTO keyword_bank (keyword, volume, url, taxonomy, source_seed)
      VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(keyword) DO UPDATE SET volume=excluded.volume, url=excluded.url,
        taxonomy=excluded.taxonomy, source_seed=excluded.source_seed, exported_at=datetime('now')`);
    let n = 0;
    for (const r of rows) {
      const kw = String(r.keyword || '').trim().toLowerCase();
      if (!kw) continue;
      stmt.run(kw, r.volume ?? null, r.url ?? null, r.taxonomy ?? null, seed ?? null);
      n++;
    }
    return n;
  },
  count() { return db().prepare('SELECT COUNT(*) n FROM keyword_bank').get().n; },
  // Offline discovery query: filter by substring(s), volume band, exclude patterns, sort.
  query({ like = null, anyOf = null, minVolume = 0, maxVolume = null, exclude = null, sort = 'volume', limit = 200 } = {}) {
    const where = ['volume >= ?']; const args = [minVolume || 0];
    if (maxVolume) { where.push('volume <= ?'); args.push(maxVolume); }
    if (like) { where.push('keyword LIKE ?'); args.push('%' + like.toLowerCase() + '%'); }
    if (Array.isArray(anyOf) && anyOf.length) {
      where.push('(' + anyOf.map(() => 'keyword LIKE ?').join(' OR ') + ')');
      anyOf.forEach(t => args.push('%' + String(t).toLowerCase() + '%'));
    }
    if (Array.isArray(exclude)) exclude.forEach(t => { where.push('keyword NOT LIKE ?'); args.push('%' + String(t).toLowerCase() + '%'); });
    const order = sort === 'keyword' ? 'keyword ASC' : 'volume DESC';
    args.push(Math.min(limit || 200, 1000));
    return db().prepare(`SELECT keyword, volume, url, taxonomy, source_seed FROM keyword_bank WHERE ${where.join(' AND ')} ORDER BY ${order} LIMIT ?`).all(...args);
  },
  seeds() { return db().prepare("SELECT source_seed seed, COUNT(*) n, MAX(exported_at) last FROM keyword_bank GROUP BY source_seed ORDER BY last DESC").all(); },
};

export const Articles = {
  create(a) {
    return db().prepare(
      'INSERT INTO articles (topic_id, title, slug, hero_path, status) VALUES (?, ?, ?, ?, ?)'
    ).run(a.topic_id ?? null, a.title, a.slug ?? null, a.hero_path ?? null, a.status ?? 'draft').lastInsertRowid;
  },
  setPublished(id, wpPostId) {
    db().prepare("UPDATE articles SET wp_post_id=?, status='published', published_at=datetime('now') WHERE id=?").run(wpPostId, id);
  },
};

export const ArticleItems = {
  add(articleId, item) {
    return db().prepare(`INSERT INTO article_items
      (article_id, position, description, image_url, image_local_path, source_url, credit, ai_vet_score, ai_vet_reason)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
      articleId, item.position ?? null, item.description ?? null, item.image_url ?? null,
      item.image_local_path ?? null, item.source_url ?? null, item.credit ?? null,
      item.ai_vet_score ?? null, item.ai_vet_reason ?? null
    ).lastInsertRowid;
  },
  forArticle(articleId) {
    return db().prepare('SELECT * FROM article_items WHERE article_id=? ORDER BY position ASC').all(articleId);
  },
};

export const Pins = {
  enqueue(p) {
    return db().prepare(`INSERT INTO pins
      (article_id, account_id, image_path, title, description, status, scheduled_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)`).run(
      p.article_id ?? null, p.account_id ?? null, p.image_path ?? null,
      p.title ?? null, p.description ?? null, p.status ?? 'pending', p.scheduled_at ?? null
    ).lastInsertRowid;
  },
  dueForPosting(nowIso) {
    return db().prepare("SELECT * FROM pins WHERE status='scheduled' AND scheduled_at<=? ORDER BY scheduled_at ASC").all(nowIso);
  },
  markPosted(id, pinterestPinId) {
    db().prepare("UPDATE pins SET status='posted', posted_at=datetime('now'), pinterest_pin_id=? WHERE id=?").run(pinterestPinId, id);
  },
};

export const Performance = {
  record(pinId, keyword, m) {
    db().prepare('INSERT INTO performance (pin_id, keyword, impressions, saves, clicks) VALUES (?, ?, ?, ?, ?)')
      .run(pinId, keyword, m.impressions ?? 0, m.saves ?? 0, m.clicks ?? 0);
  },
};

export const Jobs = {
  create(type, payload) {
    return db().prepare("INSERT INTO jobs (type, status, payload_json) VALUES (?, 'queued', ?)")
      .run(type, JSON.stringify(payload ?? {})).lastInsertRowid;
  },
  update(id, fields) {
    const sets = [], vals = [];
    for (const [k, v] of Object.entries(fields)) { sets.push(`${k}=?`); vals.push(v); }
    sets.push("updated_at=datetime('now')");
    db().prepare(`UPDATE jobs SET ${sets.join(', ')} WHERE id=?`).run(...vals, id);
  },
};
