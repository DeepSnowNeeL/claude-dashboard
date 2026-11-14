// A dashboard session: detail, feed, and what the page asks of it (message, interruption, mode, end,
// archiving, renaming, queue, answer to a card). The HTTP calls are the usual ones.
import { api } from '../core/api.js';

export const readSession = slug => api(`/api/sessions/${slug}`);
export const readFeed = slug => api(`/api/sessions/${slug}/feed`);
export const readAgentFeed = (slug, key) => api(`/api/sessions/${slug}/agents/${key}/feed`);

/** Message to the session; `body` = { text, when, attachments }. */
export const send = (slug, body) => api(`/api/sessions/${slug}/message`, body);
export const interrupt = slug => api(`/api/sessions/${slug}/interrupt`, {});
export const setMode = (slug, mode) => api(`/api/sessions/${slug}/mode`, { mode });
/** Models offered for the session ({ models: [{ value, displayName, description, resolvedModel }], current }). */
export const readModels = slug => api(`/api/sessions/${slug}/models`);
export const setModel = (slug, model) => api(`/api/sessions/${slug}/model`, { model });
export const end = slug => api(`/api/sessions/${slug}/end`, {});
export const archive = slug => api(`/api/sessions/${slug}/archive`, {});
export const rename = (slug, title) => api(`/api/sessions/${slug}/rename`, { title });
/** Mermaid schema of the panel that failed to render: the engine sends it back to Claude (once per version of the schema). */
export const reportSchema = (slug, key, source, error) => api(`/api/sessions/${slug}/schema-error`, { key, source, error });

/** Queued messages: `when` = 'now' or 'stop'. */
export const pushQueue = (slug, when) => api(`/api/sessions/${slug}/push-queue`, { when });
/** Removes the queued messages and returns them ({ messages }) to edit them again. */
export const recallQueue = slug => api(`/api/sessions/${slug}/recall-queue`, {});

/** Answer to a pending card (question, permission). */
export const answer = (slug, id, reply) => api(`/api/sessions/${slug}/answer`, { id, answer: reply });

/** Releases the session from the other Claude Code that held it (`id` = ev.backgroundId). */
export const release = (slug, id) => api(`/api/sessions/${slug}/release`, { id });
/** Message for a subagent: the main session forwards it (SendMessage). */
export const sendToAgent = (slug, key, text) => api(`/api/sessions/${slug}/message-agent`, { key, text });
export const stopAgent = (slug, key) => api(`/api/sessions/${slug}/agents/${key}/stop`, {});
export const stopShell = (slug, key) => api(`/api/sessions/${slug}/shells/${key}/stop`, {});
export const readShellOutput = (slug, key) => api(`/api/sessions/${slug}/shells/${key}/output`);
/** The session is in front of the developer: its new items are read. */
export const markSeen = slug => api(`/api/sessions/${slug}/seen`, {});
/** Active time (ms) of the tab in the foreground. */
export const sendActive = (slug, ms) => api(`/api/sessions/${slug}/active`, { ms });
/** Same thing when the page closes (sendBeacon, without waiting for an answer). */
export const sendActiveFinal = (slug, ms) => navigator.sendBeacon(`/api/sessions/${slug}/active`, new Blob([JSON.stringify({ ms })], { type: 'application/json' }));
/** Archives the session (the server also stops its Claude session). No exception on an HTTP error. */
export const removeSession = slug => fetch(`/api/sessions/${slug}`, { method: 'DELETE' });

/** MCP servers of the session; `action` = reconnect | toggle, returns the updated list. */
export const readMcp = slug => api(`/api/sessions/${slug}/mcp`);
export const mcpAction = (slug, action, name, active) => api(`/api/sessions/${slug}/mcp/${action}`, { name, active });

/** Creates an empty session in a folder; returns { slug }. */
export const create = (cwd, mode, branch) => api('/api/sessions', { cwd, mode, ...(branch ? { branch } : {}) });
/** Resumes a conversation from the history of the folder; `h` = { sessionId, cwd, title, firstPrompt }. */
export const resume = h => api('/api/sessions/resume', { sessionId: h.sessionId, cwd: h.cwd, title: h.title, firstPrompt: h.firstPrompt });
