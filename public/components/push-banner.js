// First opening on the phone: a banner offers the notifications of the blocked sessions. Shown once: "Later" does not
// ask again, ⚙ Options keeps the setting. The permission can only be asked after a click (iOS), hence the banner.
import { esc, toast } from '../core/dom.js';
import { read, write } from '../core/storage.js';
import { pushBlocker, enablePush } from '../services/push.js';
import { t } from '../i18n/index.js';

const ASKED_KEY = 'dash-push-asked';
const DEFAULT_IDLE = 10;

export function mountPushBanner() {
  if (innerWidth >= 900 || pushBlocker() || Notification.permission !== 'default' || read(ASKED_KEY, false)) return;
  const el = document.createElement('div');
  el.className = 'push-banner';
  el.innerHTML = `<b>🔔 ${esc(t('options.push.bannerTitle'))}</b>
    <div class="m">${esc(t('options.push.bannerText', { n: DEFAULT_IDLE }))}</div>
    <div class="push-banner-act"><button class="btn on" data-push="yes">${esc(t('options.push.enable'))}</button><button class="btn" data-push="no">${esc(t('options.push.later'))}</button></div>
    <div class="m">${esc(t('options.push.laterHelp'))}</div>`;
  el.addEventListener('click', async e => {
    const what = e.target.closest('[data-push]')?.dataset.push;
    if (!what) return;
    write(ASKED_KEY, true);
    el.remove();
    if (what !== 'yes') return;
    try { await enablePush(DEFAULT_IDLE); toast(t('options.push.enabled')); } catch (err) { toast(err.message === 'denied' ? t('options.push.denied') : err.message); }
  });
  document.body.append(el);
}
