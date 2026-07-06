/**
 * Agent runner — spawns Claude Code headless (`claude -p`) on the user's
 * subscription (NO paid API) and normalizes its stream-json output into simple
 * SSE events for the dashboard: session / text / tool / done / error.
 *
 * The prompt is written to STDIN (avoids all Windows arg-quoting issues); the
 * command line contains only fixed flags, so shell:true is safe here.
 */
import { spawn } from 'child_process';
import { join } from 'path';
import { Logger } from './logger.js';

// Tools the headless agent may use without prompting. Full file access (Read/
// Write/Edit) + Bash (run node scripts, call localhost) + web research + the
// app's own functions via `roundup` MCP + a real BROWSER via `playwright` MCP
// (navigate/click/type/screenshot + vision — for Google Images, Pinterest
// Trends, PinClicks).
const ALLOWED_TOOLS = 'Read,Write,Edit,Grep,Glob,Bash,WebSearch,WebFetch,mcp__roundup,mcp__playwright';

// Briefing prepended to the agent's system prompt so it knows it IS the app's
// brain, what tools it has, and where its detailed how-to lives (the skills).
const SYSTEM_BRIEFING = [
  'You are the brain of the Roundup Automator app — a family/home idea-roundup',
  'blog tool with Pinterest keyword intelligence. You have FULL access to the',
  "app's code, files, and data, and you EXECUTE tasks, not just advise.",
  'TOOLS: (1) `roundup` MCP = the app\'s functions (add_topic, save_keyword_score,',
  'create_article, add_article_item, wp_create_draft, wp_upload_image,',
  'list_dolphin_profiles, sql_query, …) — the safe, validated way to touch the DB',
  'and WordPress. (2) `playwright` MCP = a real browser (navigate, click, type,',
  'screenshot, vision) — use it to research Pinterest Trends + PinClicks and to',
  'find/vet real (non-AI) images on Google Images. The research browser IS already',
  'installed and configured — NEVER run `npx playwright install` or try to install a',
  'browser; that is never the fix. If the FIRST browser tool call errors (e.g.',
  '"browser is already in use" / profile locked / cannot launch), it means another',
  'window holds the profile: STOP and tell the user to close the Settings → Agent',
  'browser login window, then retry — do not attempt to install anything. The',
  'research profile should already be logged into PinClicks/Pinterest; if you hit a',
  'login wall, tell the user to open Settings → Agent browser and log in. (3)',
  'Read/Write/Edit/Bash for code and files.',
  'HOW-TO lives in the skills (keyword-research, roundup-images) — they auto-load',
  'by topic; follow them. Read CLAUDE.md for the full vision and decisions.',
  'Guardrails: NO AI images in article bodies — real sourced photos with a credit',
  'link only; be honest ("opportunity", never "will go viral").',
  'IMPORTANT: keyword research does NOT require a configured site — save_keyword_score',
  'and add_topic have no site dependency at all, so research/score/queue freely even',
  'with zero sites set up. A site is only needed later, for wp_create_draft (actually',
  'publishing). Never block or ask the user to add a site just to do keyword research.',
  'If a topic like "recipes" is ambiguous between a family/home recipe-roundup post',
  '(fits THIS app fine) vs. real food-recipe SEO for the separate leagueofcooking.com',
  'app (out of scope here), briefly ask which was meant — but that is a scope question,',
  'not a missing-site blocker; do not conflate the two.',
].join(' ');

const runs = new Map();   // runId -> { proc, events:[], listeners:Set, done, sessionId }
let _current = null;

function _emit(run, ev) {
  run.events.push(ev);
  for (const res of run.listeners) { try { res.write(`event: ${ev.type}\ndata: ${JSON.stringify(ev)}\n\n`); } catch {} }
}

function _toolInfo(name, input) {
  if (!input) return '';
  if (name === 'Bash') return String(input.command || '').slice(0, 100);
  if (name === 'Read' || name === 'Edit' || name === 'Write') return String(input.file_path || input.path || '').slice(0, 80);
  if (name === 'WebFetch') return String(input.url || '').slice(0, 80);
  if (name === 'WebSearch' || name === 'Grep' || name === 'Glob') return String(input.query || input.pattern || '').slice(0, 80);
  // MCP app tools (mcp__roundup__*) — show the most telling argument.
  if (name.startsWith('mcp__')) {
    return String(input.keyword || input.title || input.sql || input.name || input.status || (input.id ?? '') || '').slice(0, 80);
  }
  return '';
}

export function startAgentRun(prompt, { sessionId = null, cwd } = {}) {
  const runId = (globalThis.crypto?.randomUUID?.() || String(Date.now()));
  const mcpConfig = join(cwd || process.cwd(), 'mcp.config.json');
  const args = ['-p', '--output-format', 'stream-json', '--verbose', '--include-partial-messages',
    '--permission-mode', 'dontAsk', '--allowedTools', ALLOWED_TOOLS,
    '--mcp-config', mcpConfig, '--strict-mcp-config',
    '--append-system-prompt', SYSTEM_BRIEFING];
  if (sessionId) args.push('--resume', sessionId);

  // shell:true is needed on Windows (resolves claude.cmd) but does NOT auto-quote
  // args — so quote any arg with spaces/specials (mcp path, system briefing).
  const q = (a) => (/[\s"&|<>()^%]/.test(a) ? `"${String(a).replace(/"/g, '""')}"` : a);
  const proc = spawn('claude', args.map(q), { cwd, shell: true });
  const run = { proc, events: [], listeners: new Set(), done: false, sessionId: null, streamedText: false };
  runs.set(runId, run);
  _current = run;

  try { proc.stdin.write(prompt); proc.stdin.end(); } catch (e) { Logger.warn(`[Agent] stdin write failed: ${e.message}`); }

  let buf = '', finalResult = '';
  proc.stdout.on('data', (chunk) => {
    buf += chunk.toString();
    const lines = buf.split('\n'); buf = lines.pop();
    for (const ln of lines) {
      if (!ln.trim()) continue;
      let e; try { e = JSON.parse(ln); } catch { continue; }
      if (e.session_id && !run.sessionId) { run.sessionId = e.session_id; _emit(run, { type: 'session', id: e.session_id }); }
      if (e.type === 'stream_event') {
        const ev = e.event || {};
        const text = ev.delta?.text ?? (ev.type === 'content_block_delta' ? ev.delta?.text : undefined);
        if (text) { run.streamedText = true; _emit(run, { type: 'text', text }); }
        if (ev.type === 'content_block_start' && ev.content_block?.type === 'tool_use') {
          _emit(run, { type: 'tool', name: ev.content_block.name, info: _toolInfo(ev.content_block.name, ev.content_block.input) });
        }
      } else if (e.type === 'system' && (e.subtype === 'api_retry' || e.subtype === 'rate_limit')) {
        _emit(run, { type: 'tool', name: 'waiting', info: e.subtype === 'api_retry' ? `retry ${e.attempt}/${e.max_retries}` : 'rate limit' });
      } else if (e.type === 'result') {
        finalResult = e.result || '';
      }
    }
  });

  let stderr = '';
  proc.stderr.on('data', c => { stderr += c.toString(); });

  proc.on('close', (code) => {
    // If nothing streamed (delta shape differed), show the final result text.
    if (!run.streamedText && finalResult) _emit(run, { type: 'text', text: finalResult });
    if (code !== 0 && !run.streamedText && !finalResult) _emit(run, { type: 'error', error: (stderr || `claude exited ${code}`).slice(0, 300) });
    _emit(run, { type: 'done', code });
    run.done = true;
    Logger.info(`[Agent] run ${runId} finished (code ${code}, session ${run.sessionId})`);
    // keep the run briefly so late subscribers get the buffer, then drop
    setTimeout(() => runs.delete(runId), 60000);
  });
  proc.on('error', (err) => { _emit(run, { type: 'error', error: err.message }); _emit(run, { type: 'done', code: -1 }); run.done = true; });

  return runId;
}

export function subscribeAgentRun(runId, res) {
  const run = runs.get(runId);
  res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' });
  res.write(': connected\n\n');
  if (!run) { res.write(`event: error\ndata: ${JSON.stringify({ error: 'run not found' })}\n\n`); res.end(); return; }
  for (const ev of run.events) res.write(`event: ${ev.type}\ndata: ${JSON.stringify(ev)}\n\n`); // replay
  if (run.done) { res.end(); return; }
  run.listeners.add(res);
  res.on('close', () => run.listeners.delete(res));
}

export function stopAgentRun() {
  if (_current && !_current.done) { try { _current.proc.kill(); } catch {} return true; }
  return false;
}
