// Subscription usage: limits shown at the bottom of the list (block hidden if the experimental API breaks).
import { $, esc, formatWhen } from '../core/dom.js';
import { readUsage } from '../services/usage.js';
import { t } from '../i18n/index.js';

// Gauge color: orange from 80 %, red from 90 % (like the plan alerts of the feed)
const tier = l => { const p = Number(l.percent) || 0; return p >= 90 ? 'critical' : p >= 80 ? 'warning' : ''; };

export async function loadUsage() {
  const u = await readUsage();
  // Empty or failed answer (transient): the block keeps what it displayed
  if (!u?.limits?.length && $('#usage').innerHTML.trim()) return;
  // Organization left out when it only repeats the e-mail ("x@y.fr's Organization")
  const org = u?.organization && !(u.email && u.organization.includes(u.email)) ? u.organization : '';
  const account = [u?.email, org].filter(Boolean).join(' · ');
  // One line per limit: label, thin bar, percentage, reset (short)
  $('#usage').innerHTML = !u?.limits?.length ? '' : `
    <div class="group usage-head"><span>${t('usage.footer.subscription')}${u.plan ? ` ${esc(u.plan.toUpperCase())}` : ''}</span>${account ? `<span class="account" title="${esc(account)}">${esc(account)}</span>` : ''}</div>
    ${u.limits.map(l => `<div class="gauge ${tier(l)}" title="${esc(t('usage.footer.limitTitle', { label: l.label, percent: l.percent ?? '?', reset: l.reset ? formatWhen(l.reset) : '?' }))}">
      <span class="gl">${esc(l.label)}</span>
      <div class="gauge-bar"><div style="width:${Math.min(Number(l.percent) || 0, 100)}%"></div></div>
      <b>${esc(l.percent ?? '?')} %</b>
      <span class="reset">${l.reset ? esc(formatWhen(l.reset, true)) : ''}</span>
    </div>`).join('')}`;
}
