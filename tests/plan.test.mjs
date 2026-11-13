import { test } from 'node:test';
import assert from 'node:assert/strict';
import { advancePlan } from '../engine/achievements/plan.mjs';

const H = (j, h) => new Date(2026, 10, j, h); // November 2026
const R1 = Date.UTC(2026, 10, 16) / 1000, R2 = Date.UTC(2026, 10, 23) / 1000;
const smp = (pct, reset = R1, plan = 'max', extra = {}) => ({ plan, week: { pct, reset }, ...extra });
function run(samples) {
  let state = null; const evs = [];
  for (const [r, d] of samples) { const x = advancePlan(state, r, d); state = x.state; evs.push(...x.events); }
  return { state, evs, max: id => Math.max(0, ...evs.filter(e => e.id === id).map(e => e.value)), n: id => evs.filter(e => e.id === id).length };
}

test('increase during the day', () => {
  assert.equal(run([[smp(41), H(13, 9)], [smp(44), H(13, 12)], [smp(47), H(13, 18)]]).max('big-appetite'), 6);
});

test('plan change: no jump', () => {
  const s = run([[smp(41), H(13, 9)], [smp(47), H(13, 12)], [smp(10, R1, 'pro'), H(13, 13)], [smp(15, R1, 'pro'), H(13, 15)]]);
  assert.equal(s.max('big-appetite'), 11);
});

test('a % going down does not count', () => {
  const s = run([[smp(90), H(13, 9)], [smp(5, R2 + 86400), H(13, 10)], [smp(7, R2 + 86400), H(13, 11)]]);
  assert.equal(s.max('big-appetite'), 2);
});

test('midnight resets the day usage', () => {
  const s = run([[smp(10), H(13, 9)], [smp(20), H(13, 22)], [smp(22), H(14, 1)], [smp(25), H(14, 2)]]);
  assert.equal(s.state.dayUsage, 3);
});

test('5-hour windows and hell week', () => {
  const c = (pct, reset) => ({ ...smp(30), fiveHours: { pct, reset } });
  const s = run([[c(100, 'a'), H(13, 9)], [c(100, 'a'), H(13, 9)], [c(100, 'b'), H(13, 15)]]);
  assert.equal(s.n('wall-5h'), 2);
  assert.equal(s.max('hell-week'), 2);
});

test('out of fuel once per week', () => {
  const s = run([[smp(100), H(13, 9)], [smp(100), H(13, 10)], [{ plan: 'max', rejection: { type: 'seven_day', reset: R1 } }, H(13, 11)]]);
  assert.equal(s.n('out-of-fuel'), 1);
});

test('end of week: on the edge, ascetic, plan changed', () => {
  const end = new Date(R1 * 1000 + 3600_000);
  assert.equal(run([[smp(97), H(14, 9)], [smp(1, R2), end]]).n('on-the-edge'), 1);
  assert.equal(run([[smp(5), H(11, 9)], [smp(10), H(12, 9)], [smp(15), H(14, 9)], [smp(1, R2), end]]).n('ascetic'), 1);
  assert.equal(run([[smp(5), H(11, 9)], [smp(10, R1, 'pro'), H(12, 9)], [smp(15, R1, 'pro'), H(14, 9)], [smp(1, R2, 'pro'), end]]).n('ascetic'), 0);
});
