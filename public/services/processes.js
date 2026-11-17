// Processes tab: what runs on the PC for development (engine/processes.mjs), and stopping one with its tree.
import { api } from '../core/api.js';

/** On the PC only (the page server refuses the route from the wifi and the internet). */
export const onPc = () => !!window.desktop || ['localhost', '127.0.0.1', '[::1]'].includes(location.hostname);

/** { items, total, projects: { slug: project } } */
export const readProcesses = () => api('/api/processes');

/** Stops a listed process and its children; `created` makes sure it is still the same one. */
export const killProcess = (pid, created) => api('/api/processes/kill', { pid, created });
