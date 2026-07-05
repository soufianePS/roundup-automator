# Skill: roundup-writer

Goal: given a keyword + title, produce a complete idea-roundup as structured JSON —
real sourced images (non-AI) with credits, plus intro and per-item text. The app
then builds the title-card hero, uploads to WordPress, and makes the pins.

## Inputs
- `keyword`, `title`, optional `count` (default 25), `type` (roundup)

## Steps
1. Search for candidate images/ideas: `search_images(keyword, ...)`. Prefer trusted
   sources (established blogs, magazines, real listings). Discovery via Pinterest is
   OK but pull the image from the ORIGINAL source and credit that.
2. Keep it REAL: for each candidate, `vet_image(url)` → drop likely-AI, watermarked,
   duplicate, or low-quality images. Use the date filter (pre-2022 = guaranteed real)
   for part of the set; vet the recent ones harder.
3. LOOK at the images (vision) and pick the best `count` — most beautiful, most
   distinct, on-topic. This visual judgment is the whole reason an agent does this.
4. Write:
   - intro (2-3 short paragraphs, genuinely useful, human voice — no AI clichés),
   - per item: a heading + 2-4 sentence description with a real angle ("why this
     works in a small room"), NOT a generic caption (avoid thin/low-value content),
   - a `credit` + `source_url` for each image.
5. Choose 1 category. Write pin plans (3-5) with distinct angles.
6. Return roundup JSON (below). App handles hero (title-card), WP draft, pins.

## Guardrails
- NO AI images in the article body — real sourced photos only.
- Every image MUST have a source credit link (copyright stance: see CLAUDE.md §6.1).
- Hero is a designed title-card (app builds it), NOT a collage of others' photos.
- Give each item a real angle → information gain (Google E-E-A-T for roundups).

## Output (roundup JSON)
```json
{
  "title": "...", "slug": "...", "category": "...",
  "intro": "para1\n\npara2\n\npara3",
  "items": [
    {"position": 1, "heading": "...", "description": "...",
     "image_url": "...", "source_url": "...", "credit": "..."}
  ],
  "pins": [
    {"title": "...", "description": "... #hashtags", "image_hint": "which item image"}
  ]
}
```
