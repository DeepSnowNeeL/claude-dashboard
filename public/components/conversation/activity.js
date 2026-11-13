// --- Processing indicator, under the feed: "✻ Pondering… (3 min 42 s · ↓ 19.9 k tokens · thinking)" -------
import { effect } from '../../core/signals.js';
import { $ } from '../../core/dom.js';
import { activity } from '../../core/state.js';
import { t, locale } from '../../i18n/index.js';

const STARS = ['✻', '✶', '✳', '✢', '·', '✢', '✳', '✶'];
const PHASES = { thinking: 'activity.thinking', writing: 'activity.writing', tool: 'activity.tool', pending: '' };
let tick = 0;

/** Renders the indicator in #activity (recreated with the center: also called when a session opens). */
export function renderActivity() {
  const z = $('#activity');
  if (!z) return;
  if (!activity()) { z.innerHTML = ''; return; }
  const s = Math.max(0, Math.round((Date.now() - activity().start) / 1000));
  const duration = s < 60 ? `${s} s` : `${Math.floor(s / 60)} min ${String(s % 60).padStart(2, '0')} s`;
  const n = activity().tokens || 0;
  const tokens = n >= 1000 ? `${(n / 1000).toLocaleString(locale(), { minimumFractionDigits: 1, maximumFractionDigits: 1 })} k` : String(n);
  const verbs = t('conversation.activity.verbs').split('|');
  const verb = verbs[Math.floor(activity().start / 1000) % verbs.length];
  const phaseKey = PHASES[activity().phase];
  const phase = phaseKey ? t(`conversation.${phaseKey}`) : '';
  z.innerHTML = `<span class="star">${STARS[tick % STARS.length]}</span> <b>${verb}…</b>
    <span class="m">(${duration} · ↓ ${tokens} tokens${phase ? ` · <i>${phase}</i>` : ''})</span>`;
}

/** Rerendered when `activity` changes, and every 250 ms while Claude works (star, duration). */
export function mountActivity() {
  effect(() => { activity(); renderActivity(); }); // read first: #activity may be missing at this point
  setInterval(() => { tick++; if (activity()) renderActivity(); }, 250);
}
