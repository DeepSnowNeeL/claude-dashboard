// Claude Code history: feed and subagents of a past session, recent folders.
import { listSessions, getSessionMessages, listSubagents, getSubagentMessages } from '@anthropic-ai/claude-agent-sdk';
import { toolEvent, resultText, AGENT_TOOLS, contextOf, windowOf } from './events.mjs';
import { BOARD_TOOL } from './mcp-tools.mjs';
import { extractAttachments, attachmentUrl } from './attachments.mjs';
import { migrateSession } from '../migration.mjs';
import { t } from '../public/i18n/index.js';

// Backward compatibility: conversations recorded by the French build of the dashboard name its MCP tools in French
// (server "tableau"). Their calls are shown under the current names, and the board tool is still recognised.
const OLD_TOOL_NAMES = {
  mcp__tableau__maj_tableau: BOARD_TOOL,
  mcp__tableau__lancer_session: 'mcp__dashboard__launch_session',
  mcp__tableau__lister_sessions: 'mcp__dashboard__list_sessions',
  mcp__tableau__message_session: 'mcp__dashboard__message_session',
  mcp__tableau__terminer_session: 'mcp__dashboard__end_session',
  mcp__tableau__lister_suivis: 'mcp__dashboard__list_trackers',
  mcp__tableau__definir_suivi: 'mcp__dashboard__set_tracker',
};
const toolName = name => OLD_TOOL_NAMES[name] || name;

// Messages the dashboard sends to Claude start with "[Dashboard] " ("[Tableau de bord] " in the French build,
// still recognised for backward compatibility).
const PREFIX = /^\[(?:Dashboard|Tableau de bord)\] /;
const MESSAGE_TO_AGENT = /^\[(?:Dashboard\] Developer message for subagent|Tableau de bord\] Message du développeur pour le sous-agent) « (.*?) » \(id /;
// Tail of the wake-up after background agents ("Prends en compte…" in the French build)
const WAKE_UP_TAIL = / (?:Take (?:its result|their results) into account and continue\.|Prends en compte.*)$/s;

/**
 * Decisions passed to the board tool. Backward compatibility: the French build named the parameter `etat` and wrote
 * the decisions with French keys, converted by migrateSession.
 */
function decisionsOf(input) {
  if (Array.isArray(input?.state?.decisions)) return input.state.decisions;
  const old = input?.etat?.decisions;
  if (!Array.isArray(old) || !old.length) return null;
  const board = { decisions: old };
  return (migrateSession(board) || board).decisions;
}

/**
 * Rebuilds the feed of a session from its Claude Code history: messages, texts, tools, decisions.
 * Permission cards and turn ends are not in the history.
 */
export async function feedFromHistory(slug, sessionId, cwd) {
  const feed = [];
  let n = 0;
  const id = () => `${slug}-h${++n}`;
  let messages = [];
  try { messages = await getSessionMessages(sessionId, { dir: cwd }); } catch { /* fallback below */ }
  // The folder may not find the session (different case on Windows): we then search in all projects.
  if (!messages.length) { try { messages = await getSessionMessages(sessionId); } catch { return feed; } }
  const agents = await agentsFromHistory(slug, sessionId);
  const calls = new Map(); // tool_use id → tool line, completed by its result
  for (const m of messages) {
    const content = m.message?.content;
    if (m.type === 'user') attachResults(content, calls);
    if (m.type === 'user' && !m.parent_tool_use_id) {
      const text = typeof content === 'string' ? content
        : Array.isArray(content) ? content.filter(b => b.type === 'text').map(b => b.text).join('\n') : '';
      // "!" commands arrive at the head of the next message: they are shown as commands.
      let rest = text;
      for (const [, cmd, out, err] of text.matchAll(/<bash-input>([\s\S]*?)<\/bash-input>\s*<bash-stdout>([\s\S]*?)<\/bash-stdout><bash-stderr>([\s\S]*?)<\/bash-stderr>\s*/g)) {
        feed.push({ id: id(), t: 'command', cmd, output: out + err, running: false });
      }
      rest = rest.replace(/<bash-input>[\s\S]*?<\/bash-stderr>\s*/g, '');
      const { text: clean, attachments } = extractAttachments(rest, file => attachmentUrl(slug, file));
      const toAgent = clean.match(MESSAGE_TO_AGENT);
      if (toAgent) feed.push({ id: id(), t: 'auto', text: t('driver.feed.messageToSubagent', { name: toAgent[1] }) });
      else if (PREFIX.test(clean)) feed.push({ id: id(), t: 'auto', text: `🔔 ${clean.replace(PREFIX, '').replace(WAKE_UP_TAIL, '')}` }); // wake-up after agents
      else if ((clean.trim() || attachments.length) && !clean.startsWith('<')) feed.push({ id: id(), t: 'user', text: clean, attachments });
    } else if (m.type === 'assistant' && Array.isArray(content)) {
      for (const raw of content) {
        const b = raw.type === 'tool_use' && OLD_TOOL_NAMES[raw.name] ? { ...raw, name: toolName(raw.name) } : raw;
        if (b.type === 'text' && !m.parent_tool_use_id && b.text.trim()) feed.push({ id: id(), t: 'text', text: b.text });
        else if (b.type === 'tool_use' && b.name === BOARD_TOOL) {
          const decisions = decisionsOf(b.input);
          if (decisions?.length) feed.push({ id: id(), t: 'decisions', decisions });
        } else if (b.type === 'tool_use' && AGENT_TOOLS.has(b.name) && !m.parent_tool_use_id) {
          const a = agents.get(b.id);
          feed.push({
            id: `ag-${b.id}`, t: 'agent', key: b.id, type: b.input?.subagent_type || 'general-purpose', description: b.input?.description || '',
            agentId: a?.agentId, state: a?.state || 'stopped', tools: a?.tools || 0, summary: a?.summary || '', start: a?.start, end: a?.end,
            durationMs: a?.start && a?.end ? a.end - a.start : undefined, model: a?.model, contextMax: a?.contextMax, window: a?.window, background: !!b.input?.run_in_background, fromHistory: true,
          });
        } else if (b.type === 'tool_use' && b.name === 'AskUserQuestion') feed.push({ id: id(), t: 'question', questions: b.input?.questions || [], state: 'answered' });
        else if (b.type === 'tool_use') { const ev = toolEvent(id(), b); calls.set(b.id, ev); feed.push(ev); }
      }
    }
  }
  return feed;
}

/** Tool results of a user message of the history: they complete the tool lines already seen. */
function attachResults(content, calls) {
  if (!Array.isArray(content)) return;
  for (const b of content) {
    const ev = b.type === 'tool_result' && calls.get(b.tool_use_id);
    if (ev) { ev.result = resultText(b); ev.error = !!b.is_error; }
  }
}

/**
 * Subagents of a past session, from their transcripts: key (id of the Agent tool_use) → conversation and state.
 * An agent whose transcript does not end on an answer was cut (server stopped, Stop).
 */
const agentsCache = new Map(); // sessionId → Map
async function agentsFromHistory(slug, sessionId) {
  const agents = new Map();
  let ids = [];
  try { ids = await listSubagents(sessionId); } catch { return agents; }
  let n = 0;
  for (const agentId of ids) {
    let msgs = [];
    try { msgs = await getSubagentMessages(sessionId, agentId); } catch { continue; }
    const key = msgs.find(m => m.parent_tool_use_id)?.parent_tool_use_id;
    if (!key) continue;
    const feed = [];
    let tools = 0, summary = '', model, contextMax = 0;
    const calls = new Map();
    for (const m of msgs) {
      const c = m.message?.content;
      if (m.type === 'user') attachResults(c, calls);
      if (m.type === 'assistant' && m.message?.model && m.message.model !== '<synthetic>') model = m.message.model;
      if (m.type === 'assistant') contextMax = Math.max(contextMax, contextOf(m.message?.usage));
      if (m.type === 'user' && typeof c === 'string' && !feed.length) feed.push({ id: `${slug}-ha${++n}`, t: 'user', text: c, fromParent: true });
      else if (m.type === 'assistant' && Array.isArray(c)) for (const raw of c) {
        const b = raw.type === 'tool_use' && OLD_TOOL_NAMES[raw.name] ? { ...raw, name: toolName(raw.name) } : raw;
        if (b.type === 'text' && b.text.trim()) { feed.push({ id: `${slug}-ha${++n}`, t: 'text', text: b.text }); summary = b.text; }
        else if (b.type === 'tool_use') { tools++; const ev = toolEvent(`${slug}-ha${++n}`, b); calls.set(b.id, ev); feed.push(ev); }
      }
    }
    const last = msgs.at(-1);
    const finished = last?.type === 'assistant' && !(last.message?.content || []).some(b => b.type === 'tool_use');
    const ts = m => (m?.timestamp ? Date.parse(m.timestamp) : undefined);
    agents.set(key, { key, agentId, feed, tools, summary: finished ? summary : '', state: finished ? 'completed' : 'stopped', start: ts(msgs[0]), end: ts(last), model, contextMax, window: windowOf(model) });
  }
  agentsCache.set(sessionId, agents);
  return agents;
}
/** Conversation of a subagent of a past session (session paused, not resumed yet). */
export async function agentFeedFromHistory(slug, sessionId, key) {
  const agents = agentsCache.get(sessionId) || await agentsFromHistory(slug, sessionId);
  return agents.get(key)?.feed || null;
}
export const historyAgents = sessionId => agentsCache.get(sessionId) || new Map();

/** Recent project folders, to suggest a `cwd` on creation. */
export async function recentFolders() {
  try {
    const list = await listSessions({ limit: 200 });
    const seen = new Map();
    for (const x of list) if (x.cwd && !seen.has(x.cwd)) seen.set(x.cwd, x.lastModified);
    return [...seen].sort((a, b) => b[1] - a[1]).map(([cwd]) => cwd).slice(0, 20);
  } catch {
    return [];
  }
}
