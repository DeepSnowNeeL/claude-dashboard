// Levels, XP and achievements: single source of the families, their thresholds and the ranks.
// Changing a threshold here is enough (nerf or buff): milestones, XP and level are recomputed from the raw records.
// Names and descriptions are UI text: they live in the `achievements` dictionaries (public/i18n), keyed by id.
// Spec: docs/specs/2026-11-13-achievements.md
import { t, locale } from '../../public/i18n/index.js';

export const TIERS = ['bronze', 'silver', 'gold', 'platinum', 'legend'];
export const BONUS = { bronze: 100, silver: 250, gold: 500, platinum: 1000, legend: 2500 };

/** Activity XP per event. */
export const XP = { message: 10, decisionLine: 5, card: 10, turn: 2, toolMax: 50, launch: 5 };

export const CATEGORIES = ['endurance', 'sessions', 'plan', 'multitasking', 'decisions', 'git', 'rhythm', 'remote', 'accidents', 'secrets']
  .map(id => ({ id }));

export const RANKS = [
  { level: 1, id: 'student-pilot', emoji: '🎓' },
  { level: 5, id: 'copilot', emoji: '✈️' },
  { level: 10, id: 'pilot', emoji: '🛩️' },
  { level: 20, id: 'captain', emoji: '🛫' },
  { level: 30, id: 'air-traffic-controller', emoji: '📡' },
  { level: 40, id: 'tower-chief', emoji: '🗼' },
  { level: 50, id: 'flight-director', emoji: '🎖️' },
  { level: 75, id: 'sky-master', emoji: '🌌' },
  { level: 100, id: 'tower-legend', emoji: '👑' },
];

// f(id, cat, emoji, measure, thresholds, image, extra); name and description: achievements.families.<id>
const f = (id, cat, emoji, measure, thresholds, image, extra = {}) => ({ id, cat, emoji, measure, thresholds, image, ...extra });

export const FAMILIES = [
  // Endurance: one same conversation
  f('compactor', 'endurance', '🗜️', 'max', [3, 5, 10, 20], 'a hydraulic press crushing a stack of paper sheets'),
  f('bursting', 'endurance', '🧠', 'max', [100], 'a brain overflowing out of a box', { tier: 'gold' }),
  f('marathon', 'endurance', '🏃', 'max', [3, 7, 21, 60], 'a runner with a race bib in front of a long horizon', { unit: 'd' }),
  f('fossil', 'endurance', '🦴', 'max', [7, 30, 90], 'an ammonite fossil with a blinking text cursor', { unit: 'd' }),

  // Sessions that work hard
  f('toolbox', 'sessions', '🧰', 'max', [300, 1000, 2500, 5000], 'an overflowing toolbox'),
  f('autopilot', 'sessions', '🤖', 'max', [10, 50, 100], 'an empty airplane cockpit, the yoke moving by itself'),
  f('conductor', 'sessions', '🎼', 'max', [1, 3, 5, 10, 20], "a conductor's baton in front of music stands made of screens"),
  f('swarm', 'sessions', '🐝', 'max', [1, 3, 5, 10, 20], 'a beehive with small robots flying out'),
  f('long-haul', 'sessions', '⏱️', 'max', [30, 60, 180], 'a smoking stopwatch', { unit: 'min' }),
  f('bulldozer', 'sessions', '🚜', 'max', [3000, 8000, 20000, 50000], 'a bulldozer pushing a pile of code lines'),

  // Plan
  f('big-appetite', 'plan', '🍔', 'max', [5, 10, 20, 30], 'a fork stuck into a fuel gauge', { unit: '%' }),
  f('wall-5h', 'plan', '🧱', 'total', [1, 5, 10], 'a paper airplane crashed against a brick wall'),
  f('hell-week', 'plan', '🔥', 'max', [2, 5, 10], 'a calendar on fire'),
  f('out-of-fuel', 'plan', '⛽', 'total', [1, 3, 5], 'an empty fuel gauge with a gliding airplane'),
  f('on-the-edge', 'plan', '🎯', 'total', [1], 'a tightrope walker at the end of the rope', { tier: 'gold' }),
  f('ascetic', 'plan', '🧘', 'total', [1], 'a meditating monk in front of a switched-off screen', { tier: 'bronze' }),

  // Multitasking
  f('juggler', 'multitasking', '🤹', 'max', [3, 5, 8, 12], 'a juggler with balls shaped like chat bubbles'),
  f('traffic-jam', 'multitasking', '🚦', 'max', [3, 5, 8], 'a queue of airplanes waiting on the tarmac'),
  f('reflex', 'multitasking', '⚡', 'total', [100, 500, 2000], 'a lightning bolt striking a send button'),
  f('inbox-zero', 'multitasking', '📭', 'max', [10, 15, 25], 'an empty, sparkling mailbox'),

  // Decisions
  f('decider', 'decisions', '🗳️', 'total', [50, 250, 1000], 'an APPROVED rubber stamp coming down'),
  f('go', 'decisions', '👍', 'total', [50, 500, 2000], 'a giant thumbs up'),
  f('eyes-closed', 'decisions', '🙈', 'max', [10, 20, 50], 'a blindfolded pilot at the controls'),
  f('rebel', 'decisions', '😈', 'total', [10, 50, 100], 'a little devil ticking the wrong box'),
  f('teacher', 'decisions', '🧑‍🏫', 'total', [10, 50], 'a blackboard covered with diagrams'),
  f('perfectionist', 'decisions', '🎨', 'max', [3, 5, 10], 'a pile of crumpled sketches'),
  f('perfection', 'decisions', '💎', 'total', [50, 100, 500], 'a flawless shining diamond with a chef kiss sparkle'),

  // Git and worktrees
  f('courier', 'git', '📦', 'total', [10, 100, 500, 2000], 'a parcel leaving on a conveyor belt'),
  f('liftoff', 'git', '🚀', 'total', [10, 100, 500], 'a rocket lifting off from a tree branch'),
  f('arborist', 'git', '🌳', 'total', [1, 5, 20, 50], 'a tree whose branches carry small folders'),
  f('lumberjack', 'git', '🪓', 'total', [5, 20], 'an axe planted in a tree stump'),

  // Rhythm
  f('night-owl', 'rhythm', '🦉', 'total', [1, 10, 50], 'an owl wearing a pilot headset in front of a screen'),
  f('early-bird', 'rhythm', '🌅', 'total', [1, 10, 50], 'a steaming coffee cup in front of a sunrise'),
  f('no-weekend', 'rhythm', '📆', 'total', [1, 5, 20], 'an empty deckchair next to a switched-on computer'),
  f('streak', 'rhythm', '🔁', 'max', [7, 30, 100, 365], 'a chain of flaming links', { unit: 'd' }),
  f('holiday', 'rhythm', '🎄', 'total', [1], 'a Santa hat on a keyboard', { tier: 'silver' }),

  // Remote
  f('remote-pilot', 'remote', '📱', 'total', [1, 50, 500], 'a smartphone with a radar antenna'),
  f('couch', 'remote', '🛋️', 'total', [1, 10, 50], 'a sofa with a remote control shaped like a control tower'),
  f('globetrotter', 'remote', '🌍', 'total', [1, 10, 50], 'a suitcase covered with travel stickers, a screen sticking out'),

  // Accidents
  f('red-button', 'accidents', '🛑', 'total', [10, 50, 200], 'a big red button under a lifted safety cover'),
  f('clean-slate', 'accidents', '🧹', 'max', [25, 50, 80], 'a broom pushing a mountain of tokens', { unit: '%' }),
  f('it-happens', 'accidents', '💥', 'total', [10, 50, 200], 'a storm cloud with the number 529'),
  f('insomniac', 'accidents', '🌙', 'max', [1, 6, 24], 'a terminal window with tired eyes and a coffee mug', { unit: 'h' }),
  f('sentinel', 'accidents', '🔐', 'total', [100, 500], 'a guard with a stamp in front of a barrier'),

  // Secrets: hidden until unlocked
  f('em-dash', 'secrets', '✒️', 'max', [1], 'a fountain pen drawing a single long dash', { tier: 'legend', secret: true }),
  f('polite', 'secrets', '🙏', 'total', [100], 'two hands pressed together with a small heart', { tier: 'silver', secret: true }),
  f('huh', 'secrets', '❓', 'max', [1], 'a giant question mark with a puzzled face', { tier: 'bronze', secret: true }),
  f('hourglass', 'secrets', '⏳', 'max', [1], 'an hourglass covered in cobwebs', { tier: 'silver', secret: true }),
  f('outburst', 'secrets', '🤬', 'max', [1], 'a keyboard with the caps lock key on fire', { tier: 'bronze', secret: true }),
  f('first-flight', 'secrets', '🐣', 'max', [1], 'a chick hatching from an egg wearing aviator goggles', { tier: 'bronze', secret: true }),
  f('inception', 'secrets', '🪞', 'max', [1], 'a control tower reflected infinitely in a mirror', { tier: 'gold', secret: true }),
  f('collector', 'secrets', '🏆', 'max', [1], 'a glass trophy cabinet full of medals', { tier: 'platinum', secret: true, computed: true }),
];

/** Tier of milestone i of a family (single milestone: its `tier`). */
export const tierOf = (family, i) => (family.thresholds.length === 1 && family.tier ? family.tier : TIERS[i]);

/** Display name of a family, in the current language. */
export const nameOf = family => t(`achievements.families.${family.id}.name`);

/** Readable description: {n} replaced by the given threshold, otherwise by all of them joined by « / ». */
export const descOf = (family, threshold) => t(`achievements.families.${family.id}.desc`, {
  n: (threshold != null ? [threshold] : family.thresholds).map(s => s.toLocaleString(locale())).join(' / '),
});

/** A rank with its display name (what leaves the engine). */
export const rankView = rank => (rank ? { ...rank, name: t(`achievements.ranks.${rank.id}`) } : null);

/** Categories with their display names. */
export const categoriesView = () => CATEGORIES.map(c => ({ ...c, name: t(`achievements.categories.${c.id}`) }));
