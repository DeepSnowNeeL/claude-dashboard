// Explorer: list of the files, text search (ripgrep), watching a folder.
import fs from 'node:fs';
import path from 'node:path';
import { spawn, execFile } from 'node:child_process';
import { git } from './git.mjs';
import { t } from '../public/i18n/index.js';

/**
 * Watching a folder through Windows (recursive fs.watch): one watcher per folder, shared by the pages looking at it,
 * closed when the last one leaves. Changes are grouped (300 ms); .git is not watched.
 */
const watchers = new Map(); // folder → { watcher, clients, pending, timer }
export function watch(dir, req, res) {
  res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store', Connection: 'keep-alive' });
  res.write(': ok\n\n');
  let o = watchers.get(dir);
  if (!o) {
    o = { clients: new Set(), pending: new Set(), timer: null, watcher: null };
    const send = () => {
      o.timer = null;
      const paths = [...o.pending];
      o.pending.clear();
      const msg = `data: ${JSON.stringify(paths.length > 300 ? { all: true } : { paths })}\n\n`;
      for (const c of o.clients) c.write(msg);
    };
    try {
      o.watcher = fs.watch(dir, { recursive: true }, (_, f) => {
        if (!f) return;
        const rel = String(f).replace(/\\/g, '/');
        if (rel === '.git' || rel.startsWith('.git/')) return;
        o.pending.add(rel);
        o.timer ??= setTimeout(send, 300);
      });
      o.watcher.on('error', () => {});
    } catch { /* no watching: the page reads again on demand */ }
    watchers.set(dir, o);
  }
  o.clients.add(res);
  const heartbeat = setInterval(() => res.write(': .\n\n'), 25_000); // keeps the connection open (Caddy, proxies)
  req.on('close', () => {
    clearInterval(heartbeat);
    o.clients.delete(res);
    if (!o.clients.size) { o.watcher?.close(); clearTimeout(o.timer); watchers.delete(dir); }
  });
}

// --- Explorer: list of the files and text search ---------------------------------------------

/**
 * ripgrep, without a dependency: DASH_RG, else `rg` from the PATH, else the one shipped with Orca or VS Code. null if
 * there is none (search then goes through git grep, fast too in a repo).
 */
let rgFound;
function ripgrep() {
  if (rgFound !== undefined) return rgFound;
  const local = process.env.LOCALAPPDATA || '';
  const candidates = [process.env.DASH_RG, path.join(local, 'Programs', 'orca', 'resources', 'ripgrep', 'win32-x64', 'rg.exe')];
  const vscode = path.join(local, 'Programs', 'Microsoft VS Code');
  try {
    for (const v of fs.readdirSync(vscode)) candidates.push(path.join(vscode, v, 'resources', 'app', 'node_modules.asar.unpacked', '@vscode', 'ripgrep-universal', 'bin', 'win32-x64', 'rg.exe'));
  } catch { /* no VS Code */ }
  for (const dir of (process.env.PATH || '').split(path.delimiter)) candidates.push(path.join(dir, WIN_RG));
  rgFound = candidates.find(c => c && fs.existsSync(c)) || null;
  return rgFound;
}
const WIN_RG = process.platform === 'win32' ? 'rg.exe' : 'rg';

/** Files of a folder, relative paths, without what git ignores (repo) or without node_modules / .git (otherwise). */
export async function folderFiles(dir) {
  const MAX = 100_000;
  const raw = await git(dir, ['ls-files', '-co', '--exclude-standard', '-z']).catch(() => null);
  if (raw !== null) return raw.split('\0').filter(Boolean).slice(0, MAX).map(f => f.replace(/\\/g, '/'));
  const rg = ripgrep();
  if (rg) {
    const out = await new Promise(ok => execFile(rg, ['--files', '--hidden', '-g', '!.git'], { cwd: dir, windowsHide: true, maxBuffer: 50 * 1024 * 1024 }, (e, s) => ok(s || '')));
    return out.split(/\r?\n/).filter(Boolean).slice(0, MAX).map(f => f.replace(/\\/g, '/'));
  }
  const files = [];
  const walk = (rel = '') => {
    for (const e of fs.readdirSync(path.join(dir, rel), { withFileTypes: true })) {
      if (files.length >= MAX || e.name === 'node_modules' || e.name === '.git') continue;
      const r = rel ? `${rel}/${e.name}` : e.name;
      if (e.isDirectory()) walk(r); else files.push(r);
    }
  };
  walk();
  return files;
}

/**
 * Text search in all the files of the folder: ripgrep, else git grep. At most 2,000 lines found
 * (and 50 per file); each line cut at 300 characters.
 */
export function searchText(dir, q, { regex = false, matchCase = false, signal } = {}) {
  return new Promise(ok => {
    const rg = ripgrep();
    const [prog, args] = rg
      ? [rg, ['-n', '--no-heading', '--color', 'never', '--max-count', '50', '--max-columns', '300', '--max-columns-preview', ...(regex ? [] : ['-F']), ...(matchCase ? ['-s'] : ['-i']), '-e', q, '.']]
      : ['git', ['-C', dir, 'grep', '-n', '-I', '--untracked', '--max-count', '50', ...(regex ? ['-E'] : ['-F']), ...(matchCase ? [] : ['-i']), '-e', q]];
    const p = spawn(prog, args, { cwd: dir, windowsHide: true });
    const results = [];
    let rest = '', truncated = false;
    p.stdout.on('data', chunk => {
      const lines = (rest + chunk).split(/\r?\n/);
      rest = lines.pop();
      for (const l of lines) {
        const m = l.match(/^(.+?):(\d+):(.*)$/);
        if (!m) continue;
        results.push({ rel: m[1].replace(/^\.[\\/]/, '').replace(/\\/g, '/'), line: Number(m[2]), text: m[3].slice(0, 300) });
        if (results.length >= 2000) { truncated = true; p.kill(); break; }
      }
    });
    // A search never runs forever (a costly regex on a huge folder), nor after the page gave up waiting for it
    const stop = () => { truncated = true; p.kill(); };
    const timer = setTimeout(stop, 20_000);
    signal?.addEventListener('abort', stop, { once: true });
    p.on('error', () => { clearTimeout(timer); ok({ tool: rg ? 'ripgrep' : 'git grep', results, truncated, error: t('server.errors.searchFailed') }); });
    p.on('close', () => { clearTimeout(timer); signal?.removeEventListener('abort', stop); ok({ tool: rg ? 'ripgrep' : 'git grep', results, truncated }); });
  });
}
