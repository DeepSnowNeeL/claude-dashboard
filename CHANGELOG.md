# Changelog

What changed for people who use the dashboard, newest first. The commit history has the technical detail.

## 2026-11-17

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
