// End of plan mode (ExitPlanMode): the plan, approved in the mode chosen here (as in the terminal), or sent back to
// keep planning, with an optional clarification.
import { esc, markdown } from '../../core/dom.js';
import { current } from '../../core/state.js';
import { modeLabel } from '../../core/modes.js';
import { answer } from '../../services/sessions.js';
import { t } from '../../i18n/index.js';

export function planCard(ev) {
  const plan = `<div class="plan-body">${markdown(ev.plan || '')}</div>`;
  if (ev.state !== 'pending') {
    const a = ev.answer;
    const head = ev.state === 'cancelled' ? t('cards.plan.cancelled')
      : a?.mode ? t('cards.plan.approved', { mode: esc(modeLabel(a.mode)) }) : t('cards.plan.keptPlanning');
    return `<div class="card past"><details><summary><span class="m">${head}</span>${a?.clarification ? ` <span class="m">· ${esc(a.clarification)}</span>` : ''}</summary>${plan}</details></div>`;
  }
  // Mode before the plan first, then "accept edits" and "ask" (as in the terminal), then keep planning
  const modes = [ev.back || 'all', 'edits', 'ask'].filter((m, i, all) => all.indexOf(m) === i);
  return `<div class="card active plan">
    <div class="q">${t('cards.plan.question')}</div>
    ${plan}
    <input class="clarification" placeholder="${t('cards.plan.clarification')}">
    <div class="choices">
      ${modes.map((m, i) => `<button class="btn ${i ? '' : 'on'}" data-mode="${m}">${esc(t(i ? 'cards.plan.approveIn' : 'cards.plan.approveBack', { mode: modeLabel(m) }))}</button>`).join('')}
      <button class="btn" data-mode="">${t('cards.plan.keepPlanning')}</button>
    </div>
  </div>`;
}

export function attachPlan(el, ev) {
  if (ev.state !== 'pending') return;
  el.querySelectorAll('[data-mode]').forEach(b => b.addEventListener('click', async () => {
    const clarification = el.querySelector('.clarification').value.trim();
    try { await answer(current(), ev.id, { mode: b.dataset.mode || null, clarification }); } catch (e) { alert(e.message); }
  }));
}
