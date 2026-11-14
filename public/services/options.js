// Page settings (archiving, language…), PC only.
import { api } from '../core/api.js';

export const readOptions = () => api('/api/options');
export const saveOptions = options => api('/api/options', options);

/** ⚙ Options → Tracker: profiles, installation default, choice per project folder (`dirs`). PC only. */
export const readTrackers = dirs => api(`/api/trackers?${dirs.map(d => `dir=${encodeURIComponent(d)}`).join('&')}`);
/** `scope` 'default' (profile id) or 'install-repo' (dir, profile id or null: back to the repo's or the default). */
export const saveTracker = (scope, dir, profile) => api('/api/trackers', { scope, dir, profile });

/** Interface language setting ('auto' | 'fr' | 'en'), readable from everywhere (remote devices included). */
export const readLanguage = () => api('/api/language').then(r => r.setting || 'auto');
/** { setting, serverMode }: language setting and whether the dashboard runs in server mode (Docker). */
export const readLanguageInfo = () => api('/api/language');
/** Server mode: workspace folder and its first-level subfolders `{ dir, folders: [{ name, path, git }] }`. */
export const readWorkspace = () => api('/api/workspace');
