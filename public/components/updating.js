// Mobile: waiting screen while the dashboard restarts (update pushed, page or engine restarted). The server announces
// it on the event stream (`restarting`); when the stream reopens, app.js reloads the page whole (new code).
import { t } from '../i18n/index.js';

const MOBILE = '(max-width: 900px)';
// The dashboard has not come back after this delay: say so, the screen keeps waiting (the stream retries by itself)
const LONG = 30000;

export function mountUpdating() {
  let el = null;
  return {
    shown: () => !!el,
    show() {
      if (el || !matchMedia(MOBILE).matches) return;
      el = document.createElement('div');
      el.className = 'updating';
      el.innerHTML = `<div class="updating-card"><div class="updating-icon">🔄</div><h1>${t('common.updating.title')}</h1>
        <p>${t('common.updating.text')}</p><div class="updating-spinner"></div><div class="updating-status"></div></div>`;
      document.body.append(el);
      setTimeout(() => { if (el) el.querySelector('.updating-status').textContent = t('common.updating.long'); }, LONG);
    },
  };
}
