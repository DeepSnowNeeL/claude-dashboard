// common texts (en).
export default {
  appTitle: 'Claude Dashboard',
  appTitleUnread: '({n}) Claude Dashboard',
  closeEsc: 'Close (Esc)',
  updateBanner: {
    engine: 'The engine runs an older version of the code (update pulled).',
    page: 'The page runs an older version of the code (update pulled).',
    both: 'The engine and the page run an older version of the code (update pulled).',
    restart: 'Restart',
    waiting: 'Restarting as soon as these sessions are idle: {list}',
    restarting: 'Restarting…',
  },
  upstream: {
    news: { one: '1 update on GitHub', other: '{n} updates on GitHub' },
    newsFork: { one: '1 update to bring into your fork', other: '{n} updates to bring into your fork' },
    update: 'Update',
    integrate: 'Bring in',
    dismiss: 'Ignore until the next ones',
    whatsNew: "What's new (CHANGELOG)",
    noChangelog: 'No CHANGELOG line: see the commits on GitHub.',
    explain: 'A Claude session opens in this folder: it fetches GitHub, merges with your changes, resolves the conflicts, then restarts the engine as soon as the sessions are idle. It pushes nothing.',
    launch: '▶ Start the session',
    cancel: 'Cancel',
    prompt: p => `Update Claude Dashboard (this folder, ${p.root}) with what is new on its public repository ${p.url} (branch ${p.branch}): ${p.behind} commit(s) not here yet.${p.fork ? ' This checkout has changes of its own (a fork or local commits): they must be kept.' : ''}

1. \`git status\`: if there are uncommitted changes, tell me and ask whether to commit them or stash them first.
2. \`git fetch ${p.url} ${p.branch}:refs/dash/upstream\` (the dashboard already did it, do it again to be up to date), then show me in a few lines what changes for me (the new lines of CHANGELOG.md).
3. Merge \`refs/dash/upstream\` into the current branch with \`git merge\` (never rebase nor reset: my own commits stay as they are). On a conflict, keep both my changes and the new features; ask me only when it is a real choice between the two.
4. \`npm install\` if package.json or package-lock.json changed, then \`npm test\`.
5. Restart: \`node dash.mjs restart\` for the page, then \`node dash.mjs restart-engine --deferred\` for the engine (never --force: this session runs in it, it comes back paused).
6. Push nothing unless I ask.`,
  },
  context: {
    title: 'Context: {context} of a {window} window ({pct} %)',
    now: p => (p.window ? `${p.context} / ${p.window} · ${p.pct} %` : p.context),
    max: p => (p.window ? `${p.context} max · ${p.pct} %` : `${p.context} max`),
  },
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
  offline: {
    title: 'The computer cannot be reached',
    text: 'It is probably turned off or asleep, or the dashboard is not running on it.',
    retry: 'Try again',
    trying: 'Connecting…',
    still: 'Still unreachable ({time}), next automatic try in 15 s.',
  },
  updating: {
    title: 'Updating',
    text: 'The dashboard is restarting, it will be back in a moment.',
    long: 'This is taking longer than expected, the page will reload as soon as it answers.',
  },
  modes: {
    all: '⚡ allow everything',
    allTitle: 'No prompt: every tool runs (like claude --dangerously-skip-permissions)',
    auto: '🤖 auto',
    autoTitle: 'A classifier approves each tool and asks when unsure',
    edits: '✏️ accept edits',
    editsTitle: 'File edits go through without asking, the rest asks',
    ask: '✋ ask before each tool',
    askTitle: 'A permission card before each sensitive tool',
    plan: '📋 plan',
    planTitle: 'Read only: Claude explores and proposes a plan to approve before changing anything',
    unavailable: '(unavailable for this model)',
  },
};
