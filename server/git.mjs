// Git: modified files, commits, versions of a file, ignored files.
import fs from 'node:fs';
import path from 'node:path';
import { spawn, execFile } from 'node:child_process';
import { t } from '../public/i18n/index.js';

// --- Git: modified files and versions of a file ------------------------------------------------

export const git = (dir, args, { raw = false } = {}) => new Promise((ok, ko) => execFile('git', ['-C', dir, ...args],
  { windowsHide: true, timeout: 15_000, maxBuffer: 20 * 1024 * 1024, encoding: raw ? 'buffer' : 'utf8' },
  (err, stdout, stderr) => (err ? ko(new Error(String(stderr || err.message).trim())) : ok(stdout))));

/** Among these relative paths (folders ending with "/"), the names of those git ignores. Outside a repo: none. */
export function ignoredByGit(dir, paths) {
  if (!paths.length) return Promise.resolve(new Set());
  return new Promise(ok => {
    const p = spawn('git', ['-C', dir, 'check-ignore', '-z', '--stdin'], { windowsHide: true });
    let out = '';
    p.stdout.on('data', d => { out += d; });
    p.on('error', () => ok(new Set()));
    p.on('close', () => ok(new Set(out.split('\0').filter(Boolean).map(c => c.replace(/\/$/, '').split('/').pop()))));
    p.stdin.end(paths.join('\0') + '\0');
  });
}

/** Files modified since the last commit (staged or not, new ones included), with their lines added / removed. */
export async function gitStatus(dir) {
  const root = (await git(dir, ['rev-parse', '--show-toplevel'])).trim();
  const branch = (await git(dir, ['rev-parse', '--abbrev-ref', 'HEAD']).catch(() => '')).trim();
  const lines = (await git(root, ['status', '--porcelain=v1', '-z', '--untracked-files=all'])).split('\0').filter(Boolean);
  const files = [];
  for (let i = 0; i < lines.length; i++) {
    const code = lines[i].slice(0, 2), rel = lines[i].slice(3);
    if (code[0] === 'R' || code[0] === 'C') i++; // a rename carries the old name next
    const state = code === '??' ? 'untracked' : code.includes('D') ? 'deleted' : code.includes('A') ? 'added' : code.includes('R') ? 'renamed' : 'modified';
    files.push({ rel, path: path.join(root, rel), state });
  }
  // Lines added / removed per file, compared with the last commit
  const counts = new Map();
  for (const l of (await git(root, ['diff', 'HEAD', '--numstat', '-z']).catch(() => '')).split('\0')) {
    const [plus, minus, rel] = l.split('\t');
    if (rel) counts.set(rel.trim(), { insertions: Number(plus) || 0, deletions: Number(minus) || 0, binary: plus === '-' });
  }
  for (const f of files) Object.assign(f, counts.get(f.rel) || {});
  return { root: path.normalize(root), branch, files };
}

/**
 * Brings a file back to its state of the last commit: a new file (tracked or not) is deleted, a modified or deleted
 * file is restored, a rename undone (old name restored, new one removed). The state is read again from git, never
 * taken from the page; a file without changes is refused.
 */
export async function revertChanges(file) {
  // The file (or its whole folder) may have been deleted: git starts from the first folder that exists
  let dir = path.dirname(file);
  while (!fs.existsSync(dir) && path.dirname(dir) !== dir) dir = path.dirname(dir);
  const root = (await git(dir, ['rev-parse', '--show-toplevel'])).trim();
  const rel = path.relative(root, file).split(path.sep).join('/');
  if (!rel || rel.startsWith('..')) throw new Error(t('server.git.outsideRepo'));
  // Full status (a path filter would break rename detection)
  const lines = (await git(root, ['status', '--porcelain=v1', '-z', '--untracked-files=all'])).split('\0').filter(Boolean);
  let code = null, old = null;
  for (let i = 0; i < lines.length; i++) {
    const c = lines[i].slice(0, 2), r = lines[i].slice(3), before = c[0] === 'R' || c[0] === 'C' ? lines[++i] : null;
    if (r === rel) { code = c; old = before; break; }
  }
  if (!code) throw new Error(t('server.git.nothingToRevert'));
  if (code === '??') {
    if (!fs.statSync(file, { throwIfNoEntry: false })?.isFile()) throw new Error(t('server.errors.fileNotFound'));
    return fs.unlinkSync(file);
  }
  const inHead = await git(root, ['cat-file', '-e', `HEAD:${rel}`]).then(() => true, () => false);
  if (!inHead) await git(root, ['rm', '-f', '-q', '--', rel]); // added since the last commit (or new name)
  else await git(root, ['restore', '--source=HEAD', '--staged', '--worktree', '--', rel]);
  if (code[0] === 'R' && old) await git(root, ['restore', '--source=HEAD', '--staged', '--worktree', '--', old]);
}

/** Latest commits of the branch, marking those not pushed yet. */
export async function gitCommits(dir, n = 20, skip = 0) {
  const root = (await git(dir, ['rev-parse', '--show-toplevel'])).trim();
  const out = await git(root, ['log', `-n${n}`, `--skip=${skip}`, '--format=%H%x1f%h%x1f%s%x1f%an%x1f%aI%x1e']);
  const unpushed = new Set((await git(root, ['rev-list', '@{u}..HEAD']).catch(() => '')).split('\n').filter(Boolean));
  const commits = out.split('\x1e').map(l => l.trim()).filter(Boolean).map(l => {
    const [hash, short, subject, author, date] = l.split('\x1f');
    return { hash, short, subject, author, date, unpushed: unpushed.has(hash) };
  });
  return { root: path.normalize(root), commits };
}

/** One commit: full message and touched files (state, lines +/−). */
export async function gitCommit(dir, hash) {
  if (!/^[0-9a-f]{4,40}$/i.test(hash)) throw new Error(t('server.git.invalidCommit'));
  const root = (await git(dir, ['rev-parse', '--show-toplevel'])).trim();
  const [header] = (await git(root, ['show', '-s', '--format=%H%x1f%s%x1f%b%x1f%an%x1f%aI', hash])).split('\n\x1e');
  const [full, subject, body, author, date] = header.split('\x1f');
  const states = new Map((await git(root, ['diff-tree', '--root', '--no-commit-id', '-r', '--name-status', hash])).split('\n').filter(Boolean)
    .map(l => { const [code, ...names] = l.split('\t'); return [names.at(-1), code[0]]; }));
  const STATES = { M: 'modified', A: 'added', D: 'deleted', R: 'renamed', C: 'added' };
  const files = (await git(root, ['diff-tree', '--root', '--no-commit-id', '-r', '--numstat', hash])).split('\n').filter(Boolean).map(l => {
    const [plus, minus, ...rest] = l.split('\t');
    const rel = rest.join('\t').replace(/^.*=> /, '').replace(/[{}]/g, '');
    return { rel, path: path.join(root, rel), state: STATES[states.get(rel)] || 'modified', insertions: Number(plus) || 0, deletions: Number(minus) || 0, binary: plus === '-' };
  });
  return { root: path.normalize(root), hash: full, subject, body: (body || '').trim(), author, date: (date || '').trim(), files };
}

const EDITOR_MAX_SIZE = 2 * 1024 * 1024;
/**
 * Two versions of a file for the editor. Without `commit`: the one of the last commit (empty if new) and the current
 * one (empty if deleted). With `commit`: the one before this commit and the one it left (the diff of that time).
 */
export async function fileVersions(file, commit) {
  if (commit && !/^[0-9a-f]{4,40}$/i.test(commit)) throw new Error(t('server.git.invalidCommit'));
  const dir = fs.existsSync(file) && fs.statSync(file).isDirectory() ? file : path.dirname(file);
  let root = null;
  try { root = (await git(fs.existsSync(dir) ? dir : path.dirname(dir), ['rev-parse', '--show-toplevel'])).trim(); } catch { /* outside git */ }
  if (commit && !root) {
    // File deleted since: its folder may be gone, go up to a folder of the repo
    let d = path.dirname(file);
    while (!fs.existsSync(d) && path.dirname(d) !== d) d = path.dirname(d);
    root = (await git(d, ['rev-parse', '--show-toplevel'])).trim();
  }
  const rel = root ? path.relative(root, file).replace(/\\/g, '/') : null;
  const version = ref => git(root, ['show', `${ref}:${rel}`], { raw: true }).catch(() => null); // null: absent at this version
  const current = commit ? await version(commit) : fs.existsSync(file) ? fs.readFileSync(file) : null;
  if (current && current.length > EDITOR_MAX_SIZE) throw new Error(t('server.git.tooLargeForEditor'));
  let original = null;
  if (root) original = await version(commit ? `${commit}^` : 'HEAD');
  const text = b => (b ? b.toString('utf8') : '');
  const binary = [current, original].some(b => b && b.subarray(0, 8000).includes(0));
  return {
    path: file, root, binary, exists: !!current, tracked: original !== null,
    original: binary ? '' : text(original), current: binary ? '' : text(current),
    modified: !!root && (original === null ? !!current : !current || !original.equals(current)),
  };
}
