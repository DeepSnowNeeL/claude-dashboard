// explorer texts (en).
export default {
  empty: 'empty',
  ignoredByGit: 'ignored by git',
  searchSummary: p => `${p.n}${p.more} line${p.n === 1 ? '' : 's'} in ${p.files} file${p.files === 1 ? '' : 's'}`,
  noResults: 'No results.',
  emptyFolder: 'Empty folder.',
  searchPlaceholder: '🔎 Search in files…',
  matchCase: 'Match case',
  regex: 'Regular expression',
  findFile: 'Find a file (Ctrl+P)',
  collapseAll: 'Collapse all',
  palette: {
    placeholder: 'File name… (↑ ↓, Enter opens, Esc closes)',
    none: 'No files.',
  },
};
