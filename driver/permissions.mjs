// Questions and permissions: SDK canUseTool, cards waiting for the page's answer.
import { summarizeTool } from './events.mjs';
import { MODES, afterPlan } from './modes.mjs';

/** Returns `{ awaitAnswer, canUseTool }`; sets `s.answer` (the page's answer to a card). */
export function attachPermissions(ctx) {
  const { s, pending, newId, pushEvent, setStatus } = ctx;

  /** Waits for the page's answer to a card (question or permission). */
  function awaitAnswer(ev, signal) {
    ev.shownAt = Date.now(); // answer delay (achievements Reflex, Hourglass)
    pushEvent(ev);
    setStatus('waiting');
    return new Promise(resolve => {
      pending.set(ev.id, resolve);
      signal?.addEventListener('abort', () => { pending.delete(ev.id); pushEvent({ ...ev, state: 'cancelled' }); resolve(null); }, { once: true });
    });
  }

  const canUseTool = async (tool, input, { signal }) => {
    if (tool === 'AskUserQuestion') {
      const r = await awaitAnswer({ id: newId(), t: 'question', questions: input.questions, state: 'pending' }, signal);
      setStatus('working');
      if (!r) return { behavior: 'deny', message: 'Question cancelled.' };
      return { behavior: 'allow', updatedInput: { questions: input.questions, answers: r.answers } };
    }
    // End of plan mode: the plan to approve, executed in the mode chosen on the card (as in the terminal)
    if (tool === 'ExitPlanMode') {
      const back = afterPlan(s.prePlan);
      const r = await awaitAnswer({ id: newId(), t: 'plan', plan: String(input?.plan || ''), back, state: 'pending' }, signal);
      setStatus('working');
      if (!r) return { behavior: 'deny', message: 'Plan review cancelled.' };
      if (!r.mode) return { behavior: 'deny', message: r.clarification ? `Keep planning. The developer says: ${r.clarification}` : 'The developer wants to keep planning.' };
      const mode = MODES[r.mode] && r.mode !== 'plan' ? r.mode : back;
      // The approved plan goes back to Claude in the tool result: the developer's clarification travels with it
      const plan = r.clarification ? `${input.plan || ''}\n\nDeveloper's note on approval: ${r.clarification}` : input.plan;
      s.syncMode(mode);
      return { behavior: 'allow', updatedInput: { ...input, plan }, updatedPermissions: [{ type: 'setMode', mode: MODES[mode], destination: 'session' }] };
    }
    const r = await awaitAnswer({ id: newId(), t: 'permission', tool, summary: summarizeTool(tool, input), state: 'pending' }, signal);
    setStatus('working');
    if (!r?.allow) return { behavior: 'deny', message: r?.clarification ? `Denied: ${r.clarification}` : 'Denied by the developer.' };
    return { behavior: 'allow', updatedInput: input };
  };

  /** Card blocking the session (`permission`, then `plan`, then `question`), otherwise null: the list shows it in red. */
  s.blocked = () => {
    const types = [...pending.keys()].map(id => s.feed.find(x => x.id === id)?.t);
    return types.includes('permission') ? 'permission' : types.includes('plan') ? 'plan' : types.includes('question') ? 'question' : null;
  };

  s.answer = (id, answer) => {
    const resolve = pending.get(id);
    if (!resolve) return false;
    pending.delete(id);
    const ev = s.feed.find(x => x.id === id);
    if (ev) pushEvent({ ...ev, state: 'answered', answer });
    // Achievements: XP of the card, answer delay, permissions accepted, questions answered
    const delay = ev?.shownAt ? Date.now() - ev.shownAt : null;
    ctx.achievements.xp(10);
    if (delay != null && delay < 30_000) ctx.achievements.add('reflex');
    if (delay != null && delay >= 8 * 3600_000) ctx.achievements.record('hourglass', 1);
    if (ev?.t === 'permission' && answer?.allow) ctx.achievements.add('sentinel');
    if (ev?.t === 'question' && answer) ctx.achievements.add('decider');
    resolve(answer);
    return true;
  };

  return { awaitAnswer, canUseTool };
}
