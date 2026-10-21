# Échéances

Application pour téléphone Android et PC : tâches avec échéances, matrice importance/urgence mise à jour chaque jour, budget, objectifs d'épargne, suivi des abonnements, synchronisation entre appareils et résumé du matin à 8h.

- **Aujourd'hui** : les tâches en retard, celles du jour et celles qui arrivent bientôt, les fins d'essai, les paiements de la semaine et le budget du mois.
- **Tâches** : ajouter, cocher, répéter (chaque jour, semaine, mois ou année), classer par catégorie.
- **Matrice** : *Faire maintenant / Planifier / Expédier / Plus tard*. Tu choisis l'importance (★). L'urgence se calcule seule à partir de l'échéance (par défaut, moins de 3 jours).
- **Budget**, avec quatre sous-onglets :
  - **Mois** : solde du mois, revenus, dépenses par catégorie face au budget, répartition de tes dépenses et liste des opérations. Touche une catégorie pour changer son budget (ce mois-ci seulement, ou à partir de ce mois) ou pour corriger directement son total, comme dans un tableur.
  - **Bilan** : revenus et dépenses sur 3, 6 ou 12 mois, solde cumulé, puis pour chaque catégorie le total sur la période (gains déduits), la moyenne par mois et le budget.
  - **Objectifs** : objectifs d'épargne (vacances, permis…) avec une barre de progression et le montant à mettre de côté chaque mois pour tenir la date visée. Chaque versement est compté dans ton budget du mois.
  - **Abos** : montant, fréquence, prochain paiement calculé automatiquement, total par mois et par an, alerte avant la fin d'un essai gratuit. Les abonnements remplissent tout seuls la catégorie « Dépenses récurrentes ».
  - Les gains (Gamble, remboursements) se saisissent avec l'option « Gain ou remboursement » : ils réduisent les dépenses de la catégorie.
  - **Alertes** : quand une dépense fait passer une catégorie à 80 % de son budget, ou la fait dépasser, l'app te prévient immédiatement.
- **Raccourcis** : un appui long sur l'icône de l'app propose « Dépense » et « Tâche », qui ouvrent directement le formulaire.
- **Calendrier** : tâches et paiements sur le mois.
- **Réglages** : synchronisation, résumé du matin, seuils d'urgence et d'alerte, catégories des tâches et du budget, export et import de sauvegarde.

---

## Installation

### 1. Mettre l'application en ligne avec GitHub Pages

1. Crée un compte gratuit sur <https://github.com>, puis un dépôt **public** (le dépôt ne contient que le code, aucune de tes données).
2. Envoie-y tout le contenu du dossier de l'application, **sauf** le dossier `.claude`.
3. Va dans **Settings**, puis **Pages**. Dans *Build and deployment*, choisis **Deploy from a branch**, puis la branche `main` et le dossier `/ (root)`, et clique sur **Save**.
4. Après 1 à 2 minutes, l'app est en ligne sur `https://pilofe009.github.io/App-perso/`.

### 2. Installer l'app

- **Téléphone Android** : ouvre l'adresse dans **Chrome**, puis menu **⋮** → **Installer l'application**.
- **PC** : ouvre l'adresse dans Chrome ou Edge, puis clique sur l'icône ⊕ dans la barre d'adresse pour l'installer.

### 3. Synchroniser téléphone et PC (Firebase)

Les données sont stockées dans **ton propre projet Firebase** (gratuit, chez Google). L'app continue de fonctionner hors connexion et envoie les changements au retour du réseau.

1. Sur <https://console.firebase.google.com>, crée un projet `echeances` (tu peux désactiver Google Analytics).
2. **Connexion Google** : ouvre **Sécurité → Authentication → Commencer**, puis dans *Mode de connexion*, choisis **Google**, active-le et enregistre.
   Dans l'onglet **Paramètres → Domaines autorisés**, ajoute `pilofe009.github.io`.
3. **Base de données** : ouvre **Bases de données et stockage → Firestore → Créer une base de données**, choisis `eur3 (europe-west)` et le **mode production**.
   Dans l'onglet **Règles**, colle le texte ci-dessous, puis clique sur **Publier** :
   ```
   rules_version = '2';
   service cloud.firestore {
     match /databases/{database}/documents {
       match /users/{uid}/{document=**} {
         allow read, write: if request.auth != null && request.auth.uid == uid;
       }
     }
   }
   ```
   Ces règles garantissent que chaque compte Google ne peut lire et écrire que ses propres données.
4. **Identifiants** : ⚙️ **Paramètres du projet** → *Vos applications* → **Web `</>`**. Copie le bloc `firebaseConfig` dans `firebase-config.js`. Ces identifiants ne sont pas secrets.
5. Dans l'app, sur le téléphone **puis** sur le PC : ⚙️ **Réglages** → **Se connecter avec Google**. Ce qui est déjà sur l'appareil est conservé et envoyé en ligne.

### 4. Résumé du matin

Chaque matin, GitHub lit tes données dans Firebase, construit le résumé (tâches, paiements, budget, y compris ce que tu as ajouté depuis le PC) et l'envoie à tes appareils.

**a. Donner à GitHub l'accès en lecture à ta base** :
1. Dans Firebase : ⚙️ **Paramètres du projet** → onglet **Comptes de service** → **Générer une nouvelle clé privée** → **Générer la clé**. Un fichier `.json` se télécharge.
2. Ouvre ce fichier avec le Bloc-notes et copie **tout** son contenu.
3. Sur GitHub, dans ton dépôt : **Settings → Secrets and variables → Actions → New repository secret**.
   - Name : `FIREBASE_SERVICE_ACCOUNT`
   - Secret : colle le contenu du fichier, puis clique sur **Add secret**.
4. Supprime ensuite le fichier `.json` de ton PC. Cette clé donne accès à toute ta base : elle ne doit être que dans ce secret GitHub.
   L'ancien secret `PUSH_CONFIG` ne sert plus, tu peux le supprimer.

**b. Activer le résumé sur ton téléphone** (et sur ton PC si tu veux) :
- Dans l'app : ⚙️ **Réglages** → **Résumé du matin** → **Activer sur cet appareil**, puis accepte les notifications. Il faut être connecté (étape 3).

**c. Tester** : sur GitHub, ouvre l'onglet **Actions**, puis **Résumé du matin** → **Run workflow**. La notification arrive en moins d'une minute.

### 5. Le déclencher chaque jour à 8h pile (cron-job.org)

Les tâches programmées de GitHub arrivent souvent avec plusieurs heures de retard. C'est donc le service gratuit **cron-job.org** qui lance le résumé à 8h00 pile.

**a. Créer une clé d'accès GitHub** (elle ne permet que de lancer le résumé de ce dépôt) :
1. Sur GitHub, touche ta photo de profil, puis **Settings → Developer settings → Personal access tokens → Fine-grained tokens → Generate new token**.
2. *Token name* : `cron-job résumé`. *Expiration* : la durée la plus longue proposée.
3. *Repository access* : **Only select repositories**, puis choisis `App-perso`.
4. *Permissions* : **Add permissions** → **Actions** → **Read and write**.
5. Clique sur **Generate token** et copie la clé (elle commence par `github_pat_`). Elle ne s'affiche qu'une seule fois.

**b. Créer la tâche sur cron-job.org** :
1. Crée un compte gratuit sur <https://cron-job.org>, puis clique sur **Create cronjob**.
2. Onglet **Common** :
   - *Title* : `Résumé du matin`
   - *URL* : `https://api.github.com/repos/Pilofe009/App-perso/actions/workflows/resume-quotidien.yml/dispatches`
   - *Execution schedule* : **Every day at 8:00**, fuseau horaire **Europe/Paris**.
3. Onglet **Advanced** :
   - *Request method* : **POST**
   - *Headers* :
     - `Authorization` → `Bearer github_pat_…` (ta clé)
     - `Accept` → `application/vnd.github+json`
     - `Content-Type` → `application/json`
   - *Request body* : `{"ref":"main"}`
4. Enregistre, puis utilise **Test run**. La réponse doit être **204**, et la notification arrive dans la minute.

---

## Bon à savoir

- **Pastille sur ⚙️** : verte = synchronisé, orange = envoi en cours ou hors ligne, rouge = erreur (le détail est dans Réglages).
- **Sauvegarde** : tes données sont dans ton projet Firebase. Tu peux aussi faire un **Exporter** dans Réglages de temps en temps.
- **Raccourcis de l'icône** : ils apparaissent après la mise à jour de l'app installée par Chrome, ce qui peut prendre jusqu'à un jour. Si tu ne les vois pas au bout d'un jour, désinstalle puis réinstalle l'app : tes données sont conservées en ligne.
- **Notifications qui n'arrivent plus** : GitHub t'envoie un e-mail si l'envoi échoue. Dans l'app, va dans **Résumé du matin** → **Désactiver**, puis **Activer sur cet appareil**.
- **Batterie** : si les notifications arrivent en retard, dans les paramètres Android, va dans Applications → Chrome → Batterie et choisis **Sans restriction**.
- **Changer l'heure** : modifie l'horaire de la tâche sur cron-job.org.
- **Clé expirée** : quand la clé GitHub expire, GitHub te prévient par e-mail et cron-job.org signale des erreurs (code 401). Crée une nouvelle clé (étape 5a) et remplace-la dans l'en-tête `Authorization`.

## Fichiers

| Fichier | Rôle |
|---|---|
| `index.html`, `styles.css`, `app.js` | L'application |
| `shared.js` | Dates, matrice, budget, résumé et conversion pour la synchronisation (partagé avec le service worker et GitHub) |
| `sync.js`, `firebase-config.js` | Synchronisation en ligne entre appareils (Firebase) |
| `sw.js` | Service worker : mode hors ligne et affichage du résumé |
| `manifest.webmanifest`, `icons/` | Installation et raccourcis de l'icône |
| `.github/workflows/resume-quotidien.yml`, `scripts/send-push.mjs` | Résumé du matin construit et envoyé par GitHub Actions (lancé à 8h par cron-job.org) |
