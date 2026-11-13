// "/" commands: those of the session (supportedCommands of the SDK) and those the page handles itself
// (/login, /logout, /mcp, /usage, /tracker).
import { api } from '../core/api.js';
import { t } from '../i18n/index.js';
import { serverMode } from '../core/state.js';

// A function, so that the descriptions follow the language chosen after the modules are loaded
// Server mode: no /login or /logout (no terminal to open: `claude auth login` is run inside the container)
const localCommands = () => (serverMode() ? ['mcp', 'usage', 'tracker'] : ['login', 'logout', 'mcp', 'usage', 'tracker'])
  .map(name => ({ name, description: t(`common.commands.${name}`), argumentHint: '', local: true }));
const sessionCommands = new Map(); // slug → list (loaded at the first "/")

export async function commandsOf(slug) {
  if (!sessionCommands.has(slug)) sessionCommands.set(slug, api(`/api/sessions/${slug}/commands`).catch(() => []));
  const list = await sessionCommands.get(slug);
  if (!list.length) sessionCommands.delete(slug); // empty or failed (engine restarting…): we will ask again
  // "__…": internal commands; those the page handles itself (/mcp…) are not doubled
  const local = localCommands();
  return [...local, ...list.filter(c => !c.name.startsWith('__') && !local.some(l => l.name === c.name) && c.name !== 'dashboard:tracker')];
}

/** /login and /logout: login goes through the browser, the dashboard opens it in a terminal. */
export const openAuth = what => api(`/api/auth/${what}`, {});

/** Authenticate to an MCP server: opens Claude Code on /mcp in a terminal, in the `cwd` folder. */
export const openMcpAuth = cwd => api('/api/auth/mcp', { cwd });
