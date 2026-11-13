// Explorer: all the files of the session folder, read from the disk, text search, fuzzy search (Ctrl+P).
import { api } from '../core/api.js';

// The tree comes from the disk, a folder read the first time it is opened; git only tells what it ignores (greyed).
// Windows reports the changes (fs.watch on the page side, SSE stream): the touched folders already read are read again.
// `files` (Ctrl+P) stays the git list: without what it ignores, so as not to drown the search.
export const explorerState = { dir: null, files: [], ignoredPaths: new Set(), tree: null, openDirs: new Set(), selection: null, q: '', regex: false, matchCase: false, results: null, stream: null };

const newNode = ignored => ({ dirs: new Map(), files: [], ignored, loaded: false });
const nodeOf = rel => (rel ? rel.split('/') : []).reduce((n, part) => n?.dirs.get(part), explorerState.tree);
const byDepth = (a, b) => a.split('/').length - b.split('/').length;

/** Reads a folder from the disk; the subfolders already read keep their content. */
async function listNode(rel, node) {
  const r = await api(`/api/browse/list?dir=${encodeURIComponent(explorerState.dir)}&rel=${encodeURIComponent(rel)}${node.ignored ? '&ignore=1' : ''}`)
    .catch(() => null);
  if (!r) return; // gone in the meantime
  const previous = node.dirs;
  node.dirs = new Map();
  node.files = [];
  for (const e of r.entries) {
    const relE = (rel ? `${rel}/` : '') + e.name;
    if (e.ignored) explorerState.ignoredPaths.add(relE); else explorerState.ignoredPaths.delete(relE);
    if (e.isDir) node.dirs.set(e.name, previous.get(e.name) || newNode(e.ignored));
    else node.files.push(e.name);
  }
  node.loaded = true;
}
/** Reads the open folders not read yet, from the shallowest to the deepest. */
export async function ensureOpenLoaded(openDirs = explorerState.openDirs) {
  for (const rel of [...openDirs].sort(byDepth)) {
    const n = nodeOf(rel);
    if (n && !n.loaded) await listNode(rel, n);
  }
}

/** Root and Ctrl+P list of a folder, read once (simultaneous calls wait for the same read). */
export function loadExplorer(d) {
  if (explorerState.dir === d.cwd && explorerState.loading) return explorerState.loading;
  Object.assign(explorerState, { dir: d.cwd, openDirs: new Set(), ignoredPaths: new Set(), selection: null, q: '', results: null, tree: newNode(false), files: [] });
  explorerState.loading = (async () => {
    const [, r] = await Promise.all([listNode('', explorerState.tree), api(`/api/browse/files?dir=${encodeURIComponent(d.cwd)}`).catch(() => ({ files: [] }))]);
    explorerState.files = r.files;
    watchExplorer();
  })();
  return explorerState.loading;
}

/**
 * Stream of the folder changes: reads the touched folders again, then notifies (event "explorer-update") so that
 * the explorer and the editor tree repaint.
 */
let paletteFilesUpdate = null;
function watchExplorer() {
  explorerState.stream?.close();
  const dir = explorerState.dir;
  const stream = explorerState.stream = new EventSource(`/api/browse/watch?dir=${encodeURIComponent(dir)}`);
  stream.onmessage = async e => {
    if (explorerState.dir !== dir) return stream.close();
    const { paths = [], all } = JSON.parse(e.data);
    // Folders to read again: the parents of the touched paths (and the path itself if it is a folder already read)
    const touched = new Set();
    for (const c of all ? [] : paths) {
      touched.add(c.includes('/') ? c.slice(0, c.lastIndexOf('/')) : '');
      touched.add(c);
    }
    const read = [];
    const walk = (n, rel) => { if (n.loaded) read.push(rel); for (const [name, f] of n.dirs) walk(f, rel ? `${rel}/${name}` : name); };
    walk(explorerState.tree, '');
    for (const rel of read.filter(r => all || touched.has(r)).sort(byDepth)) await listNode(rel, nodeOf(rel) || newNode(false));
    await ensureOpenLoaded();
    dispatchEvent(new Event('explorer-update'));
    // Ctrl+P list: read again once things calm down (git ls-files), not at every keystroke of an editor
    clearTimeout(paletteFilesUpdate);
    paletteFilesUpdate = setTimeout(async () => {
      const r = await api(`/api/browse/files?dir=${encodeURIComponent(dir)}`).catch(() => null);
      if (r && explorerState.dir === dir) explorerState.files = r.files;
    }, 2000);
  };
}

export const absolute = rel =>`${explorerState.dir.replace(/[\\/]+$/, '')}\\${rel.replace(/\//g, '\\')}`;

/** Text search in the files of the folder (ripgrep, otherwise git grep on the server side). */
export const searchText = (dir, q, regex, matchCase) =>
  api(`/api/browse/search?dir=${encodeURIComponent(dir)}&q=${encodeURIComponent(q)}&regex=${regex ? 1 : 0}&case=${matchCase ? 1 : 0}`);

/**
 * Ctrl+P: find a file by its name (fuzzy search: the letters in order, bonus when they follow each other
 * or fall in the file name). Enter opens it in the editor and selects it in the tree.
 */
export function fuzzyScore(q, rel) {
  const sl = rel.toLowerCase();
  const wordStart = (k, start) => k === start || /[A-Z]/.test(rel[k]) || '/._- '.includes(rel[k - 1]);
  // Letters in order from `start`: the letter right after the previous one first, otherwise a word start
  // ("urcrepoi" → UserResultsCoachingRepositoryI), otherwise the next one found
  const attempt = start => {
    let i = start, score = 0, run = 0;
    for (const c of q) {
      let j = sl[i] === c ? i : -1;
      if (j < 0) for (let k = i; k < sl.length; k++) if (sl[k] === c && wordStart(k, start)) { j = k; break; }
      if (j < 0) j = sl.indexOf(c, i);
      if (j < 0) return -1;
      run = j === i ? run + 1 : 0;
      score += 1 + run * 2 + (wordStart(j, start) ? 4 : 0);
      i = j + 1;
    }
    return score;
  };
  const name = attempt(rel.lastIndexOf('/') + 1); // everything in the file name: well ahead
  const exact = sl.slice(rel.lastIndexOf('/') + 1).includes(q) ? 500 : 0; // the input as is in the name
  if (name >= 0) return 1000 + exact + name - rel.length * 0.01;
  const all = attempt(0);
  return all < 0 ? -1 : all - rel.length * 0.01;
}
