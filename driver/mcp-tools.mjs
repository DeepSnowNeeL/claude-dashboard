// Internal MCP server of a session: Tracker panel, other dashboard sessions, tracker profile.
import fs from 'node:fs';
import path from 'node:path';
import { createSdkMcpServer, tool } from '@anthropic-ai/claude-agent-sdk';
import { z } from 'zod';
import * as trackers from '../trackers.mjs';
import { createWorktree } from '../projects.mjs';
import { boardFields } from '../engine/board-fields.mjs';
import { t } from '../public/i18n/index.js';

export const BOARD_TOOL = 'mcp__dashboard__update_board';
/**
 * Dashboard tools allowed without asking (allowedTools of the query): the panel and read-only ones. The others act on
 * other sessions or write files (launch, message, end, set_tracker): in "ask" mode they go through a permission card
 * like any tool, so a session cannot get around its mode through another session.
 */
export const DASHBOARD_TOOLS = [BOARD_TOOL, 'mcp__dashboard__list_sessions', 'mcp__dashboard__list_trackers'];

/** "dashboard" MCP server of the session: returns `{ dashboard }`, passed to the query (mcpServers). */
export function attachMcpTools(ctx) {
  const { s, slug, cwd, updateBoard, pushEvent, newId } = ctx;
  const { launch, list, write, end } = ctx.callbacks;

  const dashboard = createSdkMcpServer({
    name: 'dashboard',
    version: '1.0.0',
    tools: [tool('update_board',
      'Updates the Tracker panel of the dashboard (merges the given fields; null clears). See the session instructions for the fields (they depend on the tracker profile).',
      { state: z.record(z.string(), z.any()).describe('Board fields to merge') },
      async ({ state }) => {
        // The engine's own keys (folder, mode, conversation, counters…) are not the session's to change
        const { fields, ignored } = boardFields(state);
        updateBoard(fields);
        if (Array.isArray(fields.decisions) && fields.decisions.length) pushEvent({ id: newId(), t: 'decisions', decisions: fields.decisions });
        return { content: [{ type: 'text', text: ignored.length ? `board updated; ignored (managed by the dashboard, or not an http(s) URL): ${ignored.join(', ')}` : 'board updated' }] };
      }, { alwaysLoad: true }), // loaded up front: no ToolSearch before the first call

    // Other dashboard sessions (like the Orca skills, but in the same worktree by default)
    tool('launch_session',
      'Launches a new Claude Code session in the dashboard, with a first message. By default in the same folder as this '
      + 'session. When the work concerns another project (another repository): pass `folder`, so that the session loads '
      + 'its CLAUDE.md, memories and settings. Only if the developer asks for another worktree or another branch: pass '
      + '`worktree` (creates a git worktree next to the repository, then a session in it). Do not wait for its answer: '
      + 'it lives its own life, the developer follows it in the dashboard.',
      {
        prompt: z.string().describe('First message of the new session: the subject, useful context, what is expected'),
        folder: z.string().optional().describe('Absolute path of the project where to launch the session (e.g. D:\\other-repo); default: the folder of this session'),
        worktree: z.object({
          branch: z.string().describe('Name of the branch to create (e.g. 2691-export-csv)'),
          base: z.string().optional().describe('Starting branch or commit; default: HEAD of the main worktree'),
        }).optional().describe('Only if another worktree is requested'),
        mode: z.enum(['all', 'ask']).optional().describe('Tool permissions; default: the mode of this session'),
      },
      async ({ prompt, folder: requested, worktree, mode: m }) => {
        let folder = cwd;
        if (requested) {
          folder = path.resolve(cwd, requested);
          if (!fs.statSync(folder, { throwIfNoEntry: false })?.isDirectory())
            return { content: [{ type: 'text', text: `Folder not found: ${folder}` }], isError: true };
        }
        if (worktree) {
          try { folder = await createWorktree(folder, worktree.branch, worktree.base); ctx.achievements.add('arborist'); }
          catch (e) { return { content: [{ type: 'text', text: `Worktree not created: ${e.message}` }], isError: true }; }
        }
        // A session in "ask" mode never launches one that asks nothing: its tools would escape the developer's approval
        const created = await launch({ cwd: folder, text: prompt, mode: s.mode === 'ask' ? 'ask' : m || s.mode });
        return { content: [{ type: 'text', text: `Session ${created} launched in ${folder}.` }] };
      }, { alwaysLoad: true }),
    tool('list_sessions',
      'Lists the dashboard sessions, to follow one or write to it: slug, displayed title, ticket, description, step, '
      + 'status, busy or not, folder, project, worktree branch and project group.',
      {},
      async () => ({ content: [{ type: 'text', text: JSON.stringify((await list()).filter(x => x.slug !== slug), null, 2) }] })),
    tool('message_session',
      'Sends a message to another dashboard session (delivered at the end of its turn if it is working).',
      { slug: z.string(), text: z.string() },
      async ({ slug: target, text }) => {
        const r = await write(target, text);
        return { content: [{ type: 'text', text: r || `Message sent to ${target}.` }], isError: !!r };
      }),
    tool('end_session',
      'Ends another dashboard session that is no longer needed (a worker session that has delivered, for example): '
      + 'its Claude process stops and it moves to "ended", still viewable; a message from the developer resumes it. '
      + 'A running turn is interrupted: only use it on a session that has finished its work.',
      { slug: z.string().describe('Slug of the session (see list_sessions)') },
      async ({ slug: target }) => {
        const r = await end(target);
        return { content: [{ type: 'text', text: r || `Session ${target} ended.` }], isError: !!r };
      }),

    // Tracker profile (skill /tracker): what the Tracker panel shows and what Claude puts in it
    tool('list_trackers',
      'Tracker profile of this session (and the file it comes from), the three possible files for this folder, the '
      + 'profiles built into the application and the block types.',
      {},
      async () => {
        const current = trackers.profileOf(cwd);
        return { content: [{ type: 'text', text: JSON.stringify({
          session: { id: current.profile.id, name: current.profile.name, source: current.source, file: current.file, preview: !!s.trackerPreview, profile: current.profile },
          files: trackers.filesOf(cwd),
          builtIn: trackers.builtInProfiles(),
          types: trackers.BLOCK_TYPES,
        }, null, 2) }] };
      }),
    tool('set_tracker',
      'Sets a tracker profile. Scopes: `preview` (this session only, nothing written; profile null removes it); '
      + '`install-repo` (for this repository, for this user only: ~/.claude-dashboard/trackers/repos/<repo>.json, '
      + 'takes precedence over everything); `repo` (in the repository, .claude/tracker.json, versioned, shared with the '
      + 'team); `default` (installation default: ~/.claude-dashboard/tracker.json). `profile`: a complete profile, the id '
      + 'of a built-in profile (the file points to it and follows its updates), or null to delete the file of this scope.',
      {
        profile: z.any().describe('{ id, name, description, steps: [{ key, label }], method, types?, blocks: [{ key, type, title?, instruction? } | { sideBySide: [..] }] }, or the id of a built-in profile, or null'),
        scope: z.enum(['preview', 'install-repo', 'repo', 'default']),
      },
      async ({ profile, scope }) => {
        try {
          // The profile sometimes arrives as JSON text ("null" included) rather than an object; a bare id stays an id
          if (typeof profile === 'string' && /^\s*[[{n]/.test(profile)) { try { profile = JSON.parse(profile); } catch { throw new Error('profile: unreadable JSON'); } }
          if (scope === 'preview') {
            if (typeof profile === 'string') profile = trackers.builtInProfiles().find(p => p.id === profile) || profile;
            if (profile) { const e = trackers.profileError(profile); if (e) throw new Error(e); }
            s.trackerPreview = profile || null;
            updateBoard({ trackerPreview: profile || null });
            return { content: [{ type: 'text', text: profile ? 'Preview shown in the Tracker panel of this session.' : 'Preview removed.' }] };
          }
          const file = trackers.writeTracker(cwd, scope, profile ?? null);
          s.trackerPreview = null;
          updateBoard({ trackerPreview: null });
          return { content: [{ type: 'text', text: profile == null ? `File deleted: ${file} (the next level applies).`
            : `Written: ${file}. The panel already shows it; the instructions of sessions will follow at their next start.` }] };
        } catch (e) {
          return { content: [{ type: 'text', text: `Profile rejected: ${e.message}` }], isError: true };
        }
      }),
    ],
  });
  /** Mermaid diagram of the panel that the page could not draw: Claude fixes it without waiting for the developer. */
  s.reportSchema = (key, error) => {
    if (s.closed) return false;
    pushEvent({ id: newId(), t: 'auto', text: t('driver.feed.schemaNotRendered', { key }) });
    ctx.dispatch(`[Dashboard] The Mermaid diagram of the field "${key}" (update_board) does not render in the panel: `
      + `${String(error).slice(0, 600)}
Fix the syntax and send the whole field "${key}" again with update_board, `
      + `then resume where you were (no need to mention it to the developer).`);
    return true;
  };
  return { dashboard };
}
