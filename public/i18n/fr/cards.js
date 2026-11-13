// cards texts (fr).
export default {
  clarificationPlaceholder: 'Ajouter une précision (facultatif)…',
  // Envoyé à Claude dans la ligne de réponse, devant la précision
  clarificationPrefix: 'Précision : ',
  agent: {
    states: { working: 'en cours', completed: 'terminé', failed: 'en échec', stopped: 'arrêté' },
    tools: { one: '{n} outil', other: '{n} outils' },
    background: '(arrière-plan)',
    seeConversation: 'Voir sa conversation →',
    resumeTitle: 'Demande à la session de reprendre cet agent là où il s\'est arrêté (SendMessage, contexte gardé)',
    resume: '↻ Reprendre cet agent',
    relaunched: 'relancé depuis (voir l\'onglet le plus récent)',
    resumePrompt: 'Reprends le sous-agent « {description} » (agentId {agentId}) avec SendMessage, là où il s\'est arrêté : il a été interrompu. Ne relance pas un nouvel agent.',
  },
  decisions: {
    recommended: 'recommandé',
    other: 'Autre…',
    explain: 'Explique-moi',
    // Phrase envoyée à Claude, reconnue par les consignes et les hauts faits : ne pas la changer
    explainAnswer: 'explique-moi plus en détail',
    yourAnswer: 'Ta réponse…',
  },
  permission: {
    cancelled: 'annulée :',
    allowed: '✓ autorisé :',
    denied: '✗ refusé :',
    question: 'Autoriser {tool} ?',
    clarification: 'Précision pour Claude (facultatif, utile surtout en cas de refus)…',
    allow: 'Autoriser',
    deny: 'Refuser',
  },
  question: {
    cancelled: 'Question annulée',
    title: 'Question',
    multiSelect: '(plusieurs choix possibles)',
    hint: 'Un clic choisit sans envoyer.',
    reply: 'Répondre',
    empty: 'Choisis une option ou écris une précision.',
  },
  sessionMessage: {
    unknown: 'inconnue',
    from: 'Message de la session {from}',
    queued: '· en file, part à la fin du tour',
    showAll: 'voir tout',
    collapse: 'replier',
  },
};
