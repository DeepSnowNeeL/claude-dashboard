// --- Guard for local files (mockups) ------------------------------------------------------------
import fs from 'node:fs';
import path from 'node:path';
import { norm } from '../common.mjs';

function declaredPaths(data) {
  const out = [];
  const ex = e => {
    if (!e) return;
    if (e.path) out.push(e.path);
    if (e.left?.path) out.push(e.left.path);
    if (e.right?.path) out.push(e.right.path);
  };
  for (const m of data.mockups || []) {
    if (m.path) out.push(m.path);
    for (const v of m.versions || []) if (v.path) out.push(v.path);
  }
  for (const d of data.decisions || []) ex(d.example);
  for (const c of data.architecture?.layers || []) for (const el of c.elements || []) ex(el.example);
  return out;
}

function gitRoot(file) {
  let d = path.dirname(file);
  for (;;) {
    if (fs.existsSync(path.join(d, '.git'))) return d;
    const parent = path.dirname(d);
    if (parent === d) return path.dirname(file);
    d = parent;
  }
}

export function isAllowed(data, requested) {
  const target = norm(requested);
  return declaredPaths(data).some(c => {
    const root = norm(gitRoot(path.resolve(c)));
    return target === root || target.startsWith(root + path.sep);
  });
}
