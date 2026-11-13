// SDK messages → feed events: live text, tools and results, subagents, plan limits, end of turn;
// activity indicator.
import { BOARD_TOOL } from './mcp-tools.mjs';
import { t, locale } from '../public/i18n/index.js';

export const AGENT_TOOLS = new Set(['Agent', 'Task']); // the tool that launches a subagent (renamed Task → Agent depending on versions)

export const truncate = (text, max) => (text.length > max ? `${text.slice(0, max)}\n… (${text.length - max} characters cut)` : text);

/** Tool line of the feed, with the full call (truncated) for the expandable detail of the page. */
export function toolEvent(id, b) {
  // Field by field: a large Write keeps its path and the start of its content
  const input = Object.fromEntries(Object.entries(b.input ?? {}).map(([k, v]) => {
    const text = typeof v === 'string' ? v : JSON.stringify(v);
    return [k, text.length > 4000 ? truncate(text, 4000) : v];
  }));
  return { id, t: 'tool', name: b.name, summary: summarizeTool(b.name, b.input), toolId: b.id, input };
}
/** Text of a tool_result (string or blocks; images are mentioned, not passed on). */
export function resultText(b, max = 8000) {
  const text = typeof b.content === 'string' ? b.content
    : (b.content || []).map(c => (c.type === 'text' ? c.text : c.type === 'image' ? '[image]' : '')).join('\n');
  return max === Infinity ? text : truncate(text, max);
}

const EM_DASH = String.fromCharCode(0x2014); // secret achievement "Em dash" (written like this: the instructions forbid it in code)
const lineCount = text => (typeof text === 'string' && text ? text.split('\n').length : 0);
/** Lines written by an Edit, MultiEdit or Write call (Bulldozer). */
function linesWritten(name, i) {
  const x = i || {};
  if (name === 'Write') return lineCount(x.content);
  if (name === 'Edit') return lineCount(x.old_string) + lineCount(x.new_string);
  if (name === 'MultiEdit') return (Array.isArray(x.edits) ? x.edits : []).reduce((n, e) => n + lineCount(e?.old_string) + lineCount(e?.new_string), 0);
  return 0;
}
/**
 * Achievements of a Bash command, counted if it succeeds: git commit, push, worktree add / remove, restart-engine.
 * Each piece (&&, ;, |) is read without what is between quotes: a commit message that says "push" does not count.
 */
function bashActions(cmd = '') {
  const a = [];
  const pieces = String(cmd).replace(/"(?:\\.|[^"\\])*"|'[^']*'/g, '""').split(/&&|\|\||;|\||\n/);
  for (const p of pieces) {
    const git = p.match(/^\s*git(?:\s+-C\s+\S+)?\s+(commit|push|worktree\s+add|worktree\s+remove)\b(.*)$/);
    if (git?.[1] === 'commit' && !/--dry-run/.test(git[2])) a.push(['add', 'courier']);
    else if (git?.[1] === 'push') a.push(['add', 'liftoff']);
    else if (git?.[1].startsWith('worktree add')) a.push(['add', 'arborist']);
    else if (git?.[1].startsWith('worktree remove')) a.push(['add', 'lumberjack']);
    // restart-moteur is the subcommand name of the French build, kept recognised for backward compatibility
    if (/^\s*node\s+\S*dash\.mjs\s+restart-(?:engine|moteur)\b/.test(p)) a.push(['record', 'inception']);
  }
  return a;
}

/** A readable line for a tool call. */
export function summarizeTool(name, input = {}) {
  const v = input.file_path || input.path || input.command || input.pattern || input.url || input.description || input.query || input.skill || (input.slug && input.text ? `${input.slug}: ${input.text}` : '') || input.prompt || input.text || input.slug || input.scope || '';
  const short = String(v).replace(/\s+/g, ' ');
  return short.length > 110 ? short.slice(0, 107) + '…' : short;
}

/**
 * Returns `{ handleMessage, startActivity, stopActivity }`: `handleMessage(m)` translates a message of the query
 * stream (read by index.mjs). Sets `s.activity` and `ctx.terminalCommands` (init message).
 */
export function attachEvents(ctx) {
  const { s, slug, newId, pushEvent, setStatus, updateBoard, emit, count, notifyChange, achievements } = ctx;
  // Achievements: tools of the running turn, model window (for the context %), Bash commands to count
  let turnTools = 0, modelWindow = 0;
  const achievementCalls = new Map();

  // Processing indicator (like "✻ Noodling… (3m 42s · ↓ 19.9k tokens)" in the console): start of the turn, tokens
  // generated, current phase. Broadcast separately (not in the feed), at most twice per second.
  s.activity = null;
  let baseTokens = 0, msgTokens = 0, lastSent = 0, plannedSend = null;
  function broadcastActivity(force) {
    clearTimeout(plannedSend);
    const left = 500 - (Date.now() - lastSent);
    if (!force && left > 0) { plannedSend = setTimeout(() => broadcastActivity(true), left); return; }
    lastSent = Date.now();
    emit({ id: `${slug}-activity`, t: 'activity', activity: s.activity });
  }
  function trackActivity(e) {
    if (!s.activity) return;
    if (e.type === 'message_start') { baseTokens += msgTokens; msgTokens = 0; }
    else if (e.type === 'message_delta' && e.usage?.output_tokens != null) msgTokens = e.usage.output_tokens;
    else if (e.type === 'content_block_start') s.activity.phase = e.content_block?.type === 'thinking' ? 'thinking' : e.content_block?.type === 'tool_use' ? 'tool' : 'writing';
    else if (e.type === 'content_block_delta') {
      // Live estimate (≈ 4 characters per token), replaced by the exact count of the message_delta
      const text = e.delta?.text ?? e.delta?.thinking ?? e.delta?.partial_json ?? '';
      msgTokens += Math.ceil(text.length / 4);
    }
    s.activity.tokens = baseTokens + msgTokens;
    broadcastActivity();
  }
  function startActivity() {
    if (s.activity) return;
    baseTokens = 0; msgTokens = 0;
    s.activity = { start: Date.now(), tokens: 0, phase: 'pending' };
    broadcastActivity(true);
  }
  function stopActivity() { s.activity = null; broadcastActivity(true); }

  /** Tool calls waiting for their result: tool_use id → feed line and where to push it again. */
  const calls = new Map();
  const shellCalls = ctx.shellCalls;
  // Agent resumed by SendMessage: its task_* and messages carry the id of the SendMessage, not the one of the original
  // Agent call. resumes: SendMessage id → recipient and message; aliases: SendMessage id → agent key.
  const resumes = new Map(), aliases = new Map();
  const agentOf = id => id && (s.agents.get(id) || s.agents.get(aliases.get(id)));

  // Reading the stream: live text, grouped tools, end of turn.
  let text = null; // text event being written
  let lastContext = 0; // context size already counted (one message per block, same usage)
  function handleMessage(m) {
    if (m.type === 'system' && m.subtype === 'init') {
      s.sessionId = m.session_id;
      ctx.terminalCommands = new Set(m.terminal_slash_commands || []);
      updateBoard({ sessionId: m.session_id, model: m.model });
    } else if (m.type === 'system' && m.subtype === 'compact_boundary') {
      // Context compacted (auto-compact or /compact): a line marks it, the 🧠 restarts at the next call
      const before = m.compact_metadata?.pre_tokens;
      lastContext = 0;
      achievements.record('compactor', achievements.stat('compactions'));
      pushEvent({ id: newId(), t: 'auto', text: t('driver.feed.compacted', { auto: m.compact_metadata?.trigger === 'auto', k: before ? Math.round(before / 1000) : null }) });
    } else if (m.type === 'conversation_reset') {
      // /clear (or /reset, /new): new conversation, the feed restarts from zero under its new id (resume)
      const id = m.new_conversation_id || m.session_id;
      achievements.record('clean-slate', achievements.get('contextPct') || 0); // session counters reset by clearBoard
      s.feed.length = 0;
      s.agents.clear();
      aliases.clear();
      pushEvent({ id: newId(), t: 'cleared', text: t('driver.feed.cleared') });
      lastContext = 0;
      ctx.clearBoard(); // Tracker panel, automatic title, ticket, step, counters: like a new session
      if (id) { s.sessionId = id; updateBoard({ sessionId: id }); }
      notifyChange();
    } else if (m.type === 'stream_event') {
      const e = m.event;
      if (m.parent_tool_use_id) return; // subagents: only their tools
      trackActivity(e);
      if (e.type === 'content_block_start' && e.content_block?.type === 'text') { text = { id: newId(), t: 'text', text: '' }; count({ newItems: 1 }); }
      else if (e.type === 'content_block_delta' && e.delta?.type === 'text_delta' && text) { text.text += e.delta.text; pushEvent({ ...text }); }
      else if (e.type === 'content_block_stop') { if (text?.text.includes(EM_DASH)) achievements.record('em-dash', 1); text = null; }
    } else if (m.type === 'assistant') {
      const parent = agentOf(m.parent_tool_use_id);
      const push = parent ? ev => ctx.pushAgentEvent(parent, ev) : pushEvent;
      // Context size: what the last call of the main feed sent to the model
      const u = !parent && m.message.usage;
      if (u) {
        const context = (u.input_tokens || 0) + (u.cache_read_input_tokens || 0) + (u.cache_creation_input_tokens || 0);
        if (context && context !== lastContext) {
          lastContext = context; count({ context });
          if (modelWindow) { const pct = Math.floor((context * 100) / modelWindow); achievements.set('contextPct', pct); achievements.record('bursting', pct); }
        }
      }
      for (const b of m.message.content) {
        if (parent && b.type === 'text' && b.text.trim()) push({ id: newId(), t: 'text', text: b.text });
        if (!parent && b.type === 'tool_use') {
          turnTools++;
          achievements.record('toolbox', achievements.stat('tools'));
          const n = linesWritten(b.name, b.input);
          if (n) achievements.record('bulldozer', achievements.stat('lines', n));
          if (b.name === 'Bash') { const a = bashActions(String(b.input?.command || '')); if (a.length) achievementCalls.set(b.id, a); }
        }
        if (b.type !== 'tool_use' || b.name === 'AskUserQuestion' || b.name === BOARD_TOOL) continue;
        if (AGENT_TOOLS.has(b.name)) ctx.launchAgent(b, parent);
        else {
          if (!parent && b.name === 'SendMessage' && b.input?.to) resumes.set(b.id, { to: b.input.to, message: b.input.message });
          if (!parent && (b.input?.run_in_background || b.name === 'Monitor')) shellCalls.set(b.id, { command: String(b.input?.command || b.input?.prompt || '').slice(0, 500), description: b.input?.description || '' });
          const ev = toolEvent(newId(), b);
          calls.set(b.id, { ev, push });
          push(ev);
        }
      }
    } else if (m.type === 'user' && Array.isArray(m.message?.content)) {
      for (const b of m.message.content) {
        if (b.type !== 'tool_result') continue;
        const actions = achievementCalls.get(b.tool_use_id);
        if (actions) { achievementCalls.delete(b.tool_use_id); if (!b.is_error) for (const [f, id] of actions) achievements[f](id, 1); }
        // Result of a tool: it completes its line (expandable in the page)
        const call = calls.get(b.tool_use_id);
        if (call) { calls.delete(b.tool_use_id); call.push({ ...call.ev, result: resultText(b), error: !!b.is_error }); }
        // Background shell: the tool result gives the file where its output is written
        if (shellCalls.has(b.tool_use_id)) {
          const file = resultText(b, Infinity).match(/Output is being written to: ?(\S[^\r\n]*?)(?:\.\s|\s*$|\n)/m)?.[1]?.trim();
          shellCalls.delete(b.tool_use_id);
          const sh = [...s.shells.values()].find(x => x.toolKey === b.tool_use_id);
          if (sh && file) sh.file = file;
          else if (file) shellCalls.set(`file:${b.tool_use_id}`, file);
        }
        // Result of the Agent tool: a foreground subagent finished (a background agent finishes with task_notification).
        const a = s.agents.get(b.tool_use_id);
        if (!a || a.background || a.state !== 'working') continue;
        const out = resultText(b, Infinity);
        ctx.updateAgent(a, { state: b.is_error ? 'failed' : 'completed', end: Date.now(), summary: out.replace(/\n*agentId:[\s\S]*$/, '').trim() || a.summary });
      }
    } else if (m.type === 'system' && ['task_started', 'task_updated', 'task_notification'].includes(m.subtype) && (s.shells.has(m.task_id) || ['local_bash', 'monitor'].includes(m.task_type) || m.patch?.is_backgrounded)) {
      ctx.trackTask(m);
      const sh = s.shells.get(m.task_id), file = sh && shellCalls.get(`file:${sh.toolKey}`);
      if (file) { sh.file = file; shellCalls.delete(`file:${sh.toolKey}`); }
    } else if (m.type === 'system' && ['task_started', 'task_progress', 'task_notification'].includes(m.subtype)) {
      let a = agentOf(m.tool_use_id);
      const resumed = !a && m.subtype === 'task_started' && resumes.get(m.tool_use_id);
      if (resumed) {
        // Resumed agent: it takes back its original card and conversation, becomes running again (tab, 🤖 pill)
        a = [...s.agents.values()].find(x => [m.task_id, resumed.to].includes(x.taskId || x.agentId));
        resumes.delete(m.tool_use_id);
        if (!a) return;
        aliases.set(m.tool_use_id, a.key);
        if (typeof resumed.message === 'string' && resumed.message.trim() !== a.devMessage) ctx.pushAgentEvent(a, { id: newId(), t: 'user', text: resumed.message, fromParent: true });
        a.devMessage = null;
        return ctx.updateAgent(a, { state: 'working', taskId: m.task_id, background: true, start: Date.now(), end: undefined });
      }
      if (!a) return;
      const usage = m.usage ? { tools: m.usage.tool_uses, durationMs: m.usage.duration_ms } : {};
      if (m.subtype === 'task_started') ctx.updateAgent(a, { taskId: m.task_id, type: m.subagent_type || a.type, background: !!m.is_backgrounded });
      else if (m.subtype === 'task_progress') ctx.updateAgent(a, { ...usage, lastTool: m.last_tool_name, summary: m.summary || a.summary });
      else ctx.updateAgent(a, { ...usage, state: m.status, summary: m.summary || a.summary, end: Date.now() });
    } else if (m.type === 'rate_limit_event') {
      // Plan: report a usage milestone, and exhaustion (the turn then stops without text)
      const r = m.rate_limit_info || {};
      achievements.plan(r);
      if (r.status === 'rejected') s.planRejected = true;
      const key = `${r.status}-${r.rateLimitType}-${r.resetsAt}`;
      // The cap of extra credits ("overage") only counts if they are being consumed: otherwise (plan changed,
      // credits not used) the alert came back in every session without meaning anything
      const offTopic = r.rateLimitType === 'overage' && !r.isUsingOverage && !r.overageInUse;
      if ((r.status === 'allowed_warning' || r.status === 'rejected') && !offTopic && key !== s.planAlert) {
        s.planAlert = key;
        const window = PLAN_WINDOWS.includes(r.rateLimitType) ? t(`driver.planWindow.${r.rateLimitType}`) : r.rateLimitType || '';
        const reset = r.resetsAt ? new Date(r.resetsAt * 1000).toLocaleString(locale(), { weekday: 'long', hour: '2-digit', minute: '2-digit' }).replace(' ', t('driver.plan.at')) : '';
        const pct = r.utilization != null ? Math.round(r.utilization <= 1 ? r.utilization * 100 : r.utilization) : null;
        // "allowed_warning" arrives from a milestone on (50 % over 7 days, for example): we state the fact, without drama
        const message = t(r.status === 'rejected' ? 'driver.feed.planExhausted' : 'driver.feed.planWarning', { window, reset, pct });
        // Colour by milestone: neutral below 80 %, orange from 80 to 89 %, red from 90 % (and exhausted)
        const level = r.status === 'rejected' || pct >= 90 ? 'red' : pct >= 80 ? 'orange' : null;
        pushEvent({ id: newId(), t: r.status === 'rejected' ? 'error' : 'auto', text: r.status === 'rejected' ? message : `⚠ ${message}`, ...(level ? { level } : {}) });
      }
    } else if (m.type === 'result') {
      s.busy = false;
      stopActivity();
      // Turn stopped by an API error (plan exhausted, overload…): its text, otherwise the page shows nothing
      const apiError = m.is_error ? String(m.result || (m.errors || []).join('\n') || t('driver.feed.apiError')).trim() : '';
      if (apiError) { pushEvent({ id: newId(), t: 'error', text: apiError }); count({ newItems: 1 }); }
      // Achievements: XP of the turn, its duration, API errors (neither plan exhausted nor requested interruption)
      if (apiError && !s.planRejected && !s.interrupted) achievements.add('it-happens');
      achievements.xp(2 + Math.min(50, turnTools));
      achievements.record('long-haul', (m.duration_ms || 0) / 60000);
      achievements.set('lastExchange', new Date().toISOString());
      turnTools = 0; s.planRejected = false; s.interrupted = false;
      s.turnEndedAt = s.lastTurnAt = Date.now();
      pushEvent({ id: newId(), t: 'end', ok: m.subtype === 'success' && !m.is_error, cost: m.total_cost_usd, duration: m.duration_ms });
      const window = Math.max(0, ...Object.values(m.modelUsage || {}).map(x => x.contextWindow || 0));
      count({ claudeMs: m.duration_ms, window });
      if (window) modelWindow = window;
      setStatus('waiting');
      ctx.flushQueue();
    }
  }

  return { handleMessage, startActivity, stopActivity };
}

/** Plan windows that have a label in the dictionary (others are shown as the SDK names them). */
const PLAN_WINDOWS = ['five_hour', 'seven_day', 'seven_day_opus', 'seven_day_sonnet', 'overage'];
