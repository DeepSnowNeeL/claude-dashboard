import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MODES, modeKey, childMode, afterPlan } from '../driver/modes.mjs';

test('modeKey maps SDK modes back, null for the ones the dashboard does not offer', () => {
  for (const [k, v] of Object.entries(MODES)) assert.equal(modeKey(v), k);
  assert.equal(modeKey('dontAsk'), null);
});

test('a launched session is never more permissive than its parent', () => {
  assert.deepEqual(childMode('all', 'all'), { mode: 'all' });
  assert.deepEqual(childMode('auto', 'all'), { mode: 'auto' });
  assert.deepEqual(childMode('edits', 'auto'), { mode: 'edits' });
  assert.deepEqual(childMode('ask', 'all'), { mode: 'ask' });
  assert.deepEqual(childMode('all', 'ask'), { mode: 'ask' });
  assert.deepEqual(childMode('auto', undefined), { mode: 'auto' });
});

test('a parent in plan launches in ask; a child in plan goes back to the parent mode', () => {
  assert.deepEqual(childMode('plan', 'all'), { mode: 'ask' });
  assert.deepEqual(childMode('plan', undefined), { mode: 'ask' });
  assert.deepEqual(childMode('auto', 'plan'), { mode: 'plan', prePlan: 'auto' });
  assert.deepEqual(childMode('plan', 'plan'), { mode: 'plan', prePlan: 'ask' });
});

test('afterPlan: the mode before the plan, all by default', () => {
  assert.equal(afterPlan('edits'), 'edits');
  assert.equal(afterPlan(undefined), 'all');
  assert.equal(afterPlan('plan'), 'all');
});
