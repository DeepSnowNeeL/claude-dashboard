# Architecture refactor: components and services, no build

Date: 2026-10-30. Status: done (differences noted at the end of the document). File and symbol names below are the
current (English) ones; at the time, the code was written in French.

## Why

The application grew fast, one feature after another, and the code no longer reads well:

- `public/app.js`: 2,800 lines (183 KB) in a single file, about thirty global variables (list, current session,
  detail, feed, view, explorer, git status, attachments…) and `renderX()` functions called by hand wherever a state
  changes.
- `public/style.css`: 584 dense lines, a single file.
- `driver.mjs`: `createSession()` alone is 540 lines (query, input queue, translation of SDK messages, permissions,
  subagents, shells, MCP).
- `server.mjs`: its request handler chains 220 lines of route `if`s, mixed with Git, Caddy, network, explorer.
- `engine.mjs`: routes, archives, JSON writing and the path guard in the same file.

The goal is **clean and readable** code, organised in components and services like an Angular application, **with no
build step**: you change a file in `public/`, F5, it is taken.

## Goals

- One file = one responsibility, named so you find it without searching.
- A central state (signal store) instead of global variables; components redraw when the signals they read change.
- On the server side, routes declared in tables and modules per topic.

## Non-goals

- No new feature, no visible change: **identical behaviour**, on screen as in the HTTP APIs and the format of the
  JSON files in `~/.claude-dashboard`.
- No framework, no TypeScript, no bundler, no new npm dependency (the CLAUDE.md rules stay: SDK, zod, Electron).

## Anti-goals (what would make the refactor fail even if it "works")

- A build step, or a dependency loaded from a CDN at startup (Monaco and Mermaid stay loaded on demand, as today).
- A regression in feed smoothness: redrawing the whole conversation on each event (loss of scrolling, of expanded
  blocks, of the selection, of the input being typed).
- Losing a change made in parallel by another session during the refactor.
- An "Angular-like" architecture heavier than the code it replaces (classes, decorators, home-made injection): we keep
  functions and modules.

## Constraints

- Native ES modules: `index.html` already loads `app.js` as `type="module"`, each file does its `import` / `export`
  with full relative paths (`'./core/dom.js'`, extension included).
- The service worker (`public/sw.js`, 4 lines) caches nothing: nothing to adapt.
- Files served by `server.mjs` from `public/`: check that subfolders and the `text/javascript` MIME type go through,
  as well as remote access (`remoteGate`), which may filter paths.
- The engine holds this session: any engine restart goes through `node dash.mjs restart-engine --deferred`.
- French everywhere at the time (since then: English), never an em dash.

## Decisions made with the developer

1. **Shape of the components: ES modules + a small home-made signal store** (no Web Components, no Lit).
2. **Schedule: start now, all at once** (no split into small batches delivered one by one), leaving aside what the
   running sessions are changing.
3. **Scope: the page first, then `server.mjs`, `driver.mjs` and `engine.mjs`.**

## Page architecture (`public/`)

```
public/
  index.html            unchanged, except the CSS <link>s
  app.js                bootstrap: mounts the components, wires the SSE and the #slug routing
  core/
    signals.js          signal(), computed(), effect(), batch()   (~60 lines)
    state.js            the shared signals of the application (see below)
    dom.js              $, esc, rich(), toast(), pathLinks
    api.js              api(url, body), upload()
    sse.js              EventSource /api/events, reconnection, dispatches "update" and "feed"
    storage.js          tolerant localStorage read / write (folds, drafts, seen, tab, layout)
    router.js           #slug, #new?cwd=…, hashchange
  services/
    sessions.js         list, detail, feed of a session; send, interrupt, mode, end, archive
    git.js              status, commits, versions of a file
    explorer.js         list a folder, watch, search, fuzzy search (Ctrl+P)
    commands.js         the session's "/" commands, /login, /logout, /mcp
    draft.js            draft answer to the decisions (split, recompose, sync)
    usage.js            subscription usage
    theme.js            read / apply the theme
    access.js           remote access (PC only)
    projects.js         projects, groups, orders, metadata
  components/
    tree/               tree.js (projects → worktrees → sessions), edit.js (group / project, emojis),
                        modal.js (ask())
    conversation/       conversation.js (show / refresh the session), header.js, feed.js, event.js (rendering of one
                        event), input.js (sending, shortcuts, attachments, "/" menu), activity.js, tabs.js (agents,
                        shells), shell.js
    cards/              decisions.js, example.js, question.js, permission.js, agent.js, session-message.js
    tracker/            panel.js (profile blocks, "seen" / "new"), renderers.js (one renderer per block type),
                        compose.js (composite types), mockup.js
    side/               tabs.js (Tracker / Modified files / Explorer), files.js, commits.js
    explorer/           explorer.js, palette.js (Ctrl+P)
    editor/             monaco.js (loading), viewer.js (diff / read), remark.js (bubble)
    mermaid.js
    path-menu.js        menu of a clicked path
    new-session.js
    options.js          ⚙ Options window (general, remote access)
    mcp.js              /mcp window
    mobile.js           bottom bar, dot
  css/
    base.css            variables, themes, typography, buttons, toast, modals
    one file per component folder (tree.css, conversation.css, cards.css, tracker.css, side.css,
    explorer.css, editor.css, options.css, mobile.css)
  style.css             only keeps the @imports, in today's order (identical cascade)
```

Dependency rules: `core` imports nothing; `services` import only `core`; `components` import `core`, `services` and
other components; only `app.js` mounts. No circular import between components: when two components must talk, they go
through a signal of `state.js`.

### The signals (`core/signals.js`)

Deliberately tiny API, close to Angular:

```js
const counter = signal(0);       // counter() reads, counter.set(1), counter.update(n => n + 1)
const double = computed(() => counter() * 2);
const stop = effect(() => console.log(double()));  // rerun when what it read changes
batch(() => { a.set(1); b.set(2); });               // a single pass of the effects
```

Effects are grouped in a microtask (several `set()` in a row = a single render). Equality by `Object.is`: for an array
or an object, replace the value (`set([...l, x])`) or call `.notify()` after a mutation.

### Shared state (`core/state.js`)

Application signals, replacing the global variables read by more than one component:

- `sessions` (tree list), `projects`, `groups`, `orders`
- `current` (displayed slug), `detail` (JSON of the displayed session), `relativeDir` (derived from `detail`)
- `view` (main conversation or key of a subagent), `agents`, `shells`
- `activity` (indicator under the feed)
- `sideTab`, `gitStatus`
- `attachments`

A variable read by a single component stays in that component (module-local state).

### What redraws through an effect, what stays targeted

- **Through an effect** (full render of the component as `innerHTML`, it is fast and it is already what the code
  does): tree, header, Tracker panel, right tabs, modified files, agent tabs, activity indicator, send buttons.
- **Targeted, as today**: the feed. `feed.js` keeps its array of events and exposes `addEvent(ev)` and
  `replaceFeed(evs)`; the SSE calls it directly. Same for the input, which is never redrawn while you type. This is
  the condition of the "feed smoothness" anti-goal.

### Shape of a component

```js
// components/conversation/activity.js
import { effect } from '../../core/signals.js';
import { activity } from '../../core/state.js';
import { esc } from '../../core/dom.js';

/** Indicator under the feed: "✻ Thinking… (3 min 42 s · ↓ 19.9 k tokens · reasoning)". */
export function mountActivity(el) {
  effect(() => { el.innerHTML = renderActivity(activity()); });
}

function renderActivity(a) { … }
```

An exported `mountX(el)` function, private functions in the module, listeners set once on `el` (event delegation, as
today with `closest()`). Components mounted and unmounted depending on the view (new session, Options and MCP windows,
viewer) return an unmount function that stops their effects and their `setInterval`s.

## Server architecture

```
server.mjs              startup: HTTP 4747 (+ 4749 remote), route table, static files  (~80 lines)
server/
  routes/               one table { 'GET /api/…': handler } per topic:
                        sessions.mjs (engine relay), git.mjs, explorer.mjs, files.mjs, projects.mjs,
                        access.mjs, options.mjs, desktop.mjs ("PC only" routes)
  router.mjs            method + path matching (with :slug parameters); null if no route
  engine-client.mjs     engineAlive, ensureEngine, relay
  git.mjs               status, commits, versions, ignored
  explorer.mjs          ripgrep, files of a folder, search, watch
  paths.mjs             isPathAllowed, sensitive files
  network.mjs           local network access, device log
  caddy.mjs             Caddyfile, launch, hot reload
  remote.mjs            remoteGate (login, cookie, approval)

engine.mjs              startup: HTTP 4748, SSE, route table  (~80 lines)
engine/
  routes.mjs            engine routes
  registry.mjs          the Maps sessions and drivers (avoids the sessions / board mutual import)
  sessions.mjs          new, resume, end, summarize, load from disk
  board.mjs             updateBoard, count, markSeen, JSON writing
  broadcast.mjs         SSE: broadcast, broadcastFeed
  archives.mjs          archiveSession, automatic archiving, archiveOf
  guard.mjs             declared paths, git root, isAllowed

driver/
  index.mjs             createSession(): assembles the pieces below (~100 lines)
  input.mjs             continuous input queue (inputQueue), immediate / queued sending
  events.mjs            SDK messages → feed events (text, tools, results, activity)
  permissions.mjs       canUseTool: AskUserQuestion, permissions, pending cards
  agents.mjs            subagents and shells (task_*), stopTask, wake-up
  mcp-tools.mjs         internal MCP server: update_board, launch_session, list_sessions, message_session, …
  attachments.mjs       attachments, extractAttachments, attachmentUrl
  history.mjs           feedFromHistory, agents from the history, recentFolders
  usage.mjs             subscriptionUsage
driver.mjs              re-exports driver/index.mjs (the existing imports do not change)
```

`access.mjs`, `projects.mjs`, `trackers.mjs`, `common.mjs`, `dash.mjs` are already a reasonable size: they are not
moved, only what the split makes necessary is fixed.

## Process

The sessions that were changing the repo had finished (confirmed by the developer on 10/30). A single pass, on a
**dedicated branch in a separate worktree** (`refactor-architecture`): the running page serves the main checkout's
`public/`, an in-place split would break it at the first F5 during the work (Claude's choice). Work order: page, then
server, then driver and engine.

At the end:
1. if commits arrived on master in the meantime (`git log <base>..master`), port them by hand into the new files;
2. verify (see below);
3. a single merge into master, push, `node dash.mjs restart` then `restart-engine --deferred`.

## Verification

No automated tests at the time, and the refactor adds none. Manual check in the browser (Chrome DevTools), serving the
branch on other ports (`DASH_PORT=4757`, `DASH_PORT_ENGINE=4758`, already read by `common.mjs`) and comparing with the
running application.

**Isolation of the test instance (Claude's choice)**: the `~/.claude-dashboard` folder was hard-coded in
`engine.mjs`, `driver.mjs`, `projects.mjs`, `access.mjs` and `dash.mjs`. A second engine would take over the live
sessions, write to the same JSON files, archive concurrently, and the page would restart Caddy (hijacked remote
access). The refactor therefore adds, in `common.mjs`, a `DASH_DIR` constant read from the `DASH_DIR` variable (default
unchanged: `~/.claude-dashboard`) that every module uses, and the test instance runs on a copy of that folder without
`access.json` nor `network.json` (so neither Caddy nor wifi). The only departure from "identical behaviour", with no
effect when the variable is not set.

**Real sessions (Claude's choice)**: driver and engine are checked with a few throwaway sessions in a test folder (an
empty git repo), with short messages: a simple exchange, an AskUserQuestion, a permission in "ask" mode, a subagent, a
background shell, `/clear`, `/mcp`, then `restart-engine` of the test instance and resume.

Checklist:

- tree: folds, groups, drag and drop, editing, search, counters;
- conversation: send, queue, Ctrl+Enter, stop, `!command`, `/` and `/mcp`, attachments, decision cards (selection,
  clarification, "explain"), questions, permissions, subagents and shells, scrolling;
- Tracker: each block type of the `simple` and `dev` profiles, "new" marks;
- Modified files, commits, explorer, Ctrl+P, text search, Monaco (diff, remark);
- Options, theme, mobile (under 900 px), remote access (login);
- browser console free of errors.

## Left to the builder

- The fine split inside each folder (one file more or less), as long as the dependency rules hold.
- The exact implementation of the signals, within the API above.
- The CSS file names and the grouping of rules, as long as the cascade gives the same rendering.
- Updating CLAUDE.md ("How it works" section) to describe the new layout.

## Differences found during the work

- The router returns `null` when nothing matches: the 404 and the 500 (exception in a handler, JSON error) stay in
  `server.mjs`, as do the relay to the engine and the static files. `server/routes/sessions.mjs` only contains what is
  not a plain relay.
- `show` / `refresh` (open a session, redraw its areas) live in `components/conversation/conversation.js`, not in
  `app.js`, which only does the bootstrap.
- Files added to the plan: `engine/registry.mjs`, `components/conversation/conversation.js`, `services/theme.js` (as
  planned) and the tests `tests/signals.test.mjs`, `tests/router.test.mjs` (the spec said "no tests"; `npm test` runs
  them). `DASH_DIR` is read by `common.mjs`.
- In `driver/`, the `attachX(ctx)` modules add their functions to a shared `ctx` (`Object.assign`); `attachments`,
  `history` and `usage` stay standalone functions.
- Components do not only go through the signals of `core/state.js`: three ways. (a) The signals. (b) Six DOM
  `CustomEvent`s: `explorer-update` (emitted by `services/explorer.js`, listened to by `explorer.js` and `viewer.js`),
  `explorer-reveal` (emitted by `palette.js`, listened to by `explorer.js`), `open-palette` (emitted by
  `explorer.js`, listened to by `palette.js`), `open-view` (emitted by `cards/agent.js`, listened to by `feed.js`),
  `recall-queue` (emitted by `event.js`, listened to by `input.js`), `input-changed` (emitted by `decisions.js` and
  `event.js`, listened to by `input.js`). (c) Functions passed at mount time by `app.js` to avoid an import cycle:
  `mountHeader(refresh)` and `mountSide(el, renderTracker)`. Not every `mountX` takes an element
  (`mountTree($('#list'))`, but `mountMobile()`, `mountPalette()`).
