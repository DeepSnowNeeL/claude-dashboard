// Files and folders of the computer: existence, read URL, opening in the Windows file explorer.
import { api } from '../core/api.js';

/** URL of a disk file (absolute path) served by the page. */
export const localFileUrl = path => '/api/file/' + path.replace(/\\/g, '/').split('/').map(encodeURIComponent).join('/');
/** { exists, isDir… }; empty object if the call fails. */
export const pathExists = c => fetch(`/api/exists?path=${encodeURIComponent(c)}`).then(r => r.json()).catch(() => ({}));
/** Shows the path in the Windows file explorer (server). */
export const showInExplorer = path => api('/api/explorer', { path });
/** Opens the path with the default application (server). */
export const openWithDefault = path => api('/api/explorer', { path, open: true });
/** Opens the path in VS Code, in the window of its repository (server). */
export const openInVsCode = (path, line) => api('/api/vscode', { path, line });
/** `{ engine, page }`: true when that process runs older code than the files on disk (PC only: fails elsewhere). */
export const readUpdates = () => api('/api/updates');
/** Restarts what is behind: the engine as soon as its sessions are idle (`{ running }`), the page right away. */
export const restartOutdated = what => api('/api/updates/restart', what);
