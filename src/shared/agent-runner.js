/**
 * Agent runner — spawns Claude Code headless (`claude -p`) on the user's
 * subscription (NO paid API) and normalizes its stream-json output into simple
 * SSE events for the dashboard: session / text / tool / done / error.
 *
 * The prompt is written to STDIN (avoids all Windows arg-quoting issues); the
 * command line contains only fixed flags, so shell:true is safe here.
 */
import { spawn, spawnSync } from 'child_process';
import { join } from 'path';
import { homedir } from 'os';
import { readFileSync, writeFileSync, existsSync } from 'fs';
import { Logger } from './logger.js';
import { activeProfileName } from './profiles.js';

// Antigravity ships `agy.exe` (not always on the shell PATH). Resolve it directly.
const AGY_PATHS = [
  join(homedir(), 'AppData', 'Local', 'agy', 'bin', 'agy.exe'),
  join(homedir(), 'AppData', 'Roaming', 'Antigravity', 'bin', 'agy-node.cmd'),
];
const AGY_BIN = AGY_PATHS.find(p => existsSync(p)) || 'agy';

/**
 * Build a runtime MCP config from the committed template, with the Playwright
 * browser's --user-data-dir pointed at the ACTIVE profile. Written to a local
 * (gitignored) file so switching profiles never edits the committed template.
 */
function resolveMcpConfig(cwd) {
  const templatePath = join(cwd, 'mcp.config.json');
  try {
    const cfg = JSON.parse(readFileSync(templatePath, 'utf8'));
    const args = cfg?.mcpServers?.playwright?.args;
    if (Array.isArray(args)) {
      const i = args.indexOf('--user-data-dir');
      if (i >= 0 && args[i + 1] !== undefined) args[i + 1] = `data/browser-profiles/${activeProfileName()}`;
    }
    const outPath = join(cwd, 'data', 'mcp.runtime.json');
    writeFileSync(outPath, JSON.stringify(cfg, null, 2));
    return outPath;
  } catch (e) {
    Logger.warn(`[agent] could not build runtime mcp config, using template: ${e.message}`);
    return templatePath;
  }
}

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
  'SETTLED, do not re-ask: recipe/meal ROUNDUP topics (e.g. "25 Easy Weeknight',
  'Dinners") ARE in scope for THIS blog, same as any other roundup category — treat',
  '"give me N recipes" as a normal roundup request, not an out-of-scope one. The ONLY',
  'thing that belongs to the separate leagueofcooking.com/recipe-automator app is an',
  'individual full recipe SEO post via its own pipeline (Sheets input, AI images, Tasty',
  'Recipes) — that distinction is about which SITE/pipeline, not "is it about food".',
  'Only ask a clarifying question if a request is genuinely unclear about which site it',
  'targets; do not reflexively question every recipe-related request.',
].join(' ');

// ── Providers: which agent CLI drives the run (all use the SAME MCP tools) ──
// Claude Code (validated), OpenAI Codex (validated MCP), Antigravity `agy` (adapter
// ready; enable once installed). Each provides: how to spawn + how to parse output.
function codexMcpArgs(cwd) {
  const prof = activeProfileName();
  return [
    '-c', 'mcp_servers.roundup.command="node"',
    '-c', 'mcp_servers.roundup.args=["src/mcp/roundup-mcp.js"]',
    '-c', 'mcp_servers.playwright.command="node"',
    '-c', `mcp_servers.playwright.args=["node_modules/@playwright/mcp/cli.js","--browser","chromium","--user-data-dir","data/browser-profiles/${prof}","--output-dir",".playwright-mcp","--caps","vision"]`,
  ];
}

const PROVIDERS = {
  claude: {
    label: 'Claude',
    detect: () => detectBin('claude', true),
    // prompt via stdin; briefing via --append-system-prompt; MCP via --mcp-config file
    spawn: (cwd, { sessionId }) => {
      const mcpConfig = resolveMcpConfig(cwd);
      const args = ['-p', '--output-format', 'stream-json', '--verbose', '--include-partial-messages',
        '--permission-mode', 'dontAsk', '--allowedTools', ALLOWED_TOOLS,
        '--mcp-config', mcpConfig, '--strict-mcp-config', '--append-system-prompt', SYSTEM_BRIEFING];
      if (sessionId) args.push('--resume', sessionId);
      const q = (a) => (/[\s"&|<>()^%]/.test(a) ? `"${String(a).replace(/"/g, '""')}"` : a);
      return spawn('claude', args.map(q), { cwd, shell: true });
    },
    prompt: (p) => p,
    parse: parseClaudeLine,
  },
  codex: {
    label: 'Codex (ChatGPT)',
    detect: () => detectBin('codex', true),
    // codex.exe is a native binary → shell:false (no arg-quoting issues). No
    // system-prompt flag, so the briefing is prepended to the prompt (stdin).
    spawn: (cwd) => spawn('codex.exe', [
      'exec', '--json', '--dangerously-bypass-approvals-and-sandbox', '--skip-git-repo-check',
      '-C', cwd, ...codexMcpArgs(cwd), '-',
    ], { cwd, shell: false }),
    prompt: (p) => SYSTEM_BRIEFING + '\n\n---\n\n' + p,
    parse: parseCodexLine,
  },
  antigravity: {
    label: 'Antigravity (Gemini)',
    detect: () => AGY_BIN !== 'agy' && existsSync(AGY_BIN),
    // agy has no --json / --mcp-config: headless `-p` prints PLAIN TEXT, and MCP tools
    // are imported into its plugin config (see ensureAgyMcp). So: plain-text streaming,
    // briefing prepended, prompt via stdin. Long print-timeout for the pipeline.
    spawn: (cwd) => spawn(AGY_BIN, ['-p', '--dangerously-skip-permissions', '--add-dir', cwd, '--print-timeout', '15m0s'], { cwd, shell: false }),
    prompt: (p) => SYSTEM_BRIEFING + '\n\n---\n\n' + p,
    plainText: true,
  },
};

const _detectCache = {};
function detectBin(bin, shell) {
  if (bin in _detectCache) return _detectCache[bin];
  let ok = false;
  try { const r = spawnSync(bin, ['--version'], { shell, timeout: 5000 }); ok = r.status === 0 || !!(r.stdout && r.stdout.length); } catch { ok = false; }
  return (_detectCache[bin] = ok);
}

export function agentProviders() {
  return Object.entries(PROVIDERS).map(([id, p]) => ({ id, label: p.label, available: p.detect() }));
}

// ── output parsers → normalized SSE events [{type:'session'|'text'|'tool'|'result'}] ──
function parseClaudeLine(e, run) {
  const out = [];
  if (e.session_id && !run.sessionId) { run.sessionId = e.session_id; out.push({ type: 'session', id: e.session_id }); }
  if (e.type === 'stream_event') {
    const ev = e.event || {};
    const text = ev.delta?.text ?? (ev.type === 'content_block_delta' ? ev.delta?.text : undefined);
    if (text) { run.streamedText = true; out.push({ type: 'text', text }); }
    if (ev.type === 'content_block_start' && ev.content_block?.type === 'tool_use') {
      out.push({ type: 'tool', name: ev.content_block.name, info: _toolInfo(ev.content_block.name, ev.content_block.input) });
    }
  } else if (e.type === 'system' && (e.subtype === 'api_retry' || e.subtype === 'rate_limit')) {
    out.push({ type: 'tool', name: 'waiting', info: e.subtype === 'api_retry' ? `retry ${e.attempt}/${e.max_retries}` : 'rate limit' });
  } else if (e.type === 'result') {
    run.finalResult = e.result || run.finalResult;
  }
  return out;
}

function parseCodexLine(e, run) {
  const out = [];
  if (e.type === 'thread.started' && e.thread_id && !run.sessionId) { run.sessionId = e.thread_id; out.push({ type: 'session', id: e.thread_id }); }
  const it = e.item;
  if ((e.type === 'item.completed' || e.type === 'item.started') && it) {
    if (it.type === 'agent_message' && e.type === 'item.completed' && it.text) { run.streamedText = true; out.push({ type: 'text', text: it.text }); }
    else if (it.type === 'mcp_tool_call' && e.type === 'item.started') out.push({ type: 'tool', name: `mcp__${it.server}__${it.tool}`, info: '' });
    else if (it.type === 'command_execution' && e.type === 'item.started') out.push({ type: 'tool', name: 'Bash', info: String(it.command || '').slice(0, 100) });
    else if (it.type === 'file_change' && e.type === 'item.completed') out.push({ type: 'tool', name: 'Edit', info: '' });
  }
  return out;
}

const runs = new Map();   // runId -> { proc, events:[], listeners:Set, done, sessionId }
let _current = null;

function _emit(run, ev) {
  run.events.push(ev);
  for (const res of run.listeners) { try { res.write(`event: ${ev.type}\ndata: ${JSON.stringify(ev)}\n\n`); } catch {} }
  for (const cb of run.internalListeners) { try { cb(ev); } catch {} }
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

export function startAgentRun(prompt, { sessionId = null, cwd, provider = 'claude' } = {}) {
  const drv = PROVIDERS[provider] || PROVIDERS.claude;
  if (!drv.detect()) throw new Error(`${drv.label} CLI is not installed / not on PATH.`);
  const workdir = cwd || process.cwd();
  const runId = (globalThis.crypto?.randomUUID?.() || String(Date.now()));
  const mcpConfig = resolveMcpConfig(workdir);           // Claude/agy use the file path
  const proc = drv.spawn(workdir, { sessionId, mcpConfig });
  const run = { proc, events: [], listeners: new Set(), internalListeners: new Set(), done: false, sessionId: null, streamedText: false, finalResult: '', provider };
  runs.set(runId, run);
  _current = run;
  Logger.info(`[Agent] run ${runId} started via ${drv.label}`);

  try { proc.stdin.write(drv.prompt(prompt)); proc.stdin.end(); } catch (e) { Logger.warn(`[Agent] stdin write failed: ${e.message}`); }

  let buf = '';
  proc.stdout.on('data', (chunk) => {
    if (drv.plainText) {   // agy: not JSON — stream raw text straight through
      run.streamedText = true; _emit(run, { type: 'text', text: chunk.toString() }); return;
    }
    buf += chunk.toString();
    const lines = buf.split('\n'); buf = lines.pop();
    for (const ln of lines) {
      if (!ln.trim()) continue;
      let e; try { e = JSON.parse(ln); } catch { continue; }
      for (const ev of drv.parse(e, run)) _emit(run, ev);
    }
  });

  let stderr = '';
  proc.stderr.on('data', c => { stderr += c.toString(); });

  proc.on('close', (code) => {
    if (!run.streamedText && run.finalResult) _emit(run, { type: 'text', text: run.finalResult });
    if (code !== 0 && !run.streamedText && !run.finalResult) _emit(run, { type: 'error', error: (stderr || `${drv.label} exited ${code}`).slice(0, 400) });
    _emit(run, { type: 'done', code });
    run.done = true;
    Logger.info(`[Agent] run ${runId} finished (${drv.label}, code ${code}, session ${run.sessionId})`);
    setTimeout(() => runs.delete(runId), 60000);
  });
  proc.on('error', (err) => { _emit(run, { type: 'error', error: `${drv.label}: ${err.message}` }); _emit(run, { type: 'done', code: -1 }); run.done = true; });

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

// Non-HTTP subscription — for internal callers (e.g. the video-job queue) that
// need to know when a run finishes without an Express `res` to write SSE to.
// Calls `cb(event)` for every event, including replaying ones already emitted.
export function onRunEvent(runId, cb) {
  const run = runs.get(runId);
  if (!run) return false;
  for (const ev of run.events) cb(ev);
  if (!run.done) run.internalListeners.add(cb);
  return true;
}

export function stopAgentRun() {
  if (_current && !_current.done) { try { _current.proc.kill(); } catch {} return true; }
  return false;
}
