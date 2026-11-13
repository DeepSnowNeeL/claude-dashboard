// side texts (en).
export default {
  tabs: {
    tracker: 'Tracker',
    files: 'Modified files',
    explorer: 'Explorer',
    explorerTitle: 'All the files of the folder (Ctrl+P to find one)',
  },
  files: {
    layoutTitle: 'File display',
    list: '☰ List',
    tree: '🌳 Tree',
    revertFailed: 'Could not revert: {message}',
    notGit: 'This folder is not a git repository.',
    summary: { one: '{n} file modified since the last commit', other: '{n} files modified since the last commit' },
    nothing: 'Nothing modified since the last commit.',
    clickAgainDelete: 'Click again to delete',
    clickAgainRevert: 'Click again to go back to the last commit',
  },
  gitFiles: {
    binary: 'binary',
    deleteTitle: 'Delete this file, click twice',
    revertTitle: 'Discard the changes (back to the last commit), click twice',
  },
  commits: {
    title: 'Commits',
    currentBranch: 'current branch',
    currentBranchCount: 'current branch, {n}',
    unpushed: 'not pushed yet',
    none: 'No commits.',
  },
};
