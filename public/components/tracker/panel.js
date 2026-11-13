// Tracker tab of the right panel (called by mountSide, which provides the tab bar). It reads no signal
// other than `detail` (through what mountSide passes it): otherwise the whole panel would redraw.
import { $, esc, toast } from '../../core/dom.js';
import { removeSession, reportSchema } from '../../services/sessions.js';
import { renderMermaid } from '../mermaid.js';
import { rerenderSide } from '../side/tabs.js';
import { t } from '../../i18n/index.js';
import { trackerHtml, markSeen, sectionChanged, sectionKeys } from './renderers.js';

/** Tracker tab of the right panel (called by mountSide, which provides the tab bar `bar`). */
export function renderTracker(d, bar) {
  const html = trackerHtml(d);

  const y = $('#right').scrollTop;
  $('#right').innerHTML = bar + html;
  $('#right').scrollTop = y;
  // A diagram that does not render is sent back to Claude, who fixes it (the engine reports it only once)
  document.querySelectorAll('#right .mermaid').forEach(el => renderMermaid(el, e => reportSchema(d.slug, el.dataset.block, el.dataset.src, e.message).catch(() => {})));
  // A click in a changed section marks it as seen (after the click, so as not to get in the way of a link or a button).
  $('#right').querySelectorAll('[data-key]').forEach(s => s.addEventListener('click', () => {
    if (!sectionChanged(s.dataset.key)) return;
    markSeen([s.dataset.key]);
    setTimeout(() => rerenderSide());
  }));
  $('#all-seen')?.addEventListener('click', () => { markSeen(sectionKeys()); rerenderSide(); });
  $('#right').querySelectorAll('[data-enlarge]').forEach(b => b.addEventListener('click', () => {
    const full = document.createElement('div');
    full.className = 'full';
    full.innerHTML = `<button class="btn close">${t('tracker.close')}</button><div class="mermaid" data-src="${esc(b.closest('section').querySelector('.mermaid')?.dataset.src || '')}"></div>`;
    document.body.append(full);
    full.querySelector('.close').onclick = () => full.remove();
    renderMermaid(full.querySelector('.mermaid'));
  }));
  $('#remove').addEventListener('click', async () => {
    if (!confirm(d.driven ? t('tracker.archiveConfirmDriven', { title: d.title || d.slug }) : t('tracker.archiveConfirm', { title: d.title || d.slug }))) return;
    await removeSession(d.slug);
    location.hash = '';
    toast(t('tracker.archived', { title: d.title || d.slug }));
  });
}
