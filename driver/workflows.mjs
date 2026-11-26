// Agents of a Workflow (SDK task local_workflow). Claude Code streams none of their messages: the dashboard reads them
// in the transcript folder given by the tool result ("Transcript dir: …"), polled while the workflow runs:
// journal.jsonl (started / result / failed per agent) and one agent-<id>.jsonl per agent. They show as subagents
// (card, tab, conversation), key `wf-<agentId>`.
import fs from 'node:fs';
import path from 'node:path';
import { toolEvent, resultText, contextOf, windowOf, lastSentence, summarizeTool } from './events.mjs';
import { addCall } from './pricing.mjs';

export const WORKFLOW_TOOL = 'Workflow';
/** Transcript folder of a Workflow tool result, or null. */
export const workflowDir = text => String(text || '').match(/^Transcript dir: ?(.+?)\s*$/m)?.[1] || null;

/** New complete lines of a JSONL file since the last call (offset per file kept in `offsets`). */
function readLines(file, offsets) {
  let size;
  try { size = fs.statSync(file).size; } catch { return []; }
  const from = offsets.get(file) || 0;
  if (size <= from) return [];
  const buffer = Buffer.alloc(size - from);
  try {
    const fd = fs.openSync(file, 'r');
    fs.readSync(fd, buffer, 0, buffer.length, from);
    fs.closeSync(fd);
  } catch { return []; }
  const end = buffer.lastIndexOf(10); // last line still being written: read next time
  if (end < 0) return [];
  offsets.set(file, from + end + 1);
  return buffer.subarray(0, end).toString('utf8').split('\n').flatMap(line => { try { return [JSON.parse(line)]; } catch { return []; } });
}

// The task of a workflow agent starts with a harness preamble, then the text computed by the script, indented
const HARNESS = /^\[Workflow harness[\s\S]*?follows:\n/;
const taskText = text => (HARNESS.test(text) ? text.replace(HARNESS, '').replace(/^ {2}/gm, '').trim() : text);

/**
 * Reader of a workflow folder. `read(onAgent, onMessage)` reads what is new: `onAgent(info)` for each agent whose
 * journal entry changed (`{ agentId, label, phase, state, result }`), `onMessage(info, m)` for each new line of its
 * transcript.
 */
export function workflowReader(dir) {
  const offsets = new Map(), agents = new Map();
  function read(onAgent, onMessage) {
    for (const e of readLines(path.join(dir, 'journal.jsonl'), offsets)) {
      if (!e.agentId || !['started', 'result', 'failed'].includes(e.type)) continue;
      const info = agents.get(e.agentId) || { agentId: e.agentId, state: 'working' };
      if (e.type === 'started') {
        let meta = {};
        if (!e.label) try { meta = JSON.parse(fs.readFileSync(path.join(dir, `agent-${e.agentId}.meta.json`), 'utf8')); } catch { /* no meta */ }
        Object.assign(info, { state: 'working', label: e.label || meta.description || e.agentId, phase: e.phase || meta.workflowPhase });
      } else if (e.type === 'result') Object.assign(info, { state: 'completed', result: e.result });
      else info.state = 'failed';
      agents.set(e.agentId, info);
      onAgent(info);
    }
    for (const info of agents.values()) for (const m of readLines(path.join(dir, `agent-${info.agentId}.jsonl`), offsets)) onMessage(info, m);
  }
  return { agents, read };
}

/**
 * Applies one transcript line to an agent (`a`: feed, tool count, model, context, cost, tool in progress, last
 * sentence). `push(ev)` adds or replaces a line of its conversation. Returns true if something changed.
 */
export function applyWorkflowMessage(a, m, id, push) {
  const content = m.message?.content;
  a.start ||= ts(m);
  if (m.type === 'user' && typeof content === 'string') {
    if (!a.feed.length) push({ id: id(), t: 'user', text: taskText(content), fromParent: true, at: ts(m) });
    return false;
  }
  if (m.type === 'user' && Array.isArray(content)) {
    for (const b of content) {
      const ev = b.type === 'tool_result' && a.toolCalls.get(b.tool_use_id);
      if (ev) { a.toolCalls.delete(b.tool_use_id); push({ ...ev, result: resultText(b), error: !!b.is_error }); }
    }
    return false;
  }
  if (m.type !== 'assistant' || !m.message) return false;
  const msg = m.message;
  if (msg.model && msg.model !== '<synthetic>') a.model = msg.model;
  const context = contextOf(msg.usage);
  if (context) { a.context = context; a.contextMax = Math.max(a.contextMax || 0, context); }
  if (msg.usage) a.consumption = addCall(a.calls ||= new Map(), msg.id, msg.model || a.model, msg.usage);
  a.window = windowOf(a.model);
  for (const b of Array.isArray(content) ? content : []) {
    if (b.type === 'text' && b.text.trim()) {
      push({ id: id(), t: 'text', text: b.text, at: ts(m) });
      a.lastText = lastSentence(b.text); a.lastAnswer = b.text; a.current = null;
    } else if (b.type === 'tool_use') {
      a.tools = (a.tools || 0) + 1;
      a.current = { name: b.name, summary: summarizeTool(b.name, b.input) };
      const ev = toolEvent(id(), b);
      a.toolCalls.set(b.id, ev);
      push(ev);
    }
  }
  a.lastAt = ts(m);
  return true;
}
const ts = m => (m?.timestamp ? Date.parse(m.timestamp) : undefined);

/** New agent record of a workflow (same shape as a subagent of the Agent tool). */
export function workflowAgent(info, workflowKey, name) {
  return {
    key: `wf-${info.agentId}`, type: name || 'workflow', description: info.phase ? `${info.label} (${info.phase})` : info.label,
    state: 'working', tools: 0, feed: [], toolCalls: new Map(), workflow: workflowKey, workflowAgentId: info.agentId,
  };
}
/** Final fields of an agent from its journal state (`summary`: its last answer, otherwise the script's result). */
export function workflowEnd(a, info, fallback = 'stopped') {
  const state = info.state === 'working' ? fallback : info.state;
  const result = typeof info.result === 'string' ? info.result : info.result != null ? JSON.stringify(info.result) : '';
  return { state, end: a.lastAt || Date.now(), current: null, summary: state === 'completed' ? a.lastAnswer || result : a.summary };
}

/**
 * Agents of the workflows of a past session, read once from their folders: key → agent (finished, or stopped if the
 * process was cut before its result).
 */
export function workflowAgentsFromDir(dir, workflowKey, slug) {
  const reader = workflowReader(dir), agents = new Map();
  let n = 0;
  const id = () => `${slug}-hw${++n}-${workflowKey.slice(-6)}`;
  reader.read(info => {
    if (!agents.has(info.agentId)) agents.set(info.agentId, workflowAgent(info, workflowKey));
  }, (info, m) => {
    const a = agents.get(info.agentId);
    applyWorkflowMessage(a, m, id, ev => upsert(a.feed, ev));
  });
  const out = new Map();
  for (const [agentId, a] of agents) {
    Object.assign(a, workflowEnd(a, reader.agents.get(agentId)), { fromHistory: true });
    delete a.toolCalls;
    out.set(a.key, a);
  }
  return out;
}
const upsert = (feed, ev) => { const i = feed.findIndex(x => x.id === ev.id); if (i >= 0) feed[i] = ev; else feed.push(ev); };

/**
 * Live side, attached to the driver context: `trackWorkflow(m)` follows the task_* of a workflow, `startWorkflow(key,
 * dir)` starts reading its folder once the tool result gives it. Returns also `isWorkflowTask(m)`.
 */
export function attachWorkflows(ctx) {
  const { s, newId } = ctx;
  const runs = new Map(); // Workflow tool_use id → { key, dir, reader, taskId, name, timer, done }
  const run = key => {
    if (!runs.has(key)) runs.set(key, { key });
    return runs.get(key);
  };
  const byTask = id => [...runs.values()].find(r => r.taskId === id);

  function poll(r) {
    if (!r.reader) return;
    const changed = new Set();
    r.reader.read(info => {
      let a = s.agents.get(`wf-${info.agentId}`);
      if (!a) {
        a = workflowAgent(info, r.key, r.name);
        Object.assign(a, { start: Date.now(), taskId: r.taskId });
        s.agents.set(a.key, a);
      }
      if (info.state !== 'working' && a.state === 'working') a.ending = info;
      changed.add(a);
    }, (info, m) => {
      const a = s.agents.get(`wf-${info.agentId}`);
      if (a && applyWorkflowMessage(a, m, newId, ev => ctx.pushAgentEvent(a, ev))) changed.add(a);
    });
    for (const a of changed) {
      const ending = a.ending;
      delete a.ending;
      ctx.updateAgent(a, ending ? workflowEnd(a, ending) : {});
    }
  }
  function startWorkflow(key, dir) {
    const r = run(key);
    if (r.reader || !dir) return;
    r.dir = dir;
    r.reader = workflowReader(dir);
    poll(r);
    if (!r.done) r.timer = setInterval(() => { if (s.closed) return stop(r); poll(r); }, 2000);
  }
  function stop(r) { clearInterval(r.timer); r.timer = null; }
  /** End of the workflow: last read, agents without a result are stopped. */
  function finish(r, status) {
    if (r.done) return;
    r.done = true;
    stop(r);
    poll(r);
    for (const a of s.agents.values()) {
      if (a.workflow !== r.key || a.state !== 'working') continue;
      ctx.updateAgent(a, workflowEnd(a, r.reader?.agents.get(a.workflowAgentId) || { state: 'working' }, status === 'failed' ? 'failed' : 'stopped'));
    }
  }
  const isWorkflowTask = m => m.task_type === 'local_workflow' || (m.tool_use_id && runs.has(m.tool_use_id)) || !!byTask(m.task_id);
  function trackWorkflow(m) {
    const r = m.tool_use_id ? run(m.tool_use_id) : byTask(m.task_id);
    if (!r) return;
    if (m.subtype === 'task_started') {
      Object.assign(r, { taskId: m.task_id, name: m.workflow_name || r.name });
      for (const a of s.agents.values()) if (a.workflow === r.key) a.taskId = m.task_id; // Stop: stops the whole workflow
    } else if (m.subtype === 'task_notification') finish(r, m.status);
    else if (m.subtype === 'task_updated' && ['completed', 'failed', 'killed'].includes(m.patch?.status)) finish(r, m.patch.status);
  }
  s.stopWorkflows = () => { for (const r of runs.values()) stop(r); };
  return { startWorkflow, trackWorkflow, isWorkflowTask };
}
