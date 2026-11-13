// Interface language: French or English. The setting lives in options.json (`language`: auto, fr or en);
// `auto` follows the browser on the page, the operating system in the engine and the Electron app.
// Shared by the page, the engine and Electron: this module imports nothing outside public/i18n.
import fr from './fr/index.js';
import en from './en/index.js';

export const LANGUAGES = ['fr', 'en'];
const DICTIONARIES = { fr, en };

let current = 'en';

/** `auto` → French if the locale is French, English otherwise. */
export function resolveLanguage(setting, locale) {
  if (LANGUAGES.includes(setting)) return setting;
  return String(locale || '').toLowerCase().startsWith('fr') ? 'fr' : 'en';
}

export function setLanguage(lang) { current = LANGUAGES.includes(lang) ? lang : 'en'; }
export const language = () => current;

function find(dict, key) {
  let v = dict;
  for (const part of key.split('.')) { v = v?.[part]; if (v === undefined) return undefined; }
  return v;
}

/**
 * Text of `key` in the current language (English if missing, the key itself as a last resort).
 * `{name}` is replaced by params.name. A value { one, other } (or zero) is chosen by params.n.
 * A value can also be a function (params) => string, for sentences that do not fit a template.
 */
export function t(key, params = {}, lang = current) {
  let v = find(DICTIONARIES[lang], key);
  if (v === undefined && lang !== 'en') v = find(DICTIONARIES.en, key);
  if (v === undefined) return key;
  if (typeof v === 'function') return v(params);
  if (v && typeof v === 'object') {
    const n = Number(params.n);
    v = (n === 0 && v.zero !== undefined) ? v.zero : (v[new Intl.PluralRules(lang).select(n)] ?? v.other);
  }
  return String(v).replace(/\{(\w+)\}/g, (m, name) => (params[name] !== undefined ? params[name] : m));
}

/** Translates the static HTML: data-i18n (text), data-i18n-placeholder, data-i18n-title, data-i18n-aria-label. */
export function translateDom(root) {
  for (const attr of ['', 'placeholder', 'title', 'aria-label']) {
    const name = attr ? `data-i18n-${attr}` : 'data-i18n';
    for (const el of root.querySelectorAll(`[${name}]`)) {
      const text = t(el.getAttribute(name));
      if (attr) el.setAttribute(attr, text); else el.textContent = text;
    }
  }
}

/** Locale for dates and numbers (Intl). */
export const locale = () => (current === 'fr' ? 'fr-FR' : 'en-US');
