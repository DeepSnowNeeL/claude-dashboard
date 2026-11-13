// common texts (fr).
export default {
  appTitle: 'Tableau de bord Claude',
  appTitleUnread: '({n}) Tableau de bord Claude',
  closeEsc: 'Fermer (Échap)',
  time: {
    justNow: 'à l\'instant',
    minutesAgo: 'il y a {n} min',
    hoursAgo: 'il y a {n} h',
    daysAgo: 'il y a {n} j',
    inMinutes: 'dans {n} min',
    minutes: '{n} min',
    atTime: 'à {time}',
  },
  git: {
    modified: 'modifié',
    added: 'ajouté',
    deleted: 'supprimé',
    untracked: 'nouveau, pas encore suivi',
    renamed: 'renommé',
  },
  commands: {
    login: 'Se connecter à son compte Claude (ouvre un terminal : la connexion passe par le navigateur)',
    logout: 'Se déconnecter de son compte Claude (ouvre un terminal)',
    mcp: 'Serveurs MCP de la session : état, outils, reconnecter, activer / désactiver, s\'authentifier',
    usage: 'Usage : limites de l\'abonnement, consommation de la session, part du tableau de bord',
    tracker: 'Composer ton suivi : ce que montre le panneau Suivi, et ce que Claude y met',
  },
  side: {
    searchPlaceholder: '🔎 retrouver une session…',
    newSession: '+ Nouvelle session',
  },
  handles: {
    left: 'Glisser pour élargir la liste des sessions · double-clic : largeur d\'origine',
    right: 'Glisser pour élargir le panneau · double-clic : largeur d\'origine',
  },
  mobileNav: {
    sessions: 'Sessions',
    conversation: 'Conversation',
    tracker: 'Suivi',
  },
  offline: {
    title: 'Ordinateur injoignable',
    text: 'Il est sans doute éteint ou en veille, ou le tableau de bord n\'y tourne pas.',
    retry: 'Réessayer',
    trying: 'Connexion…',
    still: 'Toujours injoignable ({time}), nouvel essai automatique dans 15 s.',
  },
};
