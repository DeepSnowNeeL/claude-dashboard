# claude-dashboard

Local dashboard to follow your Claude Code sessions and make the decisions they need quickly, without reading walls
of text in a console.

## Why

A developer runs several Claude Code sessions in parallel (often one per ticket) and keeps switching from one to the
next. Measured on 5 active sessions: the agent writes 2,000 to 9,000 characters before answers like "go", "perfect",
"1. yes 2. yes". The agent is right in the vast majority of cases: the cost is not deciding, it is **finding out where
the session stands** and **spotting what really needs a decision**. Sessions are too verbose by default.

The goal: every time you come back to a session, see in a few seconds the current step, what is expected from you,
and the design of what is about to be built in visual form, with all the available detail under the questions.

## Principles

- **Summary first, detail within reach**: nothing is deleted, everything that is not a decision comes under the
  questions, in blocks expanded by default and collapsible.
- **Recommended approach set by default**: the explored alternatives and why they were rejected are shown directly;
  we do not make you pick A/B/C when A is clearly better.
- **Explicit and concrete decisions**: each question comes with an example (scenario, before/after code, JSON
  payload, mini mockup if it is UI) and an "Explain in more detail" button.
- **Always able to clarify before answering**: a click on a choice (decision, AskUserQuestion) selects it without
  sending it; an optional "clarification" field goes with it, and nothing leaves before "Send".
- **Mockup before technical design**: validating the visual already validates most choices; the design
  (architecture, database) comes next as an "are we on the same page" check.
- **Fixed UI**: a template that does not move from one session to the next. The session sends **data** (JSON), never
  HTML.
- **Few extra tokens**: one JSON push per step; the console keeps one line per step.
- **Opt-in**: nothing changes in sessions that do not load the skill.

## What the page shows (chosen layout: side by side, chat in the middle)

- **On the left** (a handle between the list and the chat widens it, like the right panel's): a tree projects (git
  repos) → worktrees → sessions, as in Orca. Each level collapses (state kept in the browser); collapsed, it shows its
  counters (⏳ waiting for your answer, ⚙ Claude working). A "+" on each worktree opens the "New session" page of the
  folder: ▶ New session starts it in one click, empty (the first message is typed in its input), or the folder history
  resumes an old one. The folder is set by default (the "+" one, otherwise the one of the last displayed session),
  "change" opens the input; the permission mode is the one of the last session started from this browser (`dash-new-session-mode` in
  `localStorage`); "In a new worktree" (unchecked by default) asks for a branch and creates the worktree next
  to the repo (`createWorktree` of `projects.mjs`, shared with `launch_session`). Within a worktree, the order never
  depends on the status: manual order, otherwise newest to oldest (creation date read from the slug).
  Each session has a `ticket · quick-context` header and a one-sentence description; a dot marks the sessions driven
  by the page, a 🤖 pill the running subagents. A session stopped on a card (question or command to approve, `blocked`
  in the summary) has a red border and a blinking red pill (❓ question, 🔐 command to approve); collapsed, the node
  shows ❗ n in red. **Unread**: a blue dot in the corner counts the new items (Claude text block, agent or shell
  finished, API error) since your last visit (`stats.newItems` and `seen: { n, id }` in the session JSON, `unread` in
  the list); collapsed, the node shows ● n in blue, the tab `(n) Claude Dashboard`. Read = session displayed, window
  visible and in the foreground (`POST /api/sessions/:slug/seen`); on opening or coming back to the window, a blue
  separator "n new items since your last visit" is placed in the feed after the last seen event. Above the projects,
  **groups** (created by hand, or taken from Orca by `POST /api/import-orca`, no button: ask a session; projects sorted
  by drag and drop: onto a group to put it there, onto another project to go above or below it, in a group as outside
  one, order kept in `orders.json` under `projects:ungrouped`); a ⋯ menu opens the editor: name and color of a group
  (vertical bar over its whole height), group, display name, name color, icon (emoji, otherwise the project's
  `logo.png` or Orca's icon) and **ticket URL template** of a project (`ticketUrl`, e.g.
  `https://gitlab.example.com/team/app/-/issues/{n}`: `{n}` is replaced by the ticket number, `ticketLink()` of
  `core/dom.js` builds the header link from it unless the session gives its own) (`~/.claude-dashboard/groups.json`,
  `projects-meta.json`); "Remove from the tree" works for any project: refused while it has open sessions, its ended
  sessions are archived (otherwise it would come back), it comes back if a session opens in it. The sessions of a
  worktree are reordered by drag and drop (`orders.json`; new ones go on top).
  **Right click** (`tree/menu.js`, same box as the path menu): on a session (open, rename, new session in its folder,
  explorer, copy the path, the `claude -r` command or the link, end, archive), on a worktree (new session, explorer,
  copy path and branch, **remove the worktree**: `POST /api/worktree/remove`, PC only, never the main one, refused if
  it has open sessions, one more confirmation if it has uncommitted changes, branch kept, ended sessions archived), on
  a project (the same for its main worktree, edit, remove from the tree).
- **In the middle, the conversation**: header (title, renamable in one click: the chosen name is pinned 📌, Claude no
  longer changes it, empty = automatic name; discreet counters: Claude's time, exchanges, your active time; the
  session's folder 📁 (click: path menu) and its branch ⎇; steps, **model pill** (short name, colour per family;
  click: `supportedModels()` list, `setModel`, choice kept in `modelChoice` and passed again as `model` on resume),
  permission mode), subagent tabs, the feed (messages,
  one collapsed line per group of tools, decision, question, permission and subagent cards, output of `!` commands),
  the input. A click on a choice selects it without sending it. Messages rendered in markdown (`markdown()` of
  `core/dom.js`: quotes, nested lists, tables, headings…; the panel keeps the `rich()` subset); a Claude answer is
  highlighted as a whole on hover, ⧉ at the top right copies its markdown text. A copied selection (Ctrl+C,
  `components/copy.js`) keeps the formatting (headings, bold, lists, tables, code, links) without the page colors.
- **`/` commands**: typing `/` at the start of the input opens the autocompletion of the session's commands and skills
  (`supportedCommands()` of the SDK, minus the terminal-only ones); the command goes as is and Claude Code runs it.
  `/login` and `/logout` open a terminal with `claude auth login` / `logout` (login through the browser).
  `/mcp` (handled by the page, headless Claude Code does not show it) opens the session's MCP servers window (search on
  server and tool names, case and accent insensitive): status (`mcpServerStatus()`), tools, ↻ Reconnect
  (`reconnectMcpServer`), Enable / Disable (`toggleMcpServer`); 🔑 Authenticate opens Claude Code in a terminal on
  `/mcp` (OAuth through the browser), then Reconnect.
  `/usage` (or `/cost`, handled by the page) opens the usage window: what the CLI's `/usage`, `/cost` and `/context`
  show (`usageCli` of the driver: `usage_EXPERIMENTAL…` without `skipBehaviors` and `getContextUsage`, engine route
  `usage-cli`: cost in $ per model, what consumes over 24 h / 7 days with the split per agent, skill, plugin and MCP
  server, its recommendations and "Ask Claude to fix it", context usage per category), consumption of the session and
  share of the dashboard (instructions and tools added to the prompt, `dashboard` tool calls), dashboard / terminal
  comparison over 7 days. Computed in `server/consumption.mjs`, from the transcripts in `~/.claude/projects`
  (instructions measured in the `api-request-shape` lines, tokens weighted by their price; cache per file, first
  computation ≈ 6 s).
- **Send commands**, as buttons depending on the situation and on the keyboard: Enter sends (during a turn: queues it,
  it leaves at the end of the turn; queued messages, including another session's, stay at the end of the feed and
  scroll with it, not in a fixed area); Ctrl+Enter sends right away (Claude reads it at the next tool); Ctrl+X Ctrl+S
  stops and sends; Escape or Ctrl+C (without selection) stops. `!command` runs right away in the session's folder (Git
  Bash on Windows); Claude receives its output with the next message, as in the terminal.
  Ctrl+Tab / Ctrl+Shift+Tab go to the next / previous open (not ended) session, in tree order (in the app; Chrome
  keeps this shortcut for its tabs).
- **On the right, the Tracker** (a handle between the chat and it widens it: width kept in the browser, double-click to
  go back): the blocks of the session's **tracker profile** (see "Tracker profiles"). With "Dev tracker": progress on
  one line, chosen approach and alternatives, key points and tradeoffs side by side, mockups (Open button + older
  versions), architecture, database (with "enlarge"). What changed since your last read is marked in blue (badge on the
  section, highlighted item); a click marks it seen.
  A second tab, **Modified files**, shows the git status of the session's folder (state, +/− lines, read every 10 s),
  then below the branch **commits** (↑ = not pushed yet; a click expands message and files). Files as a list or a
  folder tree (⋯ menu). A click opens the file in **Monaco** (loaded from the CDN): diff with the last commit, or for a
  commit's file the diff of that time (before / after this commit), side by side or inline, unchanged parts folded,
  Alt+← / Alt+→ from one file to the next. The menu of a path clicked in the chat also offers "View in the editor"
  (diff if modified, otherwise read only) and "Open in VS Code" (`POST /api/vscode`, PC only: in the window of its git
  repo). A right click on a modified or commit file opens this same menu.
  Accessible files (`isPathAllowed`): from the PC, any; from the wifi or the internet, only the projects and
  `~/.claude-dashboard`; everywhere, never the sensitive files (Claude credentials, `access.json`, `.ssh`, `.env`,
  keys, names containing token / secret / password / credential; `*.local` only outside the PC).
  In the editor, the folder tree is on the left, centered on the open file (modified files marked by their state,
  folders that contain some tinted): a click opens a neighbour file, as a diff if it changed (not for a commit diff).
  Folders with a single subfolder fit on one line (`main/java/com/example/core`), tree and list scroll sideways, a
  handle on their edge widens them (widths kept in the browser, double-click to go back).
  A third tab, **Explorer**, shows the folder as it is on disk (each folder read when first opened, what git ignores
  greyed; Windows reports changes through `fs.watch`, stream `/api/browse/watch`, and the touched folders are read
  again; right click: path menu, including the Windows explorer and the default application; folders drawn only when
  open; single-subfolder ones on one line, horizontal scrolling), with ⊟ collapse all, **text search** in all the
  files (ripgrep: `DASH_RG`, PATH, or Orca's / VS Code's; otherwise git grep; case and regex options; a result opens
  Monaco on the line) and **Ctrl+P**: fuzzy search on names (word starts, name before folder), Enter opens the file
  and selects it in the tree.
  A selection in the editor shows a 💬 Comment button (no focus taken, the selection can still be copied); a click
  opens the remark bubble: Enter sends to the displayed session the file, the lines
  (`path:L12-L20`, with the version if it is a commit diff), the selected code and the remark.
- **Architecture**: UML style, no file tree or RPC links. Badges `+` added / `~` modified / `−` deleted (not just
  colors). Angular components created and where they are used, impacted `Service.method` with the reason in a few
  words. Each element's example code comes before its description.
  Granularity by the size of the dev: class diagram of one component (inputs, outputs, signals) for a small dev,
  components + services for a medium dev, package diagram for a big dev.
- **Database**: partial physical data model, Merise style (Mermaid `erDiagram`): new tables with their columns,
  neighbour tables reduced to their key to show the relations, `+` / `~` / `−` marks on tables and columns.
  A diagram Mermaid rejects is sent back to Claude (`POST /api/sessions/:slug/schema-error`, once per version of the
  diagram, hash in `reportedSchemas`): it fixes it by itself, a ⚠ line marks it in the feed.

- **Skeleton loading**: what loads is shown right away in its animated grey form (`skeleton()` /
  `sessionSkeleton()` of `core/dom.js`: feed, panel, lines, code), never a frozen page. Resuming a session or creating
  one opens its skeleton view at once, title included, while the engine answers.
- **Mobile** (under 900 px): one panel at a time, chosen by the bottom bar (☰ Sessions, 💬 Conversation, 📋 Tracker;
  dot when a session is waiting); opening a session shows its conversation. Reduced header, input at 16 px (no iOS
  zoom). 📎 attaches a file (everywhere), 📷 takes a photo (mobile), like the Claude app. PC unreachable (off,
  asleep, page server stopped: no answer within 10 s, or Caddy's 502/503/504): the service worker (`public/sw.js`)
  shows `public/offline.html` instead of a white screen, with "Try again" (automatic every 15 s); it caches only that
  page and the `i18n` dictionaries (refreshed from the network each time they load). Update (page or engine restarted:
  `/api/stop` and the engine announce `restarting` on the event stream): the phone shows "Updating" (`components/updating.js`),
  then reloads the whole page when the stream reopens, so it runs the new code.

## How it works

- **The page drives the sessions** (`driver/`, entry point `driver.mjs`): one long `query()` of the Claude Code SDK
  (`@anthropic-ai/claude-agent-sdk`) per session, in streaming input mode. The SDK starts the real Claude Code and uses
  the machine's subscription (no API key). It loads settings, CLAUDE.md, skills and plugins like the terminal
  (`settingSources` user + project + local).
- **Two processes**, so that a restart does not cut the sessions:
  - the **engine** (`engine.mjs`, port 4748, local) holds the sessions, their state and the SSE. It is only restarted
    for a change in `driver/`, `engine/` or `engine.mjs`, with `node dash.mjs restart-engine`: it refuses while a
    turn, an agent or a command is running (`--wait` waits, `--force` cuts); the sessions then come back paused, feed
    and agents rebuilt from the history;
  - the **page** (`server.mjs`, port 4747, also 4749 for remote access) serves the files, the tree, the history, the
    usage, and relays the rest to the engine (which it starts if it is not running). `node dash.mjs restart` restarts
    it without cutting anything; the browser reconnects and reloads everything. Changes in `public/` only need an F5.
- **Layout** (native ES modules, no build, relative imports with extension):
  - `public/`: `app.js` is only the bootstrap (mounts the components, wires SSE and routing). `core/` imports nothing
    outside itself (except `public/i18n`): `signals.js` (`signal`, `computed`, `effect`, `batch`, effects grouped in a microtask,
    `Object.is` equality: replace the value or call `.notify()`), `state.js` (the store: shared signals `sessions`,
    `current`, `detail`, `view`, `gitStatus`…), `dom.js`, `api.js`, `sse.js`, `storage.js`, `router.js` (`#slug`).
    `services/` (import only `core`) hold the data and the calls (`sessions`, `git`, `explorer`, `commands`,
    `projects`, `theme`, `usage`, `access`, `draft`, `options`, `progress`, `desktop`: Windows explorer, existence of a
    path); no HTTP call in the components. `components/` (one folder per area: `tree`, `conversation`, `cards`,
    `tracker`, `side`, `explorer`, `editor`, plus `options.js`, `mcp.js`, `mobile.js`, `usage.js`, `achievements.js`…)
    export a `mountX` (not always with an element parameter); one render per effect (`innerHTML`), except the feed and
    the input, targeted (`conversation/feed.js` adds or replaces an event, the input is never redrawn); two components
    never import each other in a cycle and communicate in three ways: the signals of `state.js`, six DOM
    `CustomEvent`s (`explorer-update`, `explorer-reveal`, `open-palette`, `open-view`, `recall-queue`,
    `input-changed`) and functions passed at mount time by `app.js` (`mountHeader(refresh)`,
    `mountSide(el, renderTracker)`).
    `css/`: `base.css` + one file per area, `style.css` only keeps the `@import`s. In CSS the right panel is `right`
    (`#right`, `.right-tabs`) because `.side` is already the left session list, even though its JS folder is
    `components/side/`.
  - `server/`: `server.mjs` starts HTTP (4747, 4749), assembles the route tables, relays the rest to the engine and
    serves `public/` (500 on exception, 404 if there is neither a route nor a file). `server/router.mjs`
    (`createRouter(...tables)`) maps `'GET /api/x'`, `:param` and `/*` to a handler and returns `null` without a route;
    the tables are in `server/routes/` (sessions, git, explorer, files, projects, access, options, desktop: "PC only"
    routes, `EXECUTABLES`). The topics have their module: `git`, `explorer`, `paths` (`isPathAllowed`), `network`,
    `caddy`, `remote` (`remoteGate`), `engine-client`, `consumption`. The in-page explorer routes are `/api/browse/*`
    (`/api/explorer` is the Windows explorer, PC only).
  - `engine/`: `routes.mjs`, `sessions.mjs`, `registry.mjs` (the `Map`s `sessions` and `drivers`), `board.mjs`
    (`updateBoard`, JSON), `broadcast.mjs` (SSE), `archives.mjs`, `guard.mjs`, plus the achievements modules (below).
  - `driver/`: `index.mjs` (`createSession()`) creates a shared context `ctx` and adds each module's functions to it
    with `Object.assign(ctx, attachX(ctx))` (`input`, `events`, `permissions`, `agents`, `mcp-tools`); the modules call
    each other through `ctx.x()`. Outside `ctx`: `attachments`, `history`, `usage`.
- **Relay** (`node:http`, no Express): SSE `/api/events` (events `update` and `feed`), POST to create a session, send a
  message, answer a card, interrupt, change mode.
- **Request checks** (`server/request-guard.mjs`, against other websites open in the browser and DNS rebinding): the
  page answers only to Host `localhost` / `127.0.0.1` / `[::1]` with its port (any IP address in LAN mode, plus the
  names of `DASH_HOSTS`); a cross-site GET on `/api/` (except the file routes) is refused; a POST / PUT / DELETE needs
  `Origin` = the page itself (no Origin: loopback only, the CLI) and a JSON body, or `x-dash: 1` for a raw upload.
  The engine only accepts the page: Host `127.0.0.1:<port>` and the header `x-dash-engine-token` =
  `DASH_DIR/engine-token` (created by the first process that needs it). Files from elsewhere (`/f/`, `/api/file/`,
  attachments) are served with `Content-Security-Policy: sandbox` when HTML or SVG, mockup iframes have `sandbox`.
  Such a page has an opaque origin, so through the internet gate its images, CSS and scripts would leave without the
  login cookie: the gate redirects it to `/api/file/~<token>/…` or `/f/~<token>/…` (`server/file-tokens.mjs`: read
  token signed with the device key, valid for the page's project root, 12 h), its relative links keep the prefix.
  update_board ignores the engine's keys (`engine/board-fields.mjs`); a session never launches one more permissive than
  itself (`childMode` of `driver/modes.mjs`: all > auto > edits > ask, a session in plan launches in ask), and outside
  "all" its `launch_session`, `message_session`, `end_session` and `set_tracker` calls go through `canUseTool` (only `update_board`, `list_sessions` and `list_trackers` are in `allowedTools`). Sensitive files: `server/sensitive.mjs` (alternate streams and 8.3 names refused on Windows).
- **Questions and permissions**: `canUseTool` of the SDK. AskUserQuestion always goes through it, even in "allow all"
  mode; the other tools depending on the mode. Modes (`driver/modes.mjs`, selector `public/core/modes.js`), as Claude
  Code's Shift+Tab: `all` (bypassPermissions), `auto` (classifier, greyed out when the model does not support it:
  `autoMode` read from `supportedModels()`), `edits` (acceptEdits), `ask` (default), `plan`. The mode really in force
  follows the SDK's `init` / `status` messages (Claude entering plan by itself). ExitPlanMode shows a plan card: approve
  back to the mode before the plan (`prePlanMode`), in accept edits or in ask, or keep planning (clarification sent to
  Claude). The card waits for the page's answer.
- **Tracker panel**: built-in MCP tool `update_board` (MCP server `dashboard`, field merge, `null` erases, parameter
  `state`), the session's instructions in `instructions.en.md` / `instructions.fr.md` (common, chosen by the interface
  language) + those generated from its tracker profile, appended to Claude Code's system prompt when the query starts.
  The state is written to `~/.claude-dashboard/sessions/<slug>.json`.
- **Tracker profiles** (`trackers.mjs`, spec `docs/specs/2026-10-30-customizable-tracker.md`): a profile = `steps`
  (step line of the header), `method` (text added to the instructions), composite `types` and `blocks`
  `{ key, type, title ({n} = count), instruction }` or `{ sideBySide: [...] }`. Human texts are a string or
  `{ "fr": "…", "en": "…" }` (`localizeProfile`). Base types: progress, approach, list, text, checklist, images, files,
  table, code, mermaid, mockups, architecture, db; composite types = list of objects (text, date, image, link, file) as
  `cards`, `timeline` or `rows`. Built in: `trackers/simple.json` (default of a fresh install), `trackers/dev.json`
  (steps, a dev method that takes precedence over a brainstorming skill, and the blocks above). **No setting: the
  presence of a file decides**, the first one found: `~/.claude-dashboard/trackers/repos/<main worktree>.json` (the
  installation's choice for this repo) > `<root>/.claude/tracker.json` (repo, shared) >
  `~/.claude-dashboard/tracker.json` (installation default) > Simple tracker. ⚙ Options → 📋 Tracker (PC only, engine
  routes `GET` / `POST /api/trackers`, `trackerSettings()`) writes the installation default and the per-project choice
  (`install-repo`; "Default" deletes it) as references to a built-in profile; a full profile made with `/tracker` shows
  as such until another choice replaces it. Each file: a full profile, or a reference
  `{ "profile": "dev" }` to a built-in profile (which follows its updates). An installation that already has sessions
  gets `{ "profile": "dev" }` when the engine starts (`init()`). The engine attaches the resolved profile to each
  session (`tracker`: profile, source, file), the `/tracker` preview (`trackerPreview`) takes precedence. Skill
  `/tracker`: local plugin `plugin/` passed to the SDK (`plugins`), named `/dashboard:tracker` for Claude Code, the page
  offers `/tracker`; tools `list_trackers` and `set_tracker` (scopes `preview`, `install-repo`, `repo`, `default`;
  profile `null` deletes the file).
- **Terminal sessions**: the terminal skill (in `~/.claude/skills`, outside this repo) and `dash.mjs push` still work;
  their answer is copied into the console.
- For now **only new sessions**, launched from the page.
- **Resume after a restart**: the panel JSON keeps the Claude `sessionId` and the `cwd`. The session goes "paused"; its
  feed is rebuilt from the Claude Code history (`getSessionMessages`), and the query resumes (`resume`) at the first
  message or mode change. Permission cards and turn ends are not in the history.
  **Cut in the middle of a turn** (PC restarted, engine killed): the session stays in the tree, paused, marked "cut off
  by a restart" when loaded (its `working` status goes back to `waiting`); nothing is relaunched, a message resumes it.
  The app starts with Windows (option of its tray icon), so the engine does too.
- **Subagents**: the SDK's `task_*` and the messages carrying `parent_tool_use_id` feed one conversation per agent
  (key = id of the Agent tool_use), viewable read only and stoppable (`stopTask`). Their duration (⏱, `chrono()` of
  `core/dom.js`, advanced every second without redrawing) is shown on the tab, the card and the banner, as for the
  shells. Each card, tab and the banner also show the agent's model pill, its context gauge (input + cache of its last
  call over its model window, `contextWindow` of the results' `modelUsage`, 200k until known; highest reached once
  finished), its tool count and, while it runs, the tool in progress with its argument and its last sentence (no AI
  summary: `agentProgressSummaries` stays off). Kept in memory only: after a restart, the history only shows the tool
  call (model and highest context are read again from the subagent transcripts).
- **Background shells** (Bash `run_in_background`, Monitor: SDK tasks `local_bash` / `monitor`): one 🐚 tab per running
  shell next to the subagents' (🐚 pill in the list); a click opens its output, read every 2 s from the file given by
  the tool result (tail, 64 KB), with "Stop" (`stopTask`). A shell that finishes while the session is idle starts a
  turn, like a subagent (grouped wake-up). Counted in what `restart-engine` refuses to cut.
- **Projects** (`projects.mjs`): deduced from the sessions' folders (`git worktree list`, 30 s cache) and from those
  added by hand (`~/.claude-dashboard/projects.json`).
- **Other sessions**: internal MCP tools `launch_session` (same folder by default, `folder` for another project;
  `worktree: { branch, base }` creates a git worktree next to the repo, e.g. `App-1234-export`), `list_sessions`
  (displayed title, step, status, project, branch, group), `message_session`, `end_session` (closes a worker session
  that delivered, like the End button). The instructions make Claude use them instead of Orca. A message received from
  another session (Claude Code messaging, `<cross-session-message from-name=…>`, or `message_session`, wrapped in
  `<session-message from=… title=…>`) shows as a purple card on the left: sender (link if it is a dashboard
  session), content only, collapsed beyond about ten lines.
- **End, archive**: End stops the Claude process, the session goes into "ended" (a message resumes it). **Archive**
  (🗄 button, or automatically once ended for the delay set in ⚙ Options, 1 day by default, checked every hour;
  `archiveAfterDays` in `~/.claude-dashboard/options.json`) removes it from the tree: its JSON goes to
  `sessions/archive/<slug>.json`, its mockups are copied there. "Resume" a conversation in the folder history (📋 if
  its panel is archived) brings it back with its panel.
- **⚙ Options** (bottom of the list): General tab (theme follow the computer / light / dark, kept per browser in
  `localStorage` and set before display by `index.html`; PC only: **language** auto / Français / English, archiving and
  auto-compact: `autoCompact` `default` (Claude Code compacts around 967k on the 1M window), a number of tokens
  (env `CLAUDE_CODE_AUTO_COMPACT_WINDOW` of the query, threshold = window − 33k) or `off` (`DISABLE_AUTO_COMPACT`), read
  when each query starts; a compaction puts a 🗜 line in the feed), 📋 Tracker (PC only: default and per-project tracker
  profile, see "Tracker profiles") and 🔒 Remote access (PC only). Outside the PC, only
  the theme is offered.
- **`/clear`** (and `/reset`, `/new`): the SDK's `conversation_reset` message empties the feed (a line marks it) and
  keeps the new conversation id for resuming; the Tracker panel and the header start from scratch like a new session
  (`clearBoard` of `engine/board.mjs`: automatic title, ticket, description, step, counters; what stays: folder, mode,
  Claude conversation and a title pinned by hand 📌).
- **Expandable tools**: each tool line carries its call (fields truncated to 4,000 characters) and its result (8,000),
  live as from the history.
- **Counters** of the session (`stats` in its JSON): turn durations, messages sent, active time sent by the page (tab
  in the foreground and activity in the last minute), context size (🧠 in the header: tokens of the last call of the
  main feed, `context`, over the model window read in the `result`, `window`; known at the first call after a restart).
- **Levels and achievements** (spec `docs/specs/2026-11-13-achievements.md`): the engine counts everything, no token.
  `engine/achievements/` (pure, tested): `definitions.mjs` single source of the families, thresholds, ranks and XP;
  `compute.mjs` (dated milestones, level `floor(sqrt(xp/250))`); `message.mjs`; `plan.mjs`. `engine/progress.mjs`
  holds `~/.claude-dashboard/progress.json`: only **raw records** (max value or total, journal dated at round values)
  and the activity XP; a changed threshold applies at restart (buff announced, nerf removed). Counting: `driver/`
  through the `ctx.achievements` callback (`sessionAchievements`, conversation counters in
  `data.stats.achievements`), the rest in `engine/achievement-counters.mjs` (developer messages and their origin
  `x-dash-origin` set by the page, cards, parallelism, unread), plan by `engine/plan-achievements.mjs` (the engine now
  holds the only usage probe, `/api/usage` is relayed to it). Page: 🏆 badge next to ⚙ Options, window and toasts
  (`components/achievements.js`, SSE `achievement`); the app notifies gold and above
  (`/api/progress/announcements`). Names and descriptions live in the `achievements` dictionaries, keyed by id.
  Images: `node scripts/achievement-images.mjs [id…]` (gpt-image-2, key `OPENAI_API_KEY` or a `.env` file given by
  `DASH_OPENAI_ENV`), `public/achievements/<id>.webp`.
- **Subscription usage** at the bottom of the list: `usage_EXPERIMENTAL…` of the SDK through a probe query that sends
  no message (1 min cache); next to the plan, the logged-in account (`accountInfo()`: e-mail, organization if it does
  not repeat the e-mail). Experimental API: if it breaks, the block disappears.

## Interface language (i18n)

- `public/i18n/index.js` (plain ESM, imports nothing outside `public/i18n`, shared by the page, the engine, the page
  server and Electron): `t(key, params, lang?)`, `setLanguage`, `language()`, `resolveLanguage(setting, locale)`,
  `translateDom(root)`, `locale()` ('fr-FR' / 'en-US' for dates and numbers), `LANGUAGES`.
- Dictionaries per zone: `public/i18n/fr/<zone>.js` and `public/i18n/en/<zone>.js` (`export default { … }`, keys nested
  by component, e.g. `tree.menu.rename`), gathered by `public/i18n/{fr,en}/index.js`. `{name}` placeholders; plurals as
  `{ one, other }` (and `zero`) chosen by `params.n` with `Intl.PluralRules`; a function `(p) => string` when a template
  does not fit. A missing key falls back to English, then to the key itself.
- Setting `language` in `options.json`: `auto` (default) / `fr` / `en`. `auto` follows `navigator.language` on the page,
  the OS locale in the engine, the page server (`applyLanguage()` of `common.mjs`, called at startup and after options
  are saved) and Electron (`electron/language.cjs`). `GET /api/language` (allowed from everywhere) returns
  `{ setting }`; writing goes through the options route (PC only, ⚙ Options shows the language there only).
- Static HTML (`index.html`, `login.html`): `data-i18n`, `data-i18n-placeholder`, `data-i18n-title`,
  `data-i18n-aria-label`, applied by `translateDom(document)` at startup.
- The language also chooses the instructions sent to Claude: `instructions.fr.md` / `instructions.en.md` (the first
  line of each is the header `server/consumption.mjs` uses to measure them: keep both in sync).
- **Never call `t()` at module top level**: the language is set after the modules load, so a text computed at import
  time would stay in the default language. Call it inside functions, or use getters (as `BLOCK_TYPES` in
  `trackers.mjs` does).

## Data migration (`migration.mjs`)

One-time conversion of the data folder (`~/.claude-dashboard`, or `DASH_DIR`) written by the French build: file names
(`groupes.json` → `groups.json`, `suivis/depots/` → `trackers/repos/`…), JSON keys and enum values become the English
ones. `migrate()` is called first thing by `server.mjs` and `engine.mjs` (a lock file makes the second one wait);
every step is idempotent and a `version.json` marker makes the next starts instant. Before the first change, the
folder is copied to `<dir>-backup-fr` next to it (without `caddy/` and the attachments). The module is
backward-compatibility code: its French names are recognised on purpose. Tests: `tests/migration.test.mjs`.

## Later

- **Resume a terminal session** (`resume` of the SDK; `listSessions` already sees them).
- **Find an old session**: history + search, button that relaunches `claude -r <id>` (today `claude -r` becomes
  unusable beyond 1 or 2 days if the session name is not explicit).
- "Waiting for your answer" status detected automatically by a Claude Code hook (zero token).

## Conventions

- **English** for code, identifiers, comments and docs. Every text shown to the user goes through `t()`, with its entry
  in **both** dictionaries (`fr` and `en`); pure developer logs are written directly in English.
- Never use the em dash character (U+2014), anywhere (code, comments, docs, UI texts, commit messages).
- **Git**: `git add` lists the files, never `git add .` nor `-A`.
- **Tests and test instance**: `npm test` (`node --test`, `tests/*.test.mjs`: signals, router, achievements, progress,
  plan, migration). `DASH_DIR` replaces `~/.claude-dashboard` (`DASH_DIR` of `common.mjs`, used everywhere); with
  `DASH_PORT` and `DASH_PORT_ENGINE`, it runs an isolated test instance on a copy of the folder, without `access.json`
  nor `network.json` (so neither Caddy nor wifi). Without it, nothing changes.
- No framework. npm dependencies limited to the Claude Agent SDK, zod (schema of the `update_board` tool) and Electron
  (the app).
- Run: `npm install` once, then the app (`npm run app`, or the launcher below) or, without it, `node dash.mjs ensure`
  and the page on http://localhost:4747.
- **Local network** (to try from a phone): `node dash.mjs network on` opens the page on `0.0.0.0` (setting in
  `~/.claude-dashboard/network.json`, page restarted, wifi address shown); `off` goes back to the PC only. Even open,
  only private addresses get through; stopping page or engine, `/login` and the explorer stay reserved to the PC. The
  engine always stays on 127.0.0.1. No authentication: any device on the wifi can drive the sessions. First visit of
  each remote device in `~/.claude-dashboard/network.log`. Firewall: an inbound TCP 4747 rule is needed when the app
  starts the page. Android: if Chrome fails (ERR_TOO_MANY_RETRIES) while the network works, its local network
  permission is blocked internally: `adb shell appops set --uid com.android.chrome ACCESS_LOCAL_NETWORK allow`.
- **Access from the internet** (`access.mjs`), with your own domain (e.g. `https://dash.example.com`, dynamic DNS
  pointing to your box, NAT rule TCP 443 → this PC). **Caddy** (`~/.claude-dashboard/caddy/caddy.exe`, or
  `DASH_CADDY`), started by the page like the engine as soon as a domain and a password are configured, does the HTTPS
  (Let's Encrypt through 443, renewed by itself; `Caddyfile` and `caddy.log` in that folder; admin on
  127.0.0.1:2019, queried with `node:http`, not `fetch` which it refuses) and relays to **127.0.0.1:4749**, where
  everything goes through the login (`remoteGate`): page `login.html`, master password (scrypt), then the device waits
  to be **approved from the PC** (⚙ Options → 🔒 Remote access, at the bottom of the list, or an app notification).
  Cookie `HttpOnly Secure SameSite=Lax` 90 days (Lax: a link opened from the PWA into the browser counts as cross-site), extended on each visit; Origin checked on POSTs; 5 failures per IP
  → 15 min, doubled at each new lockout of that IP (24 h max), no global cut; client IP = last `X-Forwarded-For`
  value; log `~/.claude-dashboard/access.log`. Changing the password logs out every
  device. The management routes (`/api/access/*`) and the "PC only" routes are refused from the wifi and the internet.
  Firewall: inbound TCP 443 rule for caddy.exe.
  **Several PCs behind the box** (⚙ Options → 🔒 Remote access), two ways:
  - **autonomous**: its own Caddy, `httpPort: 80` (the box sends it port 80 for the HTTP-01 validation, no http →
    https redirect) and an HTTPS port of its own (e.g. box 8443 → its 443), address
    `https://pc2.dash.example.com:8443` (CNAME to the main domain); works without the first PC;
  - **relay** (the 443 PC must stay on): `relays: [{ domain, target }]` on the 443 PC, one Caddy block per subdomain to
    `<local IP>:4749`; the other one (`viaRelay` = IP of the relay) does not start Caddy and opens its 4749 on its
    local addresses, only to the relay's IP.
  Each PC keeps its own login (password, devices approved from its screen). A configuration change reloads Caddy hot
  (`POST /load` of its admin): stopping then restarting it failed, Windows releasing 443 too late.
- **Electron app** (`electron/main.cjs`, `electron/preload.cjs`, `electron/language.cjs`): a window on the page, a tray
  icon (in color when a session is blocked or has unread items, Windows notification on each new wait, option "Start
  with Windows": Run key with `--at-startup`, the app then starts with its window hidden, icon only; "Reachable from
  the wifi"). It starts the page and the engine (embedded Node, detached processes) but holds nothing: quitting it
  cuts no session. Closing the window hides it. The page finds `window.desktop` there (explorer and browser in the
  foreground, which a background server cannot do on Windows).
  Icon: the control tower (`electron/icons/source.png`; the gpt-image proposals in `electron/icons/proposals/` are not
  versioned). After an image change, `node_modules\electron\dist\electron.exe electron\make-icons.cjs` redoes
  `app.ico`, `app.png` and the notification icons (`notif-alert`: blocked or unread, `notif-idle`: idle); a badge is
  put on the taskbar icon: red if a session is blocked, blue if there are unread items; the window title is the
  page's. To restart the app, only stop the process that has a window (the launcher's exe, or `electron.exe` through
  `npm run app`): if it started the page and the engine, they also run under that name.
- **Launcher**: `npm run launcher` (`electron/make-launcher.cjs`) builds in `launcher/` (not versioned) a renamed copy
  of Electron with the app icon, which loads the repo's code in place (nothing bundled: F5 and restarts work as
  before). Name "Claude Dashboard" or "Tableau de bord Claude" depending on the language. To redo, with the app quit,
  after an Electron update or a move of the repo.
- **Working on the dashboard from a session it drives**: its engine holds that very session. `node dash.mjs restart`
  (page) is safe; for the engine, **always** `node dash.mjs restart-engine --deferred` (it stops as soon as the turn
  ends, the page restarts it, the session comes back paused); never `--force`, which cuts it.
