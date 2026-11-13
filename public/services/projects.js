// Projects, groups, sessions and orders of the tree: loading, saving (groups, orders, metadata,
// added projects), recent folders and history of a folder.
import { batch } from '../core/signals.js';
import { sessions, projects, groups, orders, listLoaded } from '../core/state.js';
import { api } from '../core/api.js';

/** Loads the list; the projects come with their meta (name, color, icon, ticketUrl), read by core/dom.js ticketLink. */
export async function loadList() {
  const [list, pageProjects, pageGroups, pageOrders] = await Promise.all([api('/api/sessions'), api('/api/projects').catch(() => []), api('/api/groups').catch(() => []), api('/api/orders').catch(() => ({}))]);
  batch(() => { sessions.set(list); projects.set(pageProjects); groups.set(pageGroups); orders.set(pageOrders); listLoaded.set(true); });
}

/** Same path key as the server (projects.mjs): unified separators, no trailing slash, case-insensitive on Windows. */
export const pathKey = p => { const n = String(p || '').replace(/\\/g, '/').replace(/\/+$/, ''); return /^[a-z]:/i.test(n) ? n.toLowerCase() : n; };

/** Keeps the groups; throws the network error if any (up to the component to show it). */
export async function saveGroups(newGroups) {
  groups.set(newGroups);
  await fetch('/api/groups', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(newGroups) });
}

/** Adds a folder to the projects by hand. */
export const addProject = path => api('/api/projects', { path });
/** Name, color, icon and ticket URL template of a project. No exception on an HTTP error. */
export const saveProjectMeta = meta => fetch('/api/projects/meta', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(meta) });
/** Removes a project from the tree (its ended sessions are archived). Throws the server error (open sessions). */
export const removeProject = async path => {
  const r = await fetch('/api/projects', { method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ path }) });
  if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || `HTTP ${r.status}`);
};
/** Manual order of the sessions of a worktree. No exception on an HTTP error. */
export const saveOrder = (worktree, slugs) => fetch('/api/orders', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ worktree, slugs }) });
export const projectLogoUrl = id => `/api/projects/logo?id=${encodeURIComponent(id)}`;

/** Past conversations of a folder. */
export const readHistory = dir => api(`/api/history?dir=${encodeURIComponent(dir.trim())}`);
/** Folders offered for a new session. */
export const readFolders = () => api('/api/folders');
