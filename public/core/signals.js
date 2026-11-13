// Tiny signal store (close to Angular): signal, computed, effect, batch.
// Effects are grouped in a microtask; equality by Object.is; an effect only subscribes to what it read
// during its last run.

let observer = null;   // effect or computation running: receives the reads
let batchDepth = 0;
const pending = new Set(); // effects to rerun
let scheduled = false;

function track(subscribers) {
  if (observer) { subscribers.add(observer); observer.sources.add(subscribers); }
}

function notifyAll(subscribers) {
  for (const o of [...subscribers]) o.dirty();
}

function schedule(effect) {
  pending.add(effect);
  if (batchDepth || scheduled) return;
  scheduled = true;
  queueMicrotask(flush);
}

function flush() {
  scheduled = false;
  while (pending.size) {
    const effects = [...pending];
    pending.clear();
    // An effect that throws must not prevent the others from running
    for (const e of effects) if (!e.stopped) { try { e.run(); } catch (err) { console.error(err); } }
  }
}

/** Readable value `s()`, writable with `s.set(v)`, `s.update(f)`; `s.notify()` after an in-place mutation. */
export function signal(value) {
  const subscribers = new Set();
  const read = () => { track(subscribers); return value; };
  read.set = v => { if (Object.is(v, value)) return; value = v; notifyAll(subscribers); };
  read.update = f => read.set(f(value));
  read.notify = () => notifyAll(subscribers);
  return read;
}

function unsubscribe(o) {
  for (const subscribers of o.sources) subscribers.delete(o);
  o.sources.clear();
}

/** Derived value, recomputed only if a source changed since the last read. */
export function computed(f) {
  const subscribers = new Set();
  let value, dirty = true;
  const node = {
    sources: new Set(),
    dirty() { if (!dirty) { dirty = true; notifyAll(subscribers); } },
  };
  return () => {
    track(subscribers);
    if (dirty) {
      unsubscribe(node);
      const before = observer;
      observer = node;
      try { value = f(); } finally { observer = before; }
      dirty = false;
    }
    return value;
  };
}

/** Runs `f` right away, then reruns it (in a microtask) when what it read changes. Returns `stop()`. */
export function effect(f) {
  const node = {
    sources: new Set(),
    stopped: false,
    dirty() { schedule(node); },
    run() {
      unsubscribe(node);
      const before = observer;
      observer = node;
      try { f(); } finally { observer = before; }
    },
  };
  node.run();
  return () => { node.stopped = true; pending.delete(node); unsubscribe(node); };
}

/** Groups several `set()` calls: a single pass of the effects at the end. */
export function batch(f) {
  batchDepth++;
  try { f(); } finally {
    if (--batchDepth === 0 && pending.size && !scheduled) { scheduled = true; queueMicrotask(flush); }
  }
}
