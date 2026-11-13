// Small text input window.
import { esc } from '../../core/dom.js';
import { t } from '../../i18n/index.js';

// Small text input in a modal (Electron does not support window.prompt). Resolves with the (trimmed) value or null.
export function ask({ title, label, placeholder = '', value = '' }) {
  return new Promise(resolve => {
    document.querySelector('.modal-backdrop')?.remove();
    const backdrop = document.createElement('div');
    backdrop.className = 'modal-backdrop';
    backdrop.innerHTML = `<div class="modal" role="dialog"><button class="close-x" id="dm-cancel" title="${t('tree.modal.close')}">×</button>
      <h3>${esc(title)}</h3>
      <label>${esc(label)}<input id="dm-field" value="${esc(value)}" placeholder="${esc(placeholder)}" autocomplete="off"></label>
      <div class="bar"><span></span><span><button class="btn on" id="dm-ok">${t('tree.modal.ok')}</button></span></div>
    </div>`;
    document.body.append(backdrop);
    const field = backdrop.querySelector('#dm-field');
    const close = v => { backdrop.remove(); resolve(v); };
    backdrop.querySelector('#dm-ok').onclick = () => close(field.value.trim() || null);
    backdrop.querySelector('#dm-cancel').onclick = () => close(null);
    backdrop.addEventListener('mousedown', e => { if (e.target === backdrop) close(null); });
    backdrop.addEventListener('keydown', e => {
      if (e.key === 'Escape') { e.stopPropagation(); close(null); }
      if (e.key === 'Enter' && e.target.tagName === 'INPUT') close(field.value.trim() || null);
    });
    field.focus();
  });
}
