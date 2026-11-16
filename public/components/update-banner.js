// "Not up to date" banner (PC only): after a `git pull`, the engine and the page server keep running their old code until
// they restart (an F5 only refreshes public/). Checked every minute; the button restarts what is behind.
import { esc } from '../core/dom.js';
import { readUpdates, restartOutdated } from '../services/desktop.js';
import { t } from '../i18n/index.js';

let el = null, status = null, pending = null;

function render() {
  const behind = status && (status.engine || status.page);
  if (!behind) { el?.remove(); el = null; pending = null; return; }
  if (!el) { el = document.createElement('div'); el.className = 'code-update'; document.body.prepend(el); }
  const what = status.engine && status.page ? 'both' : status.engine ? 'engine' : 'page';
  el.innerHTML = `<span>🔄 ${t(`common.updateBanner.${what}`)}</span>
    ${pending ? `<span class="m">${esc(pending)}</span>` : `<button class="btn" id="update-restart">${t('common.updateBanner.restart')}</button>`}`;
  el.querySelector('#update-restart')?.addEventListener('click', async () => {
    try {
      const r = await restartOutdated({ engine: status.engine, page: status.page });
      pending = r.running?.length ? t('common.updateBanner.waiting', { list: r.running.map(x => x.title || x.slug).join(', ') }) : t('common.updateBanner.restarting');
      render();
    } catch (err) { alert(err.message); }
  });
}

async function check() {
  try { status = await readUpdates(); } catch { status = null; } // outside the PC (refused), or page restarting
  render();
}

export function mountUpdateBanner() {
  check();
  setInterval(check, 60_000);
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') check(); });
}
