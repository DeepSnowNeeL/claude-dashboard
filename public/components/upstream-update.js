// News on GitHub: a discreet line under ⚙ Options when the public repository has commits this checkout lacks (clone or
// fork). A click shows the new CHANGELOG lines, then starts a Claude session that merges them in. The ✕ hides the line
// until the next upstream commit (kept per browser).
import { $, esc } from '../core/dom.js';
import { readUpstream } from '../services/options.js';
import { create } from '../services/sessions.js';
import { MODE_KEYS } from '../core/modes.js';
import { read, write } from '../core/storage.js';
import { t } from '../i18n/index.js';

const DISMISSED_KEY = 'dash-upstream-dismissed';
let status = null, open = false;

function render() {
  const z = $('#upstream-update');
  if (!z) return;
  if (!status?.behind || read(DISMISSED_KEY, '') === status.latest) { z.innerHTML = ''; open = false; return; }
  const n = status.behind;
  z.innerHTML = `<div class="upstream-line">
      <span class="upstream-dot"></span>
      <span class="upstream-txt" title="${esc(status.url || '')}">${t(status.fork ? 'common.upstream.newsFork' : 'common.upstream.news', { n })}</span>
      <a href="#" data-up="open">${t(status.fork ? 'common.upstream.integrate' : 'common.upstream.update')}</a>
      <span class="upstream-x" data-up="dismiss" title="${t('common.upstream.dismiss')}">✕</span>
    </div>
    ${open ? `<div class="upstream-pop">
      <b>${t('common.upstream.whatsNew')}</b>
      ${status.changelog?.length ? `<ul>${status.changelog.slice(0, 8).map(l => `<li>${esc(l)}</li>`).join('')}</ul>` : `<div class="m">${t('common.upstream.noChangelog')}</div>`}
      <div class="m">${t('common.upstream.explain')}</div>
      <div class="upstream-act"><button class="btn on" data-up="launch">${t('common.upstream.launch')}</button><button class="btn" data-up="cancel">${t('common.upstream.cancel')}</button></div>
    </div>` : ''}`;
}

/** Reads the status again (the page server fetches GitHub at most every 6 hours). */
export async function checkUpstream() {
  try { status = await readUpstream(); } catch { status = null; }
  render();
}

async function launch() {
  // Same permission mode as the last session started from this browser
  const mode = read('dash-new-session-mode', 'all');
  try {
    const { slug } = await create(status.root, MODE_KEYS.includes(mode) ? mode : 'all', '', '', t('common.upstream.prompt', status));
    open = false; render();
    location.hash = slug;
  } catch (err) { alert(err.message); }
}

export function mountUpstreamUpdate() {
  $('#upstream-update')?.addEventListener('click', e => {
    const act = e.target.closest('[data-up]')?.dataset.up;
    if (!act) return;
    e.preventDefault();
    if (act === 'open') { open = !open; render(); }
    else if (act === 'cancel') { open = false; render(); }
    else if (act === 'dismiss') { write(DISMISSED_KEY, status.latest); render(); }
    else if (act === 'launch') launch();
  });
  checkUpstream();
  setInterval(checkUpstream, 30 * 60_000);
}
