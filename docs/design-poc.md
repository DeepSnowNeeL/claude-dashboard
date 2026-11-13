# claude-dashboard POC design

Historical document: the first version (a page fed by JSON pushes from terminal sessions), before the page drove the
sessions itself. The why, the principles and the current architecture are in `../CLAUDE.md`. Key names and values
below are the current (English) ones. The HTML mockups validated in brainstorming are not published.

## 1. The four pieces

| Piece | Location | Role |
|---|---|---|
| Server | `server.mjs` | HTTP on `127.0.0.1:4747`, in-memory state, serves the page, pushes updates |
| Page | `public/index.html` (+ `app.js`, `style.css`) | Fixed template that shows the sessions' JSON |
| CLI | `dash.mjs` | `push` (sends a JSON) and `ensure` (starts the server if it does not answer) |
| Skill | `~/.claude/skills/<name>/SKILL.md` | Way of working loaded by hand in a session |

Node only, no npm dependency. Mermaid loaded by the page from
`https://cdn.jsdelivr.net/npm/mermaid@11.4.1/dist/mermaid.esm.min.mjs`.

## 2. Server

- Listens **only** on `127.0.0.1:4747` (port overridable with the `DASH_PORT` variable). No authentication (outside
  the POC).
- State: a `Map` slug → last JSON received, plus the reception date. Nothing on disk. At startup, it **reloads** the
  files of `~/.claude-dashboard/sessions/*.json` if there are any (that is where the skill writes them), so that a
  restart does not empty the page.
- Routes:

| Method | Route | Effect |
|---|---|---|
| GET | `/` | the page |
| GET | `/api/ping` | `{ok:true}` |
| GET | `/api/sessions` | summary list: slug, title, description, status, step, statusSummary, updatedAt |
| GET | `/api/sessions/:slug` | full JSON |
| POST | `/api/sessions/:slug` | replaces the session's JSON (body = the full JSON) |
| DELETE | `/api/sessions/:slug` | removes the session from the page and moves its file to `sessions/archive/` ("Remove" button of the page, `dash.mjs rm` command) |
| GET | `/api/events` | Server-Sent Events: an `update` event with the slug on each POST/DELETE |
| PATCH | `/api/sessions/:slug` | merges `status` / `statusSummary` only (light update) |
| GET | `/f/<slug>/<absolute path>` | serves a local file (HTML mockup and its CSS, images, neighbour iframes) |

- **`/f/` guard**: the route is by path (not by parameter) so that the relative links of a mockup
  (`../../app-front/dist/…/app.css`, `fontawesome/…`, neighbour iframes) resolve by themselves. Allowed roots: for each
  path declared in the session's JSON (`mockups[].path`, `example.path`), the root of the git repo that contains it
  (first parent folder containing `.git`), otherwise its folder. Any path outside these roots, or containing `..` after
  normalisation, answers 403. *(Builder's choice, review.)*
- Validation on reception: valid JSON, `slug` equal to the URL's slug, `title` and `step` present. Otherwise 400 with
  the reason. The rest of the schema is not checked: the page shows what it finds and ignores the rest.

## 3. Session JSON format

One object per session, always sent **whole** (no partial update). All fields except `slug`, `title`, `step` are
optional; a missing block is not shown.

```jsonc
{
  "slug": "1234-quiz-matching",            // [a-z0-9-]+, key of the session
  "ticket": "1234",                        // optional, shown as "1234 · quiz-matching"
  "title": "quiz-matching",                // quick context
  "description": "New kind of quiz question: match items two by two…",
  "project": "app",
  "ticketUrl": "https://gitlab.example.com/team/app/-/issues/1234",
  "status": "waiting",                     // waiting | working | done  → group in the list
  "step": "framing",                       // framing | mockup | design | execution | push
  "statusSummary": "2 decisions",          // pill in the list
  "approach": {
    "chosen": "Dedicated tables, modelled on the ordering question",
    "why": "Convention \"one question type = its own tables\"",
    "alternatives": [ { "name": "Reuse the ordering tables", "reason": "contradicts an earlier tradeoff" } ]
  },
  "decisions": [
    {
      "id": 1,
      "question": "Must the right pair be hidden from the browser?",
      "context": "A learner opens the dev tools during an exam.",
      "recommendation": "random key",                  // label of one of the choices
      "choices": [ { "label": "random key", "answer": "random key ok" },
                   { "label": "no need",    "answer": "no random key" } ],
      "example": { /* see § 3.1 */ },
      "explanation": "rich text (§ 3.2), filled when the developer asked \"explain\""
    }
  ],
  "keyPoints": [ "Scoring of your choice: per pair or all or nothing", "…" ],
  "mockups": [ { "title": "Quiz, card mode", "path": "/home/me/app/docs/mockups/1234-….html" } ],
  "architecture": {
    "level": "components",                 // component | components | packages (shown as a subtitle)
    "layers": [
      { "name": "common", "elements": [
        { "op": "+", "name": "app-question-matching",
          "detail": "in: question, elements, answers, disabled, correction · model: selection",
          "usedIn": ["quiz", "exam", "LMS player"],
          "example": { "type": "code", "language": "html", "code": "<app-question-matching [question]=\"q\" [(selection)]=\"sel\" />" } }
      ] },
      { "name": "services · methods", "elements": [
        { "op": "~", "name": "QuizService.saveQuiz", "detail": "numbers the pairs, draws the keys",
          "example": { "type": "comparison", "left": {…}, "right": {…} } }
      ] }
    ]
  },
  "db": {
    "mermaid": "erDiagram\n  Q ||--o| QM : \"1-1\"\n  Q[\"~ Question\"] { … }\n  QM[\"+ QuestionMatching\"] { … }",
    "notes": "LMS: no table"
  },
  "tradeoffs": [ "No feature flag: opt-in by construction" ],
  "progress": [ { "label": "Mockups", "state": "done" }, { "label": "Execution", "state": "todo" } ],
  "updatedAt": "2026-10-28T17:40:00+01:00"
}
```

`op` is `+` (added), `~` (modified) or `-` (deleted), shown as a colored square badge (green / orange / red) with the
sign, never the color alone. `state` is `done`, `working` or `todo` (✅ / ⏳ / ⬜).

### 3.1 Examples (`example`)

| `type` | Fields | Rendering |
|---|---|---|
| `situation` | `text` | paragraph of rich text |
| `code` | `language`, `code` | dark code block |
| `comparison` | `left` and `right`, each `{title, tone, text?, code?, language?, path?}` | two columns side by side; `tone` = `good` / `bad` / `neutral` colors the border |
| `mockup` | `path`, `height` (px, default 220) | iframe on `/api/file` |

In a `comparison`, a side can carry the `path` of a mini HTML mockup: this is how two UI variants are shown side by
side (example of the images with/without in `dashboard-v3.html`).

### 3.2 Rich text

The fields `text`, `context`, `explanation`, `detail`, `why`, `reason` accept a subset of markdown, rendered by the
page (no library): `**bold**`, `` `code` ``, ```` ``` ```` blocks with a language, `- ` lists, line breaks. Everything
else is escaped (no HTML injected).

## 4. Page

Layout and content: mockups `dashboard-v2.html` and `dashboard-v3.html`, and `../CLAUDE.md` § "What the page shows".
Details:

- **Left list**: groups "Waiting for your answer" / "Working" / "Done" by `status`, sorted by descending
  `updatedAt`. Search field filtering on slug, title and description (local filter, no server).
- **Right panel**, in this order: header (`ticket · title`, description, ticket links, "N min ago"); step bar (the 5
  steps, the current one highlighted, the previous ones checked); progress on one discreet line; chosen approach
  (alternatives shown); **Your call**; **answer field**; then, without folding: key points and tradeoffs side by
  side, mockups ("Open" button + one button per older version), architecture (each element's example code first, the
  description below), database.
- **Decisions**: question, context, example, then the choice buttons (the recommendation carries the "recommended"
  pill) and an **Explain** button. If `explanation` is present, it shows under the decision in a separate box.
- **Answer field**: free text area. A click on a choice writes or replaces the `N. <answer>` line of that decision;
  **Explain** writes `N. explain in more detail`; the developer completes by hand. **Copy** button (clipboard), then
  they paste into the console. The draft is kept per session in `localStorage` (survives a reload). It is **never
  emptied as a whole**: on each new JSON, only the `N. …` lines of decisions that disappeared (or whose `question`
  changed) are removed; the free text stays. *(Builder's choice, review.)*
- **Pre-filling** (decided by the developer): when a decision arrives, its `N. <answer>` line is written with the
  `recommendation` choice, and that choice appears selected. Following all recommendations = 0 clicks, then Copy; a
  disagreement = 1 click that replaces the line.
- **Architecture**: one box per layer, the elements with badge, `name` in bold, `detail`, `usedIn` bullets, and
  `example` expandable, closed by default.
- **Database**: Mermaid rendering; after rendering, the entities whose label starts with `+` are colored green, `~`
  orange, `-` red. Legend `+ added · ~ modified · − deleted`.
- **Real time**: the page listens to `/api/events`; on an `update` event, it reloads the list and, if it is the
  displayed session, its detail, without losing the open blocks or the draft. The displayed slug is in the URL
  (`#1234-quiz-matching`).
- **Theme**: follows the computer's theme (`prefers-color-scheme`), dark and light, colors defined as CSS variables;
  dark is the main case. Readable on a laptop screen. The mockups are the reference for the layout, not for the
  colors (they are light).

## 5. CLI `dash.mjs`

- `node dash.mjs ensure`: if `/api/ping` does not answer, starts `server.mjs` detached (without a console window on
  Windows) and waits for it to answer (5 s max). Shows the URL.
- `node dash.mjs status <slug> <waiting|working|done> ["summary"]`: light PATCH, a few tokens, used at the start of a
  turn (see skill, rule 4).
- `node dash.mjs rm <slug>`: DELETE.
- `node dash.mjs push <file.json>`: reads the file, writes `updatedAt` = now **into the file** (so that a reload from
  disk keeps it), sends it as POST. Success: shows a line
  `📋 <ticket · title> · <step> · <statusSummary> → http://localhost:4747/#<slug>`. Server unreachable or 400: shows
  the reason **without failing** (exit code 0), so as never to block the session.

## 6. The terminal skill

Loaded by hand at the start of a session, before or during a brainstorming skill. It does not change any other skill's
file, but **for the session, its rules take precedence** over the brainstorming skill's wherever they diverge, and the
skill says so explicitly:

- decisions come **grouped** (all those of a step at once), not one question per message;
- the **mockup comes before** the technical design (a typical brainstorming skill does the opposite);
- spec, spec review, plan and doc impact are still done as usual, but are not steps of the bar: spec and review belong
  to `design`, plan and doc impact to `execution` (`statusSummary` says "spec in review", "plan in progress");
- everything else of the brainstorming skill (reading the project sheet, business docs, conventions, single commit on
  approval) applies as is.

Added rules:

1. **Startup**: `dash.mjs ensure`; give the URL once.
2. **Naming**: slug `<ticket>-<quick-context>` (2 to 4 words, kebab-case, taken from the meaning of the ticket, not its
   number alone), or `<quick-context>` without a ticket. Suggest the developer runs `/rename <ticket> · <title>` (the
   agent cannot rename the session itself).
3. **File**: the JSON lives in `~/.claude-dashboard/sessions/<slug>.json`. The agent writes it (Write), then
   `dash.mjs push`. On each push, the file is rewritten whole.
4. **When to push**: full push at each turn end where the agent waits for the developer (status `waiting`), at each
   step change, and at the end of the work (`done`). At the **start of a turn** that follows an answer, a light
   `dash.mjs status <slug> working "…"`, so that the list does not stay on "waiting for your answer". Not on every tool
   call.
5. **Console**: when a push happened, the console message is reduced to the push line plus, if needed, one sentence.
   No recap nor design in the console. If the push failed, the agent goes back to the usual console format.
6. **Brainstorm order**: framing (recommended approach set by default, alternatives and reasons in `approach`) →
   decisions → **mockup** (if the subject has UI, before any technical design) → **design (check)** (key points,
   architecture, database) → execution → push. The spec and plan files of the brainstorming skill are produced as
   usual, they simply do not appear on the page.
7. **Decisions**: only those that change what is built. Each has a concrete `example` (scenario, code, before/after
   comparison, mini mockup if it is UI) and a `recommendation`. What the agent decided alone goes into `tradeoffs`.
8. **"Explain"**: when the answer contains `N. explain in more detail`, the agent rephrases decision N more
   concretely in `explanation` (worked example, text diagram, code), pushes again, and waits.
9. **Architecture**: granularity by the size of the dev (§ 3, `level`); never a file tree nor RPC links; impacted
   `Service.method` with the reason; one `example` per element when it helps.
10. **Database**: partial `erDiagram`, impacted tables complete, neighbours reduced to their key, `+`/`~`/`-` prefix in
    the entity labels and in the comment of modified columns.

The skill contains a full example JSON (a real session of that time) so the agent copies the shape without reading this
document again.

## 7. Test data

Example sessions (not published): one session at the time of the decisions (approach, 2 illustrated decisions, architecture, database, tradeoffs, progress), plus a minimal one (status `working`)
to populate the list. Check: `dash.mjs ensure`, push both examples, visual check of the page in the browser, click on
the choices and copy of the answer. No automated tests (POC).

## 8. Outside the POC

See `../CLAUDE.md` § "Later".
