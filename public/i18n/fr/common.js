// common texts (fr).
export default {
  appTitle: 'Tableau de bord Claude',
  appTitleUnread: '({n}) Tableau de bord Claude',
  closeEsc: 'Fermer (Échap)',
  updateBanner: {
    engine: 'Le moteur tourne avec une ancienne version du code (mise à jour récupérée).',
    page: 'La page tourne avec une ancienne version du code (mise à jour récupérée).',
    both: 'Le moteur et la page tournent avec une ancienne version du code (mise à jour récupérée).',
    restart: 'Redémarrer',
    waiting: 'Redémarrage dès que ces sessions sont au repos : {list}',
    restarting: 'Redémarrage…',
  },
  upstream: {
    news: { one: '1 nouveauté sur GitHub', other: '{n} nouveautés sur GitHub' },
    newsFork: { one: '1 nouveauté à intégrer à ton fork', other: '{n} nouveautés à intégrer à ton fork' },
    update: 'Mettre à jour',
    integrate: 'Intégrer',
    dismiss: "Ignorer jusqu'aux prochaines",
    whatsNew: 'Nouveautés (CHANGELOG)',
    noChangelog: 'Aucune ligne de CHANGELOG : voir les commits sur GitHub.',
    explain: "Une session Claude s'ouvre dans ce dossier : elle récupère GitHub, fusionne avec tes modifications, règle les conflits, puis redémarre le moteur dès que les sessions sont au repos. Elle ne pousse rien.",
    launch: '▶ Lancer la session',
    cancel: 'Annuler',
    prompt: p => `Mets à jour Claude Dashboard (ce dossier, ${p.root}) avec les nouveautés de son dépôt public ${p.url} (branche ${p.branch}) : ${p.behind} commit(s) pas encore ici.${p.fork ? ' Ce dépôt a ses propres modifications (un fork ou des commits locaux) : il faut les garder.' : ''}

1. \`git status\` : s'il y a des modifications non commitées, dis-le-moi et demande s'il faut les commiter ou les mettre de côté (stash) d'abord.
2. \`git fetch ${p.url} ${p.branch}:refs/dash/upstream\` (le tableau de bord l'a déjà fait, refais-le pour être à jour), puis montre-moi en quelques lignes ce qui change pour moi (les nouvelles lignes de CHANGELOG.md).
3. Fusionne \`refs/dash/upstream\` dans la branche courante avec \`git merge\` (jamais de rebase ni de reset : mes propres commits restent tels quels). En cas de conflit, garde à la fois mes modifications et les nouveautés ; ne me demande que quand c'est un vrai choix entre les deux.
4. \`npm install\` si package.json ou package-lock.json a changé, puis \`npm test\`.
5. Redémarre : \`node dash.mjs restart\` pour la page, puis \`node dash.mjs restart-engine --deferred\` pour le moteur (jamais --force : cette session tourne dedans, elle revient en pause).
6. Ne pousse rien sans que je le demande.`,
  },
  context: {
    title: 'Contexte : {context} sur une fenêtre de {window} ({pct} %)',
    now: p => (p.window ? `${p.context} / ${p.window} · ${p.pct} %` : p.context),
    max: p => (p.window ? `${p.context} max · ${p.pct} %` : `${p.context} max`),
  },
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
  updating: {
    title: 'Mise à jour en cours',
    text: 'Le tableau de bord redémarre, il revient dans un instant.',
    long: "C'est plus long que prévu, la page se rechargera dès qu'il répond.",
  },
  modes: {
    all: '⚡ tout autoriser',
    allTitle: "Aucune question : chaque outil s'exécute (comme claude --dangerously-skip-permissions)",
    auto: '🤖 auto',
    autoTitle: 'Un classifieur valide chaque outil et demande quand il hésite',
    edits: '✏️ accepter les modifications',
    editsTitle: 'Les modifications de fichiers passent sans demander, le reste demande',
    ask: '✋ demander avant chaque outil',
    askTitle: 'Une carte de permission avant chaque outil sensible',
    plan: '📋 plan',
    planTitle: 'Lecture seule : Claude explore et propose un plan à valider avant de modifier quoi que ce soit',
    unavailable: '(indisponible pour ce modèle)',
  },
};
