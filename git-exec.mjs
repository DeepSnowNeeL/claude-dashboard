// Runs git for a folder. A folder of a WSL distribution seen from Windows (\\wsl.localhost\<distro>\… or
// \\wsl$\<distro>\…) goes through the git of that distribution (wsl.exe), not the Windows git: the Windows git refuses
// such a repo unless each folder is in its safe.directory ("dubious ownership"), and a worktree it creates there
// records //wsl.localhost/… paths that the git of the distribution cannot resolve (and the other way round).
// Paths go through translation both ways: gitArg() for a path given to git, fromGit() for a path git prints.
import path from 'node:path';
import { execFile, execFileSync, spawn } from 'node:child_process';

const WIN = process.platform === 'win32';
const WSL_UNC = /^[\\/]{2}(wsl\.localhost|wsl\$)[\\/]([^\\/]+)(?:[\\/](.*))?$/i;

/** WSL folder seen from Windows: `{ distro, prefix, linux }`, otherwise null. Pure (any platform). */
export function wslPath(p) {
  const m = String(p || '').match(WSL_UNC);
  if (!m) return null;
  const rest = (m[3] || '').replace(/\\/g, '/').replace(/\/+$/, '');
  return { distro: m[2], prefix: `\\\\${m[1]}\\${m[2]}`, linux: `/${rest}` };
}

/** Path printed by the git of a distribution, as Windows sees it (`prefix`: \\wsl.localhost\<distro>). */
export function linuxToWindows(p, prefix) {
  const s = String(p);
  const drive = s.match(/^\/mnt\/([a-z])(?:\/(.*))?$/i);
  if (drive) return `${drive[1].toUpperCase()}:\\${(drive[2] || '').replace(/\//g, '\\')}`;
  if (s.startsWith('/') && !s.startsWith('//')) return prefix + s.replace(/\//g, '\\').replace(/\\$/, '');
  return path.win32.normalize(s); // already a Windows path (//wsl.localhost/…, C:/…)
}

/** Path given to the git of a distribution: the WSL folder in Linux form, a drive folder under /mnt. */
export function windowsToLinux(p) {
  const w = wslPath(p);
  if (w) return w.linux;
  const drive = String(p).match(/^([a-z]):[\\/]?(.*)$/i);
  if (drive) return `/mnt/${drive[1].toLowerCase()}/${drive[2].replace(/\\/g, '/')}`.replace(/\/+$/, '');
  return String(p);
}

/** WSL folder whose git is the distribution's (only on Windows). */
const viaWsl = dir => (WIN ? wslPath(dir) : null);

/** Command and arguments running `git -C dir …args`. */
export function gitCommand(dir, args) {
  const w = viaWsl(dir);
  return w ? ['wsl.exe', ['-d', w.distro, '--exec', 'git', '-C', w.linux, ...args]] : ['git', ['-C', dir, ...args]];
}

/** A path given to git about the repo of `dir` (worktree add / remove): Linux form when that git is the distribution's. */
export const gitArg = (dir, p) => (viaWsl(dir) ? windowsToLinux(p) : p);

/** A path printed by git about the repo of `dir` (--show-toplevel, worktree list), as seen from here. */
export function fromGit(dir, p) {
  const w = viaWsl(dir);
  return w ? linuxToWindows(p, w.prefix) : p;
}

/** Runs git, resolves its output (untrimmed), rejects with its message (stderr). */
export function execGit(dir, args, { timeout = 60_000, maxBuffer = 16 * 1024 * 1024, encoding = 'utf8' } = {}) {
  const [file, argv] = gitCommand(dir, args);
  return new Promise((ok, ko) => execFile(file, argv, { windowsHide: true, timeout, maxBuffer, encoding },
    (err, stdout, stderr) => (err ? ko(new Error(String(stderr || err.message).trim() || err.message)) : ok(stdout))));
}

/** Synchronous variant; throws as execFileSync does. */
export function execGitSync(dir, args, options) {
  const [file, argv] = gitCommand(dir, args);
  return execFileSync(file, argv, { windowsHide: true, ...options });
}

/** Spawns git (streams: check-ignore --stdin, grep). */
export function spawnGit(dir, args, options) {
  const [file, argv] = gitCommand(dir, args);
  return spawn(file, argv, { windowsHide: true, ...options });
}
