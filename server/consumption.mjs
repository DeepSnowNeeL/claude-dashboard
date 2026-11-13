// Session consumption, read from the Claude Code transcripts (~/.claude/projects/**.jsonl): tokens per session,
// share due to the dashboard (instructions and tools added to the prompt, calls to update_board and to the other
// "dashboard" tools), and comparison of the dashboard sessions with the terminal ones.
//
// The subscription limits roughly follow the API cost: each category of tokens is weighted like its price
// (input 1, cache write 1.25 at 5 min / 2 at 1 h, cache read 0.1, output 5), in "input token equivalent".
// The dashboard tokens are estimated from the size of the text (≈ 3.5 characters per token).
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const ROOT = path.join(os.homedir(), '.claude', 'projects');
const CHARS_PER_TOKEN = 3.5;
const WEIGHTS = { input: 1, write5m: 1.25, write1h: 2, read: 0.1, output: 5 };
// First line of the instructions added to the system prompt (instructions.en.md, instructions.fr.md). The French
// heading is also the one of the transcripts written before the translation.
const INSTRUCTIONS_MARKERS = ['# Session driven by the dashboard', '# Session pilotée par le tableau de bord'];
// Prefix of the dashboard MCP tools; `mcp__tableau__` is the name they had before the translation (older transcripts)
const TOOL_PREFIXES = ['mcp__dashboard__', 'mcp__tableau__'];
const isDashboardTool = name => TOOL_PREFIXES.some(p => String(name || '').startsWith(p));
const tok = chars => Math.round(chars / CHARS_PER_TOKEN);

/** Weight of a request (API usage) in input token equivalent. */
function weight(u) {
  const c1h = u.cache_creation?.ephemeral_1h_input_tokens ?? 0;
  const c5m = u.cache_creation?.ephemeral_5m_input_tokens ?? Math.max(0, (u.cache_creation_input_tokens || 0) - c1h);
  return (u.input_tokens || 0) * WEIGHTS.input + c5m * WEIGHTS.write5m + c1h * WEIGHTS.write1h
    + (u.cache_read_input_tokens || 0) * WEIGHTS.read + (u.output_tokens || 0) * WEIGHTS.output;
}

/** What the dashboard adds to each request: instructions (end of the system prompt) and definitions of its tools. */
function shapeOverhead(shape) {
  let instructions = 0;
  for (const b of shape?.system || []) {
    const text = b.text || '';
    const i = Math.min(...INSTRUCTIONS_MARKERS.map(m => text.indexOf(m)).filter(i => i >= 0));
    if (Number.isFinite(i)) instructions += text.length - i;
  }
  const tools = (shape?.tools || []).filter(t => isDashboardTool(t.name)).reduce((n, t) => n + JSON.stringify(t).length, 0);
  return { instructions: tok(instructions), tools: tok(tools) };
}

/**
 * Analyses a transcript (and those of its subagents): tokens, requests, developer messages, and share of the
 * dashboard. Returns null for a file without a request.
 */
function analyzeFile(file, content) {
  const lines = content.split('\n');
  const r = {
    file, sessionId: path.basename(file, '.jsonl'), entrypoint: null, dashboard: false, start: null, end: null,
    requests: 0, rebuilds: 0, prompts: 0, models: {},
    tokens: { input: 0, cacheWrite: 0, cacheRead: 0, output: 0 }, weight: 0,
    dash: { instructions: 0, tools: 0, calls: 0, fixedWeight: 0, callWeight: 0, callDetail: {} },
  };
  let shape = { instructions: 0, tools: 0 };
  let inContext = 0; // tokens of the "dashboard" calls still in the context (read again at each request)
  const seen = new Map(); // message id → last usage (one answer is written over several lines)
  const requests = [];
  for (const l of lines) {
    if (!l) continue;
    // Rough filter before JSON.parse: the files are tens of MB
    if (!l.includes('"type":"assistant"') && !l.includes('"type":"user"') && !l.includes('"type":"api-request-shape"') && !l.includes('compact_boundary')) continue;
    let x;
    try { x = JSON.parse(l); } catch { continue; }
    if (x.type === 'api-request-shape') {
      shape = shapeOverhead(x.shape);
      if (shape.instructions) { r.dashboard = true; r.dash.instructions = shape.instructions; r.dash.tools = shape.tools; }
      continue;
    }
    if (x.type === 'system' && x.subtype === 'compact_boundary') { requests.push({ compact: true }); continue; }
    if (x.type === 'user') {
      if (x.isMeta || x.isSidechain) continue;
      const c = x.message?.content;
      const text = typeof c === 'string' ? c : Array.isArray(c) && !c.some(b => b.type === 'tool_result') ? c.find(b => b.type === 'text')?.text : null;
      if (text && !text.startsWith('<command-') && !text.startsWith('<local-command') && !text.startsWith('[Request interrupted')) r.prompts++;
      continue;
    }
    if (x.type !== 'assistant' || !x.message?.usage) continue;
    r.entrypoint ??= x.entrypoint || null;
    r.start ??= x.timestamp;
    r.end = x.timestamp;
    const id = x.message.id || x.uuid;
    // Calls to the dashboard tools: their JSON is written by Claude (output), then read again at each request
    let calls = 0;
    for (const b of x.message.content || []) {
      if (b.type !== 'tool_use' || !isDashboardTool(b.name)) continue;
      const n = tok(JSON.stringify(b.input || {}).length) + 10; // + the tool result, a few tokens
      calls += n;
      r.dash.calls++;
      const name = TOOL_PREFIXES.reduce((s, p) => s.replace(p, ''), b.name);
      const d = (r.dash.callDetail[name] ??= { calls: 0, tokens: 0 });
      d.calls++; d.tokens += n;
    }
    if (!seen.has(id)) requests.push({ id, shape, model: x.message.model });
    seen.set(id, { usage: x.message.usage, calls: (seen.get(id)?.calls || 0) + calls });
  }
  for (const q of requests) {
    if (q.compact) { inContext = 0; continue; }
    const { usage: u, calls } = seen.get(q.id);
    const p = weight(u);
    const read = u.cache_read_input_tokens || 0, total = read + (u.cache_creation_input_tokens || 0) + (u.input_tokens || 0);
    const rebuilt = read < total / 2; // the prefix was no longer cached: everything is written again
    r.requests++;
    if (rebuilt) r.rebuilds++;
    r.weight += p;
    r.tokens.input += u.input_tokens || 0;
    r.tokens.cacheWrite += u.cache_creation_input_tokens || 0;
    r.tokens.cacheRead += read;
    r.tokens.output += u.output_tokens || 0;
    const m = (r.models[q.model || '?'] ??= { requests: 0, weight: 0 });
    m.requests++; m.weight += p;
    // Share of the dashboard: its fixed text and the past calls, read again (or written again) with the rest of the
    // prefix; the calls of this answer, written as output
    const fixed = q.shape.instructions + q.shape.tools;
    const reread = rebuilt ? WEIGHTS.write1h : WEIGHTS.read;
    r.dash.fixedWeight += fixed * reread;
    r.dash.callWeight += inContext * reread + calls * WEIGHTS.output;
    inContext += calls;
  }
  if (!r.requests) return null;
  return r;
}

// Cache per file (size + date): reading 500 MB of transcripts at each opening would be too long. Asynchronous reading
// and a pause between two files: the page keeps answering during the first computation.
const cache = new Map();
async function analyze(file) {
  let st;
  try { st = await fs.promises.stat(file); } catch { return null; }
  const c = cache.get(file);
  if (c && c.size === st.size && c.mtime === st.mtimeMs) return c.r;
  let r = null;
  try { r = analyzeFile(file, await fs.promises.readFile(file, 'utf8')); } catch { /* unreadable file: ignored */ }
  await new Promise(setImmediate);
  cache.set(file, { size: st.size, mtime: st.mtimeMs, r });
  return r;
}

/** Subagents of a session: <project>/<sessionId>/subagents/*.jsonl, counted with it. */
function subagents(projectDir, sessionId) {
  const d = path.join(projectDir, sessionId, 'subagents');
  try { return fs.readdirSync(d).filter(f => f.endsWith('.jsonl')).map(f => path.join(d, f)); } catch { return []; }
}

/** Adds the analysis of a subagent to the one of its session (the dashboard adds nothing fixed there). */
function add(target, a) {
  if (!a) return;
  target.requests += a.requests; target.rebuilds += a.rebuilds; target.weight += a.weight;
  for (const k of Object.keys(target.tokens)) target.tokens[k] += a.tokens[k];
  for (const [m, v] of Object.entries(a.models)) { const c = (target.models[m] ??= { requests: 0, weight: 0 }); c.requests += v.requests; c.weight += v.weight; }
  target.subagents = (target.subagents || 0) + 1;
  target.subagentWeight = (target.subagentWeight || 0) + a.weight;
}

/** A whole session (main + subagents), searched in all the project folders. */
async function analyzeSession(sessionId, projectDir) {
  const f = path.join(projectDir, `${sessionId}.jsonl`);
  const base = await analyze(f);
  if (!base) return null;
  const r = structuredClone(base);
  for (const s of subagents(projectDir, sessionId)) add(r, await analyze(s));
  return r;
}

function projectDirs() {
  try { return fs.readdirSync(ROOT).map(d => path.join(ROOT, d)).filter(d => fs.statSync(d).isDirectory()); } catch { return []; }
}

/** Summary of a session for the page: tokens, weight, share of the dashboard. */
function summary(r) {
  const dash = r.dash.fixedWeight + r.dash.callWeight;
  return {
    sessionId: r.sessionId, entrypoint: r.entrypoint, dashboard: r.dashboard, start: r.start, end: r.end,
    requests: r.requests, rebuilds: r.rebuilds, prompts: r.prompts, tokens: r.tokens,
    weight: Math.round(r.weight), models: r.models, subagents: r.subagents || 0, subagentWeight: Math.round(r.subagentWeight || 0),
    dash: {
      instructions: r.dash.instructions, tools: r.dash.tools, calls: r.dash.calls, callDetail: r.dash.callDetail,
      fixedWeight: Math.round(r.dash.fixedWeight), callWeight: Math.round(r.dash.callWeight),
      share: r.weight ? dash / r.weight : 0,
    },
  };
}

/** Detail of a session (by its Claude Code id). */
export async function sessionConsumption(sessionId) {
  if (!/^[\w-]{8,64}$/.test(String(sessionId || ''))) return null;
  for (const d of projectDirs()) {
    if (fs.existsSync(path.join(d, `${sessionId}.jsonl`))) {
      const r = await analyzeSession(sessionId, d);
      return r ? summary(r) : null;
    }
  }
  return null;
}

/**
 * Comparison over the last `days` days: dashboard sessions / other SDK sessions / terminal.
 * Per group: number of sessions, requests, developer messages, total weight and per message, average context size,
 * share of the dashboard.
 */
export async function consumptionComparison(days = 7) {
  const since = Date.now() - days * 86_400_000;
  const groups = {};
  for (const d of projectDirs()) {
    let files;
    try { files = fs.readdirSync(d).filter(f => f.endsWith('.jsonl')); } catch { continue; }
    for (const f of files) {
      const fp = path.join(d, f);
      try { if (fs.statSync(fp).mtimeMs < since) continue; } catch { continue; }
      const r = await analyzeSession(path.basename(f, '.jsonl'), d);
      if (!r || !r.prompts) continue; // probes, empty sessions
      const key = r.dashboard ? 'dashboard' : r.entrypoint === 'cli' ? 'terminal' : 'sdk';
      const g = (groups[key] ??= { sessions: 0, requests: 0, prompts: 0, weight: 0, context: 0, output: 0, dashWeight: 0, rebuilds: 0, models: {} });
      for (const [m, v] of Object.entries(r.models)) g.models[m] = (g.models[m] || 0) + v.weight;
      g.sessions++; g.requests += r.requests; g.prompts += r.prompts; g.weight += r.weight; g.rebuilds += r.rebuilds;
      g.context += r.tokens.input + r.tokens.cacheWrite + r.tokens.cacheRead; g.output += r.tokens.output;
      g.dashWeight += r.dash.fixedWeight + r.dash.callWeight;
    }
  }
  return Object.fromEntries(Object.entries(groups).map(([k, g]) => [k, {
    sessions: g.sessions, requests: g.requests, prompts: g.prompts, weight: Math.round(g.weight),
    perPrompt: Math.round(g.weight / Math.max(g.prompts, 1)), requestsPerPrompt: +(g.requests / Math.max(g.prompts, 1)).toFixed(1),
    avgContext: Math.round(g.context / Math.max(g.requests, 1)), outputPerRequest: Math.round(g.output / Math.max(g.requests, 1)),
    rebuildShare: g.rebuilds / Math.max(g.requests, 1), dashShare: g.weight ? g.dashWeight / g.weight : 0,
    models: Object.fromEntries(Object.entries(g.models).map(([m, v]) => [m, v / g.weight])),
  }]));
}
