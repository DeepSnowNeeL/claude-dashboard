// Permission modes of a driven session: dashboard key → SDK PermissionMode. Pure, tested in tests/modes.test.mjs.

/** In the order of the selector, from the most permissive. 'plan': read only, Claude proposes a plan to approve. */
export const MODES = { all: 'bypassPermissions', auto: 'auto', edits: 'acceptEdits', ask: 'default', plan: 'plan' };

/** Dashboard key of an SDK mode, null if it has none (dontAsk). */
export const modeKey = sdk => Object.keys(MODES).find(k => MODES[k] === sdk) ?? null;

// How much a mode lets through without the developer (plan: read only, not ranked)
const RANK = { ask: 0, edits: 1, auto: 2, all: 3 };

/** Mode that executes: the session's own, 'ask' for 'plan' (or an unknown key). */
const executing = m => (m in RANK ? m : 'ask');

/**
 * Mode of a session launched by another (launch_session): never more permissive than its parent, a parent in plan
 * launching in 'ask'. A child asked in plan gets, as its mode after the plan, the parent's executing mode.
 * Returns `{ mode, prePlan }` (`prePlan` only for a child in plan).
 */
export function childMode(parent, requested) {
  const cap = executing(parent);
  if (requested === 'plan') return { mode: 'plan', prePlan: cap };
  const wanted = requested in RANK ? requested : cap;
  return { mode: RANK[wanted] <= RANK[cap] ? wanted : cap };
}

/** Mode to go back to when a plan is approved: the one before the plan, 'all' by default (as a new session). */
export const afterPlan = prePlan => (prePlan in RANK ? prePlan : 'all');
