import { test } from 'node:test';
import assert from 'node:assert/strict';
import { signal, computed, effect, batch } from '../public/core/signals.js';

const tick = () => Promise.resolve();

test('read and write', () => {
  const s = signal(1);
  s.set(2);
  assert.equal(s(), 2);
});

test('effect rerun once per batch', async () => {
  const s = signal(0);
  let n = 0;
  effect(() => { s(); n++; });
  assert.equal(n, 1);
  s.set(1);
  s.set(2);
  await tick();
  assert.equal(n, 2);
});

test('computed follows its sources', () => {
  const s = signal(1);
  const d = computed(() => s() * 2);
  assert.equal(d(), 2);
  s.set(3);
  assert.equal(d(), 6);
});

test('same value, no rerun', async () => {
  const s = signal(1);
  let n = 0;
  effect(() => { s(); n++; });
  s.set(s());
  await tick();
  assert.equal(n, 1);
});

test('notify after mutation', async () => {
  const s = signal([]);
  let n = 0;
  effect(() => { s(); n++; });
  s().push(1);
  s.notify();
  await tick();
  assert.equal(n, 2);
});

test('dynamic dependencies', async () => {
  const a = signal(true), b = signal(0);
  let n = 0;
  effect(() => { if (a()) b(); n++; });
  a.set(false);
  await tick();
  assert.equal(n, 2);
  b.set(1);
  await tick();
  assert.equal(n, 2);
});

test('stop', async () => {
  const s = signal(0);
  let n = 0;
  const stop = effect(() => { s(); n++; });
  stop();
  s.set(1);
  await tick();
  assert.equal(n, 1);
});

test('an effect that throws does not block the other pending effects', async () => {
  const s = signal(0);
  let n = 0;
  const errors = [];
  const before = console.error;
  console.error = (...a) => errors.push(a);
  try {
    effect(() => { if (s() > 0) throw new Error('boom'); });
    effect(() => { s(); n++; });
    s.set(1);
    await tick();
    assert.equal(n, 2);
    assert.equal(errors.length, 1);
  } finally { console.error = before; }
});

test('nested batch: effects only run when leaving the outer batch', async () => {
  const a = signal(0), b = signal(0);
  const seen = [];
  effect(() => { seen.push([a(), b()]); });
  batch(() => {
    a.set(1);
    batch(() => { b.set(2); });
    assert.deepEqual(seen, [[0, 0]]); // nothing has run yet
  });
  await tick();
  assert.deepEqual(seen, [[0, 0], [1, 2]]);
});
