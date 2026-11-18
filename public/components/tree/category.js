// Session categories (labels, like GitLab's): create or edit one (name, colour, "compact"), and the list to manage them.
import { esc } from '../../core/dom.js';
import { categories } from '../../core/state.js';
import { saveCategories } from '../../services/projects.js';
import { t } from '../../i18n/index.js';

const PALETTE = ['#dc2626', '#ea580c', '#f59e0b', '#16a34a', '#0d9488', '#2563eb', '#4f46e5', '#a855f7', '#db2777', '#64748b'];

function backdropWith(html) {
  document.querySelector('.modal-backdrop')?.remove();
  const b = document.createElement('div');
  b.className = 'modal-backdrop';
  b.innerHTML = `<div class="modal" role="dialog"><button class="close-x" data-close title="${t('tree.modal.close')}">×</button>${html}</div>`;
  document.body.append(b);
  const close = () => b.remove();
  b.querySelector('[data-close]').onclick = close;
  b.addEventListener('mousedown', e => { if (e.target === b) close(); });
  b.addEventListener('keydown', e => { if (e.key === 'Escape') { e.stopPropagation(); close(); } });
  return { b, close };
}

/**
 * Window of a category: `cat` to edit one, nothing to create one. `onCreated(id)`: called after a creation (the
 * right click puts the new category on its session).
 */
export function categoryDialog(cat, { onCreated } = {}) {
  let color = cat?.color || PALETTE[5];
  const { b, close } = backdropWith(`<h3>🏷️ ${cat ? t('tree.categories.editTitle') : t('tree.categories.newTitle')}</h3>
    <label>${t('tree.categories.name')}<input id="cat-name" value="${esc(cat?.name || '')}" maxlength="60" autocomplete="off"></label>
    <div class="ed-label">${t('tree.categories.color')}</div>
    <div class="ed-palette">
      ${PALETTE.map(c => `<button class="dot-c" data-c="${c}" style="background:${c}"></button>`).join('')}
      <input type="color" id="cat-free" title="${t('tree.edit.freeColor')}" value="${esc(color)}">
    </div>
    <label class="cat-compact"><input type="checkbox" id="cat-compact" ${cat?.compact ? 'checked' : ''}>
      <span><b>${t('tree.categories.compact')}</b><small>${t('tree.categories.compactHint')}</small></span></label>
    <div class="cat-preview"><span class="m">${t('tree.categories.preview')}</span><div id="cat-preview"></div></div>
    <div class="bar">
      ${cat ? `<button class="btn stop" id="cat-delete">${t('tree.categories.delete')}</button>` : '<span></span>'}
      <span><button class="btn on" id="cat-ok">${cat ? t('tree.edit.save') : t('tree.categories.create')}</button></span>
    </div>`);
  const name = b.querySelector('#cat-name'), compact = b.querySelector('#cat-compact');
  const preview = () => {
    b.querySelectorAll('.dot-c').forEach(x => x.classList.toggle('on', x.dataset.c === color));
    const n = esc(name.value.trim() || t('tree.categories.namePlaceholder'));
    b.querySelector('#cat-preview').innerHTML = compact.checked
      ? `<div class="sess compact" style="--c:${esc(color)}"><span class="t">${t('tree.categories.sampleSession')}</span><span class="st">⏳</span></div>`
      : `<span class="cat" style="--c:${esc(color)}">${n}</span>`;
  };
  b.querySelectorAll('.dot-c').forEach(x => x.addEventListener('click', () => { color = x.dataset.c; b.querySelector('#cat-free').value = color; preview(); }));
  b.querySelector('#cat-free').addEventListener('input', e => { color = e.target.value; preview(); });
  name.addEventListener('input', preview);
  compact.addEventListener('change', preview);
  const submit = async () => {
    const n = name.value.trim();
    if (!n) { name.focus(); return; }
    const c = categories();
    const v = { id: cat?.id || Date.now().toString(36), name: n, color, compact: compact.checked };
    close();
    try {
      await saveCategories({ ...c, list: cat ? c.list.map(x => (x.id === cat.id ? v : x)) : [...c.list, v] });
      if (!cat) await onCreated?.(v.id);
    } catch (e) { alert(e.message); }
  };
  b.querySelector('#cat-ok').onclick = submit;
  b.addEventListener('keydown', e => { if (e.key === 'Enter' && e.target === name) submit(); });
  b.querySelector('#cat-delete')?.addEventListener('click', async () => {
    const n = Object.values(categories().sessions).filter(l => l.includes(cat.id)).length;
    if (!confirm(t('tree.categories.deleteConfirm', { name: cat.name, n }))) return;
    close();
    const c = categories();
    const sessions = Object.fromEntries(Object.entries(c.sessions).map(([s, l]) => [s, l.filter(id => id !== cat.id)]));
    try { await saveCategories({ list: c.list.filter(x => x.id !== cat.id), sessions }); } catch (e) { alert(e.message); }
  });
  preview();
  name.focus();
}

/** List of the categories: a click edits one, "New category" creates one. */
export function manageCategories() {
  const c = categories();
  const count = id => Object.values(c.sessions).filter(l => l.includes(id)).length;
  const { b } = backdropWith(`<h3>🏷️ ${t('tree.categories.manageTitle')}</h3>
    <div class="cat-list">${c.list.map(x => `<button class="cat-row" data-id="${esc(x.id)}">
      <span class="cat" style="--c:${esc(x.color)}">${esc(x.name)}</span>
      ${x.compact ? `<span class="m">${t('tree.categories.compactTag')}</span>` : ''}
      <span class="m n">${t('tree.categories.sessionCount', { n: count(x.id) })}</span></button>`).join('') || `<p class="m">${t('tree.categories.none')}</p>`}</div>
    <div class="bar"><span></span><span><button class="btn on" id="cat-new">＋ ${t('tree.categories.new')}</button></span></div>`);
  b.querySelectorAll('.cat-row').forEach(r => r.addEventListener('click', () => categoryDialog(categories().list.find(x => x.id === r.dataset.id))));
  b.querySelector('#cat-new').onclick = () => categoryDialog();
}
