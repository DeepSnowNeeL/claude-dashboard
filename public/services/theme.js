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
