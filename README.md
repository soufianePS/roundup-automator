# Roundup Automator

Agent-primary automation for a family/home **idea-roundup** blog, plus Pinterest
**keyword intelligence** (Trends + PinClicks). Sibling of `../recipe-automator`.

**Read `CLAUDE.md` first** — it's the project memory (vision, decisions, roadmap).
See `BLUEPRINT.md` for the technical spec.

## Quick facts
- Content = "Best 25 …" idea roundups with **real sourced images + credits** (no AI
  images in the body). Designed **title-card hero**. AI-made Pinterest pins → Dolphin.
- **Agent = brain** (research, scoring, image selection, writing). **App = tools +
  data + scheduler.**
- **Data = SQLite + JSON, no server.** SQLite is a single local file (gitignored);
  git shares code, not data. Secrets in `config/secrets.json` (gitignored).

## Status
Scaffold only. Next: settle image copyright stance, then build keyword-research.

## Dev
- `npm run db:init` — create the local SQLite database from `src/db/schema.sql`.
