# AI guide: install Claude Dashboard

This file is written for an AI coding agent (Claude Code or similar) asked to install the dashboard on the user's
machine. Follow the steps in order, run the checks, and report clearly. **Ask the user before anything that needs
administrator rights** (firewall rules, global installs, system settings) and before changing anything outside the
clone folder, except what is listed here.

For working **on the code** later, read [CLAUDE.md](CLAUDE.md) instead: it is the architecture guide.

## 0. What you are installing

- A local web dashboard (page server on `http://localhost:4747`) plus an **engine** process (`127.0.0.1:4748`) that
  drives Claude Code sessions through the Claude Agent SDK, and an optional Electron desktop app around the page.
- It uses the user's **Claude Code subscription** (the login of the `claude` CLI on this machine). No API key.
- Data lives in `~/.claude-dashboard` (created on first start). Nothing is installed globally by `npm install`.

## 1. Prerequisites (check, do not assume)

Run and read the output:

```sh
node -v        # must be v22 or newer
npm -v
git --version
claude --version
```

- **Node.js < 22 or missing**: tell the user and propose the official installer (https://nodejs.org, LTS) or their
  usual version manager (nvm, fnm, volta, winget `OpenJS.NodeJS.LTS`, Homebrew `node`). Do not install it silently.
- **git missing**: same, propose the official installer (on Windows, Git for Windows also provides the Git Bash the
  dashboard uses for `!commands`).
- **Claude Code**: it must be installed and **logged in**. If `claude --version` fails, point the user to
  https://docs.claude.com/en/docs/claude-code (install), then `claude` once in a terminal to log in. The dashboard
  cannot log in for them on first install. If you are yourself running inside Claude Code on this machine, it is
  installed and logged in: say so and move on.
- Optional: **ripgrep** (`rg --version`) makes the full-text search faster; without it the dashboard falls back to
  `git grep`. Not required.

Platform notes: developed and used daily on **Windows 10/11**. macOS and Linux should work (Electron, Node, git), but
some desktop integrations are Windows-first (explorer, Git Bash for `!commands`). Tell the user if they are on macOS or
Linux that these parts may need small fixes.

## 2. Get the code

If not already done:

```sh
git clone https://github.com/DeepSnowNeeL/claude-dashboard.git
cd claude-dashboard
npm install
```

`npm install` downloads Electron (about 100 MB). Behind a proxy or offline mirror it can fail on the Electron binary:
in that case the dashboard still works without the app (step 4, "headless"), tell the user.

Run the tests to check the install: `npm test` (all must pass).

## 3. Choose how to run it

Ask the user (or pick the default **desktop app** if they just said "install it"):

- **Desktop app** (recommended on a personal computer): a window plus a tray icon that turns red or blue when a session
  needs them, notifications, optional start with the computer. It starts the page server and the engine itself.
- **Headless** (no Electron): `node dash.mjs ensure` starts the page server (which starts the engine); the user opens
  `http://localhost:4747` in their browser.
- **Server mode** (Docker on a server, reached through a reverse proxy): read [docs/server.md](docs/server.md) and
  follow it instead of the steps below.

## 4. First start

Desktop app:

```sh
npm run launcher   # builds launcher/ (a renamed Electron with the app icon) and creates shortcuts
```

- Windows: Start menu and desktop shortcuts "Claude Dashboard" (or "Tableau de bord Claude" if the system is in French)
  pointing to `launcher/win/…exe`. Start it from the shortcut, or run `npm run app`.
- macOS: `launcher/mac/Claude Dashboard.app` (signed ad hoc). Linux: `launcher/linux/claude-dashboard` and a
  `~/.local/share/applications` entry.
- If `npm run launcher` fails, `npm run app` from the clone folder is enough.

Headless:

```sh
node dash.mjs ensure
```

**Check** that it answers:

```sh
curl -s http://localhost:4747/api/language     # {"setting":"auto",...}
```

If port 4747 or 4748 is taken, find what holds it and tell the user; ports can be changed with the environment
variables `DASH_PORT` (page, engine = page + 1, remote gate = page + 2) if needed.

## 5. Show the user around (short)

Tell the user, in a few lines:

- **+ New session** (top left) starts a Claude Code session in a folder; the first message is typed in its input.
- The **Tracker** panel on the right fills itself as the session works; decisions arrive as cards in the conversation.
- **⚙ Options** (bottom left): theme, language (follows the computer by default), archiving, auto-compact, remote access.
- In the app's tray icon menu: "Start with Windows", "Reachable from the wifi", "Connect to a server…".
- To customize what the Tracker shows: type `/tracker` in a session.
- To change the dashboard itself: open a Claude Code session **on the clone folder** (from the dashboard itself is
  fine) and ask; CLAUDE.md explains the architecture and how to restart safely.

## 6. Optional steps (only if the user asks)

- **Phone on the same wifi**: `node dash.mjs network on` (no authentication: trusted networks only). Windows needs an
  inbound firewall rule for TCP 4747 (admin rights: ask first).
- **Access from the internet**: ⚙ Options → 🔒 Remote access (own domain, Caddy for HTTPS, master password, devices
  approved from the PC). See the "Access from the internet" section of CLAUDE.md. Needs a router port forward (443) and
  a DNS name: guide the user, do not touch their router.
- **Server mode**: [docs/server.md](docs/server.md).

## 7. Troubleshooting

| Symptom | What to check |
| --- | --- |
| Page does not load | `node dash.mjs ensure` output; is another process on 4747? |
| Sessions fail to start ("not logged in", 401) | `claude` in a terminal: log in again; `/login` in a session opens a terminal for it |
| Sessions start but tools fail on Windows | Git for Windows installed? (Git Bash is used for `!commands`) |
| App window blank after an update | press F5; or `node dash.mjs restart` (page only, never cuts a session) |
| Engine changes not taken into account | `node dash.mjs restart-engine --wait` (waits for running turns); from a session driven by the dashboard, always `--deferred` |
| Electron download failed during `npm install` | run headless (`node dash.mjs ensure`) or retry with a working network |

## 8. Report to the user

End with: what was installed and where, how to open it (shortcut / `npm run app` / URL), anything that failed or was
skipped and why, and the optional steps they may want next.
