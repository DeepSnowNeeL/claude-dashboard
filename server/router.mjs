// Router: method + path matching. Tables have keys like 'GET /api/git/status'; a ':id' segment captures one segment
// of the path (params.id), a trailing '/*' captures all the rest (params['*']), the method '*' matches any method.
// ':id' gives the raw segment, not decoded (%2f stays in it): the handler must validate it before using it.
// A key declared twice (in one table or across tables) makes the creation fail.
// A path without a route gives null: the caller decides (relay to the engine, static files).

/** Pattern of a table key: a list of segments, or a prefix ending with '/*'. */
function pattern(route) {
  if (route.endsWith('/*')) return { prefix: route.slice(0, -1), segments: null };
  return { prefix: null, segments: route.split('/') };
}

function match(m, route) {
  if (m.prefix !== null) return route.startsWith(m.prefix) ? { '*': route.slice(m.prefix.length) } : null;
  const segs = route.split('/');
  if (segs.length !== m.segments.length) return null;
  const params = {};
  for (let i = 0; i < segs.length; i++) {
    if (m.segments[i].startsWith(':')) { if (!segs[i]) return null; params[m.segments[i].slice(1)] = segs[i]; }
    else if (m.segments[i] !== segs[i]) return null;
  }
  return params;
}

export function createRouter(...tables) {
  const exact = new Map(); // 'GET /api/x' → handler
  const seen = new Set();
  const patterns = [];     // routes with parameters or a prefix, in declaration order
  for (const table of tables) {
    for (const [key, handler] of Object.entries(table)) {
      if (seen.has(key)) throw new Error(`route declared twice: ${key}`);
      seen.add(key);
      const [method, route] = key.split(' ');
      if (/[:*]/.test(route)) patterns.push({ method, pattern: pattern(route), handler });
      else exact.set(key, handler);
    }
  }
  return {
    find(method, route) {
      const h = exact.get(`${method} ${route}`) || exact.get(`* ${route}`);
      if (h) return { handler: h, params: {} };
      for (const r of patterns) {
        if (r.method !== method && r.method !== '*') continue;
        const params = match(r.pattern, route);
        if (params) return { handler: r.handler, params };
      }
      return null;
    },
  };
}
