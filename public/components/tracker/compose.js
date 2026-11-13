// Composite types of the tracker profile (list of objects with typed fields) and links / images of the tracker.
import { esc, rich, safeUrl } from '../../core/dom.js';
import { localFileUrl } from '../../services/desktop.js';

/** Link to a path (path menu on click) or a URL (new tab). */
export function trackerLink(x, label) {
  if (x?.path) return `<a class="path" data-path="${esc(x.path)}" title="${esc(x.path)}">${esc(label || String(x.path).split(/[\/]/).pop())}</a>`;
  const u = safeUrl(x?.url);
  return u ? `<a href="${esc(u)}" target="_blank" rel="noopener">${esc(label || u.replace(/^https?:\/\//, ''))}</a>` : esc(label || '');
}
/** Source of an image: project path (served by the page) or https URL (http would be blocked in remote access). */
export const imageSrc = x => (x?.path ? localFileUrl(x.path) : /^https:\/\//i.test(String(x?.url || '')) ? x.url : null);
/** Field of a composite type (text, date, image, link, file): URL if it starts with http, otherwise absolute path. */
const toTarget = s => (/^https?:\/\//i.test(String(s || '')) ? { url: s } : s ? { path: s } : null);

/** Composite type of the profile: list of objects with typed fields, as cards, timeline or rows (`fresh`: "new" mark of the tracker). */
export function compositeHtml(type, v, b, fresh) {
  if (!Array.isArray(v) || !v.length) return '';
  const field = (c, o) => {
    const x = o?.[c.key];
    if (x == null || x === '') return '';
    if (c.type === 'image') { const src = imageSrc(toTarget(x)); return src ? `<img src="${esc(src)}" alt="" loading="lazy">` : ''; }
    if (c.type === 'link' || c.type === 'file') return trackerLink(toTarget(x));
    if (c.type === 'date') return `<span class="date">${esc(x)}</span>`;
    return rich(String(x));
  };
  const images = type.fields.filter(c => c.type === 'image'), others = type.fields.filter(c => c.type !== 'image');
  if (type.layout === 'cards') return `<div class="tracker-cards">${v.map(o => `<div class="tracker-card${fresh(b.key, o)}">${images.map(c => field(c, o)).join('')}<div>${others.map(c => field(c, o)).filter(Boolean).join('<br>')}</div></div>`).join('')}</div>`;
  if (type.layout === 'timeline') return `<div class="tracker-timeline">${v.map(o => `<div class="${fresh(b.key, o)}">${others.map(c => field(c, o)).filter(Boolean).join(' ')}${images.map(c => field(c, o)).join('')}</div>`).join('')}</div>`;
  return `<div class="tracker-rows">${v.map(o => `<div class="${fresh(b.key, o)}">${type.fields.map(c => field(c, o)).filter(Boolean).join(' · ')}</div>`).join('')}</div>`;
}
