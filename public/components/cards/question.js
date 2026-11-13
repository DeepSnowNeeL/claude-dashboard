// AskUserQuestion: clickable options, a clarification per question, nothing is sent before "Answer".
import { esc, rich } from '../../core/dom.js';
import { current } from '../../core/state.js';
import { answer } from '../../services/sessions.js';
import { t } from '../../i18n/index.js';

export function questionCard(ev) {
  if (ev.state !== 'pending') {
    const rep = ev.answer?.answers || {};
    return `<div class="card past"><div class="q">${ev.state === 'cancelled' ? t('cards.question.cancelled') : t('cards.question.title')}</div>
      ${ev.questions.map(q => `<div>${rich(q.question)}${rep[q.question] ? ` <span class="m">→ ${esc(rep[q.question])}</span>` : ''}</div>`).join('')}</div>`;
  }
  return `<div class="card active question">${ev.questions.map((q, i) => `
    <div class="question-block" data-i="${i}">
      <div class="q">${rich(q.question)} ${q.multiSelect ? `<span class="m">${t('cards.question.multiSelect')}</span>` : ''}</div>
      <div class="choices">${q.options.map((o, j) => `<button class="btn" data-opt="${j}" title="${esc(o.description || '')}">${esc(o.label)}</button>`).join('')}</div>
      ${q.options.some(o => o.description) ? `<div class="m">${q.options.map(o => `<b>${esc(o.label)}</b> : ${esc(o.description || '')}`).join(' · ')}</div>` : ''}
      <input class="clarification" placeholder="${t('cards.clarificationPlaceholder')}">
    </div>`).join('')}
    <div class="bar"><span class="m">${t('cards.question.hint')}</span><button class="btn on" data-reply>${t('cards.question.reply')}</button></div>
  </div>`;
}
export function attachQuestion(el, ev) {
  if (ev.state !== 'pending') return;
  el.querySelectorAll('.question-block').forEach(b => {
    const multi = ev.questions[b.dataset.i].multiSelect;
    b.querySelectorAll('[data-opt]').forEach(o => o.addEventListener('click', () => {
      if (!multi) b.querySelectorAll('[data-opt]').forEach(x => x.classList.toggle('on', x === o));
      else o.classList.toggle('on');
      b.querySelector('.clarification').focus();
    }));
  });
  el.querySelector('[data-reply]').addEventListener('click', async () => {
    const answers = {};
    el.querySelectorAll('.question-block').forEach(b => {
      const q = ev.questions[b.dataset.i];
      const chosen = [...b.querySelectorAll('[data-opt].on')].map(o => q.options[o.dataset.opt].label);
      const p = b.querySelector('.clarification').value.trim();
      const base = chosen.join(', ');
      const v = base && p ? `${base}. ${t('cards.clarificationPrefix')}${p}` : base || p;
      if (v) answers[q.question] = v;
    });
    if (!Object.keys(answers).length) { alert(t('cards.question.empty')); return; }
    try { await answer(current(), ev.id, { answers }); } catch (e) { alert(e.message); }
  });
}
