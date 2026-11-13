// side texts (fr).
export default {
  tabs: {
    tracker: 'Suivi',
    files: 'Fichiers modifiés',
    explorer: 'Explorateur',
    explorerTitle: 'Tous les fichiers du dossier (Ctrl+P pour en trouver un)',
  },
  files: {
    layoutTitle: 'Affichage des fichiers',
    list: '☰ Liste',
    tree: '🌳 Arbre',
    revertFailed: 'Annulation impossible : {message}',
    notGit: "Ce dossier n'est pas un dépôt git.",
    summary: { one: '{n} fichier modifié depuis le dernier commit', other: '{n} fichiers modifiés depuis le dernier commit' },
    nothing: 'Rien de modifié depuis le dernier commit.',
    clickAgainDelete: 'Cliquer encore pour supprimer',
    clickAgainRevert: 'Cliquer encore pour revenir au dernier commit',
  },
  gitFiles: {
    binary: 'binaire',
    deleteTitle: 'Supprimer ce fichier, cliquer deux fois',
    revertTitle: 'Annuler les modifications (revenir au dernier commit), cliquer deux fois',
  },
  commits: {
    title: 'Commits',
    currentBranch: 'branche courante',
    currentBranchCount: 'branche courante, {n}',
    unpushed: 'pas encore poussé',
    none: 'Aucun commit.',
  },
};
