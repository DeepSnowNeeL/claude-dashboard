// Editor remark bubble: a selection in Monaco opens a small window inside the viewer `v`.
import { current, detail } from '../../core/state.js';
import { esc } from '../../core/dom.js';
import { send } from '../../services/sessions.js';
import { t } from '../../i18n/index.js';

/**
 * A selection in the editor opens a small window below it: the typed remark goes into the conversation of the
 * displayed session with the file, the lines and the selected code (Enter sends, Shift+Enter adds a line break).
 */
export function remarksOn(v, ed, file, lang, version) {
  let pending = null;
  ed.onDidChangeCursorSelection(() => {
    clearTimeout(pending);
    pending = setTimeout(() => {
      const sel = ed.getSelection();
      const bubble = v.querySelector('.remark-bubble');
      if (!sel || sel.isEmpty()) { if (bubble && !bubble.querySelector('textarea').value.trim()) bubble.remove(); return; }
      openBubble(v, ed, sel, file, lang, version);
    }, 250);
  });
}
function openBubble(v, ed, sel, file, lang, version) {
  v.querySelector('.remark-bubble')?.remove();
  if (!current() || current().startsWith('new') || !detail()?.driven) return; // no session to send to
  const lines = sel.startLineNumber === sel.endLineNumber ? `L${sel.startLineNumber}` : `L${sel.startLineNumber}-L${sel.endLineNumber}`;
  const code = ed.getModel().getValueInRange(sel);
  const pos = ed.getScrolledVisiblePosition({ lineNumber: sel.endLineNumber, column: sel.endColumn });
  const frame = ed.getDomNode().getBoundingClientRect();
  const b = document.createElement('div');
  b.className = 'remark-bubble';
  b.innerHTML = `<div class="m">${esc(file.split(/[\\/]/).pop())}:${lines}${version ? ` · ${esc(version)}` : ''} → ${esc(detail().title || current())}</div>
    <textarea placeholder="${t('editor.remark.placeholder')}"></textarea>`;
  b.style.left = `${Math.max(8, Math.min(frame.left + (pos?.left || 0), innerWidth - 400))}px`;
  b.style.top = `${Math.min(frame.top + (pos ? pos.top + pos.height : 0) + 6, innerHeight - 140)}px`;
  v.append(b);
  const field = b.querySelector('textarea');
  field.focus();
  field.addEventListener('keydown', async e => {
    if (e.key === 'Escape') { e.stopPropagation(); e.preventDefault(); b.remove(); ed.focus(); return; }
    if (e.key !== 'Enter' || e.shiftKey || e.isComposing) return;
    e.preventDefault();
    const remark = field.value.trim();
    if (!remark) return;
    const block = code.includes('```') ? code : `\`\`\`${lang === 'plaintext' ? '' : lang}\n${code}\n\`\`\``;
    const text = t('editor.remark.message', { file, lines, version, block, remark });
    field.disabled = true;
    try {
      await send(current(), { text, when: detail()?.busy ? 'end' : 'now' });
      b.innerHTML = `<div class="m sent">${detail()?.busy ? t('editor.remark.sentQueued') : t('editor.remark.sent')}</div>`;
      setTimeout(() => b.remove(), 1200);
    } catch (err) { field.disabled = false; alert(err.message); }
  });
}
