// Processes tab: what runs on the PC for development and who launched it (a dashboard session, an editor or a
// terminal, nobody alive anymore), to stop it in one click. Spec: docs/specs/2026-11-17-processes-tab.md.
// snapshot() reads the system, classify() (pure, tested) sorts it; the engine remembers which session launched
// a process, so that a detached server keeps its session once the shell that started it has closed.
import fs from 'node:fs';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { DASH_DIR, WIN } from '../common.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const MEMORY_FILE = path.join(DASH_DIR, 'processes.json');

// --- Reading the system ---------------------------------------------------------------------------------------

const PS_SNAPSHOT = `
$p = Get-CimInstance Win32_Process -Property ProcessId,ParentProcessId,Name,CommandLine,CreationDate,WorkingSetSize | ForEach-Object { ,@($_.ProcessId, $_.ParentProcessId, $_.Name, $_.CommandLine, $(if ($_.CreationDate) { $_.CreationDate.ToUniversalTime().ToString('o') } else { $null }), $_.WorkingSetSize) }
$l = Get-NetTCPConnection -State Listen -ErrorAction SilentlyContinue | ForEach-Object { ,@($_.OwningProcess, $_.LocalPort) }
[Console]::Out.Write((ConvertTo-Json -Compress -Depth 3 @{ p = @($p); l = @($l) }))`;

const run = (cmd, args) => new Promise((resolve, reject) => {
  execFile(cmd, args, { windowsHide: true, timeout: 20_000, maxBuffer: 64 * 1024 * 1024 }, (err, stdout) => (err && !stdout ? reject(err) : resolve(stdout)));
});

/**
 * Processes of the machine and their listening ports.
 * @returns {Promise<{ procs: {pid, ppid, name, cmd, created, ram}[], ports: Record<number, number[]> }>}
 */
export async function snapshot() {
  const ports = {};
  const addPort = (pid, port) => { (ports[pid] ||= []).includes(port) || ports[pid].push(port); };
  if (WIN) {
    const out = JSON.parse(await run('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', PS_SNAPSHOT]));
    for (const [pid, port] of out.l || []) addPort(pid, port);
    const procs = (out.p || []).map(([pid, ppid, name, cmd, created, ram]) => ({ pid, ppid, name: name || '', cmd: cmd || '', created: created || '', ram: ram || 0 }));
    return { procs, ports };
  }
  // POSIX: ps (start date in seconds through etimes) and lsof for the ports
  const out = await run('ps', ['-axo', 'pid=,ppid=,rss=,etime=,comm=,args=', '-ww']);
  const now = Date.now();
  const procs = out.split('\n').map(l => l.match(/^\s*(\d+)\s+(\d+)\s+(\d+)\s+(\S+)\s+(\S+)\s+(.*)$/)).filter(Boolean).map(m => ({
    pid: +m[1], ppid: +m[2], ram: +m[3] * 1024, created: new Date(now - etimeSeconds(m[4]) * 1000).toISOString().slice(0, 19), name: path.basename(m[5]), cmd: m[6],
  }));
  try {
    const l = await run('lsof', ['-nP', '-iTCP', '-sTCP:LISTEN', '-F', 'pn']);
    let pid = null;
    for (const line of l.split('\n')) {
      if (line[0] === 'p') pid = +line.slice(1);
      else if (line[0] === 'n' && pid) { const port = +line.split(':').pop(); if (port) addPort(pid, port); }
    }
  } catch { /* lsof missing: no ports */ }
  return { procs, ports };
}
/** ps elapsed time `[[dd-]hh:]mm:ss` in seconds. */
const etimeSeconds = e => {
  const [d, rest] = e.includes('-') ? e.split('-') : [0, e];
  return rest.split(':').map(Number).reduce((a, b) => a * 60 + b, 0) + Number(d) * 86400;
};

// --- Classification ---------------------------------------------------------------------------------------------

const base = name => name.toLowerCase().replace(/\.exe$/, '');
/** Shells and console hosts: never shown as a root, only as a link in the chain. */
const SHELLS = new Set(['bash', 'sh', 'zsh', 'fish', 'dash', 'cmd', 'pwsh', 'powershell', 'conhost', 'openconsole', 'wsl', 'env', 'nohup', 'start']);
/** Executables of development tools: an unknown one listening on a port is listed. */
const DEV = /^(node|bun|deno|java|javaw|python\d*(\.\d+)?|py|pythonw|dotnet|ruby|php|go|cargo|uvicorn|gunicorn|esbuild|caddy|nginx|httpd|redis-server|mongod|postgres|mysqld)$/;
/** Editors and terminals: what they launch goes to their own section, grouped by the instance. */
const TOOLS = [
  { kind: 'vscode', test: n => n === 'code' || n === 'code - insiders' || n === 'cursor' || n === 'windsurf' || n === 'code helper', label: n => (n === 'cursor' ? 'Cursor' : n === 'windsurf' ? 'Windsurf' : 'VS Code') },
  { kind: 'jetbrains', test: n => /^(idea|webstorm|pycharm|phpstorm|goland|rider|clion|rubymine|datagrip|studio)(64)?$/.test(n), label: n => ({ idea: 'IntelliJ IDEA', idea64: 'IntelliJ IDEA', webstorm64: 'WebStorm', pycharm64: 'PyCharm', studio64: 'Android Studio' }[n] || n.replace(/64$/, '')) },
  { kind: 'orca', test: n => n === 'orca', label: () => 'Orca' },
  { kind: 'terminal', test: n => n === 'windowsterminal' || n === 'wt' || n === 'terminal' || n === 'iterm2' || n === 'alacritty' || n === 'wezterm-gui' || n === 'kitty' || n === 'gnome-terminal-server' || n === 'konsole', label: n => (n === 'windowsterminal' ? 'Windows Terminal' : n) },
];
const toolOf = name => { const n = base(name); const tool = TOOLS.find(x => x.test(n)); return tool ? { kind: tool.kind, label: tool.label(n) } : null; };

/** Claude Code's shell for a tool call: `bash -c "… eval '<command>' …"`, or a PowerShell. Its MCP servers are not. */
const isToolShell = p => {
  const n = base(p.name);
  return ((n === 'bash' || n === 'sh') && /\beval '/.test(p.cmd)) || n === 'pwsh' || n === 'powershell';
};
/** The command Claude asked for, read from the shell of the call. */
export function evalCommand(cmd) {
  const m = String(cmd).match(/\beval '((?:[^']|'\\'')*)'/);
  return m ? m[1].replace(/'\\''/g, "'") : null;
}

/** Path for comparisons: slashes, lowercase on Windows. */
const key = p => { const n = String(p).replace(/\\/g, '/').replace(/\/+$/, ''); return WIN ? n.toLowerCase() : n; };
const procKey = p => `${p.pid}:${p.created}`;

/** Short readable name: `ng serve backoffice`, `java -jar server.jar`, `Gradle daemon`, `python -m http.server`. */
export function shortName(p) {
  const n = base(p.name);
  // Arguments, quotes removed, from the command line (good enough to name a process)
  const args = (String(p.cmd).match(/"[^"]*"|\S+/g) || []).map(a => a.replace(/^"|"$/g, ''));
  args.shift();
  // Positional arguments (not the flags nor their values: `serve backoffice --port 4201` → `serve backoffice`)
  const words = list => list.filter((a, i) => !a.startsWith('-') && !(/^--?[\w-]+$/.test(list[i - 1] || ''))).slice(0, 2).join(' ');
  if (n === 'java' || n === 'javaw') {
    if (args.some(a => /GradleDaemon/.test(a))) return 'Gradle daemon';
    if (args.some(a => /GradleWrapperMain/.test(a))) return `gradlew ${words(args.slice(args.findIndex(a => /GradleWrapperMain/.test(a)) + 1))}`.trim();
    const jar = args.indexOf('-jar');
    if (jar >= 0 && args[jar + 1]) return `java -jar ${path.basename(args[jar + 1])}`;
    const main = args.find((a, i) => !a.startsWith('-') && !['-cp', '-classpath', '--class-path'].includes(args[i - 1]));
    return main ? `java ${main.split('.').pop()}` : 'java';
  }
  if (/^python/.test(n) || n === 'py') {
    const m = args.indexOf('-m');
    if (m >= 0 && args[m + 1]) return `python -m ${args[m + 1]}`;
  }
  if (n === 'node' || n === 'bun' || n === 'deno') {
    const script = args.find(a => !a.startsWith('-'));
    if (script) {
      const parts = key(script).split('/');
      // A package's command (node_modules/@angular/cli/bin/ng.js → ng; …/vite/bin/vite.js → vite)
      const nm = parts.lastIndexOf('node_modules');
      let tool = path.basename(script).replace(/\.(m|c)?[jt]s$/, '');
      if (nm >= 0 && (tool === 'index' || tool === 'cli' || tool === 'main')) tool = parts[nm + 1]?.startsWith('@') ? parts[nm + 2] : parts[nm + 1];
      return `${tool} ${words(args.slice(args.indexOf(script) + 1))}`.trim();
    }
  }
  return `${n} ${words(args)}`.trim();
}

/**
 * Sorts the processes of a snapshot.
 * @param {{procs, ports}} snap
 * @param {object} ctx
 * @param {{slug, tag, project, calls: {command, agent}[]}[]} ctx.sessions dashboard sessions (tag: conversation id on
 *   the command line of their claude.exe, null when not running), their Bash calls and the subagent that made each
 * @param {{name, paths: string[]}[]} ctx.projects known projects and their worktrees
 * @param {Record<string, {slug, command, agent}>} ctx.memory sessions already seen launching a process (pid:created)
 * @param {(p) => boolean} ctx.isProtected the dashboard itself (page, engine, app), never listed nor killed
 * @returns {{ items: object[], memory: Record<string, object> }} root processes, and the memory to keep
 */
export function classify(snap, { sessions = [], projects = [], memory = {}, isProtected = () => false } = {}) {
  const byPid = new Map(snap.procs.map(p => [p.pid, p]));
  const parentOf = p => { const q = byPid.get(p.ppid); return q && q.pid !== p.pid && (!q.created || !p.created || q.created <= p.created) ? q : null; };
  const children = new Map();
  for (const p of snap.procs) { const q = parentOf(p); if (q) (children.get(q.pid) || children.set(q.pid, []).get(q.pid)).push(p); }
  // claude.exe of each session: its command line carries the conversation id the driver gave it (s.processTag)
  const claudeOf = new Map();
  for (const p of snap.procs) {
    const id = p.cmd.match(/--(?:resume|session-id)[= ]"?([0-9a-f-]{36})/i)?.[1];
    const session = id && sessions.find(x => x.tag === id);
    if (session) claudeOf.set(p.pid, session);
  }
  const roots = projects.flatMap(pr => pr.paths.map(x => ({ name: pr.name, path: key(x) }))).sort((a, b) => b.path.length - a.path.length);
  const projectOf = cmd => { const c = key(cmd); return roots.find(r => c.includes(`${r.path}/`) || c.endsWith(r.path))?.name || null; };
  const kept = {};

  // Who launched it: the first known launcher up the live chain decides
  const origin = new Map();
  const originOf = p => {
    if (origin.has(p.pid)) return origin.get(p.pid);
    origin.set(p.pid, null); // cycle guard
    let o = null;
    const n = base(p.name);
    const q = parentOf(p);
    if (isProtected(p) || p.pid <= 4) o = { skip: true };
    else if (claudeOf.has(p.pid)) o = { skip: true, session: claudeOf.get(p.pid) };
    // Claude Code outside the dashboard (terminal, Orca, an editor): transparent, its launcher counts
    else if (n === 'claude') { const up = q && originOf(q); o = { skip: true, claude: true, tool: up?.tool || null }; }
    else if (toolOf(p.name)) {
      // Grouped by instance: the topmost process of the tool (VS Code's helpers are Code.exe too)
      const up = q && originOf(q);
      o = { skip: true, tool: up?.tool && !up.claude && up.tool.kind === toolOf(p.name).kind ? up.tool : { ...toolOf(p.name), pid: p.pid } };
    } else if (q) {
      const up = originOf(q);
      if (up?.session && !up.kind) o = isToolShell(p) ? { kind: 'session', slug: up.session.slug, session: up.session, viaShell: p } : { skip: true };
      else if (up?.claude && !up.kind) o = !isToolShell(p) ? { skip: true } : up.tool ? { kind: 'tool', tool: up.tool } : null;
      else if (up?.tool && !up.kind) o = { kind: 'tool', tool: up.tool };
      else if (up?.kind) o = up;
      else if (up?.skip) o = { skip: true };
    }
    // Parent gone (or a launcher we do not know): a session that saw it before, else its project
    if (!o) {
      const m = memory[procKey(p)];
      if (m && sessions.some(s => s.slug === m.slug)) o = { kind: 'session', slug: m.slug, remembered: m };
      else if (DEV.test(n) || snap.ports[p.pid]?.length) { const project = projectOf(p.cmd); if (project) o = { kind: 'project', project }; }
    }
    origin.set(p.pid, o);
    return o;
  };

  const items = [];
  const listed = new Set();
  const subtree = p => { const out = []; const walk = x => { for (const c of children.get(x.pid) || []) { out.push(c); walk(c); } }; walk(p); return out; };
  for (const p of snap.procs) {
    if (listed.has(p.pid)) continue;
    const o = originOf(p);
    const n = base(p.name);
    if (SHELLS.has(n)) continue;
    let kind = o?.kind;
    if (!kind && !o?.skip && DEV.test(n) && snap.ports[p.pid]?.length) kind = 'unknown';
    if (!kind) continue;
    // A root: no listed (non-shell) ancestor in the live chain
    let q = parentOf(p), nested = false;
    while (q) { if (listed.has(q.pid)) { nested = true; break; } q = parentOf(q); }
    if (nested) continue;
    const sub = subtree(p);
    for (const c of sub) listed.add(c.pid);
    listed.add(p.pid);

    // Chain of parents: from the launcher down to the process
    const chain = [];
    let top = null, highest = p;
    for (let x = parentOf(p); x; x = parentOf(x)) {
      highest = x;
      const xn = base(x.name);
      if (claudeOf.has(x.pid) || xn === 'claude') { chain.unshift('claude'); top = x; break; }
      const tool = toolOf(x.name);
      if (tool) { chain.unshift(tool.label); top = x; if (!toolOf(parentOf(x)?.name || '')) break; continue; }
      chain.unshift(xn);
    }
    const shown = chain.filter((x, i) => x !== chain[i - 1]); // bash › bash › bash → bash
    if (shown.length > 5) shown.splice(1, shown.length - 4, '…');
    const ports = [...new Set([p, ...sub].flatMap(x => snap.ports[x.pid] || []))].sort((a, b) => a - b);
    const item = {
      pid: p.pid, created: p.created, name: shortName(p), exe: p.name, cmd: p.cmd, kind,
      ram: [p, ...sub].reduce((s, x) => s + (x.ram || 0), 0), ports, chain: shown,
      deadParent: !top && !parentOf(highest) && highest.ppid > 4 ? highest.ppid : null, // the chain starts with a gone process
      children: sub.filter(c => !SHELLS.has(base(c.name))).map(c => ({ pid: c.pid, name: shortName(c), ram: c.ram })),
    };
    if (kind === 'session') {
      const session = sessions.find(s => s.slug === o.slug);
      item.slug = o.slug;
      item.project = session?.project || null;
      // The Bash call that launched it, and the subagent that made that call
      const shellCmd = o.viaShell ? evalCommand(o.viaShell.cmd) : null;
      const call = shellCmd ? session?.calls.find(c => c.command.trim() === shellCmd.trim() || shellCmd.startsWith(c.command.replace(/\n… \(\d+ characters cut\)$/, ''))) : null;
      const m = o.remembered || { slug: o.slug, command: shellCmd || null, agent: call?.agent || null };
      item.command = m.command;
      item.agent = m.agent;
      kept[procKey(p)] = m;
    } else if (kind === 'tool') {
      item.tool = { kind: o.tool.kind, label: o.tool.label, pid: o.tool.pid };
      item.project = projectOf(p.cmd);
    } else if (kind === 'project') item.project = o.project;
    items.push(item);
  }
  // Children of a remembered root stay attached to it: memory of the roots only
  return { items, memory: kept };
}

// --- Engine state: memory, reading on demand, kill -------------------------------------------------------------

let memory = (() => { try { return JSON.parse(fs.readFileSync(MEMORY_FILE, 'utf8')); } catch { return {}; } })();
const saveMemory = next => {
  const text = JSON.stringify(next);
  if (text === JSON.stringify(memory)) return;
  memory = next;
  try { fs.writeFileSync(MEMORY_FILE, text); } catch { /* read only: memory in RAM */ }
};

/** The dashboard itself: this engine, the page server, the Electron app, the snapshot's own PowerShell. */
export const isProtected = p => {
  if (p.pid === process.pid || p.pid === process.ppid) return true;
  const c = key(p.cmd), root = key(ROOT);
  return c.includes(`${key(DASH_DIR)}/`) || (c.includes(`${root}/server.mjs`) || c.includes(`${root}/engine.mjs`) || c.includes(`${root}/electron`) || c.includes(`${root}/launcher/`) || c.includes(`${root}/node_modules/electron/`))
    || (base(p.name) === 'powershell' && p.cmd.includes('Get-NetTCPConnection -State Listen'));
};

let last = null; // { at, promise }: one reading shared by the callers of the same moment

/**
 * Snapshot + classification, at most one every 3 s.
 * @param {() => Promise<object>} context sessions and projects (engine/routes.mjs)
 */
export function readProcesses(context, maxAge = 3000) {
  if (last && Date.now() - last.at < maxAge) return last.promise;
  const promise = (async () => {
    const [snap, ctx] = await Promise.all([snapshot(), context()]);
    const r = classify(snap, { ...ctx, memory, isProtected });
    saveMemory(r.memory);
    return { items: r.items, total: snap.procs.reduce((s, p) => s + (p.ram || 0), 0) };
  })();
  last = { at: Date.now(), promise };
  promise.catch(() => { if (last?.promise === promise) last = null; });
  return promise;
}

/**
 * Stops a listed process and its tree. It must still be the same one (PID + start date: Windows reuses PIDs).
 * @returns {Promise<{ killed: number } | { error: string }>}
 */
export async function killProcess(context, pid, created) {
  const { items } = await readProcesses(context, 0);
  const item = items.find(x => x.pid === pid && x.created === created);
  if (!item) return { error: 'gone' };
  const n = 1 + item.children.length;
  if (WIN) await run('taskkill', ['/PID', String(pid), '/T', '/F']).catch(() => {});
  else {
    // Children first, then the root (they would be reparented to init)
    for (const c of [...item.children].reverse()) { try { process.kill(c.pid, 'SIGTERM'); } catch { /* already gone */ } }
    try { process.kill(pid, 'SIGTERM'); } catch { /* already gone */ }
  }
  last = null;
  return { killed: n };
}
