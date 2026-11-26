// Tree of the left list: projects (git repos) → worktrees → sessions.
// A project is the main worktree of a repo; a folder outside git is a project with a single "worktree".
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { DASH_DIR } from './common.mjs';
import { execFile } from 'node:child_process';
import { listSessions } from '@anthropic-ai/claude-agent-sdk';
import { t } from './public/i18n/index.js';

const FILE = path.join(DASH_DIR, 'projects.json');
const WIN = process.platform === 'win32';

/** Comparison key of a path: unified separators, no trailing slash, case-insensitive on Windows. */
export function pathKey(p) {
  const n = path.resolve(p).replace(/\\/g, '/').replace(/\/+$/, '');
  return WIN ? n.toLowerCase() : n;
}

/** Projects added by hand (without a session yet). */
export function addedProjects() {
  try { return JSON.parse(fs.readFileSync(FILE, 'utf8')); } catch { return []; }
}
export function addProject(dir) {
  const l = addedProjects().filter(p => pathKey(p) !== pathKey(dir));
  l.push(dir);
  fs.mkdirSync(path.dirname(FILE), { recursive: true });
  fs.writeFileSync(FILE, JSON.stringify(l, null, 2));
}
export function removeProject(dir) {
  fs.writeFileSync(FILE, JSON.stringify(addedProjects().filter(p => pathKey(p) !== pathKey(dir)), null, 2));
}

// Project groups (level above the projects): [{ id, name, projects: [project ids] }], in display order.
const GROUPS_FILE = path.join(DASH_DIR, 'groups.json');
export function readGroups() {
  try { return JSON.parse(fs.readFileSync(GROUPS_FILE, 'utf8')); } catch { return []; }
}
export function writeGroups(groups) {
  const clean = (Array.isArray(groups) ? groups : []).filter(g => g && g.id && g.name)
    .map(g => ({ id: String(g.id), name: String(g.name), projects: (g.projects || []).map(String), ...(validColor(g.color) ? { color: g.color } : {}) }));
  fs.mkdirSync(path.dirname(GROUPS_FILE), { recursive: true });
  fs.writeFileSync(GROUPS_FILE, JSON.stringify(clean, null, 2));
}
const validColor = c => typeof c === 'string' && /^#[0-9a-f]{6}$/i.test(c);
/** Ticket link template of a project: an http(s) URL with `{n}` where the ticket number goes. */
const validTicketUrl = u => typeof u === 'string' && u.length <= 500 && /^https?:\/\/\S+$/.test(u) && u.includes('{n}');

// Manual order of the sessions in each worktree (drag and drop): { worktreeId: [slugs in order] }
const ORDERS_FILE = path.join(DASH_DIR, 'orders.json');
export function readOrders() {
  try { return JSON.parse(fs.readFileSync(ORDERS_FILE, 'utf8')); } catch { return {}; }
}
export function writeOrder(worktreeId, slugs) {
  const orders = readOrders();
  orders[String(worktreeId)] = (Array.isArray(slugs) ? slugs : []).map(String).slice(0, 500);
  fs.mkdirSync(path.dirname(ORDERS_FILE), { recursive: true });
  fs.writeFileSync(ORDERS_FILE, JSON.stringify(orders, null, 2));
}

// Session categories (labels, like GitLab's): { list: [{ id, name, color, compact }], sessions: { slug: [category ids] } }.
// `compact`: the sessions that carry it take a single line in the tree.
const CATEGORIES_FILE = path.join(DASH_DIR, 'categories.json');
export function readCategories() {
  try { const c = JSON.parse(fs.readFileSync(CATEGORIES_FILE, 'utf8')); return { list: c.list || [], sessions: c.sessions || {} }; } catch { return { list: [], sessions: {} }; }
}
export function writeCategories(c) {
  const list = (Array.isArray(c?.list) ? c.list : []).filter(x => x && x.id && String(x.name || '').trim()).slice(0, 100)
    .map(x => ({ id: String(x.id).slice(0, 40), name: String(x.name).trim().slice(0, 60), color: validColor(x.color) ? x.color : '#64748b', ...(x.compact ? { compact: true } : {}) }));
  const ids = new Set(list.map(x => x.id));
  const sessions = {};
  for (const [slug, l] of Object.entries(c?.sessions || {})) {
    const kept = (Array.isArray(l) ? l : []).map(String).filter(id => ids.has(id));
    if (kept.length) sessions[String(slug).slice(0, 100)] = [...new Set(kept)];
  }
  fs.mkdirSync(path.dirname(CATEGORIES_FILE), { recursive: true });
  fs.writeFileSync(CATEGORIES_FILE, JSON.stringify({ list, sessions }, null, 2));
}

// Customisation of a project in the tree: { id: { name, color, icon, ticketUrl } } (icon: an emoji; absent = project
// logo; ticketUrl: link of a ticket, `{n}` replaced by its number, e.g. https://gitlab.example.com/team/app/-/issues/{n})
const META_FILE = path.join(DASH_DIR, 'projects-meta.json');
export function readMeta() {
  try { return JSON.parse(fs.readFileSync(META_FILE, 'utf8')); } catch { return {}; }
}
export function writeProjectMeta(id, { name, color, icon, ticketUrl } = {}) {
  const meta = readMeta();
  const url = String(ticketUrl || '').trim();
  const m = {
    ...(String(name || '').trim() ? { name: String(name).trim().slice(0, 60) } : {}),
    ...(validColor(color) ? { color } : {}),
    ...(String(icon || '').trim() ? { icon: [...String(icon).trim()].slice(0, 4).join('') } : {}), // an emoji (composed graphemes included)
    ...(validTicketUrl(url) ? { ticketUrl: url } : {}),
  };
  if (Object.keys(m).length) meta[id] = m; else delete meta[id];
  fs.mkdirSync(path.dirname(META_FILE), { recursive: true });
  fs.writeFileSync(META_FILE, JSON.stringify(meta, null, 2));
}

/** Project id → path of its logo.png (root of the main worktree) or data URI of an icon taken from Orca. */
const logos = new Map();
export const projectLogo = id => logos.get(id) || null;
const ICONS_FILE = path.join(DASH_DIR, 'icons.json');
function readIcons() { try { return JSON.parse(fs.readFileSync(ICONS_FILE, 'utf8')); } catch { return {}; } }

/**
 * Takes the projects, their groups and their icons from Orca (database of the active profile, read from a copy, Orca
 * is not touched). Groups with the same name are completed, the others created; a project already filed changes group.
 */
export async function importOrca() {
  const root = path.join(process.env.APPDATA || path.join(os.homedir(), '.config'), 'orca');
  const profile = JSON.parse(fs.readFileSync(path.join(root, 'orca-profile-index.json'), 'utf8')).activeProfileId || 'local-default';
  const copy = path.join(os.tmpdir(), `orca-import-${Date.now()}.db`);
  fs.copyFileSync(path.join(root, 'profiles', profile, 'profile-state.db'), copy);
  let orcaGroups, repos;
  try {
    const { DatabaseSync } = await import('node:sqlite');
    const db = new DatabaseSync(copy, { readOnly: true });
    const doc = d => JSON.parse(db.prepare('select payload from profile_state_documents where domain = ?').get(d)?.payload || '[]');
    orcaGroups = doc('projectGroups');
    repos = doc('repos');
    db.close();
  } finally { fs.rmSync(copy, { force: true }); }

  const icons = readIcons();
  const groups = readGroups();
  let added = 0;
  const present = repos.filter(r => r.path && fs.existsSync(r.path));
  for (const r of present) {
    if (!addedProjects().some(p => pathKey(p) === pathKey(r.path))) { addProject(path.normalize(r.path)); added++; }
    if (r.repoIcon?.type === 'image' && String(r.repoIcon.src).startsWith('data:image/')) icons[pathKey(r.path)] = r.repoIcon.src;
  }
  for (const go of [...orcaGroups].sort((a, b) => (a.tabOrder ?? 0) - (b.tabOrder ?? 0))) {
    const members = present.filter(r => r.projectGroupId === go.id).sort((a, b) => (a.projectGroupOrder ?? 0) - (b.projectGroupOrder ?? 0));
    const ids = (await Promise.all(members.map(async r => pathKey((await worktrees(r.path))?.[0]?.path || r.path))));
    for (const g of groups) g.projects = g.projects.filter(id => !ids.includes(id));
    const g = groups.find(x => x.name === go.name);
    if (g) g.projects.push(...ids);
    else groups.push({ id: go.id, name: go.name, projects: ids });
  }
  writeGroups(groups);
  fs.writeFileSync(ICONS_FILE, JSON.stringify(icons));
  return { projects: present.length, added, groups: orcaGroups.length };
}

/**
 * Past Claude Code sessions of a folder (terminal as well as page), most recent first.
 * The SDK filters by folder, but the case of the paths on Windows can make it miss them: fallback on all the
 * sessions, filtered here on the folder and its subfolders.
 */
export async function folderHistory(dir, limit = 300) {
  const k = pathKey(dir);
  const inside = x => x.cwd && (pathKey(x.cwd) === k || pathKey(x.cwd).startsWith(k + '/'));
  let l = [];
  try { l = (await listSessions({ dir, limit })).filter(inside); } catch { /* fallback */ }
  if (!l.length) { try { l = (await listSessions({ limit: 2000 })).filter(inside).slice(0, limit); } catch { return []; } }
  return l.sort((a, b) => b.lastModified - a.lastModified).map(x => ({
    sessionId: x.sessionId, title: x.customTitle || x.summary, firstPrompt: x.firstPrompt, branch: x.gitBranch,
    cwd: x.cwd, updatedAt: x.lastModified, start: x.createdAt,
  }));
}

/** Runs git, resolves its trimmed output, rejects with its message. */
const runGit = (args, timeout = 60_000) => new Promise((ok, ko) => execFile('git', args, { windowsHide: true, timeout, maxBuffer: 16 * 1024 * 1024 },
  (err, stdout, stderr) => (err ? ko(new Error((stderr || err.message).trim())) : ok(stdout.trim()))));

/** Branches that serve as a starting point: offered first when a session starts from a branch. */
const MAIN_BRANCH = /^(main|master|develop|dev|trunk|(epic|release)\/.+)$/;
/**
 * Branches of the repo of `dir` to start a session from, most recently committed first: the local ones (with the
 * worktree that has each checked out, if any), then the remote ones that have no local branch of the same name.
 * `main` marks main, master, develop, epic/*, release/*.
 * @returns {Promise<{ name, local, remote, date, worktree, main }[]>} `local`: name of the local branch to work on
 */
export async function branches(dir) {
  const out = await runGit(['-C', dir, 'for-each-ref', '--sort=-committerdate', '--format=%(refname)%09%(committerdate:unix)', 'refs/heads', 'refs/remotes'], 10_000);
  const checkedOut = new Map((await worktrees(dir) || []).filter(w => w.branch).map(w => [w.branch, w.path]));
  const locals = [], remotes = [];
  for (const line of out.split(/\r?\n/).filter(Boolean)) {
    const [ref, date] = line.split('\t');
    const at = Number(date) * 1000 || 0;
    if (ref.startsWith('refs/heads/')) {
      const name = ref.slice(11);
      locals.push({ name, local: name, remote: false, date: at, worktree: checkedOut.get(name) || null, main: MAIN_BRANCH.test(name) });
    } else {
      const name = ref.slice(13); // origin/feature
      const local = name.slice(name.indexOf('/') + 1);
      if (local === 'HEAD' || !name.includes('/')) continue;
      remotes.push({ name, local, remote: true, date: at, worktree: null, main: MAIN_BRANCH.test(local) });
    }
  }
  const known = new Set(locals.map(b => b.name));
  return [...locals, ...remotes.filter(b => !known.has(b.local))];
}

/**
 * Creates a git worktree for `branch` next to the main worktree of the repo of `dir`
 * (D:\code\App + 1234-export → D:\code\App-1234-export), as done by hand. Returns its path.
 * Existing branch: the worktree takes it; otherwise it is created from `base` (default: HEAD of the main worktree).
 * A `base` given for a branch that already exists is refused: the worktree would silently ignore it.
 */
export async function createWorktree(dir, branch, base) {
  const git = runGit;
  branch = String(branch || '').trim();
  if (!branch) throw new Error(t('server.worktree.emptyBranch'));
  const list = await git(['-C', dir, 'worktree', 'list', '--porcelain']).catch(() => { throw new Error(t('server.worktree.notInRepo', { path: dir })); });
  const main = path.normalize(list.match(/^worktree (.+)$/m)[1]);
  const target = path.join(path.dirname(main), `${path.basename(main)}-${branch.replace(/[\\/:*?"<>|\s]+/g, '-')}`);
  if (fs.existsSync(target)) throw new Error(t('server.worktree.folderExists', { path: target }));
  const exists = await git(['-C', main, 'rev-parse', '--verify', '--quiet', `refs/heads/${branch}`]).then(() => true, () => false);
  if (exists && base) throw new Error(t('server.worktree.branchExists', { branch }));
  await git(['-C', main, ...(exists ? ['worktree', 'add', target, branch] : ['worktree', 'add', '-b', branch, target, ...(base ? [base] : [])])]);
  forgetWorktrees();
  return target;
}

const cache = new Map(); // pathKey(dir) → { at, worktrees }
/** Forgets the cached worktrees (after a removal: the tree sees it at once). */
export const forgetWorktrees = () => cache.clear();
/** Worktrees of the repo containing `dir` (the main one first), or null outside git. 30 s cache. */
function worktrees(dir) {
  const k = pathKey(dir);
  const c = cache.get(k);
  if (c && Date.now() - c.at < 30_000) return Promise.resolve(c.worktrees);
  return new Promise(resolve => {
    execFile('git', ['-C', dir, 'worktree', 'list', '--porcelain'], { windowsHide: true, timeout: 5000 }, (err, stdout) => {
      let l = null;
      if (!err) {
        l = [];
        for (const block of stdout.split(/\r?\n\r?\n/)) {
          const wtPath = block.match(/^worktree (.+)$/m)?.[1];
          if (!wtPath || /^prunable/m.test(block)) continue;
          // Detached HEAD: no branch, its short commit tells it apart from the others
          const branch = block.match(/^branch refs\/heads\/(.+)$/m)?.[1] || null;
          const detached = /^detached/m.test(block);
          const head = block.match(/^HEAD ([0-9a-f]+)$/m)?.[1]?.slice(0, 7) || null;
          l.push({ path: path.normalize(wtPath), branch, detached, head });
        }
        if (!l.length) l = null;
      }
      cache.set(k, { at: Date.now(), worktrees: l });
      resolve(l);
    });
  });
}

/**
 * Projects to show: those of the given session folders and those added by hand.
 * @param {string[]} dirs cwd of the sessions
 * @returns {Promise<{id, name, path, added, ticketUrl, worktrees: {id, path, branch, detached, head, main}[]}[]>}
 */
export async function tree(dirs) {
  const added = new Set(addedProjects().map(pathKey));
  const projects = new Map();
  const all = [...dirs.filter(Boolean), ...addedProjects()].filter(d => fs.existsSync(d));
  const icons = readIcons(), meta = readMeta();
  const resolved = await Promise.all(all.map(async d => [d, await worktrees(d)]));
  for (const [d, wts] of resolved) {
    const list = wts || [{ path: path.normalize(d), branch: null }];
    const id = pathKey(list[0].path);
    if (projects.has(id)) continue;
    // Logo: logo.png at the root of the project, else the icon taken from Orca
    const logo = path.join(list[0].path, 'logo.png');
    if (fs.existsSync(logo)) logos.set(id, logo);
    else if (icons[id]) logos.set(id, icons[id]);
    else logos.delete(id);
    projects.set(id, {
      id, name: meta[id]?.name || path.basename(list[0].path), dirName: path.basename(list[0].path), path: list[0].path,
      added: added.has(id), logo: logos.has(id), color: meta[id]?.color || null, icon: meta[id]?.icon || null,
      ticketUrl: meta[id]?.ticketUrl || null,
      worktrees: list.map((w, i) => ({ id: pathKey(w.path), path: w.path, branch: w.branch, detached: !!w.detached, head: w.head || null, main: i === 0 })),
    });
  }
  return [...projects.values()].sort((a, b) => a.name.localeCompare(b.name));
}
