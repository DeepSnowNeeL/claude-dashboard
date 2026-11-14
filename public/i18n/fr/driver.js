// driver texts (fr).
export default {
  feed: {
    schemaNotRendered: '⚠ schéma « {key} » du panneau non rendu, renvoyé à Claude pour correction',
    runningInBackground: 'Cette conversation tourne déjà dans un autre Claude Code, en arrière-plan ({id}).',
    sessionStopped: 'La session Claude s\'est arrêtée : ton prochain message la relance.',
    compacted: p => `🗜 Contexte compacté${p.auto ? ' automatiquement' : ''}${p.k ? ` (${p.k}k tokens avant)` : ''} : Claude repart d'un résumé de la conversation.`,
    cleared: 'Conversation effacée : Claude repart de zéro, panneau Suivi et en-tête compris',
    planExhausted: p => `Forfait${p.window ? ` ${p.window}` : ''} épuisé : Claude et ses sous-agents sont arrêtés${p.reset ? ` jusqu'à ${p.reset}` : ''}.`,
    planWarning: p => `Forfait${p.window ? ` ${p.window}` : ''}${p.pct != null ? ` utilisé à ${p.pct} %` : ' bientôt atteint'}${p.reset ? `, remis à zéro ${p.reset}` : ''}.`,
    apiError: 'erreur de l\'API',
    doneSubagent: 'le sous-agent « {name} »',
    doneCommand: 'la commande « {name} »',
    doneInBackground: '🔔 terminé en arrière-plan : {names}, Claude reprend',
    messageToSubagent: '✉ message transmis au sous-agent « {name} »',
  },
  errors: {
    unknownSubagent: 'sous-agent inconnu, ou sans identifiant pour lui écrire',
    unknownModel: 'modèle inconnu : {model}',
  },
  planWindow: {
    five_hour: '5 h',
    seven_day: 'de la semaine',
    seven_day_opus: 'Opus de la semaine',
    seven_day_sonnet: 'Sonnet de la semaine',
    overage: 'des crédits supplémentaires',
  },
  plan: {
    at: ' à ', // between the day and the hour of a reset date
  },
  usage: {
    session: 'Session (5 h)',
    week: 'Semaine',
    weekModel: 'Semaine · {model}',
  },
};
