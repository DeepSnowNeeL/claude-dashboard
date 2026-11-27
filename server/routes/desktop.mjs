// "PC only" routes: stop the page, open a terminal (Claude Code login), the Windows explorer or VS Code.
// server.mjs refuses them from the wifi and the internet before they get here.
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawn, execFile } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { sendJson, readBody, SERVER_MODE } from '../../common.mjs';
import { isPathAllowed, isSensitive } from '../paths.mjs';
import { git, topLevel } from '../git.mjs';
import { gitArg, fromGit } from '../../git-exec.mjs';
import { pathKey, forgetWorktrees } from '../../projects.mjs';
import { engine, engineHeaders, notifyChange, announceRestart } from '../engine-client.mjs';
import { updateStatus } from '../updates.mjs';
import { ENGINE_PORT } from '../../common.mjs';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
import { t } from '../../public/i18n/index.js';

/**
 * "Open with the default application": only documents and media (an allow list: Windows runs far more types than one
 * can list, .exe, .hta, .appref-ms, .settingcontent-ms…). Same list in electron/main.cjs. Never a network path (UNC).
 */
export const OPENABLE = /\.(pdf|png|jpe?g|gif|webp|bmp|ico|svg|txt|md|csv|tsv|json|log|xml|ya?ml|html?|docx|xlsx|pptx|odt|ods|odp|rtf|mp4|mov|avi|mkv|webm|mp3|wav|ogg|flac|m4a)$/i;
const UNC = /^[\\/]{2}/;
/** "Open in the browser (file://)": what a browser displays by itself (same list as public/components/path-menu.js). */
const BROWSABLE = /\.(html?|svg|pdf|png|jpe?g|gif|webp|txt|json|xml)$/i;

const regValue = (key, value) => new Promise(resolve => execFile('reg', ['query', key, ...(value ? ['/v', value] : ['/ve'])], { windowsHide: true },
  (err, out) => resolve(err ? null : (out.match(/REG_(?:EXPAND_)?SZ\s+(.+)/) || [])[1]?.trim() || null)));

/**
 * Command of the default web browser on Windows (the http handler chosen by the user), `{ exe, args }` with `%1` in
 * args, or null. Opening the file through its own association could pick an editor instead of the browser.
 */
async function defaultBrowser() {
  // Recent Windows 11 keeps the choice in UserChoiceLatest; the older UserChoice can stay on a stale value (Edge)
  const key = 'HKCU\\Software\\Microsoft\\Windows\\Shell\\Associations\\UrlAssociations\\http';
  const progId = await regValue(`${key}\\UserChoiceLatest\\ProgId`, 'ProgId') || await regValue(`${key}\\UserChoice`, 'ProgId');
  const command = progId && await regValue(`HKCR\\${progId}\\shell\\open\\command`);
  const m = command?.match(/^"([^"]+)"\s*(.*)$/) || command?.match(/^(\S+)\s*(.*)$/);
  if (!m) return null;
  const args = m[2].split(/\s+/).filter(Boolean);
  return { exe: m[1], args: args.includes('%1') ? args : [...args, '%1'] };
}

/** VS Code's `code`: user install, then machine install, else the one from the PATH. */
function vsCodeCommand() {
  if (process.platform !== 'win32') return 'code';
  const bases = [process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, 'Programs'), process.env.ProgramFiles, process.env['ProgramFiles(x86)']].filter(Boolean);
  return bases.map(b => path.join(b, 'Microsoft VS Code', 'bin', 'code.cmd')).find(f => fs.existsSync(f)) || 'code';
}

/**
 * Action on the machine: only from the page itself (not from another site open in the browser). Server mode: an
 * approved device through the gate, which has already checked that the Origin is the page itself.
 */
const foreignOrigin = req => !(SERVER_MODE && req.origin === 'internet') && req.headers.origin && !/^http:\/\/(localhost|127\.0\.0\.1):\d+$/.test(req.headers.origin);

/** Refusal of a path that cannot be opened: sensitive file, or outside the dashboard projects. */
const refusal = (file, req) => (isSensitive(file, req) ? t('server.errors.sensitiveFile') : t('server.errors.outsideDashboardProjects'));

/**
 * Opens a file (or a folder) in VS Code. A file opens in the window of its git repo (the one already open on that
 * folder, else a new one), at line `line` if given.
 */
async function openVsCode(req, res) {
  if (foreignOrigin(req)) return sendJson(res, 403, { error: t('server.errors.originRefused') });
  let body;
  try { body = JSON.parse(await readBody(req)); } catch { return sendJson(res, 400, { error: t('server.errors.invalidJson') }); }
  const file = path.resolve(String(body.path || ''));
  if (!fs.existsSync(file)) return sendJson(res, 404, { error: t('server.errors.pathNotFound', { path: file }) });
  if (!(await isPathAllowed(file, req))) return sendJson(res, 403, { error: refusal(file, req) });
  const isDir = fs.statSync(file).isDirectory();
  let root = null;
  try { root = path.normalize(await topLevel(isDir ? file : path.dirname(file))); } catch { /* outside a repo */ }
  const target = Number(body.line) > 0 ? `${file}:${Number(body.line)}` : file;
  const args = isDir ? [file] : root ? [root, '-g', target] : ['-g', target];
  if (process.platform === 'win32') {
    // code.cmd goes through cmd: each argument in quotes, the whole command too (cmd /c removes the first pair)
    const line = [vsCodeCommand(), ...args].map(a => a.startsWith('-') ? a : `"${a}"`).join(' ');
    spawn('cmd.exe', ['/d', '/s', '/c', `"${line}"`], { detached: true, stdio: 'ignore', windowsVerbatimArguments: true, windowsHide: true }).unref();
  } else spawn(vsCodeCommand(), args, { detached: true, stdio: 'ignore' }).unref();
  return sendJson(res, 200, { ok: true });
}

// /login and /logout typed in the input: Claude Code login goes through the browser, it is opened in a
// terminal (`claude auth login`), as one would do by hand
const auth = action => async (req, res) => {
  if (foreignOrigin(req)) return sendJson(res, 403, { error: t('server.errors.originRefused') });
  const claude = [path.join(os.homedir(), '.local', 'bin', 'claude.exe'), path.join(os.homedir(), '.local', 'bin', 'claude')].find(f => fs.existsSync(f)) || 'claude';
  // Authenticating an MCP server (OAuth): only the interactive Claude Code can do it; it is opened on /mcp in the
  // session folder, then "Reconnect" in the page picks up the authenticated server
  if (action === 'mcp') {
    let body = {};
    try { body = JSON.parse((await readBody(req)) || '{}'); } catch {}
    const cwd = path.resolve(String(body.cwd || os.homedir()));
    if (!fs.existsSync(cwd)) return sendJson(res, 400, { error: t('server.errors.folderNotFound', { path: cwd }) });
    if (process.platform === 'win32') {
      // Whole command in quotes: otherwise cmd /k removes the first and the last one, and the claude path breaks
      spawn('cmd.exe', ['/c', 'start', '"Claude /mcp"', 'cmd', '/k', `""${claude}" "/mcp""`], { cwd, detached: true, stdio: 'ignore', windowsVerbatimArguments: true }).unref();
    } else spawn(claude, ['/mcp'], { cwd, detached: true, stdio: 'ignore' }).unref();
    return sendJson(res, 200, { ok: true });
  }
  if (process.platform === 'win32') {
    spawn('cmd.exe', ['/c', 'start', `"Claude ${action}"`, 'cmd', '/k', `"${claude}" auth ${action}`], { detached: true, stdio: 'ignore', windowsVerbatimArguments: true }).unref();
  } else {
    spawn(claude, ['auth', action], { detached: true, stdio: 'ignore' }).unref();
  }
  return sendJson(res, 200, { ok: true });
};

/**
 * Removes a git worktree (right click in the tree): never the main worktree, refused while a session is open in it.
 * Uncommitted changes block it (409 `dirty`) unless `force`. The branch is kept; the ended sessions of the folder are
 * archived (recoverable in the project history).
 */
async function removeWorktree(req, res) {
  if (foreignOrigin(req)) return sendJson(res, 403, { error: t('server.errors.originRefused') });
  let body;
  try { body = JSON.parse(await readBody(req)); } catch { return sendJson(res, 400, { error: t('server.errors.invalidJson') }); }
  const dir = path.resolve(String(body.path || ''));
  let list;
  try { list = [...(await git(dir, ['worktree', 'list', '--porcelain'])).matchAll(/^worktree (.+)$/gm)].map(m => path.normalize(fromGit(dir, m[1]))); }
  catch { return sendJson(res, 404, { error: t('server.worktree.notAWorktree', { path: dir }) }); }
  const main = list[0];
  if (!list.some(w => pathKey(w) === pathKey(dir))) return sendJson(res, 404, { error: t('server.worktree.notInThisRepo', { path: dir }) });
  if (pathKey(main) === pathKey(dir)) return sendJson(res, 400, { error: t('server.worktree.mainCannotBeRemoved') });
  const sessions = await engine('/api/sessions').catch(() => []);
  const inside = s => s.cwd && (pathKey(s.cwd) === pathKey(dir) || pathKey(s.cwd).startsWith(pathKey(dir) + '/'));
  const open = sessions.filter(s => inside(s) && s.status !== 'done');
  if (open.length) return sendJson(res, 409, { error: t('server.worktree.sessionsOpen', { n: open.length, names: open.map(s => s.title || s.slug).join(', ') }) });
  try { await git(main, ['worktree', 'remove', ...(body.force ? ['--force'] : []), gitArg(main, dir)]); }
  catch (e) {
    const msg = String(e.message || e);
    if (!body.force && /modified or untracked|contains modified|is dirty|untracked files/i.test(msg)) return sendJson(res, 409, { error: t('server.worktree.uncommitted'), dirty: true });
    return sendJson(res, 500, { error: msg.trim() });
  }
  for (const s of sessions.filter(inside)) await engine(`/api/sessions/${s.slug}/archive`, { method: 'POST' }).catch(() => {});
  forgetWorktrees();
  notifyChange();
  engine('/api/progress/event', { method: 'POST', body: JSON.stringify({ type: 'worktree-removed' }) }).catch(() => {}); // Lumberjack achievement
  return sendJson(res, 200, { ok: true });
}

// "Not up to date" banner: engine and page compared with the commit on disk (an engine without the version route is an
// old one); the button restarts what is behind, the engine as soon as its sessions are idle
async function updates(req, res) {
  let engineCommit;
  try {
    const r = await fetch(`http://127.0.0.1:${ENGINE_PORT}/api/engine/version`, { headers: engineHeaders(), signal: AbortSignal.timeout(2000) });
    engineCommit = r.status === 404 ? null : (await r.json()).commit;
  } catch { engineCommit = undefined; } // engine not running: the page starts it with the current code
  const status = await updateStatus(engineCommit);
  if (engineCommit === undefined) status.engine = false;
  return sendJson(res, 200, status);
}
async function restartOutdated(req, res) {
  let body;
  try { body = JSON.parse(await readBody(req)); } catch { return sendJson(res, 400, { error: t('server.errors.invalidJson') }); }
  let running = [];
  if (body.engine) running = (await engine('/api/engine/stop?deferred=1', { method: 'POST' }).catch(() => ({}))).running || [];
  sendJson(res, 200, { ok: true, running });
  // The page restarts itself through the CLI (which stops it, waits, starts it again), with the same Node (Electron's)
  if (body.page) spawn(process.execPath, [path.join(ROOT, 'dash.mjs'), 'restart'], { cwd: ROOT, detached: true, stdio: 'ignore', windowsHide: true }).unref();
}

export default {
  'GET /api/updates': updates,
  'POST /api/updates/restart': restartOutdated,
  'POST /api/worktree/remove': removeWorktree,
  'POST /api/vscode': openVsCode,
  // Stopping the page alone (dash.mjs restart): no session is touched
  'POST /api/stop': async (req, res) => { sendJson(res, 200, { ok: true }); announceRestart(); setTimeout(() => process.exit(0), 100); },
  'POST /api/auth/login': auth('login'),
  'POST /api/auth/logout': auth('logout'),
  'POST /api/auth/status': auth('status'),
  'POST /api/auth/mcp': auth('mcp'),
  'POST /api/explorer': async (req, res) => {
    // Action on the machine: only from the page itself (not from another site open in the browser)
    if (foreignOrigin(req)) return sendJson(res, 403, { error: t('server.errors.originRefused') });
    let body;
    try { body = JSON.parse(await readBody(req)); } catch { return sendJson(res, 400, { error: t('server.errors.invalidJson') }); }
    // Network path (\\server\share): refused before touching it (Windows would send the user's credentials to it)
    if (UNC.test(String(body.path || ''))) return sendJson(res, 403, { error: t('server.errors.executableRefused') });
    const file = path.resolve(String(body.path || ''));
    if (!fs.existsSync(file)) return sendJson(res, 404, { error: t('server.errors.pathNotFound', { path: file }) });
    const isDir = fs.statSync(file).isDirectory();
    // Sensitive file: only show it selected in its folder (nothing is read or opened)
    const showOnly = !isDir && !body.open && isSensitive(file, req);
    if (!showOnly && !(await isPathAllowed(file, req))) return sendJson(res, 403, { error: refusal(file, req) });
    // { browser: true }: the file:// URL in the default web browser (a page cannot open file:// itself)
    if (body.browser) {
      if (isDir || !BROWSABLE.test(file)) return sendJson(res, 403, { error: t('server.errors.executableRefused') });
      const url = pathToFileURL(file).href;
      const browser = process.platform === 'win32' ? await defaultBrowser() : null;
      if (browser) spawn(browser.exe, browser.args.map(a => (a === '%1' ? url : a)), { detached: true, stdio: 'ignore' }).unref();
      else spawn(process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'explorer.exe' : 'xdg-open', [url], { detached: true, stdio: 'ignore' }).unref();
      return sendJson(res, 200, { ok: true });
    }
    // { open: true }: with the default application (explorer.exe <file>), documents and media only
    if (body.open && !isDir && !OPENABLE.test(file)) return sendJson(res, 403, { error: t('server.errors.executableRefused') });
    spawn('explorer.exe', [isDir || body.open ? `"${file}"` : `/select,"${file}"`], { detached: true, stdio: 'ignore', windowsVerbatimArguments: true }).unref();
    return sendJson(res, 200, { ok: true });
  },
};
