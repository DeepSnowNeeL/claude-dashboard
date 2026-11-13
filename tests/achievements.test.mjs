import { test } from 'node:test';
import assert from 'node:assert/strict';
import { setLanguage } from '../public/i18n/index.js';
import { FAMILIES, tierOf, nameOf, descOf, rankView } from '../engine/achievements/definitions.mjs';
import { compute, isRound } from '../engine/achievements/compute.mjs';

const fam = id => FAMILIES.find(f => f.id === id);
const toolbox = { value: 1412, log: [[300, 'd1', 's'], [1000, 'd2', 's'], [1412, 'd3', 's']] };

test('tiers', () => {
  assert.deepEqual([0, 1, 2, 3].map(i => tierOf(fam('bulldozer'), i)), ['bronze', 'silver', 'gold', 'platinum']);
  assert.equal(tierOf(fam('em-dash'), 0), 'legend');
});

test('milestone earned and dated by the log', () => {
  const r = compute({ records: { toolbox } }).families.find(f => f.id === 'toolbox');
  assert.deepEqual(r.milestones.map(m => [m.earned, m.date]), [[true, 'd1'], [true, 'd2'], [false, null], [false, null]]);
});

test('buff: lowered thresholds, dates taken from the log', () => {
  const defs = FAMILIES.map(f => (f.id === 'toolbox' ? { ...f, thresholds: [250, 1200] } : f));
  const r = compute({ records: { toolbox } }, defs).families.find(f => f.id === 'toolbox');
  assert.deepEqual(r.milestones.map(m => m.date), ['d1', 'd3']);
});

test('xp and level', () => {
  const a = compute({ activityXp: 0, records: { toolbox } });
  assert.equal(a.xp, 350);
  assert.equal(a.level, 1);
  const b = compute({ activityXp: 132050, records: { toolbox } });
  assert.equal(b.level, 23);
  assert.equal(b.rank.id, 'captain');
});

test('collector: all the other secrets earned', () => {
  const records = Object.fromEntries(FAMILIES.filter(f => f.secret && !f.computed).map(f => [f.id, { value: f.thresholds[0], log: [[f.thresholds[0], 'd', 's']] }]));
  const r = compute({ records });
  assert.ok(r.earned.includes('collector:0'));
  delete records.polite;
  assert.ok(!compute({ records }).earned.includes('collector:0'));
});

test('round values', () => {
  assert.equal(isRound(12), true);
  assert.equal(isRound(13), false);
  assert.equal(isRound(7500), true);
  assert.equal(isRound(2000), true);
  assert.equal(isRound(0), false);
});

test('names, descriptions and ranks in both languages', () => {
  setLanguage('fr');
  assert.equal(nameOf(fam('em-dash')), 'Cadratin');
  assert.equal(descOf(fam('bulldozer')), '3 000 / 8 000 / 20 000 / 50 000 lignes écrites dans une session');
  assert.equal(rankView(compute({ activityXp: 132050 }).rank).name, 'Commandant de bord');
  setLanguage('en');
  assert.equal(nameOf(fam('em-dash')), 'Em dash');
  assert.equal(descOf(fam('toolbox')), '300 / 1,000 / 2,500 / 5,000 tool calls in one session');
  // Every family, category and rank has its texts in both dictionaries
  for (const lang of ['fr', 'en']) {
    setLanguage(lang);
    for (const f of FAMILIES) {
      assert.notEqual(nameOf(f), `achievements.families.${f.id}.name`, `${lang} ${f.id}`);
      assert.ok(!descOf(f).startsWith('achievements.'), `${lang} ${f.id}`);
    }
  }
  setLanguage('en');
});

import { analyzeMessage, momentOf } from '../engine/achievements/message.mjs';

test('analyzeMessage', () => {
  assert.equal(analyzeMessage('go').short, true);
  assert.equal(analyzeMessage('/go').short, false);
  assert.equal(analyzeMessage('Merci !').thanks, true);
  assert.equal(analyzeMessage('mercimerci').thanks, false);
  assert.equal(analyzeMessage("C'est PARFAIT").perfect, true);
  assert.equal(analyzeMessage('?').huh, true);
  assert.equal(analyzeMessage('POURQUOI CA NE MARCHE PAS').allCaps, true);
  assert.equal(analyzeMessage('POURQUOI ça').allCaps, false);
  const decisions = [
    { recommendation: 'Clé', choices: [{ label: 'Clé', answer: 'clé aléatoire ok' }, { label: 'Id', answer: 'id' }] },
    { recommendation: 'A', choices: [{ label: 'A', answer: 'a' }] },
    { recommendation: 'A', choices: [{ label: 'A', answer: 'oui' }, { label: 'B', answer: 'non' }] },
  ];
  assert.deepEqual(analyzeMessage('1. clé aléatoire ok\n2. explique-moi plus en détail\n3. non\n4. rien', decisions).lines,
    [{ n: 1, follows: true }, { n: 2, explain: true }, { n: 3, follows: false }]);
  assert.deepEqual(analyzeMessage('2. Explain in more detail', decisions).lines, [{ n: 2, explain: true }]);
});

test('momentOf', () => {
  const m = momentOf(new Date(2026, 11, 26, 3, 10)); // Saturday December 26, 2026, 3:10 am
  assert.equal(m.night, '2026-12-26');
  assert.equal(m.morning, null);
  assert.deepEqual(m.weekend, { key: '2026-12-26', day: 'sat' });
  assert.equal(momentOf(new Date(2026, 11, 27, 6)).weekend.key, '2026-12-26');
  assert.equal(momentOf(new Date(2026, 11, 25, 12)).holiday, true);
  assert.equal(momentOf(new Date(2027, 0, 1, 6)).morning, '2027-01-01');
});

test('level 1 bar: from 0 to 1,000 XP', () => {
  const r = compute({ activityXp: 170 });
  assert.equal(r.level, 1);
  assert.equal(r.levelXp, 0);
  assert.equal(r.nextLevelXp, 1000);
});
