---
name: roundup-images
description: How to build an idea-roundup article by finding REAL (non-AI) images on Google in the browser, judging them by eye for quality/resolution and authenticity, capturing the source credit, writing the intro + per-item text, and saving/uploading to WordPress. Use whenever the user asks to build/write a roundup, source images for an article, or turn a keyword into a post.
---

# Roundup article + real images — your job on this app

Given a keyword + title, you build a complete idea-roundup: ~25 **real, sourced,
non-AI** images, each with a credit link, plus an intro and a short description
per idea. You find and JUDGE the images yourself in the browser with your eyes —
that visual judgment is the whole reason an agent does this.

## Tools you use
- **Browser** (Playwright MCP): `browser_navigate`, `browser_snapshot`,
  `browser_take_screenshot` (to SEE and judge images), `browser_click`.
- **App** (roundup MCP): `create_article`, `add_article_item`, `wp_upload_image`,
  `wp_create_draft`, `list_keyword_scores`, `set_topic_status`.
- **Bash** to download an image (`curl -L -o <path> <url>`) and **Read** to view a
  downloaded image at full quality when a screenshot isn't enough to judge it.

## Workflow

### 1. Find candidate images (Google Images in the browser)
Navigate to `https://www.google.com/search?tbm=isch&q=<keyword>` (add terms like
"real home", "photo", or the year to bias toward authentic photography). Take a
screenshot and LOOK. Scroll for more. You want variety — distinct, on-topic ideas.

### 2. Judge each image by eye (this is the point)
Pick an image only if ALL of these hold — decide by looking:
- **Real, not AI** — reject tell-tale AI artifacts: melted/warped details, impossible
  geometry, garbled text/labels, too-perfect plastic lighting, nonsense objects,
  extra fingers. Authentic-home photos (slight clutter, real light) are good signals.
- **Good resolution & size** — click through to the source and confirm the actual
  image is large/sharp (not a tiny thumbnail). Portrait/large-landscape preferred.
- **Real source you can credit** — the site does NOT need to be a big brand; small
  blogs, real listings, and personal sites are fine. Avoid stock-watermarked images
  and avoid other AI-image galleries.

### 3. Capture the source
For each keeper, open the source page and record the **direct image URL** + the
**page URL** (source_url) + a human **credit** (site/author name). You will rehost
the image on our WordPress and show the credit link under it.

### 4. Write (human voice — no AI clichés)
- **intro**: 2–3 short, genuinely useful paragraphs.
- **per item**: a heading + a 2–4 sentence description with a REAL angle ("why this
  works in a small room"), not a generic caption. Information gain = E-E-A-T.

### 5. Save to the app + WordPress
- `create_article({title, slug, topic_id?})` → get the article id.
- For each item: download the image, then `wp_upload_image({path, alt, title})` to
  rehost it → use the returned media id/url. Then
  `add_article_item({article_id, position, heading→description, image_url,
  source_url, credit})`.
- Assemble the article HTML (intro + each item: image, heading, description, and a
  visible "Source: <credit>" link) and `wp_create_draft({title, html, slug,
  categoryName, featuredImageId})`. It publishes as a DRAFT for review.
- If this came from a topic, `set_topic_status(id, 'done')`.

## Guardrails (hard rules)
- **NO AI images in the article body** — real sourced photos only.
- **Every image MUST have a visible source credit link.**
- The hero is a designed title-card the app builds later — do NOT make a collage of
  other people's photos.
- Never invent a source. If you can't credit it, don't use it.

## Report back
Tell the user: article title, how many images sourced, the WordPress draft link,
and flag anything you were unsure about (borderline-AI images you dropped, etc.).
