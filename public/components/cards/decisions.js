// Decision cards: a click chooses without sending, the clarification is added to the line; the answer is composed in
// the input area (draft kept by services/draft.js).
import { $, esc, rich } from '../../core/dom.js';
import { current } from '../../core/state.js';
import { readDraft, writeDraft, splitDraft, joinDraft } from '../../services/draft.js';
import { t } from '../../i18n/index.js';
import { example } from './example.js';

function setLine(n, line) {
  const area = $('#input');
  const parts = splitDraft(area.value);
  if (line) parts.lines.set(n, `${n}. ${line.replace(/^\d+\.\s*/, '')}`);
  else parts.lines.delete(n); // "Other" with no text yet: no line
  area.value = joinDraft(parts);
  saveInputDraft();
  document.dispatchEvent(new CustomEvent('input-changed')); // text set by a click: the Send button must come back on (input.js listens)
}
export function saveInputDraft() {
  const b = readDraft(current());
  b.text = $('#input').value;
  writeDraft(current(), b);
  highlight();
}
/** Lights up the choice whose answer is in the input area. */
export function highlight() {
  const lines = splitDraft($('#input')?.value || '').lines;
  const answeredBy = (btn, l) => l.startsWith(`${btn.dataset.n}. ${btn.dataset.answer}`);
  document.querySelectorAll('.card.active .btn[data-choice]:not([data-other])').forEach(btn => {
    btn.classList.toggle('on', answeredBy(btn, lines.get(Number(btn.dataset.n)) || ''));
  });
  // "Other": clicked, or a line typed by hand that matches no choice
  document.querySelectorAll('.card.active .btn[data-other]').forEach(btn => {
    const n = Number(btn.dataset.n), l = lines.get(n);
    const byAChoice = l && [...document.querySelectorAll(`.card.active .btn[data-choice][data-n="${n}"]:not([data-other])`)].some(b => answeredBy(b, l));
    btn.classList.toggle('on', othersOpen.has(n) ? !byAChoice : !!l && !byAChoice);
  });
}

/** Decision cards: a click chooses without sending, the clarification is added to the line. */
export function decisionCards(decisions, slug, active) {
  return decisions.map((x, i) => `<div class="card dec ${active ? 'active' : 'past'}" data-n="${i + 1}">
    <div class="q">${i + 1}. ${rich(x.question)}</div>
    ${x.context ? `<div class="m">${rich(x.context)}</div>` : ''}
    ${example(x.example, slug)}
    ${active ? `<div class="choices">
      ${(x.choices || []).map(c => `<button class="btn" data-choice data-n="${i + 1}" data-answer="${esc(String(c.answer).replace(/^\d+\.\s*/, ''))}">${rich(c.label)}${c.label === x.recommendation ? `<span class="rec">${t('cards.decisions.recommended')}</span>` : ''}</button>`).join('')}
      <button class="btn" data-choice data-other data-n="${i + 1}" data-answer="">${t('cards.decisions.other')}</button>
      <button class="btn" data-choice data-n="${i + 1}" data-answer="${esc(t('cards.decisions.explainAnswer'))}">${t('cards.decisions.explain')}</button>
    </div>
    <input class="clarification" data-n="${i + 1}" placeholder="${t('cards.clarificationPlaceholder')}">` : ''}
    ${x.explanation ? `<div class="explanation">${rich(x.explanation)}</div>` : ''}
  </div>`).join('');
}

// Decisions where "Other" is chosen: the clarification field becomes the answer
const othersOpen = new Set();
/** Answer line of a choice: its sentence and the clarification, or for "Other" the written text alone. */
const choiceLine = (b, p) => (b.dataset.other !== undefined ? p : b.dataset.answer + (p ? `. ${t('cards.clarificationPrefix')}${p}` : ''));
export function attachDecisions(root) {
  root.querySelectorAll('.card.active .btn[data-choice]').forEach(b => b.addEventListener('click', () => {
    const n = Number(b.dataset.n);
    const p = root.querySelector(`.clarification[data-n="${n}"]`);
    const other = b.dataset.other !== undefined;
    if (other) othersOpen.add(n); else othersOpen.delete(n);
    if (p) p.placeholder = other ? t('cards.decisions.yourAnswer') : t('cards.clarificationPlaceholder');
    setLine(n, choiceLine(b, p?.value.trim() || ''));
    p?.focus();
  }));
  root.querySelectorAll('.card.active .clarification').forEach(p => p.addEventListener('input', () => {
    const n = Number(p.dataset.n);
    const other = othersOpen.has(n) && root.querySelector(`.btn[data-other][data-n="${n}"]`);
    const chosen = other || root.querySelector(`.btn.on[data-choice][data-n="${n}"]:not([data-other])`)
      || [...root.querySelectorAll(`.btn[data-choice][data-n="${n}"]:not([data-other])`)].find(b => (splitDraft($('#input').value).lines.get(n) || '').startsWith(`${n}. ${b.dataset.answer}`));
    if (chosen) setLine(n, choiceLine(chosen, p.value.trim()));
  }));
}
