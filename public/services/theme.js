// Theme of the page: the computer's one, or forced (set on <html> by index.html and the Options).
import { read, write, remove } from '../core/storage.js';

export function isDarkTheme() {
  const th = document.documentElement.dataset.theme;
  return th ? th === 'dark' : matchMedia('(prefers-color-scheme: dark)').matches;
}

// --- Theme: the computer's one, or forced (localStorage, set before display by index.html) -----------------
export function readTheme() { return read('theme', 'auto') || 'auto'; }
/** Keeps the choice in the browser and sets it on <html>; the components redraw what depends on it. */
export function setTheme(th) {
  if (th === 'auto') remove('theme'); else write('theme', th);
  if (th === 'light' || th === 'dark') document.documentElement.dataset.theme = th; else delete document.documentElement.dataset.theme;
}

// --- Text size: a factor kept in this browser (localStorage, set before display by index.html) -------------
// The chat follows it fully, the rest of the interface half as much (--text-scale, see base.css).
export const TEXT_SIZES = ['90', '100', '110', '125', '140'];
export function readTextSize() { const v = read('text-size', '100'); return TEXT_SIZES.includes(v) ? v : '100'; }
export function setTextSize(v) {
  const root = document.documentElement.style;
  if (v === '100') { remove('text-size'); root.removeProperty('--text-scale'); }
  else { write('text-size', v); root.setProperty('--text-scale', String(Number(v) / 100)); }
}
/** Factor of the interface outside the chat (half the text size's increase), for what CSS does not reach (Monaco). */
export function uiScale() { return 1 + (Number(readTextSize()) / 100 - 1) / 2; }
