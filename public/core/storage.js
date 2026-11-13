// localStorage without exceptions: tree folds, drafts, "seen", right tab, files layout, theme.
// A text value is kept as is (compatible with what the page wrote before, and with the theme script of
// index.html); everything else is kept as JSON.

/** Value kept under `key`, or `fallback` if missing, unreadable or storage unavailable. */
export function read(key, fallback) {
  try {
    const v = localStorage.getItem(key);
    if (v === null) return fallback;
    return typeof fallback === 'string' ? v : JSON.parse(v);
  } catch { return fallback; }
}

export function write(key, value) {
  try { localStorage.setItem(key, typeof value === 'string' ? value : JSON.stringify(value)); } catch { /* storage unavailable */ }
}

export function remove(key) {
  try { localStorage.removeItem(key); } catch { /* storage unavailable */ }
}

// --- Backward compatibility: keys (and values) written by the French build of the page -----------------------------
// Each old key is copied to its new name (value converted when its content changed too), then removed: the
// migration runs at every load but only finds something the first time.
const renameKeys = (o, names) => Object.fromEntries(Object.entries(o || {}).map(([k, v]) => [names[k] ?? k, v]));
const SIDE_TABS = { tableau: 'tracker', fichiers: 'files', commits: 'files', explorateur: 'explorer' };
const LEGACY_KEYS = [
  ['dash-onglet-droite', 'dash-side-tab', v => SIDE_TABS[v] || v],
  ['dash-affichage-fichiers', 'dash-files-layout', v => ({ liste: 'list', arbre: 'tree' }[v] || v)],
  ['visionneuse-largeurs', 'viewer-widths', v => JSON.stringify(renameKeys(JSON.parse(v), { g: 'l', d: 'r' }))],
  ['dash-plis', 'dash-folds', v => JSON.stringify(renameKeys(JSON.parse(v), { 'p:autres': 'p:others', 't:autres': 't:others' }))],
  ['largeur-sessions', 'sessions-width'],
  ['largeur-droite', 'right-width'],
];
const LEGACY_PREFIXES = [
  ['dash-vu-', 'dash-seen-'],
  ['brouillon:', 'draft:', v => { const { texte, ...rest } = JSON.parse(v) || {}; return JSON.stringify(texte === undefined ? rest : { text: texte, ...rest }); }],
];
function migrate() {
  try {
    const move = (from, to, convert) => {
      const v = localStorage.getItem(from);
      if (v === null) return;
      try { if (localStorage.getItem(to) === null) localStorage.setItem(to, convert ? convert(v) : v); } catch { /* unreadable: dropped */ }
      localStorage.removeItem(from);
    };
    for (const [from, to, convert] of LEGACY_KEYS) move(from, to, convert);
    const keys = Array.from({ length: localStorage.length }, (_, i) => localStorage.key(i));
    for (const k of keys) {
      for (const [from, to, convert] of LEGACY_PREFIXES) if (k?.startsWith(from)) move(k, to + k.slice(from.length), convert);
    }
  } catch { /* storage unavailable */ }
}
migrate();
