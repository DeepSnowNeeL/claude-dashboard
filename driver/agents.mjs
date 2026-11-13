// Subagents and background shells of a session: cards, conversations, SDK task_*, stopTask, wake-up.
import fs from 'node:fs';
import { historyAgents } from './history.mjs';
import { t } from '../public/i18n/index.js';

/**
 * Returns `{ launchAgent, trackTask, agentDone, updateAgent, pushAgentEvent }`; sets `s.agents`, `s.shells` and the
 * methods used by the page (output and stop of a shell or an agent, counters). `ctx.shellCalls` is created here.
 */
export function attachAgents(ctx) {
  const { s, resume, newId, pushEvent, emit, notifyChange } = ctx;

  // Subagents: a card in the conversation that launched it, and its own conversation (text, tools), viewable
  // from the page. The key is the id of the Agent tool_use, carried by its messages (parent_tool_use_id) and its task_*.
  s.agents = new Map(resume ? historyAgents(resume) : []); // those of the history, rebuilt with the feed
  const agentCard = a => ({
    id: `ag-${a.key}`, t: 'agent', key: a.key, type: a.type, description: a.description, state: a.state,
    agentId: a.agentId || a.taskId, start: a.start, end: a.end, tools: a.tools, durationMs: a.durationMs, lastTool: a.lastTool, summary: a.summary, background: a.background,
  });
  function pushAgentEvent(a, ev) {
    const i = a.feed.findIndex(x => x.id === ev.id);
    if (i >= 0) a.feed[i] = ev; else a.feed.push(ev);
    emit({ ...ev, agent: a.key });
  }
  function updateAgent(a, fields) {
    const before = a.state;
    Object.assign(a, fields);
    // The final answer of a subagent does not arrive as a message: it is in the end summary.
    if (before === 'working' && a.state !== 'working' && a.summary) pushAgentEvent(a, { id: `${a.key}-end`, t: 'text', text: a.summary });
    if (a.parent) pushAgentEvent(a.parent, agentCard(a)); else pushEvent(agentCard(a));
    if (before !== a.state) notifyChange(); // running agents counter of the list
    if (before === 'working' && a.state !== 'working' && !a.parent) ctx.count({ newItems: 1 }); // "unread" of the list
    if (before === 'working' && a.state !== 'working' && a.background && !a.parent) agentDone(a);
  }

  // A background agent that finishes while the session is idle starts a new turn, as in the terminal
  // (the SDK keeps the notification for the next message). Close endings are grouped.
  let done = [], agentsWakeUp = null;
  function agentDone(a) {
    done.push(a);
    clearTimeout(agentsWakeUp);
    agentsWakeUp = setTimeout(() => {
      const list = done.splice(0);
      if (s.busy || s.closed || !list.length) return; // in the middle of a turn: Claude receives the notification in that turn
      // Subagents and background shells (pipeline watch, server…): same wake-up
      const shown = list.map(x => t(x.shell ? 'driver.feed.doneCommand' : 'driver.feed.doneSubagent', { name: x.description })).join(', ');
      const names = list.map(x => `${x.shell ? 'the command' : 'the subagent'} "${x.description}"`).join(', ');
      pushEvent({ id: newId(), t: 'auto', text: t('driver.feed.doneInBackground', { names: shown }) });
      ctx.dispatch(`[Dashboard] In the background, ${names} ${list.length > 1 ? 'have' : 'has'} finished. Take ${list.length > 1 ? 'their results' : 'its result'} into account and continue.`);
    }, 3000);
  }
  function launchAgent(b, parent) {
    const a = {
      key: b.id, parent, type: b.input?.subagent_type || 'general-purpose', description: b.input?.description || '',
      state: 'working', start: Date.now(), tools: 0, background: !!b.input?.run_in_background, feed: [],
    };
    s.agents.set(a.key, a);
    ctx.achievements.xp(5);
    ctx.achievements.record('swarm', s.runningAgents()); // subagents running at the same time
    a.feed.push({ id: newId(), t: 'user', text: b.input?.prompt || '', fromParent: true });
    updateAgent(a, {});
    notifyChange();
  }
  // Background shells (Bash run_in_background, Monitor): tracked like subagents, but without a conversation:
  // their output is read in the file given by the tool result. Key = SDK task_id.
  s.shells = new Map();
  const shellCalls = ctx.shellCalls = new Map(); // tool_use_id → command and description, until its task_started
  const shellView = sh => ({ id: `sh-${sh.id}`, t: 'shell', key: sh.id, type: sh.type, description: sh.description, command: sh.command, state: sh.state, start: sh.start, end: sh.end });
  function updateShell(sh, fields) {
    const before = sh.state;
    Object.assign(sh, fields);
    pushEvent(shellView(sh)); // kept in the feed (nothing is drawn there): the page finds it again on reload
    if (before !== sh.state) notifyChange();
    if (before === 'working' && sh.state !== 'working') ctx.count({ newItems: 1 });
    // Insomniac: only a shell that finished by itself (a server stopped by hand does not count)
    if (before === 'working' && ['completed', 'failed'].includes(sh.state) && sh.start) ctx.achievements.record('insomniac', (Date.now() - sh.start) / 3600_000);
    if (before === 'working' && sh.state !== 'working') agentDone({ description: sh.description || sh.command, shell: true });
  }
  function trackTask(m) {
    if (m.subtype === 'task_started') {
      if (!['local_bash', 'monitor'].includes(m.task_type) || !m.is_backgrounded) return;
      const call = shellCalls.get(m.tool_use_id) || {};
      s.shells.set(m.task_id, { id: m.task_id, type: m.task_type, description: m.description || call.description || '', command: call.command || '', state: 'working', start: Date.now(), toolKey: m.tool_use_id });
      return updateShell(s.shells.get(m.task_id), {});
    }
    const sh = s.shells.get(m.task_id);
    if (!sh) {
      // Command moved to the background along the way (task_updated is_backgrounded); not a subagent
      if (m.subtype === 'task_updated' && m.patch?.is_backgrounded && ![...s.agents.values()].some(a => a.taskId === m.task_id)) {
        s.shells.set(m.task_id, { id: m.task_id, type: 'local_bash', description: m.patch.description || '', command: '', state: 'working', start: Date.now() });
        updateShell(s.shells.get(m.task_id), {});
      }
      return;
    }
    if (m.subtype === 'task_notification') updateShell(sh, { state: m.status, end: Date.now(), file: m.output_file || sh.file, summary: m.summary });
    else if (m.subtype === 'task_updated' && ['completed', 'failed', 'killed'].includes(m.patch?.status)) {
      updateShell(sh, { state: m.patch.status === 'killed' ? 'stopped' : m.patch.status, end: Date.now() });
    }
  }
  s.runningShells = () => [...s.shells.values()].filter(x => x.state === 'working').length;
  /** End of the output of a shell (64 KB at most): file written by Claude Code, path taken from the tool result. */
  s.shellOutput = key => {
    const sh = s.shells.get(key);
    if (!sh) return null;
    let output = '';
    try {
      if (sh.file && fs.existsSync(sh.file)) {
        const size = fs.statSync(sh.file).size, start = Math.max(0, size - 65536);
        const fd = fs.openSync(sh.file, 'r'), buffer = Buffer.alloc(size - start);
        fs.readSync(fd, buffer, 0, buffer.length, start);
        fs.closeSync(fd);
        output = (start ? '…\n' : '') + buffer.toString('utf8');
      }
    } catch { /* file being written or deleted */ }
    return { ...shellView(sh), file: sh.file || null, output };
  };
  s.stopShell = async key => {
    const sh = s.shells.get(key);
    if (!sh || sh.state !== 'working') return false;
    await s.q.stopTask(sh.id);
    return true;
  };
  s.runningAgents = () => [...s.agents.values()].filter(a => a.state === 'working').length;
  s.agentFeed = key => s.agents.get(key)?.feed || null;
  s.stopAgent = async key => {
    const a = s.agents.get(key);
    if (!a?.taskId || a.state !== 'working') return false;
    await s.q.stopTask(a.taskId);
    return true;
  };

  /**
   * Message from the developer for a subagent (input of its view): the main session passes it on through
   * SendMessage, the only way to write to it. A foreground agent is first moved to the background, otherwise the main
   * session, blocked on its Agent call, could not pass anything on before it ends. Returns an error, or null.
   */
  s.sendToAgent = async (key, text) => {
    const a = s.agents.get(key), id = a && (a.agentId || a.taskId);
    if (!id) return t('driver.errors.unknownSubagent');
    if (a.state === 'working' && !a.background) {
      try { await s.q.backgroundTasks(a.key); a.background = true; } catch { /* stays in the foreground: passed on at its end */ }
    }
    a.devMessage = text; // shown right away; the resume by SendMessage does not repeat it
    pushAgentEvent(a, { id: newId(), t: 'user', text });
    pushEvent({ id: newId(), t: 'auto', text: t('driver.feed.messageToSubagent', { name: a.description || a.type }) });
    const instruction = `[Dashboard] Developer message for subagent "${a.description || a.type}" (id ${id}). `
      + `Pass it on as is with SendMessage (to: "${id}"), without doing anything else or waiting for its answer, then resume where you were.

${text}`;
    if (s.busy) { ctx.count({ exchanges: 1 }); ctx.input.push(instruction); } // read at the next tool, without cutting the turn
    else { s.devTurn = true; ctx.dispatch(instruction); } // turn started by the developer: not "autonomous"
    return null;
  };

  return { launchAgent, trackTask, agentDone, updateAgent, pushAgentEvent };
}
