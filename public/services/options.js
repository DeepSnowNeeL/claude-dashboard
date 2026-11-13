// Page settings (archiving, language…), PC only.
import { api } from '../core/api.js';

export const readOptions = () => api('/api/options');
export const saveOptions = options => api('/api/options', options);

/** Interface language setting ('auto' | 'fr' | 'en'), readable from everywhere (remote devices included). */
export const readLanguage = () => api('/api/language').then(r => r.setting || 'auto');
/** { setting, serverMode }: language setting and whether the dashboard runs in server mode (Docker). */
export const readLanguageInfo = () => api('/api/language');
/** Server mode: workspace folder and its first-level subfolders `{ dir, folders: [{ name, path, git }] }`. */
export const readWorkspace = () => api('/api/workspace');
