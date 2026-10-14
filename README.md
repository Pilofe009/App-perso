# Échéances

Application pour téléphone Android : tâches avec échéances, matrice importance/urgence mise à jour chaque jour, gestion du budget, suivi des abonnements et résumé du matin à 8h.

- **Aujourd'hui** : les tâches en retard, celles du jour et celles qui arrivent bientôt, les fins d'essai et les paiements de la semaine.
- **Tâches** : ajouter, cocher, répéter (chaque jour, semaine, mois ou année), classer par catégorie.
- **Matrice** : *Faire maintenant / Planifier / Expédier / Plus tard*. Tu choisis l'importance (★). L'urgence se calcule seule à partir de l'échéance (par défaut, moins de 3 jours).
- **Budget**, avec trois sous-onglets :
  - **Mois** : solde du mois, revenus, dépenses par catégorie face au budget (avec une alerte en cas de dépassement), répartition de tes dépenses et liste des opérations. Touche une catégorie pour changer son budget (ce mois-ci seulement, ou à partir de ce mois) ou pour corriger directement son total, comme dans un tableur.
  - **Bilan** : revenus et dépenses sur 3, 6 ou 12 mois, solde cumulé, et moyenne par catégorie comparée au budget.
  - **Abos** : montant, fréquence, prochain paiement calculé automatiquement, total par mois et par an, alerte avant la fin d'un essai gratuit. Les abonnements remplissent tout seuls la catégorie « Dépenses récurrentes ».
  - Les gains (Gamble, remboursements) se saisissent avec l'option « Gain ou remboursement » : ils réduisent les dépenses de la catégorie.
- **Calendrier** : tâches et paiements sur le mois.
- **Réglages** : seuils d'urgence et d'alerte, catégories des tâches et du budget, export et import de sauvegarde, notifications.

Tes données restent **uniquement sur ton téléphone**. GitHub envoie seulement un « réveil » vide chaque matin, puis le téléphone construit le résumé lui-même.

---

## Installation (environ 15 minutes, une seule fois)

### 1. Mettre l'application en ligne avec GitHub Pages

1. Crée un compte gratuit sur <https://github.com>.
2. En haut à droite, clique sur **+** puis **New repository**.
   - Nom : `echeances`
   - Visibilité : **Public**. C'est obligatoire pour GitHub Pages gratuit, et sans risque : le dépôt ne contient que le code, aucune de tes données.
   - Clique sur **Create repository**.
3. Sur la page du dépôt, clique sur **uploading an existing file**. Glisse-dépose **tout le contenu** du dossier de l'application (fichiers et dossiers `icons`, `scripts`, `.github`, ainsi que le fichier `.nojekyll`), **sauf** le dossier `.claude`. Clique ensuite sur **Commit changes**.
   - Vérifie que le fichier `.github/workflows/resume-quotidien.yml` apparaît bien dans le dépôt. S'il manque, clique sur **Add file**, puis **Create new file**, tape `.github/workflows/resume-quotidien.yml` comme nom, colle son contenu et valide.
4. Va dans **Settings**, puis **Pages**. Dans *Build and deployment*, choisis **Deploy from a branch**, puis la branche `main` et le dossier `/ (root)`, et clique sur **Save**.
5. Après 1 à 2 minutes, l'app est en ligne sur `https://TON-PSEUDO.github.io/echeances/`.

### 2. Installer l'app sur le téléphone

1. Sur ton Android, ouvre l'adresse ci-dessus dans **Chrome**.
2. Ouvre le menu **⋮**, puis touche **Installer l'application** (ou **Ajouter à l'écran d'accueil**).
3. L'icône **Échéances** apparaît. L'app fonctionne aussi hors connexion.

### 3. Activer le résumé du matin

1. Dans l'app, ouvre ⚙️ **Réglages**, puis **1. Activer les notifications**, et accepte.
2. Touche **Copier la configuration**.
3. Sur GitHub (depuis le téléphone ou l'ordinateur), dans ton dépôt, va dans **Settings**, puis **Secrets and variables**, puis **Actions**, et clique sur **New repository secret**.
   - Name : `PUSH_CONFIG`
   - Secret : colle le texte copié
   - Clique sur **Add secret**.
4. Ouvre l'onglet **Actions** du dépôt. Si GitHub le demande, active les workflows. Clique ensuite sur **Résumé du matin**, puis **Run workflow**. Une notification doit arriver sur ton téléphone en moins d'une minute.

C'est fini : chaque matin vers 8h, tu recevras ton point du jour.

---

## Bon à savoir

- **Sauvegarde** : tes données ne sont que sur ce téléphone. Fais régulièrement un **Exporter** dans Réglages, par exemple pour l'envoyer sur ton Drive. Si tu changes de téléphone, utilise **Importer**.
- **Retards** : GitHub démarre parfois ses tâches programmées avec quelques minutes de retard. Le déclenchement est donc prévu à 7h50 pour une arrivée vers 8h.
- **Notifications qui n'arrivent plus** : si l'app affiche « Notifications à reconfigurer », va dans Réglages, touche **Mettre à jour**, puis recopie la configuration dans le secret `PUSH_CONFIG`. GitHub t'envoie aussi un e-mail si l'envoi échoue.
- **Batterie** : si les notifications arrivent en retard, dans les paramètres Android, va dans Applications, puis Chrome, puis Batterie, et choisis **Sans restriction**.
- **Changer l'heure** : dans `.github/workflows/resume-quotidien.yml`, modifie `TARGET_HOUR`, puis décale les deux lignes `cron` (heure UTC : heure voulue − 2 pour l'été, − 1 pour l'hiver, à HH:50 de l'heure précédente).
- **Inactivité** : GitHub met en pause les tâches programmées d'un dépôt inactif depuis 60 jours. Le workflow fait lui-même un petit commit toutes les ~6 semaines pour l'éviter.

## Fichiers

| Fichier | Rôle |
|---|---|
| `index.html`, `styles.css`, `app.js` | L'application |
| `shared.js` | Calcul des dates, de la matrice et du résumé (partagé avec le service worker) |
| `sw.js` | Service worker : mode hors ligne et affichage du résumé |
| `manifest.webmanifest`, `icons/` | Installation sur l'écran d'accueil |
| `.github/workflows/resume-quotidien.yml`, `scripts/send-push.mjs` | Réveil quotidien envoyé par GitHub Actions |
