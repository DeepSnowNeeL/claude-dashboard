# Customizable tracker

> **Update of 2026-10-30 (developer's request)**: no more ⚙ Options → Tracker tab, nor a choice file. The presence of
> a file decides, the first one found: `~/.claude-dashboard/trackers/repos/<repo>.json` >
> `<root>/.claude/tracker.json` > `~/.claude-dashboard/tracker.json` > Simple tracker; each file is a profile or a
> reference `{ "profile": "<built-in id>" }`. `/tracker` writes these files (`set_tracker`, scopes `preview`,
> `install-repo`, `repo`, `default`). The sections "Where profiles live", "Page" (Options) and "Routes" below are
> replaced by this paragraph.

2026-10-30. Decisions made with the developer in the "customizable-tracker" session.

## Why

The right panel (then called "Board") shows one developer's way of following a session: approach, key points,
tradeoffs, mockups, UML architecture, database. Other users (other trades, other devs) need other blocks: images,
files and links, tables, milestones… The panel becomes the **Tracker**, drawn from a **tracker profile** chosen per
installation and per project. A `/tracker` skill helps compose one's profile.

Non-goals: free HTML written by Claude (the principle "fixed UI, Claude only sends data" holds); editing profiles with
the mouse (that is the job of `/tracker`); changing anything for the existing user.

## What does not change

- The decision cards (`decisions`, in the conversation), `step`, `status`, `statusSummary`, `title`, `ticket`,
  `description`: common to all profiles, outside the profile.
- The MCP tool `update_board` (then `maj_tableau`) keeps its field merge (`null` erases).
- The blue "updated since your last read" marking (per block key).
- With the "Dev tracker" profile, the panel and the instructions are today's, identical.

## Tracker profile

```json
{
  "id": "graphic-design", "name": "Graphic design", "description": "visuals, deliverables, client feedback",
  "types": {
    "timeline": { "layout": "timeline", "fields": [
      { "key": "date", "type": "text" }, { "key": "label", "type": "text" }, { "key": "image", "type": "image" } ] }
  },
  "blocks": [
    { "key": "progress", "type": "progress" },
    { "key": "keyPoints", "type": "list", "title": "Key points", "instruction": "3 to 6 lines" },
    { "sideBySide": [ { "key": "a", "type": "list", "title": "A" }, { "key": "b", "type": "list", "title": "B" } ] },
    { "key": "milestones", "type": "timeline", "title": "Milestones", "instruction": "the dated steps of the project" }
  ]
}
```

- `key`: the `update_board` field the block shows (unique in the profile, neither `decisions` nor the common fields).
- `title`: optional (otherwise the type's); `instruction`: what Claude must put in it, added to the type description.
- `sideBySide`: two (or three) blocks side by side, on one line.
- `id`: `[a-z0-9-]+`, unique; it is the file name.

### Base types

| type | data | rendering |
|------|------|-----------|
| `progress` | `[{ label, state: done / working / todo }]` | dots on one line (current) |
| `approach` | `{ chosen, why, alternatives: [{ name, reason }] }` | current |
| `list` | `[rich text]` | bullet list (Key points, Tradeoffs) |
| `text` | rich text | paragraph |
| `checklist` | `[{ label, done: bool }]` | checklist (read only) |
| `images` | `[{ path \| url, caption? }]` | thumbnail gallery, click = full screen / path menu |
| `files` | `[{ path \| url, label?, note? }]` | list of links (path menu for a path, tab for a URL) |
| `table` | `{ columns: [..], rows: [[..]] }` | table |
| `code` | `{ language?, code }` | code block |
| `mermaid` | `{ source, notes? }` | any Mermaid diagram (with "enlarge") |
| `mockups` | current | current |
| `architecture` | current | current |
| `db` | current (`{ mermaid, notes? }`) | current |

Images and files go through the existing routes (`/api/file/<path>`, `isPathAllowed`): from the wifi or the
internet, only those of the projects are shown.

### Composite types

Declared in the profile's `types`: `{ layout: "cards" | "timeline" | "rows", fields: [{ key, type: text | image |
link | file | date }] }`. Data: an array of objects having these fields. Rendering: `cards` (grid, image on top),
`timeline` (vertical chronology, the first text or date field is the marker), `rows` (one line per object). A
composite type travels with its profile.

## Where profiles live, which one applies

(Superseded: see the update at the top.)

- Built into the app: `trackers/simple.json` ("Simple tracker": progress, key points, files and links; default of a
  new installation) and `trackers/dev.json` ("Dev tracker": the current display).
- Installation: `~/.claude-dashboard/trackers/<id>.json` (created by `/tracker` or imported) and a choice file
  `{ "default": "<id>", "projects": { "<project id>": "<id>" | "repo" } }`. The project id is the one of
  `projects.mjs` (`pathKey()` of the main worktree path).
- Repo: `<repo root>/.claude/tracker.json`, a full profile, shared through git.
- Order for a session (its `cwd`): installation's choice for the project > repo profile > installation default >
  "Simple tracker". A choice that names a missing profile is ignored.
- For the existing user: the default becomes `dev` at setup (if nothing exists yet and sessions already exist, sign of
  an installation in use). A new installation has nothing: "Simple tracker".

## Claude's instructions

The common instructions file (today `instructions.en.md` / `instructions.fr.md`) keeps everything except the section
"The board fields", replaced by a text generated from the session's profile (`instructionsOf(profile)` of
`trackers.mjs`): for each block, `` **`key`** `` (title): format of the type + the block's `instruction`; plus the
format of the composite types. The description of `decisions` (common) stays written in the instructions file. The
"dev" profile carries today's sentences as instructions, so its generated instructions are equivalent to the current
ones.

The instructions are read when the query starts: a profile change applies to new sessions and to those that resume.
The display follows right away (the page resolves the profile on each render).

## MCP tool `set_tracker` (for `/tracker`)

`set_tracker({ profile, scope })`, `scope`:
- `preview`: set on the session alone (`trackerPreview` in its JSON); the panel shows it instead of the resolved
  profile, with a "preview" banner; `profile: null` removes it;
- `installation`: saved to `~/.claude-dashboard/trackers/<id>.json`;
- `project`: saved in the installation and chosen for the session's project;
- `default`: saved in the installation and chosen by default;
- `repo`: written to `<repo root>/.claude/tracker.json` (Claude warns that it is versioned).
The profile is validated (ids, known types, unique keys); the error goes back to Claude. After saving, the session's
preview is removed.
(Final scopes: see the update at the top.)

## Skill `/tracker`

Local plugin of the repo (`plugin/.claude-plugin/plugin.json`, `plugin/skills/tracker/SKILL.md`), passed to the SDK
through the `plugins` option: present in the page's sessions only. The skill: asks what the user wants to see when
coming back to a session; starts from an existing profile (built-in and installation ones, read by `list_trackers`);
proposes a profile and sets it as `preview`; adjusts; saves with the chosen scope; can add a composite type.

`list_trackers()`: MCP tool that returns the available profiles (id, name, description, source) and the session's
current profile.

## Page

- "Board" tab renamed "Tracker"; mobile bar "📋 Tracker".
- The right panel (`renderTracker`) draws the profile's blocks (one renderer per type); at the top, discreet:
  "Profile: <name> · <source>". Profile with no filled block: the current waiting text, adapted; with "Simple
  tracker", a line "✨ To change this tracker, type /tracker".
- ⚙ Options → "📋 Tracker" tab (PC only): default profile; list of profiles (built-in, installation) with Export
  (download of the `.json`), Delete (installation only); Import a `.json`; choice per project ("default", "the repo's"
  if the repo has one, or a profile). (Dropped: see the update at the top.)

## Routes (page, `server.mjs`)

(Dropped: see the update at the top.)

- `GET /api/tracker?cwd=` → `{ profile, source }` (all origins).
- `GET /api/trackers` → `{ profiles: [{ id, name, description, source: built-in | installation }], default, projects }`.
- `POST /api/trackers/import` `{ profile }`, `DELETE /api/trackers/<id>`, `POST /api/trackers/choose` `{ default }` or
  `{ project, id }`, `GET /api/trackers/<id>` (export): PC only (like `/api/options`).

## Clarifications after review

- Common module `trackers.mjs` (read, resolve, validate, write), used by `server.mjs` and `driver.mjs`; the
  instructions are generated in `createSession` (the profile is resolved before, synchronously: local files and
  `git rev-parse --show-toplevel`). `set_tracker` and `list_trackers` go into `allowedTools`.
- Keys forbidden in a profile (`RESERVED_KEYS`): `decisions`, the common fields (`title`, `ticket`, `ticketUrl`,
  `description`, `project`, `step`, `status`, `statusSummary`) and the internal fields (`slug`, `cwd`, `sessionId`,
  `mode`, `stats`, `updatedAt`, `titlePinned`, `autoTitle`, `endedAt`, `archivedAt`, `trackerPreview`, `driven`,
  `model`…).
- Ids refused on import: those of the built-in profiles (`dev`, `simple`) and `import`, `choose`. An existing
  installation id is overwritten.
- Blue marking: derived from the profile's blocks (tracked items: those of a JSON array, `table.rows`,
  `architecture.layers[].elements`). Item ids (`#enlarge`…) specific to each block. The marking names of `app.js`
  were renamed so they are not confused with the Tracker.
- `title` accepts `{n}` (number of items): "Tradeoffs made without you ({n})", "Mockups ({n})".
- The page caches the profile per `cwd` (read again on `update` and after Options); the tab keeps an internal value
  (`localStorage`, `data-mobile`), only the label changes.
- `GET /api/tracker?cwd=` only accepts a known session or project folder; `GET /api/trackers` is PC only and also
  returns `repos: [projectId]` (projects whose repo has a profile). "PC only" regex: `trackers`, not `tracker`.
- URLs: `http(s)` only in links; images by URL in `https`. Field `image` / `file` / `link` of a composite type: URL if
  it starts with `http`, otherwise an absolute path.
- Archiving: also copies the `path`s of the `images` and `files` blocks, like the mockups.
- Repo profile injected into the system prompt: same trust as the repo's CLAUDE.md.
- Skill: a plugin skill is called `/<plugin>:<skill>` (checked: `dashboard:tracker`). The page offers `/tracker` as a
  local command, rewritten to `/dashboard:tracker` when sent; the autocompletion only shows `/tracker`.

## Left to the builder

Visual details of the new renderers (in the spirit of the mockups), error messages, order of the profiles in the
lists.
