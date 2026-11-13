import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dash-ach-'));
process.env.DASH_DIR = dir;
let P, FAMILIES;
before(async () => {
  (await import('../public/i18n/index.js')).setLanguage('en');
  P = await import('../engine/progress.mjs');
  ({ FAMILIES } = await import('../engine/achievements/definitions.mjs'));
});
const file = () => path.join(dir, 'progress.json');
const restart = () => { fs.rmSync(file(), { force: true }); P.loadProgress(); };

test('record keeps the max, log at round values and the current one', () => {
  restart();
  for (const v of [5, 11, 13, 12, 14, 300, 301]) P.record('toolbox', v, 's');
  const r = P.achievementState().records.toolbox;
  assert.equal(r.value, 301);
  // 13 replaced by 14 (same bracket, between 12 and 15); 12 ignored (not a record)
  assert.deepEqual(r.log.map(e => e[0]), [5, 11, 14, 300, 301]);
});

test('add accumulates', () => {
  restart();
  P.add('courier'); P.add('courier', 4);
  assert.equal(P.achievementState().records.courier.value, 5);
});

test('corrupt file: set aside, start from zero', () => {
  fs.writeFileSync(file(), '{not json');
  P.loadProgress();
  assert.ok(fs.existsSync(`${file()}.corrupt`));
  assert.equal(P.achievementState().activityXp, 0);
});

test('nerf on reload: milestone removed without announcement', () => {
  restart();
  P.record('toolbox', 400, 's');
  assert.ok(P.achievementState().announcements.includes('toolbox:0'));
  P.writeProgress();
  const before = P.announcementsSince(0).n;
  const defs = FAMILIES.map(f => (f.id === 'toolbox' ? { ...f, thresholds: [500, 1000] } : f));
  P.loadProgress(defs);
  assert.ok(!P.achievementState().announcements.includes('toolbox:0'));
  assert.equal(P.announcementsSince(before).announcements.length, 0);
  P.writeProgress();
  P.loadProgress(); // buff (back to the thresholds): announced again
  assert.ok(P.announcementsSince(before).announcements.some(a => a.family === 'toolbox'));
});

test('unearned secret: no name, no description, no emoji', () => {
  restart();
  const v = P.progressView().families.find(f => f.id === 'em-dash');
  assert.equal(v.name, undefined);
  assert.equal(v.emoji, undefined);
  assert.equal(v.desc, undefined);
  P.record('em-dash', 1);
  assert.equal(P.progressView().families.find(f => f.id === 'em-dash').name, 'Em dash');
});

test('xp and level gained announced', () => {
  restart();
  const before = P.announcementsSince(0).n;
  P.gainXp(250 * 4); // level 2
  assert.equal(P.progressView().level, 2);
  assert.ok(P.announcementsSince(before).announcements.some(a => a.type === 'level' && a.level === 2));
});
