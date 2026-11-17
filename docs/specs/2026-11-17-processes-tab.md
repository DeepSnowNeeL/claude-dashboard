# Processes tab

## Why

Claude launches dev servers and builds (`ng serve`, `java -jar`, Gradle…) that outlive the command that started them:
`&`, `Start-Process`, a subagent that ends, a session that is ended. Only background shells (Bash
`run_in_background`) are visible in the dashboard today. Measured on 17/11/2026: six `ng serve` of the same front
running at once (one since 10/11), 1 GB of RAM left out of 32, the PC freezing on each library build. The developer
only saw them in the task manager.

Goal: a fourth tab of the right panel, **Processes**, that lists what runs on the PC for development, says who launched
it, and stops it (the whole tree) in one click.

## What the tab shows

Global (the whole PC), PC only. Five collapsible sections (state in `localStorage`, `dash-processes-collapsed`):

1. **Sessions · <project of the displayed session>**: processes launched by dashboard sessions of that project, the
   displayed session first (in blue), grouped by session.
2. **Sessions · other projects**: grouped project › session.
3. **Editors and terminals**: descendants of VS Code, IntelliJ (and other JetBrains IDEs), Orca, Windows Terminal,
   grouped by the instance that launched them, with the chain of parents (`Orca › pwsh › pnpm › node`).
4. **Orphans in your projects**: command line containing the path of a known project and no live known launcher,
   grouped by project (the displayed session's project first).
5. **Unknown origin**: a dev executable (node, java, python, dotnet, ruby, php, go, deno, bun) listening on a port that
   fits none of the above.

One line per **root** process (the first non-shell process under its launcher): short name (`ng serve backoffice`),
listening ports, RAM of the whole tree, age (orange beyond a day), Stop. A click opens the detail: PID, start date,
full command line, children, and for session processes the Bash command that launched it and the subagent if any.
Stop asks for an inline confirmation then kills the tree. The tab label carries the count of roots, orange when an
orphan is older than a day.

Not listed: the dashboard itself (page, engine, Electron app), `claude.exe`, the MCP servers Claude Code starts (they
die with the session), system processes, browsers.

## How

- **Session PID**: `driver/index.mjs` passes `spawnClaudeCodeProcess` to `query()`, a spawn identical to the SDK's
  default one (`stdio: 'pipe'`, `windowsHide`, `cwd`, `env`, `signal`) that keeps `s.claudePid`.
- **Snapshot** (`engine/processes.mjs`, `snapshot()`): Windows, one `powershell.exe` call (`Win32_Process`: pid,
  parent, name, command line, creation date, working set; `Get-NetTCPConnection -State Listen`), about 2 s; elsewhere
  `ps -eo pid,ppid,rss,lstart,args` and `lsof -iTCP -sTCP:LISTEN`. Taken every 10 s while the tab is open somewhere
  (the page asks), and every 20 s while a session is busy (turn, agent, shell), so that a detached process is seen
  while its chain to `claude.exe` still exists.
- **Memory** (`DASH_DIR/processes.json`): `pid:created` → `{ slug, command, agent }`, recorded the first time a
  process is seen under a session's `claude.exe`. A process whose parent died keeps its session. Entries whose process
  is gone are dropped at each snapshot.
- **Bash command and subagent**: Claude Code runs `bash -c "… eval '<command>' < /dev/null …"`. The `<command>` (with
  `'\''` unescaped) is compared with the `Bash` / `PowerShell` calls of the session's feed and of its subagents' feeds.
- **Classification** (`classify(snapshot, context)`, pure, tested): dead parent = parent PID missing, or parent
  created after the child (PID reuse).
- **Routes** (engine, relayed by the page; refused from the wifi and the internet like `/api/explorer`):
  `GET /api/processes` (snapshot + classification, also marks the tab as open), `POST /api/processes/kill
  { pid, created }`: the process must still exist with that creation date, never a protected one (engine, page,
  Electron, `claude.exe`, PID 0/4); `taskkill /PID n /T /F` (POSIX: `kill -TERM` on the tree).
- **Page**: `services/processes.js` (`readProcesses`, `killProcess`), `components/side/processes.js`
  (`renderProcesses(d, tabs)`), 4th tab in `components/side/tabs.js`, shown on the PC only, read every 10 s while it
  is displayed.

## Non-goals

- Killing a session's `claude.exe` or its MCP servers (End does that).
- History of past processes, CPU graphs.
- Attribution of terminal (non-dashboard) Claude Code sessions: they fall under "Editors and terminals" or
  "Orphans".
