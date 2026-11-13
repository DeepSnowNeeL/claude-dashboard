// Content of the tracker panel: the blocks of the session's tracker profile and the "fresh" marks (what changed
// since the last read, kept per session in the browser).
import { esc, rich } from '../../core/dom.js';
import { read, write } from '../../core/storage.js';
import { t } from '../../i18n/index.js';
import { example } from '../cards/example.js';
import { trackerLink, imageSrc, compositeHtml } from './compose.js';
import { mockup } from './mockup.js';

const OPS = { '+': ['add', '+'], '~': ['mod', '~'], '-': ['del', '−'] };
const op = o => { const [c, s] = OPS[o] || OPS['~']; return `<span class="op ${c}">${s}</span>`; };

// What changed since the last read: one fingerprint per section and per element, kept per session in the
// browser. A changed section carries a badge, a new or changed element is highlighted; a click on the
// section marks it as seen.
const seenKey = slug => `dash-seen-${slug}`;
function readSeen(slug) { return read(seenKey(slug), null); }
function writeSeen(slug, seen) { write(seenKey(slug), seen); }
const fingerprint = v => JSON.stringify(v ?? null);

// --- Tracker: the panel draws the blocks of the session's tracker profile (trackers.mjs on the server side) -------
// The profile comes with the session (`d.tracker`); without it (engine from before profiles), the dev tracker.
const fallbackProfile = () => ({ id: 'dev', name: t('tracker.fallback.name'), blocks: [
  { key: 'progress', type: 'progress' }, { key: 'approach', type: 'approach', title: t('tracker.fallback.approach') },
  { sideBySide: [{ key: 'keyPoints', type: 'list', title: t('tracker.fallback.keyPoints') }, { key: 'tradeoffs', type: 'list', title: t('tracker.fallback.tradeoffs') }] },
  { key: 'mockups', type: 'mockups', title: t('tracker.fallback.mockups') }, { key: 'architecture', type: 'architecture', title: t('tracker.fallback.architecture') },
  { key: 'db', type: 'db', title: t('tracker.fallback.db') }] });
const TYPES_WITH_TITLE = ['progress', 'approach', 'images', 'files', 'mermaid', 'mockups', 'architecture', 'db'];
export const trackerProfile = d => (d.tracker?.profile?.blocks?.length ? d.tracker.profile : fallbackProfile());
const blocksOf = profile => profile.blocks.flatMap(b => b.sideBySide || [b]);
/** Title of a block; `{n}` = number of elements in its data. */
function blockTitle(b, profile, v) {
  const title = b.title || (TYPES_WITH_TITLE.includes(b.type) ? t(`tracker.types.${b.type}`) : b.key);
  return title.replace('{n}', Array.isArray(v) ? v.length : Array.isArray(v?.rows) ? v.rows.length : 0);
}
/** Elements of a block tracked one by one by the blue marking (an added point, a table row, an architecture element). */
function trackedElements(b, v) {
  if (b.type === 'architecture') return (v?.layers || []).flatMap(c => c.elements || []);
  if (b.type === 'approach') return v?.alternatives || [];
  if (b.type === 'table') return v?.rows || [];
  return Array.isArray(v) ? v : [];
}


/** Content of a block by type, or '' if it has nothing to show. */
const RENDERERS = {
  list: (v, b) => Array.isArray(v) && v.length ? `<ul class="list">${v.map(x => `<li class="${fresh(b.key, x)}">${rich(x)}</li>`).join('')}</ul>` : '',
  text: v => (typeof v === 'string' && v.trim() ? `<div>${rich(v)}</div>` : ''),
  checklist: (v, b) => Array.isArray(v) && v.length ? `<ul class="checklist">${v.map(x => `<li class="${x?.done ? 'done' : ''}${fresh(b.key, x)}">${x?.done ? '☑' : '☐'} ${rich(x?.label || '')}</li>`).join('')}</ul>` : '',
  approach: (a, b) => a?.chosen ? `<div class="chosen"><b>${rich(a.chosen)}</b>
      ${a.why ? `<div class="m">${rich(a.why)}</div>` : ''}
      ${a.alternatives?.length ? `<div class="m" style="margin-top:8px">${t('tracker.alternatives')}</div>
        <ul class="list">${a.alternatives.map(x => `<li class="${fresh(b.key, x)}"><b>${rich(x.name)}</b> : ${rich(x.reason)}</li>`).join('')}</ul>` : ''}</div>` : '',
  images: (v, b) => Array.isArray(v) && v.length ? `<div class="gallery">${v.map(x => {
    const src = imageSrc(x);
    return `<figure class="thumbnail${fresh(b.key, x)}">${src ? `<a ${x.path ? `class="path" data-path="${esc(x.path)}"` : `href="${esc(src)}" target="_blank" rel="noopener"`}><img src="${esc(src)}" alt="${esc(x.caption || '')}" loading="lazy"></a>` : ''}
      ${x.caption || x.path ? `<figcaption>${esc(x.caption || String(x.path).split(/[\\/]/).pop())}</figcaption>` : ''}</figure>`;
  }).join('')}</div>` : '',
  files: (v, b) => Array.isArray(v) && v.length ? `<div class="tracker-files">${v.map(x => `<div class="${fresh(b.key, x)}">
      <span>${x?.url ? '🔗' : '📄'} ${trackerLink(x, x?.label)}</span>${x?.note ? `<span class="m">${rich(x.note)}</span>` : ''}</div>`).join('')}</div>` : '',
  table: (v, b) => Array.isArray(v?.rows) && v.rows.length ? `<div class="tracker-table"><table>
      ${Array.isArray(v.columns) ? `<tr>${v.columns.map(c => `<th>${rich(c)}</th>`).join('')}</tr>` : ''}
      ${v.rows.map(l => `<tr class="${fresh(b.key, l)}">${(Array.isArray(l) ? l : [l]).map(c => `<td>${rich(String(c ?? ''))}</td>`).join('')}</tr>`).join('')}</table></div>` : '',
  code: v => (v?.code ? `<pre class="code">${esc(v.code)}</pre>` : ''),
  mermaid: (v, b) => (v?.source ? `<div class="mermaid" data-block="${esc(b.key)}" data-src="${esc(v.source)}"></div>${v.notes ? `<div class="m">${rich(v.notes)}</div>` : ''}` : ''),
  mockups: (v, b, d) => Array.isArray(v) && v.length ? v.map(m => `<div class="${fresh(b.key, m)}">${mockup(d.slug, m)}</div>`).join('') : '',
  architecture: (v, b, d) => v?.layers?.length ? `
      <div class="layers">${v.layers.map(c => `<div class="layer ${c.wide ? 'wide' : ''}"><div class="ln">${esc(c.name)}</div>
        ${(c.elements || []).map(el => `<div class="el${fresh(b.key, el)}">${op(el.op)}<div>
          <span class="name">${esc(el.name)}</span>
          ${el.example ? example(el.example, d.slug) : ''}
          ${el.detail ? `<div class="det">${rich(el.detail)}</div>` : ''}
          ${asList(el.usedIn).length ? `<div>${asList(el.usedIn).map(u => `<span class="chip">${esc(u)}</span>`).join('')}</div>` : ''}
        </div></div>`).join('')}
      </div>`).join('')}</div>` : '',
  db: (v, b) => (v?.mermaid ? `
      <div class="m legend">${op('+')}${t('tracker.db.added')} ${op('~')}${t('tracker.db.modified')} ${op('-')}${t('tracker.db.deleted')} · ${t('tracker.db.unmarked')}</div>
      <div class="mermaid" data-block="${esc(b.key)}" data-src="${esc(v.mermaid)}"></div>
      ${v.notes ? `<div class="m">${rich(v.notes)}</div>` : ''}` : ''),
};
/** One block of the profile, frame and title included, or '' if it is empty. */
function trackerBlockHtml(b, d, profile) {
  const v = d[b.key];
  if (b.type === 'progress') {
    return Array.isArray(v) && v.length ? `<div class="progress" data-key="${esc(b.key)}">${v.map(x => `<span class="${esc(x.state)}${fresh(b.key, x)}">${STATE_ICON[x.state] || '○'} ${rich(x.label)}</span>`).join('')}</div>` : '';
  }
  const composite = profile.types?.[b.type];
  const content = composite ? compositeHtml(composite, v, b, fresh) : (RENDERERS[b.type] || (() => ''))(v, b, d);
  let title = esc(blockTitle(b, profile, v));
  if (b.type === 'architecture' && v?.level) title += ` <span class="m">· ${t('tracker.level', { level: esc(v.level) })}</span>`;
  if (b.type === 'db') title += ` <span class="m">· ${t('tracker.db.partial')}</span>`;
  if (b.type === 'db' || b.type === 'mermaid') title += ` <button class="btn enlarge" data-enlarge>${t('tracker.enlarge')}</button>`;
  return block(title, content, b.type === 'architecture' ? 'archi' : b.type === 'db' ? 'db' : '', b.key);
}

/** The tracked sections and their elements (to highlight an added point or a changed architecture element). */
function seenSections(d) {
  return Object.fromEntries(blocksOf(trackerProfile(d)).map(b => [b.key, { v: d[b.key], items: trackedElements(b, d[b.key]) }]));
}
function snapshot(s) {
  return { v: fingerprint(s.v), items: s.items.map(fingerprint) };
}

let seenState = { seen: {}, sections: {} };
function prepareSeen(d) {
  const sections = seenSections(d);
  let seen = readSeen(d.slug);
  if (!seen) { // first opening: nothing is "new"
    seen = Object.fromEntries(Object.entries(sections).map(([k, s]) => [k, snapshot(s)]));
    writeSeen(d.slug, seen);
  }
  seenState = { slug: d.slug, seen, sections };
}
export const sectionChanged = key => seenState.sections[key] && fingerprint(seenState.sections[key].v) !== (seenState.seen[key]?.v ?? 'null');
const itemIsFresh = (key, item) => sectionChanged(key) && !(seenState.seen[key]?.items || []).includes(fingerprint(item));
const fresh = (key, item) => itemIsFresh(key, item) ? ' fresh' : '';
export function markSeen(keys) {
  for (const k of keys) if (seenState.sections[k]) seenState.seen[k] = snapshot(seenState.sections[k]);
  writeSeen(seenState.slug, seenState.seen);
}

function block(title, content, id = '', key = '') {
  if (!content) return '';
  const changed = key && sectionChanged(key);
  const badge = changed ? `<span class="badge-updated">${seenState.seen[key]?.v && seenState.seen[key].v !== 'null' ? t('tracker.badgeModified') : t('tracker.badgeNew')}</span>` : '';
  return `<section class="block${changed ? ' changed' : ''}" ${id ? `id="${id}"` : ''} ${key ? `data-key="${esc(key)}"` : ''}><h3>${title}${badge}</h3>${content}</section>`;
}

/** A list is expected, but Claude sometimes sends a string "a, b, c". */
const asList = v => Array.isArray(v) ? v : typeof v === 'string' && v.trim() ? v.split(/\s*,\s*/) : [];

const STATE_ICON = { done: '✓', working: '⏳', todo: '○' };

/** Keys of the tracked sections of the displayed session (for "mark all as seen"). */
export const sectionKeys = () => Object.keys(seenState.sections);

// Where the profile comes from (tracker.source value → dictionary key)
const SOURCES = { preview: 'preview', 'install-repo': 'installRepo', repo: 'repo', installation: 'installation', 'built-in': 'builtIn' };

/** HTML of the tracker tab (without the tab bar): banner of the changed sections, profile blocks, footer. */
export function trackerHtml(d) {
  const profile = trackerProfile(d);
  prepareSeen(d);
  // A section emptied or cleared has nothing to display, so nothing to click on: it is seen right away, otherwise
  // the "updated" banner would stay with no way to make it go away.
  const rendered = Object.fromEntries(blocksOf(profile).map(b => [b.key, trackerBlockHtml(b, d, profile)]));
  const invisible = Object.keys(seenState.sections).filter(k => sectionChanged(k) && !rendered[k]);
  if (invisible.length) markSeen(invisible);
  const changed = Object.keys(seenState.sections).filter(sectionChanged);
  const body = profile.blocks.map(b => b.sideBySide ? `<div class="duo" style="--cols:${b.sideBySide.length}">${b.sideBySide.map(x => rendered[x.key]).join('')}</div>` : rendered[b.key]).join('');
  // Where the profile comes from (the first file found, see trackers.mjs); the file path as a tooltip
  const source = SOURCES[d.tracker?.source] ? t(`tracker.source.${SOURCES[d.tracker.source]}`) : '';
  return `
    <div class="tracker-profile${d.tracker?.source === 'preview' ? ' preview' : ''}" title="${esc([profile.description, d.tracker?.file].filter(Boolean).join('\n'))}">${t('tracker.profileLabel')} <b>${esc(profile.name)}</b>${source ? ` · ${esc(source)}` : ''}</div>
    ${changed.length ? `<div class="update-banner">● ${t('tracker.sectionsUpdated', { n: changed.length })} <button class="btn" id="all-seen">${t('tracker.markAllSeen')}</button></div>` : ''}
    ${body.trim() ? body : `<p class="m">${t('tracker.emptyPanel', { blocks: esc(blocksOf(profile).map(b => blockTitle(b, profile, null).toLowerCase()).filter(Boolean).join(', ')) })}</p>`}
    ${profile.id === 'simple' ? `<div class="custom-tracker">${t('tracker.customizeHint', { cmd: '<code>/tracker</code>' })}</div>` : ''}
    <div class="footer"><button class="btn" id="remove" title="${t('tracker.archiveTitle')}">${t('tracker.archive')}</button></div>`;
}
