// DOM and text utilities, with no state of their own (the session folder and the projects come from state.js).
import { relativeDir, projects } from './state.js';
import { t, locale } from '../i18n/index.js';

export const $ = s => document.querySelector(s);

/** Small confirmation message at the bottom of the screen, which fades away by itself. */
export function toast(text) {
  const el = document.createElement('div');
  el.className = 'toast';
  el.textContent = `✓ ${text}`;
  document.body.append(el);
  requestAnimationFrame(() => el.classList.add('on'));
  setTimeout(() => { el.classList.remove('on'); setTimeout(() => el.remove(), 300); }, 2600);
}

export const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

/** Markdown subset: headings, **bold**, `code`, ``` blocks, "- " lists, line breaks. Everything else is escaped. */
export function rich(s) {
  if (!s) return '';
  return String(s).split(/```(\w*)\n?([\s\S]*?)```/g).map((part, i) => {
    if (i % 3 === 1) return '';
    if (i % 3 === 2) return `<pre class="code">${esc(part.replace(/\n$/, ''))}</pre>`;
    const inline = x => pathLinks(esc(x)).replace(/`([^`]+)`/g, '<code>$1</code>').replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>');
    let html = '', items = [];
    const flush = () => { if (items.length) { html += `<ul class="list">${items.join('')}</ul>`; items = []; } };
    part.split('\n').forEach((l, j, all) => {
      if (/^\s*[-*] /.test(l)) { items.push(`<li>${inline(l.replace(/^\s*[-*] /, ''))}</li>`); return; }
      flush();
      if (/^#{1,4} /.test(l)) { html += `<b>${inline(l.replace(/^#+ /, ''))}</b><br>`; return; }
      html += inline(l) + (j < all.length - 1 && l !== '' ? '<br>' : '');
    });
    flush();
    return html;
  }).join('');
}

/**
 * Markdown of the feed messages: headings, paragraphs, `>` quotes, bulleted or numbered lists (nested by
 * indentation), tables, ``` blocks, `---` line, and inline `code`, **bold**, *italic*, ~~strikethrough~~, [link](url).
 * Everything else is escaped; paths stay clickable.
 */
export function markdown(s) {
  if (!s) return '';
  return mdBlocks(String(s).replace(/\r\n?/g, '\n').split('\n'));
}

const RE_LIST = /^(\s*)([-*+]|\d{1,3}[.)])\s+(.*)$/;
const RE_TABLE_SEP = /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/;
const cells = l => l.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map(c => c.trim());

function mdBlocks(lines) {
  let html = '', para = [];
  const endPara = () => { if (para.length) { html += `<p>${para.map(mdInline).join('<br>')}</p>`; para = []; } };
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i];
    let m;
    if ((m = l.match(/^\s*(```+|~~~+)\s*([\w+#.-]*)/))) { // code block, up to the closing fence (or the end)
      endPara();
      const code = [];
      while (++i < lines.length && !lines[i].trim().startsWith(m[1])) code.push(lines[i]);
      html += `<pre class="code">${esc(code.join('\n'))}</pre>`;
    } else if (!l.trim()) endPara();
    else if ((m = l.match(/^\s{0,3}(#{1,6})\s+(.*?)\s*#*\s*$/))) { endPara(); const n = Math.min(m[1].length + 2, 6); html += `<h${n}>${mdInline(m[2])}</h${n}>`; }
    else if (/^\s{0,3}([-*_])(\s*\1){2,}\s*$/.test(l)) { endPara(); html += '<hr>'; }
    else if (/^\s{0,3}>/.test(l)) {
      endPara();
      const quote = [];
      for (; i < lines.length && /^\s{0,3}>/.test(lines[i]); i++) quote.push(lines[i].replace(/^\s{0,3}> ?/, ''));
      i--;
      html += `<blockquote>${mdBlocks(quote)}</blockquote>`;
    } else if (l.includes('|') && RE_TABLE_SEP.test(lines[i + 1] || '')) {
      endPara();
      const head = cells(l);
      const body = [];
      for (i += 2; i < lines.length && lines[i].includes('|') && lines[i].trim(); i++) body.push(cells(lines[i]));
      i--;
      html += `<div class="md-table"><table><thead><tr>${head.map(c => `<th>${mdInline(c)}</th>`).join('')}</tr></thead>`
        + `<tbody>${body.map(r => `<tr>${head.map((_, k) => `<td>${mdInline(r[k] ?? '')}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`;
    } else if (RE_LIST.test(l)) {
      endPara();
      const items = [], [, ind0, bullet0] = l.match(RE_LIST);
      const otherList = m => m && m[1].length <= ind0.length && /\d/.test(m[2]) !== /\d/.test(bullet0); // bullets ↔ numbers
      for (; i < lines.length; i++) {
        const li = lines[i];
        if (otherList(li.match(RE_LIST))) break;
        if (RE_LIST.test(li) || (li.trim() && /^\s/.test(li) && items.length)) items.push(li);
        else if (!li.trim() && RE_LIST.test(lines[i + 1] || '')) continue; // blank line between two items
        else break;
      }
      i--;
      html += mdList(items);
    } else para.push(l);
  }
  endPara();
  return html;
}

/** A list and its sublists: an item more indented than the first one belongs to the item before it. */
function mdList(lines) {
  const base = lines[0].match(RE_LIST);
  const indent = base[1].length;
  const ol = /\d/.test(base[2]);
  const items = [];
  for (const l of lines) {
    const m = l.match(RE_LIST);
    if (m && m[1].length <= indent) items.push({ text: [m[3]], sub: [] });
    else if (m) items.at(-1).sub.push(l);
    else if (items.at(-1).sub.length) items.at(-1).sub.push(l);
    else items.at(-1).text.push(l.trim());
  }
  const start = ol && parseInt(base[2], 10) !== 1 ? ` start="${parseInt(base[2], 10)}"` : '';
  const body = items.map(it => `<li>${it.text.map(mdInline).join('<br>')}${it.sub.length ? mdList(it.sub) : ''}</li>`).join('');
  return ol ? `<ol${start}>${body}</ol>` : `<ul>${body}</ul>`;
}

/** Inline: `code` and [links](url) set aside first, so that neither bold nor paths touch them. */
function mdInline(s) {
  const pieces = [];
  const keep = h => `\u0000${pieces.push(h) - 1}\u0000`;
  s = s.replace(/(`+)([^`]|[^`][\s\S]*?[^`])\1(?!`)/g, (_, __, code) => keep(`<code>${pathLinks(esc(code.trim()))}</code>`))
    .replace(/\[([^\]\n]+)\]\((https?:\/\/[^\s)]+)\)/g, (_, txt, url) => keep(`<a href="${esc(url)}" target="_blank" rel="noopener">${esc(txt)}</a>`));
  return pathLinks(esc(s))
    .replace(/\*\*(?=\S)([^*]+?)\*\*/g, '<b>$1</b>')
    .replace(/(?<![\w*])\*(?=[^\s*])([^*\n]+?)\*(?![\w*])/g, '<i>$1</i>')
    .replace(/(?<![\w\\/])_(?=\S)([^_\n]+?)_(?![\w\\/])/g, '<i>$1</i>')
    .replace(/~~(?=\S)([^~\n]+?)~~/g, '<s>$1</s>')
    .replace(/\u0000(\d+)\u0000/g, (_, n) => pieces[n]);
}

// --- Clickable paths: "E:\…\file.ext" or "C:/…:42" in an already escaped text -----------------
// A click offers to open it in a tab (if the browser can display it) or to show it in the file explorer.

// Four forms, in order: a file:/// URL (brought back to the disk path), a URL (real link), an absolute Windows path, a path relative to the
// session folder (at least one "/" and an extension, so as not to catch any word: docs/specs/x.md, ./a/b.ts).
// Absolute path with spaces ("…\RAPPORT APPLICATION - essai.pdf"): accepted only if it ends with an
// extension followed by the end of a sentence, otherwise we stop at the first space so as not to swallow the rest of the text.
const RE_PATH = new RegExp([
  /file:\/\/\/?([A-Za-z]:\/[^\s<>"'`]*[^\s<>"'`.,;:)\]])/.source, // file:///E:/…: URL-encoded path (%23 for #)
  /(https?:\/\/[^\s<>"'`&*]*[^\s<>"'`&*.,;:)\]])/.source, // without "*": "**http://…**" stays bold
  /\b([A-Za-z]:[\\/](?:(?:[^\\/\n<>"'`|*?&:]+[\\/])*[^\\/\n<>"'`|*?&:]*?\.[A-Za-z0-9]{1,8}(?=[.,;:!?)\]`*]*(?:\s|$|<|&))|[^\s<>"'`|*?&:]*[^\s<>"'`|*?&:.,;)\]]))(:\d+(?::\d+)?)?/.source,
  /(?<![\w.\/\\:-])((?:\.{1,2}[\\/])?[\w@.-]+(?:[\\/][\w@#.-]+)+\.[A-Za-z0-9]{1,8})(:\d+(?::\d+)?)?(?![\w\/\\])/.source,
].join('|'), 'g');
export const pathLinks = html => html.replace(RE_PATH, (all, file, url, abs, absLine = '', rel, relLine = '') => {
  if (file) {
    let c = file.replace(/&amp;/g, '&');
    try { c = decodeURIComponent(c); } catch { /* lone %: kept as is */ }
    c = esc(c.replace(/\//g, '\\'));
    return `<a class="path" data-path="${c}" title="${c}">${c}</a>`;
  }
  if (url) return `<a href="${url}" target="_blank" rel="noopener">${url}</a>`;
  const path = abs || (relativeDir() && `${relativeDir().replace(/[\\/]+$/, '')}\\${rel.replace(/^\.[\\/]/, '').replace(/\//g, '\\')}`);
  if (!path) return all;
  return `<a class="path" data-path="${path}" title="${path}">${abs || rel}${abs ? absLine : relLine}</a>`;
});

export function timeAgo(iso) {
  if (!iso) return '';
  const min = Math.round((Date.now() - new Date(iso)) / 60000);
  if (min < 1) return t('common.time.justNow');
  if (min < 60) return t('common.time.minutesAgo', { n: min });
  if (min < 1440) return t('common.time.hoursAgo', { n: Math.round(min / 60) });
  return t('common.time.daysAgo', { n: Math.round(min / 1440) });
}

/** Same path key as the server (projects.mjs): unified separators, no trailing slash, case-insensitive on Windows. */
const pathKey = p => { const n = String(p || '').replace(/\\/g, '/').replace(/\/+$/, ''); return /^[a-z]:/i.test(n) ? n.toLowerCase() : n; };

/** URL usable in an href: http(s) only (never javascript:, data:…), otherwise null. */
export const safeUrl = u => (/^https?:\/\/[^\s]/i.test(String(u || '').trim()) ? String(u).trim() : null);

/**
 * Ticket link: the one given by the session, otherwise built from the `ticketUrl` template of its project
 * (project meta, `{n}` replaced by the ticket number).
 */
export function ticketLink(d) {
  if (d.ticketUrl) return safeUrl(d.ticketUrl);
  const n = String(d.ticket || '').replace(/\D/g, '');
  if (!n) return null;
  const c = pathKey(d.cwd);
  const project = c && projects().find(p => p.worktrees?.some(w => c === w.id || c.startsWith(w.id + '/')));
  return project?.ticketUrl ? safeUrl(project.ticketUrl.replaceAll('{n}', n)) : null;
}

/** Date to come: "in 12 min", "at 14:30", or the day and time. `bare`: without "in" for the first form ("12 min"). */
export function formatWhen(iso, bare = false) {
  const d = new Date(iso);
  const min = Math.round((d - Date.now()) / 60000);
  if (min < 60) return t(bare ? 'common.time.minutes' : 'common.time.inMinutes', { n: Math.max(min, 0) });
  if (min < 1440) return t('common.time.atTime', { time: d.toLocaleTimeString(locale(), { hour: '2-digit', minute: '2-digit' }) });
  return d.toLocaleDateString(locale(), { weekday: 'short', hour: '2-digit', minute: '2-digit' });
}

/** Name of a session: `ticket · title`, or the title alone. */
export const displayName = d => (d.ticket ? `${esc(d.ticket)} · ${esc(d.title)}` : esc(d.title));

// Loading skeletons: the grey (animated) shape of what is coming, in its place, rather than a page that does not move.
const bars = (widths, cls = '') => widths.map(w => `<i class="${cls}" style="width:${w}%"></i>`).join('');
const SKELETONS = {
  // Conversation: a sent message, an answer, a tool line, another answer
  feed: () => `<div class="skeleton f-feed">
    <div class="f-user">${bars([100, 60])}</div>
    <div class="f-claude">${bars([96, 88, 70])}</div>
    <div class="f-tool">${bars([38])}</div>
    <div class="f-claude">${bars([92, 54])}</div>
    <div class="f-user">${bars([100])}</div></div>`,
  // Tracker panel: sections, a title then a few lines
  panel: () => `<div class="skeleton f-panel">${[[90, 70], [85, 95, 60], [75, 50]].map(l => `<div class="f-section">${bars([40], 'f-title')}${bars(l)}</div>`).join('')}</div>`,
  // List (files, commits, history, servers…): lines of varied lengths
  lines: n => `<div class="skeleton f-lines">${bars([82, 64, 90, 55, 74, 68, 86, 48].slice(0, n || 6))}</div>`,
  // Code (editor): indented lines
  code: () => `<div class="skeleton f-code">${[[0, 40], [4, 62], [8, 50], [8, 70], [4, 30], [0, 18], [0, 55], [4, 66]].map(([m, l]) => `<i style="margin-left:${m}%;width:${l}%"></i>`).join('')}</div>`,
};
/** Animated grey template of what is loading: 'feed', 'panel', 'lines' (n lines) or 'code'. */
export const skeleton = (form = 'lines', n) => SKELETONS[form](n);
/** A whole session loading (center): its title if already known, the header and the feed as skeletons. */
export const sessionSkeleton = title => `<div class="head"><div class="title">${title ? esc(title) : '<span class="skeleton"><i style="width:220px;height:16px"></i></span>'}</div>
  <div class="skeleton f-steps">${bars([14, 16, 20, 18, 12])}</div></div>
  <div class="feed">${skeleton('feed')}</div>`;

// --- Durations: running agents and shells ------------------------------------------------------------
/** Short duration: "42 s", "3 min 05", "1 h 12". */
export function shortDuration(ms) {
  const s = Math.max(0, Math.round(ms / 1000));
  if (s < 60) return `${s} s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m} min ${String(s % 60).padStart(2, '0')}`;
  return `${Math.floor(m / 60)} h ${String(m % 60).padStart(2, '0')}`;
}
/** Duration of an agent or a shell: frozen once finished, otherwise a counter that `tickChronos` advances every second. */
export const chrono = (start, end, durationMs) => !start ? ''
  : end || durationMs != null ? `<span class="chrono">${shortDuration(durationMs ?? end - start)}</span>`
  : `<span class="chrono" data-start="${Number(start)}">${shortDuration(Date.now() - start)}</span>`;
export function tickChronos() {
  setInterval(() => document.querySelectorAll('.chrono[data-start]').forEach(el => { el.textContent = shortDuration(Date.now() - Number(el.dataset.start)); }), 1000);
}
