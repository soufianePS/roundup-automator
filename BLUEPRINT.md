# Roundup Automator — Technical Blueprint

Concrete spec for the build. See `CLAUDE.md` for the vision + decisions.

## Folder structure (target)

```
roundup-automator/
├── CLAUDE.md              # project memory (read first)
├── BLUEPRINT.md           # this file
├── README.md
├── package.json
├── .gitignore
├── skills/                # agent skills (committed, shared)
│   ├── keyword-research.md
│   └── roundup-writer.md
├── src/
│   ├── server.js          # express dashboard + job API (later)
│   ├── db/
│   │   ├── schema.sql     # SQLite tables
│   │   └── db.js          # tiny helper (open, migrate, query)
│   ├── tools/             # MCP tools the agent calls (later)
│   ├── pipeline/          # deterministic downstream (image dl+vet, hero, WP, pins)
│   ├── research/          # Pinterest Trends + PinClicks fetchers (network-sniff)
│   ├── shared/            # copied plumbing: dolphin, pinterest, wordpress, sharp
│   └── scheduler/         # planifier (copied + adapted)
├── config/
│   └── default.json       # non-secret defaults (committed)
└── data/                  # GITIGNORED: roundup.db, secrets.json, image cache, logs
```

## SQLite schema

See `src/db/schema.sql`. Prefer Node's built-in `node:sqlite` (Node 22+, no
dependency); fall back to `better-sqlite3` if needed. Use WAL mode + transactions
(avoids the read-modify-write races the recipe app had).

## MCP tools the app exposes (agent calls these)

Research/data:
- `fetch_pinterest_trends(keyword)` → interest curve + related/rising terms (network-sniff)
- `fetch_pinclicks(keyword)` → top pins, save counts, difficulty (paid login)
- `pinterest_autocomplete(seed)` → long-tail variants
- `read_past_performance(filter)` → results for the training loop
Actions:
- `search_images(query, opts)` → candidate images + source URLs
- `vet_image(url|path)` → real/likely-AI score + reason (vision + date + optional detector)
- `download_image(url)` → local path (for hero/pins/rehost)
- `make_title_card(title, opts)` → branded hero image (Sharp)
- `generate_pins(article, n)` → AI-edited pins (reuse recipe ChatGPT-pin flow)
- `upload_wordpress(article)` → draft post id
- `save_keyword_scores(list)` / `save_roundup(json)` / `enqueue_pins(...)` → SQLite

## Agent skills

- `keyword-research.md` — expand seeds → fetch Trends+PinClicks → score with the
  opportunity rubric → return ranked keywords + annotations → save to DB.
- `roundup-writer.md` — given keyword+title → search+vet+pick images → write intro +
  per-item text + credits → return roundup JSON → app builds hero/WP/pins.

## Opportunity score rubric (draft — refine later)

`score = w1*demand + w2*momentum + w3*(1-competition) + w4*seasonalTiming + w5*fit`
- demand: Pinterest Trends interest (0-100, normalized/relative).
- momentum: year-over-year rising? breakout terms?
- competition: PinClicks difficulty / top-pin save density / big-account dominance
  (low = winnable → invert).
- seasonalTiming: are we 30-45 days before the keyword's peak? (lead time).
- fit: matches a site category.
Output an "opportunity score" (0-100) — NOT a promise of virality. Calibrate weights
against real results via the feedback loop.

## Reuse map (copy from ../recipe-automator)

| Need | Copy from |
|---|---|
| Dolphin + Pinterest session/browse | `src/modules/planifier/*`, `src/shared/pages/pinterest.js` |
| Network-sniff pattern | `src/shared/utils/gemini-network-listener.js` + flow.js API code |
| WordPress client | `src/shared/utils/wordpress-api.js` |
| Sharp usage | `src/shared/pages/flow-download.js` (sharp import) |
| Scheduler (with catch-up age-cap fix) | `src/modules/planifier/planifier.js` (commit ecc7470) |
| Dashboard + logging shell | `src/dashboard/*`, `src/shared/utils/logger.js` |

## Phases

1. Scaffold + SQLite + schema (foundation).
2. Keyword-research skill + Trends/PinClicks fetchers → ranked keywords in DB.
3. Copy plumbing (Dolphin/Pinterest/WP/Sharp).
4. Roundup-writer skill + downstream (hero/WP/pins).
5. MCP tool layer + headless agent invocation from the app.
6. Scheduler for pin posting.
7. Performance feedback loop (training).
