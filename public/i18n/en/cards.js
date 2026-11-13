// cards texts (en).
export default {
  clarificationPlaceholder: 'Add a note (optional)…',
  // Sent to Claude in the answer line, before the clarification
  clarificationPrefix: 'Note: ',
  agent: {
    states: { working: 'running', completed: 'done', failed: 'failed', stopped: 'stopped' },
    tools: { one: '{n} tool', other: '{n} tools' },
    background: '(background)',
    seeConversation: 'See its conversation →',
    resumeTitle: 'Asks the session to resume this agent where it stopped (SendMessage, context kept)',
    resume: '↻ Resume this agent',
    relaunched: 'relaunched since (see the most recent tab)',
    resumePrompt: 'Resume the subagent "{description}" (agentId {agentId}) with SendMessage, where it stopped: it was interrupted. Do not launch a new agent.',
  },
  decisions: {
    recommended: 'recommended',
    other: 'Other…',
    explain: 'Explain',
    // Sentence sent to Claude, matched by the instructions and the achievements: do not change it
    explainAnswer: 'explain in more detail',
    yourAnswer: 'Your answer…',
  },
  permission: {
    cancelled: 'cancelled:',
    allowed: '✓ allowed:',
    denied: '✗ denied:',
    question: 'Allow {tool}?',
    clarification: 'Note for Claude (optional, mostly useful when denying)…',
    allow: 'Allow',
    deny: 'Deny',
  },
  plan: {
    question: '📋 Claude proposes this plan',
    clarification: 'Clarification for Claude (optional): what to rework, or an instruction for the execution…',
    approveBack: 'Approve, back to {mode}',
    approveIn: 'Approve in {mode}',
    keepPlanning: 'Keep planning',
    approved: '✓ plan approved, executed in {mode}',
    keptPlanning: '↻ sent back: keep planning',
    cancelled: 'plan cancelled',
  },
  question: {
    cancelled: 'Question cancelled',
    title: 'Question',
    multiSelect: '(several choices allowed)',
    hint: 'A click selects without sending.',
    reply: 'Answer',
    empty: 'Pick an option or write a note.',
  },
  sessionMessage: {
    unknown: 'unknown',
    from: 'Message from session {from}',
    queued: '· queued, sent at the end of the turn',
    showAll: 'show all',
    collapse: 'collapse',
  },
};
