// Mobile (< 900 px): one panel at a time, chosen from the bottom bar.
import { $ } from '../core/dom.js';
import { sessions, current } from '../core/state.js';
import { t } from '../i18n/index.js';

// Mobile: one panel at a time (bottom bar); a dot on "Sessions" when a session is waiting for your answer
export function mobileView(v) {
  document.body.dataset.mobile = v;
  document.querySelectorAll('#nav-mobile [data-mobile]').forEach(b => b.classList.toggle('on', b.dataset.mobile === v));
}

/** Wires the bottom bar, the tap on an already open session and the "Sessions" dot. */
export function mountMobile() {
  document.querySelectorAll('#nav-mobile [data-mobile]').forEach(b => b.addEventListener('click', () => mobileView(b.dataset.mobile)));
  // Tapping the session that is already open: the address does not change (no hashchange), show its conversation anyway
  $('#list').addEventListener('click', e => {
    const a = e.target.closest('a.sess');
    if (a && a.getAttribute('href') === `#${current()}`) mobileView('conversation');
  });
  setInterval(() => {
    const b = document.querySelector('#nav-mobile [data-mobile="sessions"]');
    const waiting = sessions().some(s => s.status === 'waiting' && s.slug !== current());
    if (b && waiting !== !!b.querySelector('.dot-nav')) b.innerHTML = `☰<span>${t('mobile.sessions')}</span>${waiting ? '<i class="dot-nav"></i>' : ''}`;
  }, 2000);
}
