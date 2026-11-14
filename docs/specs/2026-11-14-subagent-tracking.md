# Subagent tracking and session model

Mockup: `.claude/mockups/subagents.html` (not versioned).

## Why

Following a subagent today only shows its type, description, state, tool count and duration. The developer wants to
see, at a glance, how full its context is, what it is doing right now, how many tools it used and which model it runs
on; and the model of the session itself, with a way to change it.

## What

- **Subagent card, tab and banner**: model pill (short name, colour per family: Opus, Sonnet, Haiku, Fable), context
  gauge (`48k / 200k · 24 %`, orange from 50 %, red from 75 %, same thresholds as the header 🧠), 🔧 tool count,
  ⏱ duration, and while running a "now" line: the tool in progress with its argument (`Grep parent_tool_use_id`) and,
  in italics, the last sentence the agent wrote. Once finished: the highest context reached.
- **Session model**: a pill next to the mode selector in the header (`Opus 5.5 · 1M`, full id as tooltip). A click
  opens the list of `supportedModels()`; a choice calls `setModel` (applies from the next call). The choice is kept in
  the session JSON (`modelChoice`) and passed again as `model` when the query is resumed after a restart.

## Decisions

- Activity: tool in progress + last sentence, no AI summary (`agentProgressSummaries` stays off: zero extra token).
- Model pill clickable, with the model list.

## How

- Everything comes from the stream already received: `message.model` and `message.usage` of the agent's assistant
  messages (context = input + cache read + cache creation), its `tool_use` blocks (`summarizeTool`), its text blocks.
  The window of a model is `contextWindow` from `modelUsage` of the turn results (200k until known).
- Main feed: `message.model` updates the board `model` when the family/version differs from the current one (after a
  `/model` typed in the input), the `[1m]` suffix of the init id is kept.
- History (session reloaded): model and highest context read from the subagent transcripts.
- Engine routes: `GET /api/sessions/:slug/models`, `POST /api/sessions/:slug/model { model }`.
