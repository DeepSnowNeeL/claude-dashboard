# Levels, XP and achievements

Date: 2026-11-13. Names below are the current code's (family ids,
JSON keys, routes); the original spec was written in French.

## Why

For fun. Every interaction with Claude earns XP, which gives a level and a rank, and achievements reward notable uses
(compactions, plan limits, sessions in parallel…).

## Goals, non-goals

- Everything is counted by the **engine**, with no token nor extra instruction for Claude.
- **Start from zero**: no retroactive computation from the transcripts.
- **Adjustable thresholds**: only **raw records** are stored, and the earned milestones, the XP and the level are
  recomputed from a single definitions file. Lowering a threshold (buff) unlocks the milestone with the record's real
  date; raising it (nerf) removes it, with its XP (the level can go down, that is accepted).
- **Frequent plan changes**: nothing must show a false record when the plan changes (see Plan).
- Non-goals: ranking between users, sync between PCs (each installation has its own progress), anti-cheat.

## XP and levels

Activity XP (`activityXp`, cumulative, never recomputed):

| Event | XP |
|---|---|
| Message sent to a session by the developer (send route, including `/command` and `!command`; not another session's `message_session`) | +10 |
| Panel decision recognised in the message (`N. …` line) | +5 per line |
| Card answered (AskUserQuestion, permission) | +10 |
| Turn finished by Claude (`result`) | +2, plus +1 per tool of the turn (cap 50) |
| Subagent launched, session launched (`launch_session` or page) | +5 |

Achievement XP (recomputed): bronze 100, silver 250, gold 500, platinum 1,000, legend 2,500, per earned milestone.

`xp = activityXp + Σ bonus of the earned milestones`. Total XP for level n: `250 × n²`, so
`level = floor(sqrt(xp / 250))`, minimum 1 (level 0 is shown as 1).

Ranks (minimum level → name): 1 Student pilot, 5 Copilot, 10 Pilot, 20 Captain, 30 Air traffic controller, 40 Tower
chief, 50 Flight director, 75 Master of the sky, 100 Legend of the tower. Each rank has an emoji (🎓 ✈️ 🛩️ 🛫 📡 🗼 🎖️
🌌 👑), shown in the round badge of the window header.

The day's XP is also kept (`dayXp: { date, xp }`) for "today: +2,840 XP".

## Milestone tiers

A family has 1 to 5 increasing thresholds. Milestone i (0-indexed) takes the tier
`['bronze', 'silver', 'gold', 'platinum', 'legend'][i]`. A single-milestone family states its `tier`. The number shown
in the toast is in Roman numerals (I, II, III…) except for a single milestone.

## The families

`measure`: **max** (record = highest value seen) or **total** (counter that only goes up). "Per session" values are
held in the session's `data.stats.achievements` then raised as records by `record(family, value)`. "Session" =
conversation: a `/clear` resets the `stats.achievements` counters (like `clearBoard` for the rest). Sessions that
existed before the feature start their counters at the first event seen. `stats.achievements.start` (Marathon) and
`stats.achievements.lastExchange` (Fossil) follow the session into its archive (the JSON is archived as is). A session
without these fields (resumed terminal conversation, older session) gets them at the first message sent (builder's
choice: no history reading for this).

### Endurance (`endurance`)

| id | name | emoji | measure | thresholds | counting |
|---|---|---|---|---|---|
| compactor | Compactor | 🗜️ | max | 3, 5, 10, 20 | compactions (`compact_boundary`) of the conversation |
| bursting | Bursting at the seams | 🧠 | max | 100 (gold tier) | % of the context (`context / window`), rounded down; only 100 counts |
| marathon | Marathon | 🏃 | max | 3, 7, 21, 60 (days) | gap between the first counted event of the conversation (`stats.achievements.start`) and the message sent |
| fossil | Fossil | 🦴 | max | 7, 30, 90 (days) | when a message is sent: gap with `stats.achievements.lastExchange` (time of the developer's last message or turn end, not `data.updatedAt` which everything rewrites) |

### Sessions that work hard (`sessions`)

| id | name | emoji | measure | thresholds | counting |
|---|---|---|---|---|---|
| toolbox | Toolbox | 🧰 | max | 300, 1000, 2500, 5000 | tool calls of the main feed (not the subagents') |
| autopilot | Autopilot | 🤖 | max | 10, 50, 100 | turns started without a developer message (wake-up by agent, shell, loop, message from another session) |
| conductor | Conductor | 🎼 | max | 1, 3, 5, 10, 20 | sessions launched by this session (`launch_session`) |
| swarm | Swarm | 🐝 | max | 1, 3, 5, 10, 20 | peak of subagents running at the same time in the session |
| long-haul | Long haul | ⏱️ | max | 30, 60, 180 (minutes) | duration of a turn (`duration_ms` of the `result`) |
| bulldozer | Bulldozer | 🚜 | max | 3000, 8000, 20000, 50000 | lines written: Edit (`old_string` + `new_string`), MultiEdit (sum), Write (`content`), cumulated over the conversation |

### Plan (`plan`)

| id | name | emoji | measure | thresholds | counting |
|---|---|---|---|---|---|
| big-appetite | Big appetite | 🍔 | max | 5, 10, 20, 30 (%) | rise of the weekly % within the day (see Plan) |
| wall-5h | The 5-hour wall | 🧱 | total | 1, 5, 10 | 5-hour windows that reached 100 % |
| hell-week | Hell week | 🔥 | max | 2, 5, 10 | 5-hour windows at 100 % in the same week |
| out-of-fuel | Out of fuel | ⛽ | total | 1, 3, 5 | weeks that reached 100 % (overall or per model, once per week) |
| on-the-edge | On the edge | 🎯 | total | 1 (gold tier) | week ended between 95 and 99 % |
| ascetic | Ascetic | 🧘 | total | 1 (bronze tier) | week ended under 20 %, with at least 3 days of samples in the week |

### Multitasking (`multitasking`)

| id | name | emoji | measure | thresholds | counting |
|---|---|---|---|---|---|
| juggler | Juggler | 🤹 | max | 3, 5, 8, 12 | sessions with a turn running at the same moment |
| traffic-jam | Traffic jam | 🚦 | max | 3, 5, 8 | sessions in `waiting` status or blocked on a card at the same moment (live, driven sessions); only those whose last turn happened within the hour, so forgotten sessions do not count |
| reflex | Reflex | ⚡ | total | 100, 500, 2000 | message or card answer less than 30 s after the end of Claude's turn (or the card's appearance) |
| inbox-zero | Inbox zero | 📭 | max | 10, 15, 25 | number of open (not ended) sessions when the unread total drops to 0 (after a `seen`) |

### Decisions (`decisions`)

| id | name | emoji | measure | thresholds | counting |
|---|---|---|---|---|---|
| decider | Decider | 🗳️ | total | 50, 250, 1000 | answered decisions: `N. …` lines of a message that match a panel decision, and AskUserQuestion answers |
| go | "go" | 👍 | total | 50, 500, 2000 | messages of 3 characters or less (after trim), excluding `/` and `!` |
| eyes-closed | Eyes closed | 🙈 | max | 10, 20, 50 | streak of **panel** decisions whose answer repeats the recommended choice's; another choice resets the streak to 0 (AskUserQuestion has no recommendation: it only counts for Decider) |
| rebel | Rebel | 😈 | total | 10, 50, 100 | panel decisions answered without repeating the recommended choice |
| teacher | Teacher | 🧑‍🏫 | total | 10, 50 | lines `N. explain in more detail` (French `explique-moi plus en détail` also matches) |
| perfectionist | Perfectionist | 🎨 | max | 3, 5, 10 | `1 + versions.length` of a panel mockup |
| perfection | Perfection | 💎 | total | 50, 100, 500 | messages containing "parfait" or "perfect" (case and accent insensitive) |

Matching of an `N. text` line: N = position of the decision in `data.decisions` at send time; it follows the
recommendation if the text starts with the `answer` of the recommended choice (comparison ignoring case and edge
spaces).

### Git and worktrees (`git`)

Detected on the Bash commands of the main feed whose result is not an error.

| id | name | emoji | measure | thresholds | counting |
|---|---|---|---|---|---|
| courier | Courier | 📦 | total | 10, 100, 500, 2000 | `git commit` (excluding `--dry-run`) |
| liftoff | Liftoff | 🚀 | total | 10, 100, 500 | `git push` |
| arborist | Arborist | 🌳 | total | 1, 5, 20, 50 | `git worktree add`, `createWorktree` (page and `launch_session`) |
| lumberjack | Lumberjack | 🪓 | total | 5, 20 | `git worktree remove`, route `/api/worktree/remove` (served by the page: it notifies the engine) |

### Rhythm (`rhythm`)

PC local time, when a message is sent.

| id | name | emoji | measure | thresholds | counting |
|---|---|---|---|---|---|
| night-owl | Night owl | 🦉 | total | 1, 10, 50 | distinct nights with a message between 2 and 5 am |
| early-bird | Early bird | 🌅 | total | 1, 10, 50 | distinct mornings with a message between 5 and 7 am |
| no-weekend | No weekend | 📆 | total | 1, 5, 20 | weekends with at least one message on Saturday and on Sunday |
| streak | Streak | 🔁 | max | 7, 30, 100, 365 | consecutive days with at least one message |
| holiday | Holiday | 🎄 | total | 1 (silver tier) | message on December 25 or January 1 |

### Remote (`remote`)

The origin comes from the `x-dash-origin` header (`pc`, `wifi`, `internet`) that the page adds when relaying to the
engine (port 4749 = internet, non-local address on 4747 = wifi).

| id | name | emoji | measure | thresholds | counting |
|---|---|---|---|---|---|
| remote-pilot | Remote pilot | 📱 | total | 1, 50, 500 | messages and card answers outside the PC |
| couch | From the couch | 🛋️ | total | 1, 10, 50 | sessions created outside the PC |
| globetrotter | Globetrotter | 🌍 | total | 1, 10, 50 | distinct days with a message from the internet |

### Accidents (`accidents`)

| id | name | emoji | measure | thresholds | counting |
|---|---|---|---|---|---|
| red-button | Red button | 🛑 | total | 10, 50, 200 | interruptions (interrupt route, "stop and send") |
| clean-slate | Clean slate | 🧹 | max | 25, 50, 80 (%) | % of the context at the time of a `/clear` (`/reset`, `/new`) |
| it-happens | It happens | 💥 | total | 10, 50, 200 | `result` with an API error, excluding plan limits (`rate_limit_event` rejected just before) and requested interruptions |
| insomniac | Insomniac | 🌙 | max | 1, 6, 24 (hours) | duration of a background shell **that finished by itself** (status `completed` or `failed`, not `stopped` / `killed`, not cut by a restart) |
| sentinel | Sentinel | 🔐 | total | 100, 500 | permission cards accepted |

### Secrets (`secrets`, hidden until unlocked)

| id | name | emoji | tier | counting |
|---|---|---|---|---|
| em-dash | Em dash | ✒️ | legend | an em dash (U+2014) in a Claude text block of the main feed |
| polite | Polite | 🙏 | silver | threshold 100: messages containing "merci", "thanks" or "thx" (case insensitive) |
| huh | Huh? | ❓ | bronze | message equal to "?" |
| hourglass | The hourglass | ⏳ | silver | card (question, permission) answered at least 8 h after it appeared |
| outburst | Outburst | 🤬 | bronze | message of at least 20 letters, all uppercase |
| first-flight | First flight | 🐣 | bronze | first session created after the feature went live |
| inception | Inception | 🪞 | gold | `dash.mjs restart-engine` run by a Bash command of a driven session |
| collector | Collector | 🏆 | platinum | all the other secrets earned (computed, no record) |

## Storage: `~/.claude-dashboard/progress.json`

```json
{
  "version": 1,
  "start": "2026-11-13T18:00:00.000Z",
  "activityXp": 41230,
  "dayXp": { "date": "2026-11-13", "xp": 2840 },
  "records": {
    "toolbox": { "value": 1412, "log": [[300, "2026-11-13T…", "n-abc"], [1000, "…", "n-abc"], [1412, "…", "n-abc"]] },
    "courier": { "value": 37, "log": [[10, "…", "n-x"], [20, "…", "n-y"], [37, "…", "n-z"]] }
  },
  "announcements": ["toolbox:0", "toolbox:1", "courier:0"],
  "seen": ["toolbox:1"],
  "days": { "nights": ["2026-11-04"], "mornings": [], "weekends": [], "globe": [], "streak": { "last": "2026-11-13", "n": 4 } },
  "decisions": { "recoStreak": 3 },
  "plan": { "plan": "max", "weekReset": 1763200000, "day": "2026-11-13", "lastPct": 41, "dayUsage": 3,
            "weekMaxPct": 61, "windows5h": [1763100000], "fullWeeks": [1762600000], "sampledDays": ["2026-11-10"] }
}
```

- **Log**: an entry `[value, ISO date, slug]` when the record crosses a "round" value of the sequence
  1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 12, 15, 20, 25, 30, 40, 50, 60, 75, 100, 120, 150, 200, 250, 300, 400, 500, 600,
  750, 1000… (×10 afterwards), plus the current value kept as the last entry (replaced on each new record).
  The date a milestone was earned = date of the first entry ≥ threshold. With this sequence, any threshold is dated at
  the latest at the next round step: acceptable.
- **announcements**: milestones already announced (toast). At startup and after each change, any earned milestone
  missing from `announcements` is announced (SSE `achievement`) then added; a milestone removed by a nerf leaves
  `announcements`. At the very first start (file missing), the file is created empty: nothing to announce.
- **seen**: milestones whose card was seen in the window (for the orange dot of the badge and the "new" label).
  Opening the 🏆 window marks everything seen (`POST /api/progress/seen`).
- Grouped writes (at most one per second), file written whole (`writeFileSync` to a `.tmp` then `renameSync`).

## Plan

`engine/plan-achievements.mjs` calls `subscriptionUsage()` (1 min cache, already existing) every minute while the
engine runs, and also reads the sessions' `rate_limit_event`s. To keep a single Claude probe, the page's `/api/usage`
is relayed to the engine, which now holds the only probe. The pure computation is `advancePlan()` in
`engine/achievements/plan.mjs`.

- **Day's usage** (Big appetite): `pct` = "Week" limit (`weekly_all`). If the `plan` or the weekly `reset` changed
  since the previous sample, or if `pct` went down: the base restarts, the usage already counted that day is kept
  (`dayUsage`) and additions continue from the new base. Otherwise the rise since the last sample (`lastPct`) is added
  to `dayUsage`. At midnight: `dayUsage = 0`.
- **The 5-hour wall / Hell week**: a 5-hour window counts once, identified by its `resets_at`, when its "Session (5 h)"
  limit reaches 100 % or a `rate_limit_event` `rejected` `five_hour` arrives. `hell-week` = number of these windows
  whose reset falls in the current week (identified by the weekly `reset`).
- **Out of fuel**: a week (identified by its `reset`) counts once when a weekly limit (overall or per model) reaches
  100 % or a `rejected` `seven_day*`.
- **End of week** (the weekly `reset` changes): last `weekMaxPct` sampled → On the edge (95 to 99, without 100) or
  Ascetic (< 20, at least 3 days of samples). If the plan changed during the week, neither.
- A usage failure (experimental API) counts nothing.

## Hook points (indicative)

- `driver/events.mjs`: compactions, context (Bursting), tools, lines, git commands, agents (peak), `result` (turn: XP,
  duration, API errors), `rate_limit_event`, em dash in text blocks.
- the engine's send route (not `driver/input.mjs`, which `message_session` also uses): a developer message is sent
  (XP, rhythm, go, polite, huh, uppercase, Reflex, Fossil, Marathon, decisions by `N.` lines), turns without a message
  (Autopilot: a turn started by a wake-up), `/clear` (Clean slate). Today in `engine/achievement-counters.mjs`.
- `driver/permissions.mjs`: cards (XP, Sentinel, Hourglass, Reflex, AskUserQuestion → Decider).
- `driver/agents.mjs`: shells (Insomniac), subagents (XP, Swarm).
- `engine/sessions.mjs`, `engine/routes.mjs`, `engine/board.mjs`: Juggler, Traffic jam, Conductor, First flight,
  Inbox zero (after `seen`), interruptions, worktrees, Perfectionist.
- `server/engine-client.mjs`: `x-dash-origin` header.
- The driver does not import the engine: progress goes through the callbacks given to `createSession`
  (`ctx.achievements.record`, `ctx.achievements.add`, `ctx.achievements.xp`, …), like `updateBoard` and `count`.

## API

- `GET /api/progress`: `{ categories, ranks, xp, dayXp, level, rank, nextRank, levelXp, nextLevelXp, earned, total,
  newCount, families: [{ id, cat, name, emoji, desc, measure, unit, secret, value, milestones: [{ threshold, tier,
  earned, date, slug }], isNew }] }`. Unearned secret families are sent without name, description or emoji.
- `POST /api/progress/seen`: marks everything seen.
- SSE `achievement`: `{ type: 'milestone', family, tier, number, name, emoji, desc, threshold, xp, slug, sessionTitle }`
  or `{ type: 'level', level, rank, emoji, newRank }`.

## Page

- Badge at the bottom of the session list, next to "⚙ Options" (also outside the PC): `🏆 Lv. 23` + mini bar + orange
  dot if a milestone is not seen. Tooltip: rank and XP.
- 🏆 window matching the mockup: header (rank badge, level and rank, next rank, XP bar, earned milestones / total, the
  day's XP), tabs All + categories + Secrets, sorted by progress (closest to the next milestone first); a card expands
  (each milestone, its date, link to the session if it still exists, XP). Escape closes.
- Toasts at the bottom right, 6 s, stacked; a level that reaches a new rank has an orange toast.
- Image: `public/achievements/<id>.webp` if it exists, otherwise the emoji; frame colored by tier (bronze `#b06a2c`,
  silver `#94a3b8`, gold `#eab308`, platinum `#38bdf8`, legend `#a855f7`), greyed if nothing is earned.
- Electron app: Windows notification for a gold, platinum or legend milestone, and for a new rank. It does not get the
  SSE: it polls `GET /api/progress/announcements?since=<n>` (list of numbered announcements, kept in the engine's
  memory) on each poll of `/api/sessions` it already does.

## Images

`scripts/achievement-images.mjs [id…]`: one square image per family (without argument: the missing ones), through
OpenAI's `images/generations` (model `gpt-image-2` by default, `DASH_IMAGE_MODEL` to change it, 1024×1024, medium
quality, WebP). Key: `OPENAI_API_KEY` from the environment, otherwise read from the `.env` file given by
`DASH_OPENAI_ENV`; never copied into the repo. Common style: round aviation insignia medal, simple illustration
readable at small size, bright colors, no text. Each image's subject is in the definitions (`image`). The images are
versioned.

## Left to the builder

Function names and internal split, exact detection of git commands in a compound Bash command, sort format, toast
animation.
