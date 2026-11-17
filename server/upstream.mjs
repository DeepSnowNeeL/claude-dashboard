// News from the public repository: the page server fetches it every few hours into a ref of its own and counts the
// commits the checkout does not have yet. The URL is fixed here, so a fork keeps it and still sees what it can take in
// (comparing with `origin` would not work: on a fork, origin is the fork itself).
import fs from 'node:fs';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { DASH_DIR } from '../common.mjs';
import { headCommit } from './updates.mjs';

export const UPSTREAM_URL = 'https://github.com/DeepSnowNeeL/claude-dashboard.git';
const UPSTREAM_BRANCH = 'main';
const REF = 'refs/dash/upstream';
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const EVERY = 6 * 3600_000;

const git = args => new Promise(resolve => execFile('git', ['-C', ROOT, ...args], { timeout: 60_000, windowsHide: true, maxBuffer: 4 * 1024 * 1024 },
  (e, out) => resolve(e ? null : out)));

/** Setting `upstreamCheck` of options.json (on unless set to false). */
export function upstreamCheckEnabled() {
  try { return JSON.parse(fs.readFileSync(path.join(DASH_DIR, 'options.json'), 'utf8')).upstreamCheck !== false; } catch { return true; }
}

let fetchedAt = 0, fetching = null;
function fetchUpstream() {
  fetching ??= git(['fetch', '--quiet', '--no-tags', UPSTREAM_URL, `+${UPSTREAM_BRANCH}:${REF}`]).then(out => {
    if (out !== null) fetchedAt = Date.now();
    fetching = null;
  });
  return fetching;
}

/** Bullets added to CHANGELOG.md on the upstream side since the common ancestor (continuation lines joined). */
async function newChangelog() {
  const diff = await git(['diff', `HEAD...${REF}`, '--', 'CHANGELOG.md']);
  const items = [];
  for (const line of (diff || '').split('\n')) {
    if (!line.startsWith('+') || line.startsWith('+++')) continue;
    const text = line.slice(1);
    if (text.startsWith('- ')) items.push(text.slice(2).trim());
    else if (/^\s+\S/.test(text) && items.length) items[items.length - 1] += ` ${text.trim()}`;
  }
  return items;
}

/**
 * `{ enabled, behind, ahead, fork, latest, changelog, root }`: `behind`, upstream commits the checkout lacks; `fork`,
 * the checkout has commits of its own or another origin (the update is then a merge into it).
 */
export async function upstreamStatus() {
  const enabled = upstreamCheckEnabled();
  if (!enabled || !headCommit(ROOT)) return { enabled, behind: 0 };
  if (Date.now() - fetchedAt > EVERY) await fetchUpstream();
  const latest = (await git(['rev-parse', '--verify', '--quiet', REF]))?.trim();
  if (!latest) return { enabled, behind: 0 };
  const count = async range => Number((await git(['rev-list', '--count', range]))?.trim()) || 0;
  const [behind, ahead, origin] = await Promise.all([count(`HEAD..${REF}`), count(`${REF}..HEAD`), git(['remote', 'get-url', 'origin'])]);
  const sameRepo = u => String(u || '').trim().toLowerCase().replace(/\.git$/, '').replace(/^git@github\.com:/, 'https://github.com/');
  const fork = ahead > 0 || sameRepo(origin) !== sameRepo(UPSTREAM_URL);
  return { enabled, behind, ahead, fork, latest, changelog: behind ? await newChangelog() : [], root: ROOT, url: UPSTREAM_URL, branch: UPSTREAM_BRANCH };
}
