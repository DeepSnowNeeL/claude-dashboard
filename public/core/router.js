// Routing by the address (#slug, #new?cwd=…, or nothing).

/** Calls `f(slug | 'new?cwd=…' | null)` at startup and on every address change. */
export function onRoute(f) {
  const readRoute = () => location.hash.slice(1) || null;
  window.addEventListener('hashchange', () => f(readRoute()));
  return f(readRoute());
}
