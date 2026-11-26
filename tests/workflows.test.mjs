import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { workflowDir, workflowAgentsFromDir, attachWorkflows } from '../driver/workflows.mjs';

const line = o => `${JSON.stringify(o)}\n`;
const at = '2026-11-26T12:00:00.000Z';
function folder() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wf-'));
  fs.writeFileSync(path.join(dir, 'journal.jsonl'), line({ type: 'launched' })
    + line({ type: 'started', key: 'v2:a', agentId: 'a1', label: 'lot-1', phase: 'Build' })
    + line({ type: 'started', key: 'v2:b', agentId: 'b2', label: 'lot-2', phase: 'Build' }));
  fs.writeFileSync(path.join(dir, 'agent-a1.jsonl'),
    line({ type: 'user', timestamp: at, message: { content: '[Workflow harness — computed task] blah. The computed task text follows:\n  Do lot 1\n  carefully' } })
    + line({ type: 'assistant', timestamp: at, message: { id: 'm1', model: 'claude-opus-5-5', usage: { input_tokens: 10, output_tokens: 5 }, content: [{ type: 'tool_use', id: 't1', name: 'Bash', input: { command: 'ls' } }] } })
    + line({ type: 'user', timestamp: at, message: { content: [{ type: 'tool_result', tool_use_id: 't1', content: 'ok' }] } })
    + line({ type: 'assistant', timestamp: at, message: { id: 'm2', model: 'claude-opus-5-5', content: [{ type: 'text', text: 'Lot 1 done.' }] } }));
  fs.writeFileSync(path.join(dir, 'agent-b2.jsonl'), line({ type: 'user', timestamp: at, message: { content: 'Do lot 2' } }) + '{"partial');
  return dir;
}

test('workflowDir reads the folder of the tool result', () => {
  assert.equal(workflowDir('Workflow launched in background. Task ID: x\nSummary: s\nTranscript dir: C:\\a b\\wf_1\nScript file: y'), 'C:\\a b\\wf_1');
  assert.equal(workflowDir('nothing'), null);
});

test('history: one agent per journal entry, task text without the harness preamble', () => {
  const dir = folder();
  fs.appendFileSync(path.join(dir, 'journal.jsonl'), line({ type: 'result', key: 'v2:a', agentId: 'a1', result: 'x' }));
  const agents = [...workflowAgentsFromDir(dir, 'toolu_1', 's').values()];
  assert.deepEqual(agents.map(a => [a.key, a.description, a.state]), [['wf-a1', 'lot-1 (Build)', 'completed'], ['wf-b2', 'lot-2 (Build)', 'stopped']]);
  const [a] = agents;
  assert.equal(a.feed[0].text, 'Do lot 1\ncarefully');
  assert.equal(a.tools, 1);
  assert.equal(a.feed[1].result, 'ok');
  assert.equal(a.summary, 'Lot 1 done.');
});

test('live: agents read as they go, ended with the workflow', () => {
  const dir = folder();
  const s = { agents: new Map() };
  const updates = [];
  const ctx = {
    s, newId: (() => { let n = 0; return () => `e${++n}`; })(),
    pushAgentEvent: (a, ev) => { const i = a.feed.findIndex(x => x.id === ev.id); if (i >= 0) a.feed[i] = ev; else a.feed.push(ev); },
    updateAgent: (a, f) => { Object.assign(a, f); updates.push(a.key); },
  };
  const w = attachWorkflows(ctx);
  w.trackWorkflow({ subtype: 'task_started', task_id: 'T', tool_use_id: 'toolu_1', task_type: 'local_workflow', workflow_name: 'build' });
  assert.ok(w.isWorkflowTask({ subtype: 'task_notification', task_id: 'T' }));
  w.startWorkflow('toolu_1', dir);
  assert.equal(s.agents.size, 2);
  assert.equal(s.agents.get('wf-a1').type, 'build');
  assert.equal(s.agents.get('wf-a1').state, 'working');
  fs.appendFileSync(path.join(dir, 'journal.jsonl'), line({ type: 'result', key: 'v2:a', agentId: 'a1', result: 'x' }));
  w.trackWorkflow({ subtype: 'task_notification', task_id: 'T', tool_use_id: 'toolu_1', status: 'completed' });
  assert.equal(s.agents.get('wf-a1').state, 'completed');
  assert.equal(s.agents.get('wf-b2').state, 'stopped');
  assert.equal(s.agents.get('wf-b2').feed[0].text, 'Do lot 2');
});
