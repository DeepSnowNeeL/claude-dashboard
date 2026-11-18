// "Not up to date" banner (PC only): after a `git pull`, the engine and the page server keep running their old code until
// they restart (an F5 only refreshes public/). Checked every minute; the button restarts what is behind.
import { esc } from '../core/dom.js';
import { readUpdates, restartOutdated, readEngineWork } from '../services/desktop.js';
import { t } from '../i18n/index.js';

// `pending`: message shown after a click on Restart, for the status it answered (`pendingFor`), instead of the button;
// `poll`: while the engine waits for sessions, what still holds it is read again every 5 s (the list at the click goes stale)
let el = null, status = null, pending = null, pendingFor = null, poll = null;

const waitingText = running => t('common.updateBanner.waiting', { list: running.map(x => `${x.title || x.slug} (${x.what.join(', ')})`).join(', ') });

function watchEngine() {
  clearInterval(poll);
  poll = setInterval(async () => {
    if (!pending) return clearInterval(poll);
    const running = (await readEngineWork().catch(() => null))?.running;
    if (!running) return; // engine restarting
    pending = running.length ? waitingText(running) : t('common.updateBanner.restarting');
    render();
  }, 5000);
}

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
      pending = r.running?.length ? waitingText(r.running) : t('common.updateBanner.restarting');
      pendingFor = status;
      if (r.running?.length) watchEngine();
      render();
    } catch (err) { alert(err.message); }
  });
}

async function check() {
  try { status = await readUpdates(); } catch { status = null; } // outside the PC (refused), or page restarting
  // The message stays while a part restarted and the other still waits (page done, engine not yet); a new commit on
  // disk, or a process behind that was not, brings the button back
  const was = pendingFor;
  if (pending && !(status && was && status.head === was.head && (!status.engine || was.engine) && (!status.page || was.page))) pending = null;
  render();
}

export function mountUpdateBanner() {
  check();
  setInterval(check, 60_000);
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') check(); });
}
