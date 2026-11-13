// common texts (en).
export default {
  appTitle: 'Claude Dashboard',
  appTitleUnread: '({n}) Claude Dashboard',
  closeEsc: 'Close (Esc)',
  time: {
    justNow: 'just now',
    minutesAgo: '{n} min ago',
    hoursAgo: '{n} h ago',
    daysAgo: { one: '{n} day ago', other: '{n} days ago' },
    inMinutes: 'in {n} min',
    minutes: '{n} min',
    atTime: 'at {time}',
  },
  git: {
    modified: 'modified',
    added: 'added',
    deleted: 'deleted',
    untracked: 'new, not tracked yet',
    renamed: 'renamed',
  },
  commands: {
    login: 'Log in to your Claude account (opens a terminal: login goes through the browser)',
    logout: 'Log out of your Claude account (opens a terminal)',
    mcp: 'MCP servers of the session: state, tools, reconnect, enable / disable, authenticate',
    usage: 'Usage: subscription limits, session consumption, dashboard share',
    tracker: 'Compose your tracker: what the Tracker panel shows, and what Claude puts in it',
  },
  side: {
    searchPlaceholder: '🔎 find a session…',
    newSession: '+ New session',
  },
  handles: {
    left: 'Drag to widen the session list · double-click: original width',
    right: 'Drag to widen the panel · double-click: original width',
  },
  mobileNav: {
    sessions: 'Sessions',
    conversation: 'Conversation',
    tracker: 'Tracker',
  },
};
