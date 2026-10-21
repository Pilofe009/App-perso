// Résumé du matin, construit en ligne : lit les données synchronisées dans Firebase
// (tâches, abonnements, budget, y compris ce qui a été ajouté depuis le PC), construit le
// résumé avec les mêmes règles que l'app (shared.js) et l'envoie à chaque appareil enregistré.
import fs from 'node:fs';
import vm from 'node:vm';
import webpush from 'web-push';
import { initializeApp, cert } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';

const sa = process.env.FIREBASE_SERVICE_ACCOUNT;
if (!sa) {
  console.error('Le secret FIREBASE_SERVICE_ACCOUNT est vide : suis la section « Résumé du matin » du README.');
  process.exit(1);
}

// shared.js est un script de navigateur : on le charge tel quel dans un contexte isolé.
const ctx = {};
vm.createContext(ctx);
vm.runInContext(fs.readFileSync(new URL('../shared.js', import.meta.url), 'utf8'), ctx);
const E = ctx.E;

initializeApp({ credential: cert(JSON.parse(sa)) });
const db = getFirestore();
const today = new Intl.DateTimeFormat('en-CA', { timeZone: process.env.TZ_NAME || 'Europe/Paris' }).format(new Date());

let sent = 0;
let failed = 0;
let devices = 0;
for (const userRef of await db.collection('users').listDocuments()) {
  const [itemsSnap, devSnap] = await Promise.all([userRef.collection('items').get(), userRef.collection('devices').get()]);
  if (devSnap.empty) continue;
  const items = {};
  itemsSnap.forEach((d) => { items[d.id] = { kind: d.get('kind'), json: d.get('json'), order: d.get('order') || 0 }; });
  const { title, body } = E.buildSummary(E.fromItems(items), today);
  const payload = JSON.stringify({ title, body });

  for (const dev of devSnap.docs) {
    devices++;
    const d = dev.data();
    try {
      const res = await webpush.sendNotification(d.subscription, payload, {
        TTL: 6 * 3600,
        urgency: 'high',
        vapidDetails: { subject: d.subject, publicKey: d.publicKey, privateKey: d.privateKey },
      });
      sent++;
      console.log(`✓ ${d.label || dev.id} (HTTP ${res.statusCode})`);
    } catch (err) {
      if (err.statusCode === 404 || err.statusCode === 410) {
        await dev.ref.delete();
        console.log(`Appareil « ${d.label || dev.id} » expiré : retiré. Réactive le résumé dans l'app (Réglages).`);
      } else {
        failed++;
        console.error(`✗ ${d.label || dev.id} :`, err.statusCode || '', err.body || err.message);
      }
    }
  }
}

console.log(`Résumé du ${today} : ${sent} notification(s) envoyée(s) sur ${devices} appareil(s).`);
if (!devices) {
  console.error('Aucun appareil enregistré : dans l’app, Réglages → Résumé du matin → « Activer sur cet appareil ».');
  process.exit(1);
}
if (failed) process.exit(1);
