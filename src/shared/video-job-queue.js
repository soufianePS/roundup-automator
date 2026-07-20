/**
 * Video/Reel -> WordPress post queue. Rows added via VideoJobs.enqueue() run
 * STRICTLY ONE AT A TIME (never in parallel) — this is the whole point: you
 * can queue 5 links, hit Start once, and each row's progress bar fills in
 * turn while the others wait, exactly like a real queue.
 *
 * Each job is handed to a headless agent (Claude or Codex, via agent-runner.js
 * — the same "runs on your subscription, no paid API" mechanism the chat-style
 * Agent page already uses) with a task prompt telling it to work the link end
 * to end and report progress via the report_job_progress/complete_video_job/
 * fail_video_job MCP tools. This module just sequences that: start one, wait
 * for its process to exit, verify a terminal DB state, start the next.
 */
import { VideoJobs, Sites } from '../db/repos.js';
import { startAgentRun, onRunEvent } from './agent-runner.js';
import { Logger } from './logger.js';

let processing = false;

function buildPrompt(job, site) {
  return [
    `You are processing ONE item from the app's video-to-post queue. jobId = ${job.id}.`,
    `Source link: ${job.url}`,
    `Target WordPress site: "${site.name}" (siteId=${site.id}) — pass siteId: ${site.id} to EVERY wp_upload_image`,
    'and wp_create_draft call. Do not use the default/active site instead — use this exact siteId, since the',
    'user picked it deliberately and it may differ from whatever site is active elsewhere in the app.',
    '',
    'Follow the `roundup-video-images` skill (.claude/skills/roundup-video-images/SKILL.md) for the full',
    'method: open the video with the youtube-video.js helpers (via Bash/node), identify the real distinct',
    'steps (chapters/transcript if available, otherwise dense visual frame-sampling — sample every 0.5-1s',
    'across the whole runtime and review the frames yourself if there is no chapter/transcript data), pick',
    'the best clean frame per step, resize with',
    'resizeToTarget (square 1024x1024 for a vertical/Short/Reel source, landscape ARTICLE_SIZES otherwise),',
    'upload each to WordPress (wp_upload_image) and create the post as a DRAFT (wp_create_draft) with your',
    'own step-by-step write-up and an "Image credit: <channel> via <platform>" line under each image, linked',
    'to the source.',
    '',
    'FACE CHECK — before uploading each frame, call detectFaces([path1, path2, ...]) from youtube-video.js on',
    'every candidate image (batch it, not one at a time) as an automatic PRE-FILTER, then still look at the',
    'WHOLE frame yourself, not just the main subject - the model is a safety net, not a replacement for your',
    'own check. Treat hasFace: true as a hard stop (reject or crop that image before it can be uploaded).',
    'Treat uncertain: true as "glance at it before deciding" (real test 2026-07-15 found this tier catches both',
    'real faces AND false positives like a shiny jar lid or a small decal - do not auto-reject on uncertain',
    'alone, look first). Regardless of what the model says, still visually check for ANY recognizable face',
    'anywhere in frame, including incidental ones easy to miss on a first look - a laptop/phone screen showing',
    'a video call or photo, a mirror reflection, a framed photo on a wall, a TV in the background, someone else',
    'walking through the shot. (A real run of THIS EXACT video once let a face through on a laptop screen in',
    'the background - that is the specific mistake to not repeat, and the reason this pre-filter now exists.)',
    'Also crop out any burned-in captions/text overlays from the source video/creator branding.',
    '',
    'CAPTION MATCH / BLUR / HERO CROP — read the "MANDATORY manual step 2" section of the skill file and',
    'apply all three checks to EVERY image, not just the featured one: (1) the frame must actually show what',
    'its caption claims, not just be from roughly the right timestamp; (2) the frame must be genuinely sharp',
    '- readable fine detail, not merely "less blurry than its immediate neighbors" - widen the search by',
    'several seconds if the whole neighborhood is soft; (3) for the featured/finished-result hero image, the',
    'full subject must be visible and uncropped in the raw frame before resizing - never trust',
    "fit:'cover',position:'attention' blindly, and pick a different timestamp rather than force a crop that",
    'cuts off part of the subject. Two separate real runs of this exact job shipped posts with a caption/image',
    'mismatch, an unreadably blurry frame, and a badly cropped hero image - do not repeat any of those three.',
    '',
    'HERO/FEATURED IMAGE SOURCE - for the featured/hero image ONLY (not regular in-article step images), call',
    'getHeroCandidates(page, videoId, completionWindow, outPathPrefix) - it fetches the real YouTube thumbnail',
    '(checking actual pixel dimensions, not just HTTP status - YouTube returns a 200 OK placeholder image for',
    'sizes that do not exist) AND the best extracted "finished result" frames, scores all of them the same way,',
    'and returns ONE ranked list tagged source: "thumbnail" or "frame". View the top 2-3, not just #1. Crop out',
    'any pillarbox bars (Shorts thumbnails letterbox the vertical video into 16:9) and any burned-in title text',
    'from a thumbnail candidate, then face-check whichever you pick like any other image. If every candidate is',
    'lowConfidence: true, widen your search (different timestamp window, other thumbnail quality tier) rather',
    'than accepting the least-bad option. Resize the winner with resizeToTarget(..., { hero: true }) for the',
    'stronger enhancement lift meant only for the cover image.',
    '',
    'IMAGE ENHANCEMENT - resizeToTarget() now applies an automatic photographic enhancement pass (auto-levels,',
    'saturation/brightness lift, two-stage sharpening) by default on every image - pure pixel math via sharp,',
    'no AI upscaling. You do not need to do anything extra for this, just use resizeToTarget for every image',
    'you ship (pass { hero: true } only for the one featured image).',
    '',
    'QUALITY FLOOR - grabBestFrames() and getHeroCandidates() candidates each carry a lowConfidence flag (true',
    'when contrast or exposure is below an absolute floor, not just weak relative to its neighbors). Treat',
    'lowConfidence: true on your chosen candidate as a signal to widen the search window before accepting it,',
    'not something to silently ship.',
    '',
    'If the link is an Instagram Reel: there is currently no scraper for Instagram in this codebase — do NOT',
    'attempt to improvise browser automation for it. Call fail_video_job(jobId, "Instagram Reels are not',
    'supported yet — only YouTube videos and Shorts.") and stop.',
    '',
    `IMPORTANT — progress reporting: call report_job_progress(jobId=${job.id}, step, total, label) at EACH`,
    'real stage as you actually reach it (e.g. picking the video/checking the link, then once per step you',
    'extract, then uploading, then creating the draft) — do not front-load fake progress or report only at',
    'the end. When you are completely done, call EXACTLY ONE of:',
    `  - complete_video_job(jobId=${job.id}, wpPostId, wpPostLink) — on real success, only after the draft exists.`,
    `  - fail_video_job(jobId=${job.id}, reason) — if you cannot complete it, with a specific, honest reason.`,
    'Never end the run without calling one of these — the queue is waiting on it to move to the next job.',
  ].join('\n');
}

function runOne(job) {
  return new Promise((resolve) => {
    const site = (job.site_id ? Sites.get(job.site_id) : null) || Sites.getActive();
    if (!site) {
      VideoJobs.fail(job.id, 'No WordPress site configured — pick one on the row, or add/activate one in Settings.');
      Logger.warn(`[video-queue] job ${job.id} skipped: no site`);
      resolve();
      return;
    }
    let runId;
    try {
      runId = startAgentRun(buildPrompt(job, site), { cwd: process.cwd(), provider: job.provider || 'claude' });
    } catch (e) {
      VideoJobs.fail(job.id, e.message);
      resolve();
      return;
    }
    VideoJobs.start(job.id, runId);
    Logger.info(`[video-queue] job ${job.id} started (run ${runId}, ${job.provider})`);

    onRunEvent(runId, (ev) => {
      if (ev.type !== 'done') return;
      // Safety net: the agent should always call complete_video_job/fail_video_job
      // itself, but if the process died/exited without doing so, don't leave the
      // row stuck on "running" forever — and don't block the rest of the queue.
      const cur = VideoJobs.get(job.id);
      if (cur && cur.status === 'running') {
        VideoJobs.fail(job.id, ev.code === 0
          ? 'Agent exited without reporting a result — treat as failed and check the run log.'
          : `Agent process exited with code ${ev.code}.`);
      }
      resolve();
    });
  });
}

/** Idempotent — if the queue is already draining, this is a no-op. */
export async function startVideoQueue() {
  if (processing) return;
  processing = true;
  try {
    let job;
    while ((job = VideoJobs.nextQueued())) {
      await runOne(job);
    }
  } finally {
    processing = false;
  }
}

/**
 * Run exactly one queued job by id, out of order, without draining the rest
 * of the queue. Still respects the "only one agent at a time" rule — if
 * something is already running (whether from startVideoQueue or another
 * runSingleJob call), this is a no-op and returns false so the caller can
 * tell the user to wait.
 */
export async function runSingleJob(id) {
  if (processing) return false;
  const job = VideoJobs.get(id);
  if (!job || job.status !== 'queued') return false;
  processing = true;
  try {
    await runOne(job);
    return true;
  } finally {
    processing = false;
  }
}

export function isVideoQueueProcessing() { return processing; }
