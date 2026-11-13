// access texts (fr).
export default {
  errors: {
    invalidRelayDomain: 'domaine invalide : {domain}',
    empty: '(vide)',
    invalidRelayTarget: "{domain} : la cible doit être l'IP locale de l'autre PC (ex. 10.0.0.20)",
    invalidRelayIp: 'IP locale du PC relais attendue (ex. 10.0.0.10)',
    passwordTooShort: '12 caractères minimum',
    invalidDomain: 'nom de domaine invalide',
    notConfigured: 'accès distant non configuré',
    wrongPassword: 'mot de passe incorrect',
    wrongCurrentPassword: 'le mot de passe actuel est incorrect',
    tooManyAttempts: "trop d'essais, réessaie dans {minutes} min",
    loginRequired: 'connexion requise',
  },
  // Nom d'appareil quand le navigateur n'est pas reconnu (« Navigateur · Windows »)
  browser: 'Navigateur',
  // Page de connexion (login.html)
  login: {
    appName: 'Tableau de bord Claude',
    intro: 'Accès à distance : mot de passe maître.',
    password: 'Mot de passe',
    submit: 'Se connecter',
    pendingTitle: "En attente d'approbation",
    pendingBefore: 'Autorise cet appareil (',
    pendingAfter: ") depuis le PC : notification de l'application, ou 🔒 Accès distant dans le tableau de bord.",
    pendingServer: "Autorise cet appareil depuis un appareil déjà autorisé (⚙ Options → 🔒 Accès distant), ou sur le serveur, dans le conteneur :",
    cancel: 'Annuler',
    thisDevice: 'cet appareil',
    unreachable: 'serveur injoignable',
  },
};
