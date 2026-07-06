-- Roundup Automator — SQLite schema (source of truth for structured data).
-- Local file: data/roundup.db (gitignored). Use WAL mode + transactions.
-- PRAGMA journal_mode=WAL;

-- Sites: one row per blog you manage (multi-site). Per-site WordPress creds +
-- categories + Pinterest accounts. Shared creds (Dolphin token, PinClicks,
-- Gemini) live in config/secrets.json, not here.
CREATE TABLE IF NOT EXISTS sites (
  id                  INTEGER PRIMARY KEY AUTOINCREMENT,
  name                TEXT NOT NULL,
  slug                TEXT,
  wp_url              TEXT,
  wp_username         TEXT,
  wp_app_password     TEXT,
  wp_site_name        TEXT,   -- auto-discovered on connect
  wp_authors          TEXT,   -- JSON array of {id, name, slug} (auto-discovered)
  categories          TEXT,   -- JSON array of {id, name} (auto-discovered from WP)
  pinterest_accounts  TEXT,   -- JSON array of {dolphinProfileId, name, boards?}
  active              INTEGER DEFAULT 0,  -- 1 = currently selected site
  created_at          TEXT DEFAULT (datetime('now')),
  updated_at          TEXT DEFAULT (datetime('now'))
);

-- Input queue: what to research/write next.
CREATE TABLE IF NOT EXISTS topics (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  keyword       TEXT NOT NULL,
  title         TEXT,
  type          TEXT DEFAULT 'roundup',        -- roundup | how-to | ...
  status        TEXT DEFAULT 'pending',        -- pending | researching | writing | done | error
  priority      INTEGER DEFAULT 0,
  created_at    TEXT DEFAULT (datetime('now')),
  updated_at    TEXT DEFAULT (datetime('now'))
);

-- Agent keyword research output (the "training" data).
CREATE TABLE IF NOT EXISTS keyword_scores (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  keyword           TEXT NOT NULL,
  opportunity_score REAL,                      -- 0-100 composite (NOT a viral guarantee)
  demand            REAL,                      -- Pinterest Trends interest
  ctr_intent        REAL,                      -- 0-1 will searchers CLICK vs just save
  momentum          REAL,                      -- YoY rising / breakout
  competition       REAL,                      -- lower = better (from PinClicks/heuristic)
  seasonal_timing   REAL,                      -- lead-time fit for the target month
  fit               REAL,                      -- matches a site category
  title_suggestion  TEXT,
  pin_description   TEXT,
  hashtags          TEXT,
  peak_month        TEXT,                      -- when Pinterest demand peaks (e.g. "November")
  publish_by        TEXT,                      -- publish-by date to catch the rise (e.g. "mid-September")
  source_notes      TEXT,                      -- raw signals / reasoning
  researched_at     TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_keyword_scores_kw ON keyword_scores(keyword);

-- Published roundup articles.
CREATE TABLE IF NOT EXISTS articles (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  topic_id      INTEGER REFERENCES topics(id),
  wp_post_id    INTEGER,
  title         TEXT,
  slug          TEXT,
  hero_path     TEXT,                          -- local title-card hero
  status        TEXT DEFAULT 'draft',          -- draft | published
  created_at    TEXT DEFAULT (datetime('now')),
  published_at  TEXT
);

-- Each idea inside a roundup (real sourced image + credit).
CREATE TABLE IF NOT EXISTS article_items (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  article_id       INTEGER REFERENCES articles(id),
  position         INTEGER,
  description      TEXT,
  image_url        TEXT,                       -- original source image url
  image_local_path TEXT,                       -- rehosted copy (if that stance chosen)
  source_url       TEXT,                       -- original page for credit
  credit           TEXT,
  ai_vet_score     REAL,                       -- 0-100 likely-AI (lower = more real)
  ai_vet_reason    TEXT
);
CREATE INDEX IF NOT EXISTS idx_items_article ON article_items(article_id);

-- Pinterest pins created for an article.
CREATE TABLE IF NOT EXISTS pins (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  article_id      INTEGER REFERENCES articles(id),
  account_id      TEXT,
  image_path      TEXT,
  title           TEXT,
  description     TEXT,
  status          TEXT DEFAULT 'pending',      -- pending | scheduled | posted | error
  scheduled_at    TEXT,
  posted_at       TEXT,
  pinterest_pin_id TEXT
);
CREATE INDEX IF NOT EXISTS idx_pins_article ON pins(article_id);
CREATE INDEX IF NOT EXISTS idx_pins_status ON pins(status);

-- Real performance over time (feeds the training/feedback loop).
CREATE TABLE IF NOT EXISTS performance (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  pin_id       INTEGER REFERENCES pins(id),
  keyword      TEXT,
  impressions  INTEGER,
  saves        INTEGER,
  clicks       INTEGER,
  captured_at  TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_perf_keyword ON performance(keyword);

-- Background jobs (run state, logs, resume checkpoints, kill switch).
CREATE TABLE IF NOT EXISTS jobs (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  type         TEXT,                           -- research | roundup | post-pins | ...
  status       TEXT DEFAULT 'queued',          -- queued | running | done | error | cancelled
  payload_json TEXT,
  checkpoint   TEXT,                           -- last completed phase (for resume)
  log          TEXT,
  created_at   TEXT DEFAULT (datetime('now')),
  updated_at   TEXT DEFAULT (datetime('now'))
);
