// Mermaid diagrams (loaded on demand from the CDN): architecture and database diagrams of the Tracker panel.
import { esc } from '../core/dom.js';
import { isDarkTheme } from '../services/theme.js';
import { t } from '../i18n/index.js';

let mermaidReady = null;
let mermaidCounter = 0;
// Monaco's AMD loader (editor opened before) sets a global `define`: some Mermaid modules (fastdom: `typeof
// define == "function"`) call it, which throws "Can only have one anonymous define call per script file". We
// remove it while loading and drawing (a Monaco module loaded exactly at that moment would fail: short window).
let hidings = 0, hiddenDefine;
async function withoutAmd(f) {
  if (hidings++ === 0) { hiddenDefine = window.define; if (hiddenDefine) window.define = undefined; }
  try { return await f(); } finally { if (--hidings === 0 && hiddenDefine) { window.define = hiddenDefine; hiddenDefine = undefined; } }
}
function loadMermaid() {
  mermaidReady ??= withoutAmd(() => import('https://cdn.jsdelivr.net/npm/mermaid@11.17.2/dist/mermaid.esm.min.mjs')).then(m => {
    const dark = isDarkTheme();
    m.default.initialize({ startOnLoad: false, theme: dark ? 'dark' : 'neutral', securityLevel: 'strict', suppressErrorRendering: true });
    return m.default;
  }, e => { mermaidReady = null; throw e; });
  return mermaidReady;
}
/** `onError(e)`: called when Mermaid rejects the source (syntax error only, not a loading failure). */
export async function renderMermaid(el, onError) {
  if (el.dataset.done) return;
  el.dataset.done = '1';
  let syntax = false;
  try {
    const mermaid = await loadMermaid();
    // A "~" inside a quoted text (comment "~ may be empty (any format)") makes the Mermaid 11.4 parser run away
    // (kept out of caution): its time doubles with every following word (16 s, frozen page). The mathematical tilde "∼" looks
    // the same and triggers nothing.
    const source = el.dataset.src.replace(/"[^"\n]*"/g, s => s.replace(/~/g, '∼'));
    // Only a source that Mermaid rejects when parsing is sent back to Claude: a page failure is not its business.
    await withoutAmd(() => mermaid.parse(source)).catch(e => { syntax = true; throw e; });
    const { svg } = await withoutAmd(() => mermaid.render(`mmd${++mermaidCounter}`, source));
    el.innerHTML = svg;
    const colours = { '+': ['#16a34a', '#16a34a33'], '~': ['#ea580c', '#ea580c33'], '∼': ['#ea580c', '#ea580c33'], '-': ['#dc2626', '#dc262633'] };
    el.querySelectorAll('g[id*="entity-"]').forEach(g => {
      const label = (g.querySelector('.nodeLabel, text')?.textContent || '').trim();
      const c = colours[label[0]];
      const shape = g.querySelector('rect, path');
      if (c && shape) { shape.style.stroke = c[0]; shape.style.fill = c[1]; shape.style.strokeWidth = '2px'; }
    });
  } catch (e) {
    if (syntax) onError?.(e);
    el.innerHTML = `<pre class="code">${esc(el.dataset.src)}</pre><div class="m">${t('editor.mermaid.notRendered', { message: esc(e.message) })}</div>`;
  }
}

/** The next diagrams are redrawn with the current theme (theme change). */
export function resetMermaid() { mermaidReady = null; }
