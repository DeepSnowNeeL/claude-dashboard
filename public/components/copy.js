// Copy (Ctrl+C) a selection of the page: the formatting goes through (headings, bold, lists, tables, code, links), not
// the colours of the application. Without this, the browser copies the computed styles: dark background and light text
// end up in an e-mail or a document.
const KEPT_ATTRIBUTES = new Set(['href', 'colspan', 'rowspan', 'start']);
// Page buttons, checkboxes and menus: they have nothing to do in the copied text
const REMOVED = 'button, input, select, textarea, svg, .copy, .pencil';

function clean(root) {
  root.querySelectorAll(REMOVED).forEach(el => el.remove());
  for (const el of root.querySelectorAll('*')) {
    for (const a of [...el.attributes]) if (!KEPT_ATTRIBUTES.has(a.name)) el.removeAttribute(a.name);
    // A chat path link (without href) becomes text again
    if (el.tagName === 'A' && !el.getAttribute('href')?.startsWith('http')) el.replaceWith(...el.childNodes);
  }
  return root;
}

export function mountCopy() {
  document.addEventListener('copy', e => {
    const target = e.target;
    // Inputs and the Monaco editor keep their own copy (plain text)
    if (target?.closest?.('input, textarea, .monaco-editor, [contenteditable]')) return;
    const sel = getSelection();
    if (!sel || sel.isCollapsed || !sel.rangeCount) return;
    const box = document.createElement('div');
    for (let i = 0; i < sel.rangeCount; i++) box.append(sel.getRangeAt(i).cloneContents());
    clean(box);
    e.clipboardData.setData('text/html', box.innerHTML);
    e.clipboardData.setData('text/plain', sel.toString());
    e.preventDefault();
  });
}
