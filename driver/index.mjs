// Claude Code sessions driven from the page, through the Claude Code SDK (one long query() per session).
// createSession() assembles the pieces of the driver/ folder around a shared context `ctx` and reads the query stream.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { query } from '@anthropic-ai/claude-agent-sdk';
import * as trackers from '../trackers.mjs';
import { DASH_DIR, applyLanguage } from '../common.mjs';
import { language, t } from '../public/i18n/index.js';
import { inputQueue, attachInput } from './input.mjs';
import { attachEvents } from './events.mjs';
import { attachPermissions } from './permissions.mjs';
import { attachAgents } from './agents.mjs';
import { attachMcpTools, DASHBOARD_TOOLS } from './mcp-tools.mjs';
import { MODES, modeKey } from './modes.mjs';

export { FILES_DIR, attachmentUrl, extractAttachments } from './attachments.mjs';
export { feedFromHistory, agentFeedFromHistory, historyAgents, recentFolders } from './history.mjs';
export { subscriptionUsage } from './usage.mjs';

const HERE = path.join(path.dirname(fileURLToPath(import.meta.url)), '..'); // repository root (instructions.*.md, plugin/)
export { MODES, childMode } from './modes.mjs';
const INERT_ACHIEVEMENTS = { record() {}, add() {}, xp() {}, stat: () => 0, set() {}, get() {}, plan() {}, parallel() {} };

/** Common instructions in the interface language (instructions.fr.md / instructions.en.md), read at each query start. */
function instructions() {
  const file = lang => path.join(HERE, `instructions.${lang}.md`);
  try { return fs.readFileSync(file(language()), 'utf8'); } catch { return fs.readFileSync(file('fr'), 'utf8'); }
}

/**
 * Claude Code auto-compact (⚙ Options: `autoCompact`, read at the start of each query): "default" lets Claude Code
 * compact near the end of the window (≈ 97 %, around 967k tokens with the 1M window), "off" disables it, a number of
 * tokens makes it compact as if the window had that size (CLAUDE_CODE_AUTO_COMPACT_WINDOW, from 100k to 1M).
 */
function autoCompactEnv() {
  let o = {};
  try { o = JSON.parse(fs.readFileSync(path.join(DASH_DIR, 'options.json'), 'utf8')); } catch { /* defaults */ }
  const env = { ...process.env };
  if (o.autoCompact === 'off') env.DISABLE_AUTO_COMPACT = '1';
  else if (Number(o.autoCompact) > 0) env.CLAUDE_CODE_AUTO_COMPACT_WINDOW = String(Math.round(Number(o.autoCompact)));
  return env;
}

/**
 * Creates a driven session.
 * @param {object} o
 * @param {string} o.slug
 * @param {string} o.cwd project folder
 * @param {string} o.mode key of MODES
 * @param {string} [o.prePlan] key of MODES to go back to when the plan is approved (session started in plan)
 * @param {(data: object) => void} o.updateBoard merge into the panel state (called by the tool and by the page)
 * @param {(ev: object) => void} o.emit add or replace a feed event
 * @param {() => void} [o.clearBoard] /clear: empties the Tracker panel and the session header
 * @param {(delta: object) => void} [o.count] add to the session counters (claudeMs, exchanges; context and window replaced)
 * @param {() => void} [o.notifyChange] the summary state of the session changed (running subagents): refresh the list
 * @param {(o: {cwd, text, mode}) => Promise<string>} o.launch creates another driven session, returns its slug
 * @param {() => object[]} o.list summary of the dashboard sessions
 * @param {(slug: string, text: string) => Promise<string|null>} o.write message to another session (null if sent, otherwise the error)
 * @param {(slug: string) => Promise<string|null>} o.end ends another session (null if done, otherwise the error)
 * @param {string} [o.resume] Claude session_id to resume (same session, same history)
 * @param {object[]} [o.initialFeed] feed rebuilt from the history of the resumed session
 * @param {object} [o.achievements] levels and achievements (engine/progress.mjs, sessionAchievements): record, add, xp, stat, set, get, plan
 */
export function createSession({ slug, cwd, mode = 'all', prePlan, updateBoard, emit, count = () => {}, clearBoard = () => {}, notifyChange = () => {}, onStopped = () => {}, launch, list, write, end, resume, initialFeed = [], achievements = INERT_ACHIEVEMENTS }) {
  const input = inputQueue();
  const pending = new Map(); // id → resolve
  let counter = 0;
  const newId = () => `${slug}-${Date.now().toString(36)}-${++counter}`;
  const s = { slug, cwd, mode, prePlan, busy: false, sessionId: resume || null, feed: [...initialFeed], q: null };

  const pushEvent = ev => {
    const i = s.feed.findIndex(x => x.id === ev.id);
    if (i >= 0 && s.feed[i].queued && !ev.queued) { s.feed.splice(i, 1); s.feed.push(ev); } // out of the queue: at its sending place
    else if (i >= 0) s.feed[i] = ev; else s.feed.push(ev);
    emit(ev);
  };
  // Ended session (End): the end of its loop arrives a few seconds later and must not set it back to "waiting"
  const setStatus = status => { if (!s.closed) updateBoard({ status }); };

  // Context shared by the modules of the folder. Each attachX(ctx) adds the functions it returns, which the other
  // modules call through ctx.x() when needed (no copy). State specific to a module: private to that module.
  const ctx = {
    s, slug, cwd, resume, input, pending, newId, pushEvent, setStatus, updateBoard, emit, count, clearBoard, notifyChange, onStopped, achievements,
    callbacks: { launch, list, write, end },
    terminalCommands: new Set(), // "/" commands tied to the terminal (/exit…), given by the init message
  };

  const { dashboard } = attachMcpTools(ctx);
  Object.assign(ctx, attachPermissions(ctx));

  // Language of the instructions: the current setting (options.json), so that a change applies to the next query
  applyLanguage();
  s.q = query({
    prompt: input.iterable,
    options: {
      cwd,
      ...(resume ? { resume } : {}),
      settingSources: ['user', 'project', 'local'],
      permissionMode: MODES[mode],
      allowDangerouslySkipPermissions: true,
      allowedTools: DASHBOARD_TOOLS,
      includePartialMessages: true,
      // Common instructions + those of the folder's tracker profile (blocks, steps, method), read at startup
      systemPrompt: { type: 'preset', preset: 'claude_code', append: `${instructions()}\n\n${trackers.instructionsOf(trackers.profileOf(cwd).profile)}` },
      // Dashboard plugin (skill /tracker): only in the sessions of the page
      plugins: [{ type: 'local', path: path.join(HERE, 'plugin') }],
      mcpServers: { dashboard },
      canUseTool: ctx.canUseTool,
      env: autoCompactEnv(),
    },
  });

  Object.assign(ctx, attachAgents(ctx)); // creates ctx.shellCalls, read by the events
  Object.assign(ctx, attachEvents(ctx));
  Object.assign(ctx, attachInput(ctx));
  const { handleMessage, stopActivity } = ctx;

  // Reading the stream: each SDK message is translated into feed events (events.mjs).
  (async () => {
    try {
      for await (const m of s.q) handleMessage(m);
    } catch (e) {
      // Conversation held by another Claude Code launched in the background (claude --bg, Claude Code service):
      // the page offers to stop it (`claude stop <id>`) to resume it here
      const bg = e.message.match(/session is running in the background \(([\w-]+)\)/)?.[1];
      if (!s.closed) pushEvent({ id: newId(), t: 'error', text: bg ? t('driver.feed.runningInBackground', { id: bg }) : e.message, ...(bg ? { backgroundId: bg } : {}) });
    }
    s.busy = false;
    s.dead = true;
    stopActivity();
    // Closed on request (End): not a failure, no alert in the feed
    if (!s.closed) pushEvent({ id: newId(), t: 'error', text: t('driver.feed.sessionStopped') });
    setStatus('waiting');
    onStopped(); // the engine forgets it: the next message starts a new query (history resumed)
  })();

  /** MCP servers of the session (/mcp window of the page): state, tools; reconnect, enable or disable. */
  s.mcp = async () => (await s.q.mcpServerStatus()).map(({ name, status, error, scope, source, serverInfo, tools }) => ({
    name, status, error, scope, source, version: serverInfo?.version, tools: (tools || []).map(x => x.name),
  }));
  s.mcpReconnect = name => s.q.reconnectMcpServer(name);
  s.mcpToggle = (name, active) => s.q.toggleMcpServer(name, !!active);

  /** "/" commands and skills of the session (page autocompletion), without those tied to the terminal (/exit…). */
  s.commands = async () => (await s.q.supportedCommands())
    .filter(c => !ctx.terminalCommands.has(c.name))
    .map(({ name, description, argumentHint, aliases, builtin }) => ({ name, description, argumentHint, aliases, builtin: !!builtin }));

  /**
   * /usage and /context of the CLI (/usage window of the page): cost and tokens of the session per model, what consumes
   * over 24 h and 7 days (behaviors, skills, agents, plugins, MCP servers, recommendations), and the context usage per
   * category. Experimental SDK APIs: a part that breaks returns null.
   */
  s.usageCli = async () => {
    const [u, c] = await Promise.all([
      s.q.usage_EXPERIMENTAL_MAY_CHANGE_DO_NOT_RELY_ON_THIS_API_YET({}).catch(() => null),
      s.q.getContextUsage({ detail: 'summary' }).catch(() => null),
    ]);
    const { gridRows, ...context } = c || {};
    return { session: u?.session || null, behaviors: u?.behaviors || null, context: c ? context : null };
  };

  s.interrupt = async () => { if (s.busy) s.interrupted = true; await s.q.interrupt(); }; // interrupted: not an API error (achievements)
  /**
   * Records a mode change, asked by the page or made by Claude Code itself (EnterPlanMode, plan approved: `status`
   * messages). Entering plan remembers the mode to go back to when the plan is approved.
   */
  s.syncMode = m => {
    if (!MODES[m] || m === s.mode) return;
    if (m === 'plan') s.prePlan = s.mode;
    s.mode = m;
    updateBoard({ mode: m, prePlanMode: s.prePlan ?? null });
  };
  s.setMode = async m => { if (!MODES[m]) return; await s.q.setPermissionMode(MODES[m]); s.syncMode(m); };
  ctx.syncSdkMode = sdk => s.syncMode(modeKey(sdk));
  /** Stops the Claude process of the session (running turn interrupted). Resuming stays possible through its id. */
  s.close = async () => {
    s.closed = true;
    if (s.busy) await s.q.interrupt().catch(() => {});
    input.close();
  };
  return s;
}
