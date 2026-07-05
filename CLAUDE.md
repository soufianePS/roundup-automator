# Roundup Automator — Project Memory & Plan

> This file is the project's durable memory. When a new Claude Code conversation
> opens in this folder, read this FIRST — it captures the vision, every decision,
> the architecture, what to reuse, and the roadmap. Keep it updated as things change.

Owner: Soufiane (works with a friend; both pull the repo via git).
Created: 2026-07-05. Sibling of `../recipe-automator` (the recipe blog tool).

---

## 1. What this app is

Automation for a **new FAMILY / HOME blog** (many categories: home decor, DIY,
holidays, home, lifestyle…). Content format = **idea / inspiration roundups** —
e.g. "Best 25 Home Decor Ideas", "Best 25 Small Living Room Ideas".

Give it a **keyword + title**, and it:
1. Searches the web and **visually picks the best REAL (non-AI) images**.
2. Writes an intro + a short description per idea, each with a **source credit link**.
3. Builds a **designed title-card hero** (branded, Canva-style — NOT AI, NOT a
   collage of other people's photos).
4. Creates **~5 Pinterest pins** with AI (edit a source image + add title/SEO),
   saves them, posts via **Dolphin Anty** on a schedule.
5. Uploads the article to **WordPress** as a draft.

Plus **keyword intelligence**: the agent pulls **Pinterest Trends** + **PinClicks**
(owner has the paid version) to find high-opportunity, low-competition keywords, and
returns an **opportunity score** + annotations (title formula, pin description,
hashtags). A **feedback loop** using real Pinterest results "trains" the scoring over time.

NO AI images in the article body — real sourced photos + credit links only.
(Opposite of the recipe app, which generates AI images.)

---

## 2. Decisions already made (do not re-litigate)

- **Separate app** from `recipe-automator` (different content model + architecture).
  Leave the recipe app untouched — it works and earns.
- **Agent-primary.** The AI agent (Claude / Fable) is the BRAIN: research, keyword
  scoring, image selection (vision), writing. The APP is HANDS + MEMORY + CLOCK:
  tools, data store, scheduler.
- **Do NOT put the 24/7 cron/Dolphin loop in the agent.** The app scheduler handles
  timed posting. Agent decides what/how; app remembers + executes on schedule.
- **Data: SQLite + JSON, NO server DB.** SQLite is NOT a server — a library + one
  file (`npm install`, runs on any PC). No MySQL/Postgres.
  - SQLite (local, gitignored) = structured/analytical data (keyword scores, pins,
    performance, jobs) → powers the training loop with real queries.
  - JSON in git = skills, default config, seed lists (small, shareable).
  - JSON gitignored = secrets (WP password, Dolphin token, PinClicks login, keys).
- **Push/pull model:** git shares CODE, not live data. The `.db` is gitignored
  (binary, can't merge); each machine keeps its own. Share accumulated data by
  handing over the single `.db` file directly if ever needed.
- **Hero = designed title-card** (Sharp), like stylinbysarita.com. NOT AI, NOT a
  collage of scraped photos (collage = derivative work, weakest legally).
- **Reuse proven plumbing** from `recipe-automator` by copying modules (see §5).
- **Model:** Fable for judgment/vision/writing; cheaper models for bulk fetch.

---

## 3. Architecture (agent-primary)

```
 You → dashboard button / CLI → App creates a JOB (SQLite)
                                   │
                   spawns the AGENT (claude -p / headless)
                                   │
  Agent (Fable) thinks, calling app tools via MCP:
    - search_images / fetch_pinterest_trends / fetch_pinclicks
    - vet_image (real vs AI) → pick best images
    - writes roundup JSON + keyword scores
    - calls: save_*, make_title_card, upload_wordpress, generate_pins
                                   │
  App does deterministic + scheduled work:
    - download + AI-vet images, Sharp title-card hero
    - WordPress draft upload
    - ChatGPT pin editing → save pins
    - Planifier/Dolphin posts pins on schedule
                                   │
  Results (impressions/saves) → performance table → feeds next research run
```

- **App = MCP server** exposing tools + SQLite store + scheduler.
- **Agent = invoked to think**, calls those tools. Not the always-on loop.
- Start with: **app spawns headless `claude -p`** pointed at a skill; later expose
  tools via **MCP** so any AI can drive it.

---

## 4. Data model (SQLite)

Full definition in `src/db/schema.sql`. Tables:
- `topics` — input queue (keyword, title, type, status).
- `keyword_scores` — agent research output: opportunity score + sub-signals +
  annotations (title, pin description, hashtags). The training data.
- `articles` — published roundups (WP post id, slug, status).
- `article_items` — each idea (description, image url, source url, credit).
- `pins` — each pin (image, title, desc, account, schedule, posted id).
- `performance` — real results per pin over time (impressions/saves/clicks) — the
  feedback fuel.
- `jobs` — run state + logs (background jobs, kill switch, resume checkpoints).

---

## 5. Reuse map (copy from ../recipe-automator, don't reinvent)

- **Dolphin Anty driver + Pinterest login/session/browse-simulator** — trickiest,
  already working. (`src/modules/planifier/*`, `src/shared/pages/pinterest.js`)
- **Network-sniff technique** — reverse-engineered Flow's API with it; reuse the
  same pattern for **Pinterest Trends JSON** + **PinClicks**.
  (recipe-automator memory `flow-network-api-replay`, `gemini-network-listener.js`)
- **WordPress client** — media upload + draft. (`src/shared/utils/wordpress-api.js`)
- **Sharp** — title-card hero.
- **Planifier scheduler** — timed posting, gap/cap, + the catch-up age-cap fix
  (recipe-automator commit ecc7470: don't fire stale slots on server restart).
- **Dashboard shell + logging** pattern.
- **Bug lessons:** read-modify-write races on state (SQLite transactions fix this);
  the recipe Logger is in-memory only (no file sink) — add durable logging here.

---

## 6. Open decisions (SETTLE before deep build)

1. **Copyright stance for sourced images** (biggest):
   (a) rehost + credit + takedown policy (prettiest, some risk) ←owner leaning here
       (stylinbysarita model + DMCA badge);
   (b) official embeds (safest, less pretty);
   (c) licensed-only sources (safe, fewer images).
2. **Which AI runs the agent** — Claude Code headless with Fable (recommended).
3. **AI-image vetting** — date filter (pre-2022 = guaranteed real) + trusted sources
   + vision/detector step. No watermark is reliable (SynthID = Google/OpenAI only,
   strippable).
4. **Performance feedback source** — how to pull per-pin impressions/saves from
   Pinterest (Playwright or export) to fuel training.

---

## 7. Roadmap / first tasks

- [x] Scaffold: folders, package.json, .gitignore, git init.
- [ ] SQLite schema + tiny db helper (prefer Node built-in `node:sqlite` — no
      dependency — else `better-sqlite3`).
- [ ] Settle copyright stance (§6.1).
- [ ] Keyword-research skill + opportunity-scoring rubric (PinClicks + Trends).
- [ ] Copy Dolphin + Pinterest + WP + Sharp modules from recipe-automator.
- [ ] Roundup-writer skill → roundup JSON.
- [ ] App downstream: image download + vet → title-card hero → WP draft → pins.
- [ ] MCP tool layer so the agent calls app functions.
- [ ] Performance feedback loop (later, once real results exist).

---

## 7b. Skills & plugins setup

- The **`anthropic-agent-skills` marketplace is global** (`~/.claude/settings.json`
  → `extraKnownMarketplaces`). It's already available here — do NOT re-add it.
- To use a plugin's skills IN this project (and share with the friend via git),
  enable it at **project scope**: run `/plugin` in this folder, enable the plugin,
  choose "project" scope. That writes `.claude/settings.json`:
  ```json
  { "enabledPlugins": { "wp-rest-api@anthropic-agent-skills": true } }
  ```
- The WordPress skills recipe-automator uses (`wp-rest-api`, `wp-wpcli-and-ops`, …)
  come from a separate `skills-lock.json` (source: `WordPress/agent-skills`), not the
  marketplace. For this app the useful one is **`wp-rest-api`** (WordPress uploads).
- `.claude/` is typically gitignored for local settings; enable plugins at PROJECT
  scope if you want them committed/shared with your friend.

## 8. Related knowledge (recipe-automator memory, reusable)

- `flow-network-api-replay` — reverse-engineer a Google web app's API via in-page
  fetch + network sniff + reCAPTCHA minting (the technique for Trends/PinClicks).
- `never-touch-playwright-profiles` — HARD RULE: never delete/move Chromium profile
  folders; passwords unrecoverable.
- Recipe app: `../recipe-automator` (github.com/soufianePS/recipe-automator).
