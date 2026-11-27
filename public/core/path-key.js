// Comparison key of a path, shared by the page and the servers (projects.mjs): pure, imports nothing.

/**
 * Unified separators, no trailing slash; a Windows path (drive letter or UNC share such as
 * `\\wsl.localhost\Ubuntu\home\…`) is case-insensitive, so it is lowercased. A POSIX path keeps its case.
 */
export const pathKey = p => {
  const n = String(p || '').replace(/\\/g, '/').replace(/\/+$/, '');
  return /^([a-z]:|\/\/)/i.test(n) ? n.toLowerCase() : n;
};
