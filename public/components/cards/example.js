// Rendering of the examples attached to a decision (situation, code, mockup, comparison).
import { esc, rich } from '../../core/dom.js';
import { fileUrl } from '../../core/api.js';

export function example(e, slug) {
  if (!e) return '';
  if (e.type === 'situation') return `<div>${rich(e.text)}</div>`;
  if (e.type === 'code') return `<pre class="code">${esc(e.code)}</pre>`;
  if (e.type === 'mockup') return iframe(slug, e.path, e.height);
  if (e.type === 'comparison') {
    const side = c => c ? `<div class="cmp-side ${esc(c.tone || 'neutral')}">
        ${c.title ? `<div class="h">${rich(c.title)}</div>` : ''}
        ${c.text ? `<div>${rich(c.text)}</div>` : ''}
        ${c.code ? `<pre class="code">${esc(c.code)}</pre>` : ''}
        ${c.path ? iframe(slug, c.path, c.height || 160) : ''}
      </div>` : '';
    return `<div class="cmp">${side(e.left)}${side(e.right)}</div>`;
  }
  return '';
}
const iframe = (slug, path, h) =>
  `<iframe class="mock" loading="lazy" sandbox="allow-scripts allow-popups" src="${esc(fileUrl(slug, path))}" style="height:${Number(h) || 220}px"></iframe>`;
