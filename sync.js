/* Synchronisation en ligne (Firebase) : téléphone ⇄ PC.
   Chaque tâche, abonnement, opération ou catégorie est un document Firestore
   (users/{uid}/items/{type_id}). Seuls les éléments modifiés sont réécrits, ce qui
   permet de travailler sur deux appareils sans s'écraser. Firestore garde une copie
   locale : l'app marche hors ligne et envoie les changements au retour du réseau. */
import { firebaseConfig } from './firebase-config.js';

const FB = 'https://www.gstatic.com/firebasejs/10.12.2';
const LISTS = { tasks: 'task', subs: 'sub', transactions: 'tx', categories: 'cat', budgetCats: 'bcat' };
const ORDERED = new Set(['categories', 'budgetCats']); // listes dont l'ordre d'affichage compte
const META_KEY = 'meta_main';

/* ---------- Logique pure (testable sans Firebase) ---------- */
export function toItems(state) {
  const items = {};
  for (const [list, kind] of Object.entries(LISTS)) {
    (state[list] || []).forEach((it, i) => {
      if (!it || it.id == null) return;
      items[`${kind}_${it.id}`] = { kind, json: JSON.stringify(it), order: ORDERED.has(list) ? i : 0 };
    });
  }
  items[META_KEY] = {
    kind: 'meta', order: 0,
    json: JSON.stringify({ settings: state.settings || {}, budgetOverrides: state.budgetOverrides || {} }),
  };
  return items;
}

export function fromItems(items) {
  const out = { tasks: [], subs: [], transactions: [], categories: [], budgetCats: [] };
  const listOf = Object.fromEntries(Object.entries(LISTS).map(([l, k]) => [k, l]));
  let hasMeta = false;
  Object.values(items).sort((a, b) => a.order - b.order).forEach((it) => {
    if (it.kind === 'meta') { Object.assign(out, JSON.parse(it.json)); hasMeta = true; return; }
    if (listOf[it.kind]) out[listOf[it.kind]].push(JSON.parse(it.json));
  });
  // Rien en ligne encore : on laisse l'app remettre les catégories par défaut.
  if (!hasMeta) { delete out.categories; delete out.budgetCats; }
  return out;
}

const sig = (it) => `${it.order}|${it.json}`;

export function diff(base, items) {
  const set = Object.keys(items).filter((k) => !base[k] || sig(base[k]) !== sig(items[k]));
  const del = Object.keys(base).filter((k) => !items[k]);
  return { set, del };
}

// Premier branchement d'un appareil : la version en ligne gagne, et les tâches, abonnements
// et opérations qui n'existent que sur cet appareil sont ajoutés (rien n'est supprimé).
// Si le compte est déjà utilisé, ses catégories font foi : on n'y rajoute pas les catégories
// par défaut d'un nouvel appareil (sinon une catégorie supprimée reviendrait).
export function mergeFirstLink(local, remote) {
  const inUse = !!remote[META_KEY];
  const merged = {};
  Object.entries(local).forEach(([k, it]) => {
    if (!(inUse && (it.kind === 'cat' || it.kind === 'bcat'))) merged[k] = it;
  });
  return Object.assign(merged, remote);
}

/* ---------- Branchement Firebase ---------- */
const hasWindow = typeof window !== 'undefined';
const Sync = {
  configured: !!firebaseConfig,
  status: firebaseConfig ? 'loading' : 'off', // off | loading | signed-out | syncing | pending | offline | synced | error
  error: null,
  user: null,
};

let fb = null, auth = null, db = null, unsub = null;
let base = null;          // dernier état connu en ligne (pour n'envoyer que les différences)
let linking = false;      // premier branchement de cet appareil à ce compte
let getState = null, onRemote = null, onStatus = () => {};

function setStatus(status, error) {
  Sync.status = status;
  Sync.error = error || null;
  onStatus();
}

const saveBase = () => E.kvSet('syncBase', base);
const itemsCol = () => fb.collection(db, 'users', Sync.user.uid, 'items');

function writeDiff(items) {
  const { set, del } = diff(base || {}, items);
  base = items;
  saveBase();
  const ops = set.map((k) => ['set', k]).concat(del.map((k) => ['del', k]));
  for (let i = 0; i < ops.length; i += 450) { // un lot Firestore = 500 opérations max
    const batch = fb.writeBatch(db);
    ops.slice(i, i + 450).forEach(([op, k]) => {
      const ref = fb.doc(itemsCol(), k);
      if (op === 'del') batch.delete(ref);
      else batch.set(ref, { ...items[k], updatedAt: fb.serverTimestamp() });
    });
    batch.commit().catch((e) => setStatus('error', e.message));
  }
}

function docsToItems(snap) {
  const items = {};
  snap.docs.forEach((d) => { items[d.id] = { kind: d.get('kind'), json: d.get('json'), order: d.get('order') || 0 }; });
  return items;
}

function onSnap(snap, uid) {
  const meta = snap.metadata;
  if (linking) {
    if (meta.fromCache) return; // attendre la vraie version du serveur avant de fusionner
    const remote = docsToItems(snap);
    const merged = mergeFirstLink(toItems(getState()), remote);
    base = remote;
    linking = false;
    E.kvSet('syncUid', uid);
    writeDiff(merged);
    onRemote(fromItems(merged), true);
  } else if (snap.docChanges().length) {
    base = docsToItems(snap);
    saveBase();
    onRemote(fromItems(base), false);
  }
  setStatus(meta.hasPendingWrites ? 'pending' : meta.fromCache ? 'offline' : 'synced');
}

async function maybeStart() {
  if (!Sync.user || !getState || unsub) return;
  const uid = Sync.user.uid;
  linking = (await E.kvGet('syncUid')) !== uid;
  base = linking ? null : (await E.kvGet('syncBase')) || {};
  if (!linking) writeDiff(toItems(getState())); // envoie ce qui a été modifié hors ligne
  setStatus('syncing');
  unsub = fb.onSnapshot(itemsCol(), { includeMetadataChanges: true },
    (snap) => onSnap(snap, uid),
    (err) => setStatus('error', err.message));
}

function onUser(user) {
  if (unsub) { unsub(); unsub = null; }
  Sync.user = user ? { uid: user.uid, email: user.email, name: user.displayName } : null;
  if (!user) { setStatus('signed-out'); return; }
  maybeStart();
}

const AUTH_ERRORS = {
  'auth/popup-blocked': 'La fenêtre de connexion a été bloquée. Réessaie, ou ouvre l’app dans Chrome (pas l’icône installée) pour te connecter une fois.',
  'auth/popup-closed-by-user': 'Connexion annulée.',
  'auth/cancelled-popup-request': 'Connexion annulée.',
  'auth/unauthorized-domain': 'Ce site n’est pas autorisé dans Firebase : ajoute pilofe009.github.io dans Authentication → Settings → Authorized domains.',
  'auth/network-request-failed': 'Pas de connexion internet.',
};

Sync.signIn = async () => {
  try {
    await fb.signInWithPopup(auth, new fb.GoogleAuthProvider());
  } catch (e) {
    setStatus(Sync.user ? Sync.status : 'signed-out', AUTH_ERRORS[e.code] || e.message);
  }
};

Sync.signOut = async () => {
  if (unsub) { unsub(); unsub = null; }
  base = null;
  await E.kvSet('syncUid', null);
  await E.kvSet('syncBase', null);
  await fb.signOut(auth);
};

// Appelé par l'app à chaque enregistrement.
Sync.push = (state) => {
  if (!Sync.user || !db || linking || !base) return;
  writeDiff(toItems(state));
};

// L'app se branche une fois ses données locales chargées.
Sync.attach = (opts) => {
  getState = opts.getState;
  onRemote = opts.onRemote;
  onStatus = opts.onStatus || onStatus;
  onStatus();
  maybeStart();
};

async function init() {
  try {
    const [appM, authM, fsM] = await Promise.all([
      import(`${FB}/firebase-app.js`), import(`${FB}/firebase-auth.js`), import(`${FB}/firebase-firestore.js`),
    ]);
    fb = { ...authM, ...fsM };
    const app = appM.initializeApp(firebaseConfig);
    auth = authM.getAuth(app);
    db = fsM.initializeFirestore(app, {
      localCache: fsM.persistentLocalCache({ tabManager: fsM.persistentMultipleTabManager() }),
    });
    authM.onAuthStateChanged(auth, onUser);
  } catch (e) {
    setStatus('error', 'Impossible de charger la synchronisation (connexion internet ?)');
  }
}

if (hasWindow) {
  window.Sync = Sync;
  window.dispatchEvent(new Event('sync-ready'));
  if (Sync.configured) init();
}
