// editor texts (fr).
export default {
  monacoUnreachable: 'Monaco injoignable (réseau ?)',
  remark: {
    placeholder: 'Ta remarque sur ce code… (Entrée envoie, Maj+Entrée va à la ligne, Échap ferme)',
    // Message envoyé à Claude : fichier, lignes, version éventuelle, bloc de code, remarque
    message: p => `Remarque sur \`${p.file}:${p.lines}\`${p.version ? ` (${p.version})` : ''} :\n${p.block}\n${p.remark}`,
    sent: '✓ envoyé',
    sentQueued: '✓ envoyé (en file, part à la fin du tour)',
  },
  viewer: {
    prevFile: 'Fichier précédent (Alt+←)',
    nextFile: 'Fichier suivant (Alt+→)',
    modeTitle: 'Diff côte à côte ou en ligne',
    inline: '⇆ en ligne',
    sideBySide: '⇆ côte à côte',
    close: 'Fermer (Échap)',
    folderTab: 'Dossier',
    modifiedTab: 'Modifiés',
    modifiedTabCount: 'Modifiés {n}',
    handle: "Glisser pour élargir · double-clic : largeur d'origine",
    commitFiles: 'Fichiers du commit',
    modifiedFiles: 'Fichiers modifiés',
    binaryBody: "Fichier binaire : pas d'affichage possible ici.",
    state: {
      binary: 'fichier binaire',
      deletedByCommit: 'supprimé par ce commit',
      addedByCommit: 'ajouté par ce commit',
      modifiedByCommit: 'modifié par ce commit',
      notGit: 'hors git · lecture seule',
      deleted: 'supprimé depuis le dernier commit',
      untracked: 'nouveau fichier',
      modified: 'modifié depuis le dernier commit',
      unchanged: 'inchangé · lecture seule',
    },
    version: {
      beforeCommit: "version d'avant le commit {hash}",
      lastCommit: 'version du dernier commit',
      leftByCommit: 'version laissée par le commit {hash}',
      commit: 'commit {hash}',
    },
  },
  mermaid: {
    notRendered: 'Schéma non rendu : {message}',
  },
};
