// Tool permission: Allow / Deny, with an optional clarification.
import { esc } from '../../core/dom.js';
import { current } from '../../core/state.js';
import { answer } from '../../services/sessions.js';
import { t } from '../../i18n/index.js';

export function permissionCard(ev) {
  if (ev.state !== 'pending') {
    const ok = ev.answer?.allow;
    return `<div class="card past"><span class="m">${ev.state === 'cancelled' ? t('cards.permission.cancelled') : ok ? t('cards.permission.allowed') : t('cards.permission.denied')}</span> <b>${esc(ev.tool)}</b> <code>${esc(ev.summary)}</code>${ev.answer?.clarification ? ` <span class="m">· ${esc(ev.answer.clarification)}</span>` : ''}</div>`;
  }
  return `<div class="card active permission">
    <div class="q">${t('cards.permission.question', { tool: `<code>${esc(ev.tool)}</code>` })}</div>
    <pre class="code">${esc(ev.summary)}</pre>
    <input class="clarification" placeholder="${t('cards.permission.clarification')}">
    <div class="choices"><button class="btn on" data-allow="1">${t('cards.permission.allow')}</button><button class="btn" data-allow="0">${t('cards.permission.deny')}</button></div>
  </div>`;
}
export function attachPermission(el, ev) {
  if (ev.state !== 'pending') return;
  el.querySelectorAll('[data-allow]').forEach(b => b.addEventListener('click', async () => {
    const clarification = el.querySelector('.clarification').value.trim();
    try { await answer(current(), ev.id, { allow: b.dataset.allow === '1', clarification }); } catch (e) { alert(e.message); }
  }));
}
