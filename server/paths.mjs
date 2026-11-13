// Allowed paths: known projects, sensitive files.
import path from 'node:path';
import { DASH_DIR, WORKSPACE_DIR, norm } from '../common.mjs';
import { tree } from '../projects.mjs';
import { engine } from './engine-client.mjs';
import { isSensitive } from './sensitive.mjs';

export { isSensitive };

// --- Projects and allowed paths ----------------------------------------------------------------

export async function knownProjects() {
  const known = await engine('/api/sessions').catch(() => []);
  return tree(known.map(s => s.cwd));
}
/**
 * File that can be served, listed or opened. From the PC: everything (`*.local` included), except sensitive files (a
 * path quoted by Claude can be anywhere: report in ~/.claude, temporary file…). From the wifi or the internet:
 * only the dashboard projects and ~/.claude-dashboard, without the sensitive files either.
 */
export async function isPathAllowed(file, req) {
  if (isSensitive(file, req)) return false;
  if (req?.fromPc) return true;
  return !!(await rootOf(file));
}

/**
 * Deepest allowed root (worktree of a project, ~/.claude-dashboard, workspace in server mode) holding `file`, or null.
 * Server mode: the workspace too (the cloned repositories, before any session runs in them).
 */
export async function rootOf(file) {
  const c = norm(file);
  const roots = [...(await knownProjects()).flatMap(p => p.worktrees.map(w => w.path)), DASH_DIR, ...(WORKSPACE_DIR ? [WORKSPACE_DIR] : [])];
  const inside = roots.filter(r => c === norm(r) || c.startsWith(norm(r) + path.sep));
  return inside.sort((a, b) => b.length - a.length)[0] || null;
}
