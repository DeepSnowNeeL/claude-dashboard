// explorer texts (fr).
export default {
  empty: 'vide',
  ignoredByGit: 'ignoré par git',
  searchSummary: p => `${p.n}${p.more} ligne${p.n > 1 ? 's' : ''} dans ${p.files} fichier${p.files > 1 ? 's' : ''}`,
  noResults: 'Aucun résultat.',
  emptyFolder: 'Dossier vide.',
  searchPlaceholder: '🔎 Rechercher dans les fichiers…',
  matchCase: 'Respecter la casse',
  regex: 'Expression régulière',
  findFile: 'Trouver un fichier (Ctrl+P)',
  collapseAll: 'Tout replier',
  palette: {
    placeholder: 'Nom de fichier… (↑ ↓, Entrée ouvre, Échap ferme)',
    none: 'Aucun fichier.',
  },
};
