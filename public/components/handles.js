// Handles between the three panels: on the left, the width of the session list; on the right, that of the right
// panel (the Explorer, a deep tree, a diagram). The chat takes the rest. Widths kept in the browser,
// double-click to go back to the original one.
import { read, write, remove } from '../core/storage.js';

const PANELS = {
  left: { key: 'sessions-width', cls: 'sessions-sized', variable: '--sessions-width', panel: '.side', min: 200, measure: (b, x) => x - b.left },
  right: { key: 'right-width', cls: 'right-sized', variable: '--right-width', panel: '#right', min: 260, measure: (b, x) => b.right - x },
};

export function mountHandles() {
  for (const [side, p] of Object.entries(PANELS)) attach(document.getElementById(`handle-${side}`), p);
}

function attach(handle, { key, cls, variable, panel, min, measure }) {
  const apply = px => {
    document.body.classList.toggle(cls, !!px);
    if (px) document.body.style.setProperty(variable, `${px}px`);
    else document.body.style.removeProperty(variable);
  };
  apply(read(key, 0));
  handle.addEventListener('pointerdown', e => {
    e.preventDefault();
    handle.setPointerCapture(e.pointerId);
    const box = document.querySelector(panel).getBoundingClientRect();
    let px = 0;
    document.body.classList.add('resizing');
    const move = ev => { px = Math.round(Math.max(min, measure(box, ev.clientX))); apply(px); };
    handle.addEventListener('pointermove', move);
    handle.addEventListener('lostpointercapture', () => {
      document.body.classList.remove('resizing');
      handle.removeEventListener('pointermove', move);
      if (px) write(key, px);
    }, { once: true });
  });
  handle.addEventListener('dblclick', () => { remove(key); apply(0); });
}
