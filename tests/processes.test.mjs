// Classification of the Processes tab (engine/processes.mjs): who launched what, roots and children, memory.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { classify, evalCommand, shortName } from '../engine/processes.mjs';

const TAG = '11111111-2222-3333-4444-555555555555';
const at = h => `2026-11-17T${String(h).padStart(2, '0')}:00:00.0000000Z`;
const P = (pid, ppid, name, cmd, h = 10, ram = 1e6) => ({ pid, ppid, name, cmd, created: at(h), ram });
const bashOf = c => `"C:\\Program Files\\Git\\bin\\bash.exe" -c "source /c/x/snapshot.sh && eval '${c.replace(/'/g, "'\\''")}' < /dev/null && pwd -P"`;
const NG = 'node "E:\\work\\Shop\\shop-front\\node_modules\\@angular\\cli\\bin\\ng.js" serve backoffice --port 4201';

const base = () => ({
  procs: [
    P(100, 1, 'node.exe', 'node E:\\claude-dashboard\\engine.mjs', 1),
    P(200, 100, 'claude.exe', `claude.exe --output-format stream-json --session-id=${TAG}`, 2),
    P(201, 200, 'cmd.exe', 'cmd /c npx chrome-devtools-mcp', 3),          // MCP server: not listed
    P(202, 201, 'node.exe', 'node chrome-devtools-mcp', 3),
    P(300, 200, 'bash.exe', bashOf("cd shop-front && pnpm ng serve --port 4201 & echo it's on"), 4),
    P(301, 300, 'node.exe', NG, 4, 3e9),
    P(302, 301, 'esbuild.exe', 'esbuild --service', 4, 5e8),
    P(400, 1, 'Code.exe', 'Code.exe', 5),
    P(401, 400, 'Code.exe', 'Code.exe --type=utility', 5),
    P(402, 401, 'node.exe', 'node tsserver.js', 5, 1e9),
    P(500, 999, 'node.exe', 'node E:\\billing\\billing-front\\node_modules\\@angular\\cli\\bin\\ng.js serve', 6), // parent gone
    P(600, 1, 'python.exe', 'python -m http.server 8000', 7),
    P(601, 1, 'python.exe', 'python script.py', 7),                       // no port: not listed
    P(700, 1, 'Photos.exe', 'Photos.exe E:\\work\\Shop\\docs\\a.png', 7),  // not a dev tool: not listed
  ],
  ports: { 301: [4201], 600: [8000] },
});
const ctx = (extra = {}) => ({
  sessions: [{ slug: 'n-abc', tag: TAG, project: 'Shop', calls: [{ command: "cd shop-front && pnpm ng serve --port 4201 & echo it's on", agent: 'Front #12' }] }],
  projects: [{ name: 'Shop', paths: ['E:\\work\\Shop'] }, { name: 'Billing', paths: ['E:\\billing'] }],
  isProtected: p => p.pid === 100,
  ...extra,
});

test('evalCommand reads the command of a Claude Code shell', () => {
  assert.equal(evalCommand(bashOf("echo 'a' && ls")), "echo 'a' && ls");
  assert.equal(evalCommand('bash -c ls'), null);
});

test('shortName', () => {
  assert.equal(shortName({ name: 'node.exe', cmd: NG }), 'ng serve backoffice');
  assert.equal(shortName({ name: 'java.exe', cmd: '"java.exe" -Xmx1g -jar target/server.jar --x' }), 'java -jar server.jar');
  assert.equal(shortName({ name: 'java.exe', cmd: 'java -cp a.jar org.gradle.launcher.daemon.bootstrap.GradleDaemon 9.1' }), 'Gradle daemon');
  assert.equal(shortName({ name: 'python.exe', cmd: 'python -m http.server 8000' }), 'python -m http.server');
});

test('a session process: root, children, Bash command, subagent, memory', () => {
  const { items, memory } = classify(base(), ctx());
  const ng = items.find(x => x.pid === 301);
  assert.equal(ng.kind, 'session');
  assert.equal(ng.slug, 'n-abc');
  assert.equal(ng.project, 'Shop');
  assert.equal(ng.agent, 'Front #12');
  assert.equal(ng.command, "cd shop-front && pnpm ng serve --port 4201 & echo it's on");
  assert.deepEqual(ng.ports, [4201]);
  assert.equal(ng.ram, 3.5e9);
  assert.deepEqual(ng.children.map(c => c.pid), [302]);
  assert.deepEqual(ng.chain, ['claude', 'bash']);
  assert.ok(!items.some(x => x.pid === 302), 'children are folded under their root');
  assert.ok(!items.some(x => x.pid === 202 || x.pid === 201), 'MCP servers are not listed');
  assert.deepEqual(Object.keys(memory), [`301:${at(4)}`]);
});

test('detached: the shell closed, the memory keeps the session', () => {
  const first = classify(base(), ctx());
  const snap = base();
  snap.procs = snap.procs.filter(p => p.pid !== 300); // the shell is gone
  const { items } = classify(snap, ctx({ memory: first.memory }));
  const ng = items.find(x => x.pid === 301);
  assert.equal(ng.kind, 'session');
  assert.equal(ng.agent, 'Front #12');
  assert.equal(ng.deadParent, 300);
  // Without memory, it would be an orphan of its project
  assert.equal(classify(snap, ctx()).items.find(x => x.pid === 301).kind, 'project');
});

test('editors, orphans, unknown, nothing else', () => {
  const { items } = classify(base(), ctx());
  const ts = items.find(x => x.pid === 402);
  assert.equal(ts.kind, 'tool');
  assert.equal(ts.tool.label, 'VS Code');
  assert.equal(ts.tool.pid, 400, 'grouped by the topmost instance');
  assert.deepEqual(ts.chain, ['VS Code']);
  const billing = items.find(x => x.pid === 500);
  assert.equal(billing.kind, 'project');
  assert.equal(billing.project, 'Billing');
  assert.equal(billing.deadParent, 999);
  assert.equal(items.find(x => x.pid === 600).kind, 'unknown');
  assert.deepEqual(items.map(x => x.pid).sort(), [301, 402, 500, 600]);
});

test('a reused PID is not a parent', () => {
  const snap = base();
  snap.procs.find(p => p.pid === 300).created = at(23); // "parent" started after its child: another process
  const ng = classify(snap, ctx()).items.find(x => x.pid === 301);
  assert.equal(ng.kind, 'project');
  assert.equal(ng.deadParent, 300);
});

test('a session that is not running: its claude.exe is not recognised', () => {
  const { items } = classify(base(), ctx({ sessions: [{ slug: 'n-abc', tag: null, project: 'Shop', calls: [] }] }));
  assert.equal(items.find(x => x.pid === 301).kind, 'project');
});
