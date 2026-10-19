// Envoie un « réveil » push vide au téléphone. Le téléphone construit lui-même le résumé
// à partir de ses données locales : aucune tâche ne transite par GitHub.
import webpush from 'web-push';

const raw = process.env.PUSH_CONFIG;
if (!raw) {
  console.error('Le secret PUSH_CONFIG est vide. Copie la configuration depuis Réglages > Résumé du matin.');
  process.exit(1);
}

let cfg;
try {
  cfg = JSON.parse(raw);
} catch {
  console.error('PUSH_CONFIG n’est pas un JSON valide. Recopie-le depuis l’application.');
  process.exit(1);
}

webpush.setVapidDetails(cfg.subject, cfg.publicKey, cfg.privateKey);

try {
  const res = await webpush.sendNotification(cfg.subscription, null, { TTL: 6 * 3600, urgency: 'high' });
  console.log(`Réveil envoyé (HTTP ${res.statusCode}).`);
} catch (err) {
  if (err.statusCode === 404 || err.statusCode === 410) {
    console.error('Abonnement expiré : ouvre l’app > Réglages > « Mettre à jour », puis recopie la configuration dans PUSH_CONFIG.');
  } else {
    console.error('Échec de l’envoi :', err.statusCode || '', err.body || err.message);
  }
  process.exit(1);
}
