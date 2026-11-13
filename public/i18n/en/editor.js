// editor texts (en).
export default {
  monacoUnreachable: 'Monaco could not be loaded (network?)',
  remark: {
    placeholder: 'Your remark on this code… (Enter sends, Shift+Enter new line, Esc closes)',
    // Message sent to Claude: file, lines, optional version, code block, remark
    message: p => `Remark on \`${p.file}:${p.lines}\`${p.version ? ` (${p.version})` : ''}:\n${p.block}\n${p.remark}`,
    sent: '✓ sent',
    sentQueued: '✓ sent (queued, goes at the end of the turn)',
  },
  viewer: {
    prevFile: 'Previous file (Alt+←)',
    nextFile: 'Next file (Alt+→)',
    modeTitle: 'Side-by-side or inline diff',
    inline: '⇆ inline',
    sideBySide: '⇆ side by side',
    close: 'Close (Esc)',
    folderTab: 'Folder',
    modifiedTab: 'Modified',
    modifiedTabCount: 'Modified {n}',
    handle: 'Drag to widen · double-click: original width',
    commitFiles: 'Commit files',
    modifiedFiles: 'Modified files',
    binaryBody: 'Binary file: cannot be displayed here.',
    state: {
      binary: 'binary file',
      deletedByCommit: 'deleted by this commit',
      addedByCommit: 'added by this commit',
      modifiedByCommit: 'modified by this commit',
      notGit: 'not in git · read-only',
      deleted: 'deleted since the last commit',
      untracked: 'new file',
      modified: 'modified since the last commit',
      unchanged: 'unchanged · read-only',
    },
    version: {
      beforeCommit: 'version before commit {hash}',
      lastCommit: 'version from the last commit',
      leftByCommit: 'version left by commit {hash}',
      commit: 'commit {hash}',
    },
  },
  mermaid: {
    notRendered: 'Diagram not rendered: {message}',
  },
};
