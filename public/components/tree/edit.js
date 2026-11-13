// Edit window for a group or a project of the tree.
import { esc } from '../../core/dom.js';
import { groups } from '../../core/state.js';
import { t } from '../../i18n/index.js';

/**
 * Edit window for a group or a project: name, color (palette or free), icon (emoji) and ticket URL template for a
 * project, and a remove action. Escape or a click outside closes without saving.
 */
// Emojis offered for a project icon, by theme, each with its search keywords (in the UI language, from the dictionary)
const EMOJI_THEMES = ['dev', 'work', 'nature', 'animals', 'places', 'hobbies', 'symbols', 'faces'];
const emojiList = () => EMOJI_THEMES.flatMap(id => {
  const theme = t(`tree.edit.emojis.${id}.name`);
  return t(`tree.edit.emojis.${id}.list`).split('|').map(e => { const [char, ...words] = e.split(' '); return { char, theme, words: words.join(' ') }; });
});

const PALETTE = ['#f59e0b', '#ef4444', '#ec4899', '#a855f7', '#6366f1', '#3b82f6', '#06b6d4', '#10b981', '#84cc16', '#78716c'];
export function edit(o) {
  document.querySelector('.modal-backdrop')?.remove();
  let color = o.color || '';
  const backdrop = document.createElement('div');
  backdrop.className = 'modal-backdrop';
  backdrop.innerHTML = `<div class="modal" role="dialog"><button class="close-x" id="ed-cancel" title="${t('tree.modal.close')}">×</button>
    <h3>${esc(o.title)}</h3>${o.subtitle ? `<div class="m">${esc(o.subtitle)}</div>` : ''}
    <label>${t('tree.edit.name')}<input id="ed-name" value="${esc(o.name || '')}" placeholder="${esc(o.defaultName || '')}"></label>
    ${o.group !== undefined ? `<label>${t('tree.edit.group')}<select id="ed-group">
      <option value="">${t('tree.edit.noGroup')}</option>
      ${groups().map(g => `<option value="${esc(g.id)}" ${g.id === o.group ? 'selected' : ''}>${esc(g.name)}</option>`).join('')}
    </select></label>` : ''}
    ${o.ticketUrl !== undefined ? `<label>${t('tree.edit.ticketUrl')}<input id="ed-ticket-url" value="${esc(o.ticketUrl || '')}" placeholder="https://gitlab.example.com/team/app/-/issues/{n}" autocomplete="off">
      <span class="m">${t('tree.edit.ticketUrlHint')}</span></label>` : ''}
    ${o.withIcon ? `<div class="ed-label">${t('tree.edit.icon')}</div>
      <div class="ed-icon">
        <span class="icon-preview" id="ed-preview"></span>
        <input id="ed-emoji-search" placeholder="${t('tree.edit.emojiSearch')}" autocomplete="off">
        <input id="ed-icon" value="${esc(o.icon)}" title="${t('tree.edit.pasteEmoji')}" maxlength="8">
        <button class="btn" id="ed-no-icon" title="${o.logo ? t('tree.edit.backToLogo') : t('tree.edit.noIcon')}">${o.logo ? t('tree.edit.logo') : t('tree.edit.none')}</button>
      </div>
      <div class="emoji-grid" id="ed-emojis"></div>` : ''}
    <div class="ed-label">${o.withIcon ? t('tree.edit.nameColor') : t('tree.edit.groupColor')}</div>
    <div class="ed-palette">
      <button class="dot-c none" data-c="" title="${t('tree.edit.noColor')}">∅</button>
      ${PALETTE.map(c => `<button class="dot-c" data-c="${c}" style="background:${c}"></button>`).join('')}
      <input type="color" id="ed-free" title="${t('tree.edit.freeColor')}" value="${esc(color || '#f59e0b')}">
    </div>
    <div class="bar">
      ${o.remove ? `<button class="btn stop" id="ed-delete">${esc(o.remove.label)}</button>` : '<span></span>'}
      <span><button class="btn on" id="ed-ok">${t('tree.edit.save')}</button></span>
    </div>
  </div>`;
  document.body.append(backdrop);
  if (o.withIcon) {
    // Emoji picker: themes, keyword search, preview (chosen emoji, otherwise the logo)
    const field = backdrop.querySelector('#ed-icon');
    const preview = () => { backdrop.querySelector('#ed-preview').innerHTML = field.value.trim() ? esc(field.value.trim()) : o.logo ? `<img src="${esc(o.logo)}" alt="">` : '·'; };
    const grid = () => {
      const q = backdrop.querySelector('#ed-emoji-search').value.trim().toLowerCase();
      const vis = emojiList().filter(e => !q || e.words.includes(q) || e.theme.toLowerCase().includes(q));
      const themes = [...new Set(vis.map(e => e.theme))];
      backdrop.querySelector('#ed-emojis').innerHTML = themes.map(th => `<div class="theme-emoji">${esc(th)}</div>
        <div class="emojis">${vis.filter(e => e.theme === th).map(e => `<button class="emoji ${e.char === field.value.trim() ? 'on' : ''}" data-e="${e.char}" title="${esc(e.words)}">${e.char}</button>`).join('')}</div>`).join('')
        || `<p class="m">${t('tree.edit.noEmoji')}</p>`;
    };
    backdrop.querySelector('#ed-emojis').addEventListener('click', e => {
      const b = e.target.closest('.emoji');
      if (!b) return;
      field.value = b.dataset.e;
      preview(); grid();
    });
    backdrop.querySelector('#ed-emoji-search').addEventListener('input', grid);
    field.addEventListener('input', () => { preview(); grid(); });
    backdrop.querySelector('#ed-no-icon').addEventListener('click', () => { field.value = ''; preview(); grid(); });
    preview(); grid();
  }
  const mark = () => backdrop.querySelectorAll('.dot-c').forEach(b => b.classList.toggle('on', b.dataset.c === color));
  mark();
  backdrop.querySelectorAll('.dot-c').forEach(b => b.addEventListener('click', () => { color = b.dataset.c; mark(); }));
  backdrop.querySelector('#ed-free').addEventListener('input', e => { color = e.target.value; mark(); });
  const close = () => backdrop.remove();
  const submit = () => {
    o.save({
      name: backdrop.querySelector('#ed-name').value.trim(), color, icon: backdrop.querySelector('#ed-icon')?.value.trim(),
      group: backdrop.querySelector('#ed-group')?.value ?? '', ticketUrl: backdrop.querySelector('#ed-ticket-url')?.value.trim(),
    });
    close();
  };
  backdrop.querySelector('#ed-ok').onclick = submit;
  backdrop.querySelector('#ed-cancel').onclick = close;
  backdrop.querySelector('#ed-delete')?.addEventListener('click', () => { if (confirm(o.remove.confirm)) { o.remove.run(); close(); } });
  backdrop.addEventListener('mousedown', e => { if (e.target === backdrop) close(); });
  backdrop.addEventListener('keydown', e => { if (e.key === 'Escape') { e.stopPropagation(); close(); } if (e.key === 'Enter' && e.target.tagName === 'INPUT' && e.target.id !== 'ed-emoji-search') submit(); });
  backdrop.querySelector('#ed-name').focus();
}
