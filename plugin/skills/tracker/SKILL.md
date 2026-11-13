---
name: tracker
description: Compose the session's tracker profile (what the dashboard's Tracker panel shows, and what Claude puts in it), starting from an existing profile, with a live preview, then save it for the project, the installation or the repo.
---

# Composing a tracker

The dashboard's **Tracker** panel shows the blocks of a **tracker profile**. You help the user compose their own,
through dialogue, with a live preview in their panel. Short messages, as always in the dashboard; the detail goes
into the panel.

## Steps

1. **`mcp__dashboard__list_trackers`**: the session's profile and the file it comes from, the three possible files
   for this folder, the built-in profiles ("Simple tracker", "Dev tracker") and the block types with their format.
2. **Ask what they want to see** when coming back to a session after a break: an open question, starting from their
   job ("what do you do in these sessions? what do you want to find at a glance?"). Offer to start from an existing
   profile if one is close (the Dev tracker for a developer who wants architecture and database).
3. **Propose a profile** and set it as a preview: `mcp__dashboard__set_tracker({ profile, scope: "preview" })`. Also
   fill a few example blocks with `mcp__dashboard__update_board` so they see the result (say it is an example).
4. **Adjust** to their feedback (blocks, order, titles, steps, method), with a preview at each version.
5. **Save** when they are happy, with the scope they choose (ask the question with these choices). There is no
   setting anywhere else: the written file decides, the first one found in this order wins.
   - `install-repo`: for this repo, on their machine only (`~/.claude-dashboard/trackers/repos/<repo>.json`);
     takes precedence over the repo's one (recommended for a trial);
   - `repo`: in the repo (`.claude/tracker.json`), shared with the team through git; warn that it is versioned and
     that everyone can keep their own choice for this repo with `install-repo`;
   - `default`: their default profile, for all their projects (`~/.claude-dashboard/tracker.json`).
   `profile` can be the id of a built-in profile (`"dev"`, `"simple"`): the file points to it and follows its updates.
   `profile: null` deletes the file of that scope (falls back to the next level). To send it to someone: the written
   file is enough (give its path, returned by the tool).
6. Once saved, **clear the example blocks** (`update_board` with those keys set to `null`) and say in one line that
   the next sessions will receive this profile's instructions when they start.

## The profile

```json
{
  "id": "graphic-design", "name": "Graphic design", "description": "visuals, deliverables, client feedback",
  "steps": [ { "key": "brief", "label": "Brief" }, { "key": "drafts", "label": "Drafts" }, { "key": "delivery", "label": "Delivery" } ],
  "method": "text added to Claude's instructions: its way of working for this job (optional)",
  "types": {
    "timeline": { "layout": "timeline", "fields": [ { "key": "date", "type": "date" }, { "key": "label", "type": "text" }, { "key": "image", "type": "image" } ] }
  },
  "blocks": [
    { "key": "progress", "type": "progress" },
    { "key": "keyPoints", "type": "list", "title": "Key points", "instruction": "3 to 6 lines" },
    { "key": "visuals", "type": "images", "title": "Visuals", "instruction": "the visuals produced, most recent first" },
    { "sideBySide": [ { "key": "a", "type": "list", "title": "A" }, { "key": "b", "type": "list", "title": "B" } ] },
    { "key": "milestones", "type": "timeline", "title": "Milestones" }
  ]
}
```

- `id`: lowercase letters, digits, hyphens; not `dev` or `simple` (built-in profiles). To adapt a built-in profile,
  copy it under another id.
- `key`: the `update_board` field the block reads; unique; never `decisions`, `title`, `step`, `status`… (the
  dashboard handles those for every session).
- `title` is optional; `{n}` in it is replaced by the number of items ("Feedback ({n})").
- `instruction`: what Claude puts in this block; it is what makes the tracker good, be precise.
- `sideBySide`: two or three blocks side by side.
- Human texts (`name`, `description`, `method`, step `label`, block `title` and `instruction`) can be a plain string
  or `{ "fr": "...", "en": "..." }` for a profile shared between French and English users.
- Base types: `progress`, `approach`, `list`, `text`, `checklist`, `images`, `files`, `table`, `code`, `mermaid`,
  `mockups`, `architecture`, `db` (formats returned by `list_trackers`).
- **Composite types** (in `types`): a list of objects with `text`, `date`, `image`, `link`, `file` fields, drawn as
  `cards` (grid, image on top), `timeline` (chronology) or `rows`. For what the base types do not cover; they travel
  with the profile.
- No HTML: the dashboard draws, Claude only sends data.
