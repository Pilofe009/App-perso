/* Code partagé entre l'application (index.html) et le service worker (sw.js).
   Script classique : expose un objet global `E`. */
(function (root) {
  'use strict';

  /* ---------- Stockage (IndexedDB, lisible aussi par le service worker) ---------- */
  const DB_NAME = 'echeances';
  const STORE = 'kv';

  function openDB() {
    return new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = () => req.result.createObjectStore(STORE);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }

  async function kvGet(key) {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const req = db.transaction(STORE, 'readonly').objectStore(STORE).get(key);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }

  async function kvSet(key, value) {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).put(value, key);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  }

  /* ---------- Dates (format 'AAAA-MM-JJ', heure locale) ---------- */
  const pad = (n) => String(n).padStart(2, '0');
  const fmt = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const parse = (s) => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); };
  const todayStr = () => fmt(new Date());
  const addDays = (s, n) => { const d = parse(s); d.setDate(d.getDate() + n); return fmt(d); };
  const daysBetween = (a, b) => Math.round((parse(b) - parse(a)) / 86400000);
  const daysInMonth = (y, m) => new Date(y, m + 1, 0).getDate();

  // Ajoute n mois en gardant le jour d'origine quand c'est possible (31 → 30 → 31…).
  function addMonths(s, n, anchorDay) {
    const d = parse(s);
    const day = anchorDay || d.getDate();
    const total = d.getMonth() + n;
    const y = d.getFullYear() + Math.floor(total / 12);
    const m = ((total % 12) + 12) % 12;
    return fmt(new Date(y, m, Math.min(day, daysInMonth(y, m))));
  }

  // k-ième occurrence d'une date répétée.
  function occurrence(anchor, freq, k) {
    const day = parse(anchor).getDate();
    switch (freq) {
      case 'daily': return addDays(anchor, k);
      case 'weekly': return addDays(anchor, 7 * k);
      case 'monthly': return addMonths(anchor, k, day);
      case 'quarterly': return addMonths(anchor, 3 * k, day);
      case 'yearly': return addMonths(anchor, 12 * k, day);
      default: return anchor;
    }
  }

  const PERIOD_DAYS = { daily: 1, weekly: 7, monthly: 30.44, quarterly: 91.31, yearly: 365.25 };

  // Indice de la première occurrence >= from.
  function firstIndexFrom(anchor, freq, from) {
    let k = Math.max(0, Math.floor(daysBetween(anchor, from) / PERIOD_DAYS[freq]) - 1);
    while (occurrence(anchor, freq, k) < from) k++;
    return k;
  }

  // Première occurrence >= from.
  function nextOccurrence(anchor, freq, from) {
    if (anchor >= from || !PERIOD_DAYS[freq]) return anchor;
    return occurrence(anchor, freq, firstIndexFrom(anchor, freq, from));
  }

  // Toutes les occurrences entre start et end (inclus).
  function occurrencesBetween(anchor, freq, start, end) {
    if (!PERIOD_DAYS[freq]) return anchor >= start && anchor <= end ? [anchor] : [];
    const out = [];
    let k = firstIndexFrom(anchor, freq, start);
    for (let cur = occurrence(anchor, freq, k); cur <= end; cur = occurrence(anchor, freq, ++k)) out.push(cur);
    return out;
  }

  /* ---------- Règles métier ---------- */
  const DEFAULT_SETTINGS = { urgentDays: 3, soonDays: 3, trialAlertDays: 3, paymentAlertDays: 2 };

  function isUrgent(task, today, urgentDays) {
    if (!task.due) return false;
    return daysBetween(today, task.due) <= urgentDays;
  }

  function quadrant(task, today, urgentDays) {
    const u = isUrgent(task, today, urgentDays);
    if (task.important && u) return 'do';
    if (task.important) return 'plan';
    if (u) return 'quick';
    return 'later';
  }

  function subNextPayment(sub, today) {
    return nextOccurrence(sub.anchor, sub.freq, today);
  }

  function monthlyCost(sub) {
    const a = Number(sub.amount) || 0;
    return { weekly: a * 52 / 12, monthly: a, quarterly: a / 3, yearly: a / 12 }[sub.freq] || 0;
  }

  const money = (n) => n.toLocaleString('fr-FR', { style: 'currency', currency: 'EUR' });

  function relDay(date, today) {
    const n = daysBetween(today, date);
    if (n === 0) return "aujourd'hui";
    if (n === 1) return 'demain';
    if (n === -1) return 'hier';
    if (n < 0) return `il y a ${-n} j`;
    if (n < 7) return `dans ${n} j`;
    return parse(date).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' });
  }

  // Le résumé du matin, utilisé par la notification et l'écran « Aujourd'hui ».
  function buildSummary(state, today) {
    today = today || todayStr();
    const s = Object.assign({}, DEFAULT_SETTINGS, state && state.settings);
    const tasks = ((state && state.tasks) || []).filter((t) => !t.done && t.due);
    const subs = (state && state.subs) || [];

    const overdue = tasks.filter((t) => t.due < today).sort((a, b) => a.due.localeCompare(b.due));
    const dueToday = tasks.filter((t) => t.due === today);
    const soon = tasks.filter((t) => t.due > today && daysBetween(today, t.due) <= s.soonDays)
      .sort((a, b) => a.due.localeCompare(b.due));
    const payments = subs
      .map((x) => ({ sub: x, date: subNextPayment(x, today) }))
      .filter((p) => daysBetween(today, p.date) <= s.paymentAlertDays)
      .sort((a, b) => a.date.localeCompare(b.date));
    const trials = subs
      .filter((x) => x.trialEnd && x.trialEnd >= today && daysBetween(today, x.trialEnd) <= s.trialAlertDays)
      .sort((a, b) => a.trialEnd.localeCompare(b.trialEnd));

    const parts = [];
    if (overdue.length) parts.push(`${overdue.length} en retard`);
    if (dueToday.length) parts.push(`${dueToday.length} aujourd'hui`);
    if (soon.length) parts.push(`${soon.length} bientôt`);
    const title = parts.length ? `Ton point du jour : ${parts.join(' · ')}` : 'Ton point du jour';

    const lines = [];
    const star = (t) => (t.important ? '★ ' : '');
    overdue.forEach((t) => lines.push(`⚠️ ${star(t)}${t.title} (${relDay(t.due, today)})`));
    dueToday.forEach((t) => lines.push(`📌 ${star(t)}${t.title}`));
    soon.forEach((t) => lines.push(`🗓️ ${star(t)}${t.title} (${relDay(t.due, today)})`));
    payments.forEach((p) => lines.push(`💳 ${p.sub.name} ${money(Number(p.sub.amount) || 0)} ${relDay(p.date, today)}`));
    trials.forEach((x) => lines.push(`⏳ Fin d'essai ${x.name} ${relDay(x.trialEnd, today)}`));
    if (!lines.length) lines.push('Rien d’urgent aujourd’hui. Profite ! ✨');

    const MAX = 8;
    const body = lines.length > MAX
      ? lines.slice(0, MAX - 1).concat(`… et ${lines.length - MAX + 1} autre(s)`).join('\n')
      : lines.join('\n');

    return { title, body, overdue, dueToday, soon, payments, trials };
  }

  /* ---------- Budget ---------- */
  // Catégories reprises du tableau Excel. `slot` = couleur fixe de la catégorie (0 à 7).
  const DEFAULT_BUDGET_CATS = [
    { id: 'rev-salaire', name: 'Argent de poche / Salaire', type: 'income' },
    { id: 'rev-autres', name: 'Autres revenus', type: 'income' },
    { id: 'dep-cafet', name: 'Cafet', type: 'expense', slot: 0, budgets: [{ from: '2000-01', amount: 5 }] },
    { id: 'dep-soirees', name: 'Soirées', type: 'expense', slot: 1, budgets: [{ from: '2000-01', amount: 100 }] },
    { id: 'dep-recurrentes', name: 'Dépenses récurrentes', type: 'expense', slot: 2, auto: 'subs', budgets: [] },
    { id: 'dep-clopes', name: 'Clopes', type: 'expense', slot: 3, budgets: [{ from: '2000-01', amount: 0 }] },
    { id: 'dep-autres', name: 'Autres (jeux vidéo, vacances…)', type: 'expense', slot: 4, budgets: [{ from: '2000-01', amount: 60 }] },
    { id: 'dep-invest', name: 'Investissement', type: 'expense', slot: 5, budgets: [{ from: '2000-01', amount: 105 }] },
    { id: 'dep-gamble', name: 'Gamble', type: 'expense', slot: 6, budgets: [{ from: '2000-01', amount: 50 }] },
  ];

  const round2 = (n) => Math.round(n * 100) / 100;
  const sum = (arr, f) => round2(arr.reduce((a, x) => a + (f ? f(x) : x), 0));
  const monthEnd = (ym) => { const [y, m] = ym.split('-').map(Number); return `${ym}-${pad(daysInMonth(y, m - 1))}`; };
  const addMonthsYm = (ym, n) => addMonths(ym + '-01', n).slice(0, 7);

  // Budget d'une catégorie pour un mois : exception du mois, sinon dernier budget « à partir de ».
  // null = pas de budget (ou calcul automatique pour les dépenses récurrentes).
  function budgetAt(cat, ym, overrides) {
    const o = overrides && overrides[ym];
    if (o && Object.prototype.hasOwnProperty.call(o, cat.id)) return o[cat.id];
    let amount = null;
    (cat.budgets || []).slice().sort((a, b) => a.from.localeCompare(b.from))
      .forEach((b) => { if (b.from <= ym) amount = b.amount; });
    return amount;
  }

  function subPaymentsInMonth(subs, ym) {
    const out = [];
    (subs || []).forEach((s) => occurrencesBetween(s.anchor, s.freq, ym + '-01', monthEnd(ym))
      .forEach((date) => out.push({ sub: s, date, amount: Number(s.amount) || 0 })));
    return out.sort((a, b) => a.date.localeCompare(b.date));
  }

  // Tout le budget d'un mois. Montants des opérations : positifs = argent reçu (revenu) ou dépensé (dépense),
  // négatifs = gain ou remboursement sur une catégorie de dépense.
  function budgetMonth(state, ym, today) {
    today = today || todayStr();
    const txs = (state.transactions || []).filter((t) => t.date.slice(0, 7) === ym);
    const subPays = subPaymentsInMonth(state.subs, ym);
    const lines = (state.budgetCats || []).map((cat) => {
      const own = txs.filter((t) => t.cat === cat.id);
      let total = sum(own, (t) => t.amount);
      let budget = budgetAt(cat, ym, state.budgetOverrides);
      let pays = [];
      if (cat.auto === 'subs') {
        pays = subPays;
        total = round2(total + sum(pays.filter((p) => p.date <= today), (p) => p.amount));
        if (budget == null) budget = sum(pays, (p) => p.amount);
      }
      return { cat, total, budget: budget == null ? 0 : budget, txs: own, pays };
    });
    const incomes = lines.filter((l) => l.cat.type === 'income');
    const expenses = lines.filter((l) => l.cat.type === 'expense');
    const totalIncome = sum(incomes, (l) => l.total);
    const totalSpent = sum(expenses, (l) => l.total);
    return {
      ym, incomes, expenses, txs, subPays, totalIncome, totalSpent,
      totalBudget: sum(expenses, (l) => l.budget),
      balance: round2(totalIncome - totalSpent),
    };
  }

  root.E = {
    kvGet, kvSet, fmt, parse, todayStr, addDays, addMonths, daysBetween, occurrence,
    nextOccurrence, occurrencesBetween, DEFAULT_SETTINGS, isUrgent, quadrant,
    subNextPayment, monthlyCost, money, relDay, buildSummary,
    DEFAULT_BUDGET_CATS, round2, monthEnd, addMonthsYm, budgetAt, budgetMonth,
  };
})(typeof self !== 'undefined' ? self : this);
