// driver texts (en).
export default {
  feed: {
    schemaNotRendered: '⚠ panel diagram "{key}" could not be rendered, sent back to Claude to fix',
    runningInBackground: 'This conversation is already running in another Claude Code, in the background ({id}).',
    sessionStopped: 'The Claude session stopped: your next message restarts it.',
    compacted: p => `🗜 Context compacted${p.auto ? ' automatically' : ''}${p.k ? ` (${p.k}k tokens before)` : ''}: Claude continues from a summary of the conversation.`,
    cleared: 'Conversation cleared: Claude starts from scratch, Tracker panel and header included',
    planExhausted: p => `${p.window ? `${p.window} limit` : 'Plan limit'} reached: Claude and its subagents are stopped${p.reset ? ` until ${p.reset}` : ''}.`,
    planWarning: p => `${p.window ? `${p.window} limit` : 'Plan limit'}${p.pct != null ? ` ${p.pct} % used` : ' almost reached'}${p.reset ? `, resets ${p.reset}` : ''}.`,
    apiError: 'API error',
    doneSubagent: 'subagent "{name}"',
    doneCommand: 'command "{name}"',
    doneInBackground: '🔔 finished in the background: {names}, Claude resumes',
    messageToSubagent: '✉ message passed on to subagent "{name}"',
  },
  errors: {
    unknownSubagent: 'unknown subagent, or no id to write to it',
  },
  planWindow: {
    five_hour: '5-hour',
    seven_day: 'Weekly',
    seven_day_opus: 'Weekly Opus',
    seven_day_sonnet: 'Weekly Sonnet',
    overage: 'Extra credits',
  },
  plan: {
    at: ' at ', // between the day and the hour of a reset date
  },
  usage: {
    session: 'Session (5 h)',
    week: 'Week',
    weekModel: 'Week · {model}',
  },
};
