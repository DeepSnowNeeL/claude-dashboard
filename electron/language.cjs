// Interface language of the Electron side (tray, notifications, dialogs, launcher name): the i18n module of the page
// (plain ESM, loaded with import() since this code is CommonJS), set from options.json `language`, where `auto`
// follows the operating system locale.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

// Same formula as DASH_DIR in common.mjs (CommonJS cannot import it)
const DASH_DIR = process.env.DASH_DIR || path.join(os.homedir(), '.claude-dashboard');
const OPTIONS_FILE = path.join(DASH_DIR, 'options.json');

let i18n = null;

/** Loads the i18n module once, applies the language and returns the module ({ t, language, ... }). */
async function loadI18n(app) {
  if (!i18n) i18n = await import(pathToFileURL(path.join(__dirname, '..', 'public', 'i18n', 'index.js')).href);
  applyLanguage(app);
  return i18n;
}

/** Reads the setting again (it can change from the page's Options) and applies it. */
function applyLanguage(app) {
  if (!i18n) return;
  let setting = 'auto';
  try { setting = JSON.parse(fs.readFileSync(OPTIONS_FILE, 'utf8')).language || 'auto'; } catch { /* no options yet */ }
  i18n.setLanguage(i18n.resolveLanguage(setting, app?.getLocale?.() || Intl.DateTimeFormat().resolvedOptions().locale));
}

module.exports = { loadI18n, applyLanguage, DASH_DIR };
