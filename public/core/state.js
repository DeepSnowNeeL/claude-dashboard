// Shared application state: the signals read by more than one component.
import { signal } from './signals.js';
import { read } from './storage.js';

export const sessions = signal([]);   // tree list
export const listLoaded = signal(false); // the list has been loaded once (the tree waits until then)
export const projects = signal([]);   // tree projects, with their meta (name, color, icon, ticketUrl)
export const groups = signal([]);
export const orders = signal({});     // manual order of the sessions per worktree
export const current = signal(null);  // displayed slug
export const detail = signal(null);   // JSON of the displayed session
export const view = signal(null);     // null: main conversation; otherwise the key of the displayed subagent
export const agents = signal(new Map());  // key → last card of the agent (wherever it appeared)
export const shells = signal(new Map());  // task_id → last state of the background shell
export const activity = signal(null);     // indicator under the feed
export const sideTab = signal((() => { const o = read('dash-side-tab', ''); return o === 'commits' ? 'files' : o || 'tracker'; })());
export const gitStatus = signal({ dir: null, files: [] });
export const attachments = signal([]); // { id, file: File, preview: object URL for images }

/** Folder of the displayed session: base of relative paths (kept while the next one loads). */
export const relativeDir = signal(null);
export const progress = signal(null); // levels and achievements (GET /api/progress)
/** Server mode (Docker): no desktop actions (explorer, VS Code, terminals); set at startup from GET /api/language. */
export const serverMode = signal(false);
