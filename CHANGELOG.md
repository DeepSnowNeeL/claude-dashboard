# Changelog

What changed for people who use the dashboard, newest first. The commit history has the technical detail.

## 2026-11-26

- In the list, a project with many worktrees is easier to read: ⌂ marks the main one, ⎇ a worktree on a branch
  (with the ticket read from its name) and ⊘ a detached HEAD, shown with its short commit and its folder. Only the
  main worktree and those with a session open or ended in the last 7 days stay in view; the others fold under
  "N other worktrees".
- When a background subagent or command finishes, the session wakes up once: Claude Code now starts that turn by
  itself, so the dashboard no longer sends its own wake-up on top (Claude used to answer twice, the second time to
  say nothing changed). The session also shows as working during that turn.
- Sessions of a worktree that has since been removed (merged branch) stay in their project, under its ended
  sessions, instead of landing in "Terminal sessions".

## 2026-11-25

- **Reload** a session (⋯ menu next to End, or right click in the tree): Claude Code restarts on the same
  conversation, so MCP servers, settings, skills and CLAUDE.md are read again, as quitting the terminal and running
  `claude -r`. Archive moved into the same menu.
- A phone notification disappears once the session no longer waits for you (question or command answered on the PC
  or elsewhere). On iPhone, it goes away when you open the dashboard.

## 2026-11-24

- The end-of-turn line gives its duration in hours, minutes and seconds (`8 min 43 s`) instead of a raw number of
  seconds.

## 2026-11-23

- **Modified files** tab, folder tree view: a folder that only holds new files (not in the last commit) gets a 🗑 to
  delete it in one go (click twice). The files git ignores stay.
- A file with staged changes and other changes on top gets a ↩ icon: it discards only the changes not staged, back
  to the version of the index (click twice). ↶ still goes back to the last commit.
- The List / Tree choice of the file display has clearer icons: a flat list, and a list holding an indented one.

## 2026-11-21

- Your messages and Claude's answers now show the time they were sent, very discreetly under each one (the date too
  when it is not today, the full date on hover). Past conversations get it from their history.

## 2026-11-20

- In the session list, the purple line linking launched sessions to their parent now stops at the last one instead of
  running to the bottom of the group.

## 2026-11-19

- The menu of a file path has a second browser entry, **Open in browser (file://)** (on the PC): the page opens from
  the disk in your default browser, where its saved data (localStorage) works. The existing entry, now "Open in
  browser (web server)", keeps the protected preview.

## 2026-11-18

- Session categories, like GitLab labels: right click on a session → Category to tick one or several, create one
  (name, colour) or manage them. The chips show under the title and the first category colours the row. A category
  can **compact** its sessions: a single line in the list (title, status, age), still red when blocked and with the
  unread badge. The search also finds a session by its category names.

## 2026-11-17

- New **Processes** tab in the right panel (on the PC): the dev servers, builds and other processes running on the
  PC, sorted by who launched them (a dashboard session, with the command and the subagent; an editor or terminal;
  nobody anymore), with their ports, memory and age, and a Stop button that ends the whole tree. Servers forgotten
  by a finished session no longer have to be hunted down in the task manager.
- Right click on a session: "Show the parent session" and "Open ticket" (the session's own link, otherwise the
  project's ticket URL template, set in the project editor).
- A session launched by another one goes right under it in the tree (same worktree), or shows a "launched by" link;
  the parent's conversation gets a live card for it. The ticket now sits on a small line under the session title.
- Mockups: icon fonts (Font Awesome...) load again.
- Modified files: a new file opens in a single plain editor instead of a diff against an empty file.
- Updates from GitHub: when this repository has new commits (clone or fork), a discreet line under ⚙ Options lists
  the new CHANGELOG entries and starts a Claude session that merges them into your copy, keeping your changes.
  Can be turned off in ⚙ Options → General.
- Phone notifications: when a session is blocked (question, command to approve, plan) and the PC has had no keyboard
  or mouse action for 10 minutes, the phone app gets a notification; a tap opens the session. Offered once on the
  first opening on the phone, then in ⚙ Options (on/off, idle delay, test). Needs the HTTPS access; on iPhone, the
  dashboard added to the home screen.

## 2026-11-16

- New session: choose the model (list given by Claude Code); your last choice is kept. The default entry names the
  model it resolves to, and the header's model pill can be changed before the first message.
- "Not up to date" banner: after a `git pull`, tells you when the engine or the page still runs older code, with a
  Restart button. The tray menu also gets "Restart the engine" (waits until the sessions are idle).
- Subagents: API-equivalent cost on their card, banner and tab, tokens per category in the tooltip.
- Modified files: a nested repository or submodule shows as a folder instead of an error.
- Tracker panel: what waits for your answer (including the design to validate) is laid out in full in the
  conversation; the panel keeps the record.
- macOS app: the window no longer disappears after a dialog.
- Conversations started with the French build keep working with the English tracker fields.

## 2026-11-14

- Subagents: model, context gauge, tool in progress and last sentence; the session's model pill changes the model.
- New session: the permission mode of the last session started is kept for the next one.
- Options: Tracker tab, to pick the default tracker profile and one per project (Simple or Dev).
- Remote access: HTML pages opened from the phone load their images, CSS and scripts.

## 2026-11-13

- First public release.
- Permission modes as in Claude Code: auto, accept edits, plan (with a plan card to approve).
- Editor: a selection shows a Comment button instead of opening the remark field at once.
- Phone: "computer unreachable" page instead of a white screen, "Updating" screen while the page or the engine
  restarts, bigger End / Archive buttons, achievement toasts no longer cover the input.
- Remote access: a link opened from the installed app into the browser stays logged in.
- "Start with Windows" works when the app runs with `electron .`.
- Achievements: an unlock announces the milestone reached, not every threshold.
