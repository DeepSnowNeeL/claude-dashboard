// Levels and achievements: badge next to ⚙ Options, 🏆 window, toasts (SSE event `achievement`).
import { $, esc } from '../core/dom.js';
import { effect } from '../core/signals.js';
import { progress, sessions } from '../core/state.js';
import { loadProgress, markAchievementsSeen } from '../services/progress.js';
import { t, locale } from '../i18n/index.js';

const tierName = tier => t(`achievementsUi.tiers.${tier}`);
const ROMAN = ['I', 'II', 'III', 'IV', 'V'];
const number = n => Number(n || 0).toLocaleString(locale());
const unitLabel = u => { const k = `achievementsUi.units.${u}`; const v = t(k); return v === k ? u : v; };
const withUnit = (v, u) => `${number(v)}${u ? (u === '%' ? t('achievementsUi.percentSuffix') : ` ${unitLabel(u)}`) : ''}`;
const shortDate = iso => (iso ? new Date(iso).toLocaleDateString(locale(), { day: 'numeric', month: 'short', year: 'numeric' }) : '');

/** Medal: image of the family (otherwise its emoji), frame of the best earned milestone, greyed if nothing earned. */
function medal(f, tier, size = '') {
  const content = f.hidden ? '<span class="ach-emoji">❔</span>'
    : `<img src="/achievements/${esc(f.id)}.webp" alt="" loading="lazy" onerror="this.replaceWith(Object.assign(document.createElement('span'),{className:'ach-emoji',textContent:${esc(JSON.stringify(f.emoji || '🏅'))}}))">`;
  return `<span class="ach-medal ${tier || 'locked'} ${size}">${content}</span>`;
}
const bestTier = f => f.milestones.filter(p => p.earned).at(-1)?.tier || null;

// --- Badge at the bottom of the list ---------------------------------------------------------------------------------------
function renderBadge() {
  const z = $('#level-footer'), p = progress();
  if (!z) return;
  if (!p) { z.hidden = true; return; }
  z.hidden = false;
  const part = Math.max(0, Math.min(1, (p.xp - p.levelXp) / (p.nextLevelXp - p.levelXp)));
  z.title = t('achievementsUi.badgeTitle', { rank: p.rank.name, xp: number(p.xp), next: p.level + 1, nextXp: number(p.nextLevelXp) });
  z.innerHTML = `🏆 <b>${t('achievementsUi.levelShort', { n: p.level })}</b><span class="ach-mini"><i style="width:${(part * 100).toFixed(1)}%"></i></span>${p.newCount ? '<span class="ach-new"></span>' : ''}`;
}

// --- Window ---------------------------------------------------------------------------------------------------------
let tab = 'all';
const expanded = new Set();

/** Sort: the families in progress, the closest to their next milestone first; then the finished ones; hidden secrets at the end. */
function order(f) {
  if (f.hidden) return 3;
  const next = f.milestones.find(p => !p.earned);
  if (!next) return 2;
  return 1 - Math.min(1, (f.value || 0) / next.threshold);
}

function card(f) {
  const tier = bestTier(f);
  if (f.hidden) {
    return `<div class="ach-card secret">${medal(f, null)}<div class="ach-body"><div class="ach-name">???</div><div class="ach-desc">${t('achievementsUi.secret')}</div></div></div>`;
  }
  const next = f.milestones.find(p => !p.earned);
  const segs = f.milestones.map(p => `<i class="${p.earned ? p.tier : ''}" title="${t('achievementsUi.milestoneTitle', { tier: tierName(p.tier), value: esc(withUnit(p.threshold, f.unit)) })}"></i>`).join('');
  const prog = next && f.milestones.length === 1 && f.milestones[0].threshold === 1
    ? `<span>${t('achievementsUi.notYet')}</span><span>${tierName(next.tier).toLowerCase()}</span>`
    : next
    ? `<span>${f.measure === 'max' ? t('achievementsUi.record') : ''}${esc(withUnit(f.value, f.unit))}</span><span>${t('achievementsUi.tierAt', { tier: tierName(next.tier).toLowerCase(), threshold: esc(withUnit(next.threshold, f.unit)) })}</span>`
    : `<span>${esc(withUnit(f.value, f.unit))}</span><span>${t('achievementsUi.finished')}</span>`;
  const titles = new Map(sessions().map(s => [s.slug, s.title]));
  const detail = expanded.has(f.id) ? `<div class="ach-detail">${f.milestones.map((p, i) => `<div class="ach-milestone ${p.earned ? 'ok' : ''}">
      <span class="ach-tier ${p.tier}">${tierName(p.tier)}${f.milestones.length > 1 ? ` ${ROMAN[i]}` : ''}</span>
      <span>${esc(withUnit(p.threshold, f.unit))}</span>
      <span class="ach-when">${p.earned ? `${esc(shortDate(p.date))}${p.slug && titles.has(p.slug) ? ` · <a href="#${esc(p.slug)}">${esc(titles.get(p.slug))}</a>` : ''}` : '-'}</span>
    </div>`).join('')}</div>` : '';
  return `<div class="ach-card ${f.isNew ? 'recent' : ''}" data-label="${t('achievementsUi.new')}" data-id="${esc(f.id)}">${medal(f, tier)}<div class="ach-body">
    <div class="ach-name">${esc(f.name)}</div><div class="ach-desc">${esc(f.desc)}</div>
    <div class="ach-milestones">${segs}</div><div class="ach-prog">${prog}</div>${detail}</div></div>`;
}

function paintWindow(backdrop) {
  const p = progress();
  if (!p) return;
  const part = Math.max(0, Math.min(1, (p.xp - p.levelXp) / (p.nextLevelXp - p.levelXp)));
  const families = p.families.filter(f => tab === 'all' || f.cat === tab).sort((a, b) => order(a) - order(b));
  const scroll = backdrop.querySelector('.ach-grid')?.scrollTop || 0; // redrawn at every update: we keep its position
  backdrop.querySelector('.ach-window').innerHTML = `
    <div class="ach-header">
      <span class="ach-rank">${esc(p.rank.emoji)}</span>
      <div class="ach-xp">
        <h3>${t('achievementsUi.levelTitle', { n: p.level, rank: esc(p.rank.name) })}</h3>
        <div class="ach-sub">${p.nextRank ? t('achievementsUi.nextRank', { rank: esc(p.nextRank.name), level: p.nextRank.level }) : t('achievementsUi.topRank')}</div>
        <div class="ach-bar"><i style="width:${(part * 100).toFixed(1)}%"></i></div>
        <div class="ach-figures"><span>${number(p.xp)} XP</span><span>${t('achievementsUi.xpToLevel', { xp: number(p.nextLevelXp - p.xp), level: p.level + 1 })}</span></div>
      </div>
      <div class="ach-summary"><b>${p.earned} / ${p.total}</b>${t('achievementsUi.unlocked')}<br>${t('achievementsUi.today', { xp: number(p.dayXp) })}</div>
      <button class="close-x" title="${t('common.closeEsc')}">×</button>
    </div>
    <div class="ach-tabs">${[{ id: 'all', name: t('achievementsUi.all') }, ...p.categories].map(c => `<button class="${c.id === tab ? 'sel' : ''}" data-tab="${esc(c.id)}">${esc(c.name)}</button>`).join('')}</div>
    <div class="ach-grid">${families.map(card).join('')}</div>`;
  backdrop.querySelector('.ach-grid').scrollTop = scroll;
}

export function openAchievements() {
  document.querySelector('.modal-backdrop')?.remove();
  const backdrop = document.createElement('div');
  backdrop.className = 'modal-backdrop';
  backdrop.innerHTML = '<div class="ach-window" role="dialog" tabindex="-1"></div>';
  // Everything is "seen" when closing: while it is open, the new milestones stay marked
  const close = () => { backdrop.remove(); stop(); markAchievementsSeen(); };
  backdrop.addEventListener('click', e => {
    if (e.target === backdrop || e.target.closest('.close-x')) return close();
    const o = e.target.closest('[data-tab]');
    if (o) { tab = o.dataset.tab; backdrop.querySelector('.ach-grid').scrollTop = 0; return paintWindow(backdrop); }
    if (e.target.closest('a')) return close(); // link to the session
    const c = e.target.closest('.ach-card[data-id]');
    if (c) { const id = c.dataset.id; if (expanded.has(id)) expanded.delete(id); else expanded.add(id); paintWindow(backdrop); }
  });
  backdrop.addEventListener('keydown', e => { if (e.key === 'Escape') { e.stopPropagation(); close(); } });
  document.body.append(backdrop);
  const stop = effect(() => paintWindow(backdrop));
  backdrop.querySelector('.ach-window').focus();
}

// --- Toasts ----------------------------------------------------------------------------------------------------------
function toastZone() {
  let z = document.querySelector('.ach-toasts');
  if (!z) { z = document.createElement('div'); z.className = 'ach-toasts'; document.body.append(z); }
  return z;
}
export function achievementToast(a) {
  const el = document.createElement('div');
  if (a.type === 'level') {
    el.className = 'ach-toast level';
    el.innerHTML = `<span class="ach-rank small">${esc(a.emoji)}</span><div><div class="t1">${t('achievementsUi.toastLevel', { n: a.level })}</div><div class="t2">${esc(a.rank)}</div><div class="t3">${a.newRank ? t('achievementsUi.newRank') : t('achievementsUi.levelUp')}</div></div>`;
  } else {
    el.className = 'ach-toast';
    const title = `${a.name}${a.number ? ` ${ROMAN[a.number - 1]}` : ''}`;
    el.innerHTML = `${medal({ id: a.family, emoji: a.emoji }, a.tier)}<div><div class="t1">${t('achievementsUi.toastAchievement', { tier: tierName(a.tier) })}</div><div class="t2">${esc(title)}</div><div class="t3">${esc(a.desc || '')}${a.sessionTitle ? ` · ${t('achievementsUi.quoted', { title: esc(a.sessionTitle) })}` : ''} · +${number(a.xp)} XP</div></div>`;
  }
  el.onclick = openAchievements;
  toastZone().append(el);
  requestAnimationFrame(() => el.classList.add('on'));
  setTimeout(() => { el.classList.remove('on'); setTimeout(() => el.remove(), 400); }, 6000);
}

/** Mounts the badge (rendered by an effect), and returns the handler of the SSE event `achievement`. */
export function mountAchievements() {
  const z = $('#level-footer');
  if (z) z.onclick = openAchievements;
  effect(renderBadge);
  loadProgress();
  return e => { achievementToast(JSON.parse(e.data)); loadProgress(); };
}
