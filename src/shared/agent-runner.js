/**
 * Agent runner — spawns Claude Code headless (`claude -p`) on the user's
 * subscription (NO paid API) and normalizes its stream-json output into simple
 * SSE events for the dashboard: session / text / tool / done / error.
 *
 * The prompt is written to STDIN (avoids all Windows arg-quoting issues); the
 * command line contains only fixed flags, so shell:true is safe here.
 */
import { spawn } from 'child_process';
import { Logger } from './logger.js';

// Tools the headless agent may use without prompting. Bash lets it call the
// app's own API (curl localhost) and run node scripts; web tools for research.
const ALLOWED_TOOLS = 'Read,Grep,Glob,Bash,WebSearch,WebFetch';

const runs = new Map();   // runId -> { proc, events:[], listeners:Set, done, sessionId }
let _current = null;

function _emit(run, ev) {
  run.events.push(ev);
  for (const res of run.listeners) { try { res.write(`event: ${ev.type}\ndata: ${JSON.stringify(ev)}\n\n`); } catch {} }
}

function _toolInfo(name, input) {
  if (!input) return '';
  if (name === 'Bash') return String(input.command || '').slice(0, 100);
  if (name === 'Read' || name === 'Edit' || name === 'Write') return String(input.file_path || '').slice(0, 80);
  if (name === 'WebFetch') return String(input.url || '').slice(0, 80);
  if (name === 'WebSearch' || name === 'Grep' || name === 'Glob') return String(input.query || input.pattern || '').slice(0, 80);
  return '';
}

export function startAgentRun(prompt, { sessionId = null, cwd } = {}) {
  const runId = (globalThis.crypto?.randomUUID?.() || String(Date.now()));
  const args = ['-p', '--output-format', 'stream-json', '--verbose', '--include-partial-messages',
    '--permission-mode', 'dontAsk', '--allowedTools', ALLOWED_TOOLS];
  if (sessionId) args.push('--resume', sessionId);

  const proc = spawn('claude', args, { cwd, shell: true });
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
