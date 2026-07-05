/**
 * Thin data-access helpers over the SQLite db. All writes use prepared statements
 * (safe params) and single statements are atomic — no read-modify-write races
 * like the recipe app had with JSON/Sheets state.
 */
import { getDb } from './db.js';

const db = () => getDb();

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
  save(k) {
    return db().prepare(`INSERT INTO keyword_scores
      (keyword, opportunity_score, demand, momentum, competition, seasonal_timing, fit,
       title_suggestion, pin_description, hashtags, source_notes)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
      k.keyword, k.opportunity_score ?? null, k.demand ?? null, k.momentum ?? null,
      k.competition ?? null, k.seasonal_timing ?? null, k.fit ?? null,
      k.title_suggestion ?? null, k.pin_description ?? null,
      Array.isArray(k.hashtags) ? k.hashtags.join(' ') : (k.hashtags ?? null),
      k.source_notes ?? null
    ).lastInsertRowid;
  },
  top(limit = 25) {
    return db().prepare('SELECT * FROM keyword_scores ORDER BY opportunity_score DESC LIMIT ?').all(limit);
  },
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
