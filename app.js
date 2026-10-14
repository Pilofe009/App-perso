(function () {
  'use strict';

  /* ---------- Utilitaires ---------- */
  const $ = (s, el = document) => el.querySelector(s);
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  const safeColor = (c) => (/^#[0-9a-f]{6}$/i.test(c || '') ? c : '#8b5cf6');
  const maxStr = (a, b) => (a > b ? a : b);

  const REPEAT = { none: 'Jamais', daily: 'Chaque jour', weekly: 'Chaque semaine', monthly: 'Chaque mois', yearly: 'Chaque année' };
  const FREQ = { weekly: 'Hebdomadaire', monthly: 'Mensuel', quarterly: 'Trimestriel', yearly: 'Annuel' };
  const TITLES = { today: "Aujourd'hui", tasks: 'Tâches', matrix: 'Matrice', budget: 'Budget', calendar: 'Calendrier', settings: 'Réglages' };
  const DEFAULT_CATEGORIES = [
    { id: 'perso', name: 'Perso', color: '#8b5cf6' },
    { id: 'travail', name: 'Travail', color: '#2563eb' },
    { id: 'admin', name: 'Administratif', color: '#d97706' },
    { id: 'sante', name: 'Santé', color: '#16a34a' },
    { id: 'finances', name: 'Finances', color: '#db2777' },
  ];

  /* ---------- État ---------- */
  let state;
  let today = E.todayStr();
  let view = 'today';
  const ui = {
    taskFilter: 'todo', taskCat: 'all', calMonth: today.slice(0, 8) + '01', calSel: today, push: null,
    budgetTab: 'month', budgetMonth: today.slice(0, 7), statsRange: 6, statsSel: null, lastTxCat: {},
  };

  function withDefaults(s) {
    s.tasks = s.tasks || [];
    s.subs = s.subs || [];
    s.categories = s.categories || DEFAULT_CATEGORIES.slice();
    s.settings = Object.assign({}, E.DEFAULT_SETTINGS, s.settings);
    s.budgetCats = s.budgetCats || JSON.parse(JSON.stringify(E.DEFAULT_BUDGET_CATS));
    s.transactions = s.transactions || [];
    s.budgetOverrides = s.budgetOverrides || {};
    return s;
  }
  async function load() { state = withDefaults((await E.kvGet('state')) || {}); }
  const save = () => E.kvSet('state', state);
  const catById = (id) => state.categories.find((c) => c.id === id);
  const bcatById = (id) => state.budgetCats.find((c) => c.id === id);
  const slotColor = (cat) => (cat && cat.slot != null && cat.slot < 8 ? `var(--c${cat.slot + 1})` : 'var(--c-other)');
  const signed = (n) => (n > 0 ? '+' : n < 0 ? '−' : '') + E.money(Math.abs(n));
  const parseAmount = (v) => E.round2(parseFloat(String(v).replace(',', '.')));
  const ymLabel = (ym) => E.parse(ym + '-01').toLocaleDateString('fr-FR', { month: 'long', year: 'numeric' });
  const shortDate = (d) => E.parse(d).toLocaleDateString('fr-FR', { weekday: 'short', day: 'numeric', month: 'short' });

  /* ---------- Rendu : éléments communs ---------- */
  function catTag(id) {
    const c = catById(id);
    return c ? `<span><span class="dot" style="background:${safeColor(c.color)}"></span>${esc(c.name)}</span>` : '';
  }

  function dueTag(t) {
    if (!t.due) return '';
    const n = E.daysBetween(today, t.due);
    const cls = t.done ? '' : n < 0 ? 'late' : n <= state.settings.urgentDays ? 'soon' : '';
    return `<span class="${cls}">📅 ${esc(E.relDay(t.due, today))}${t.time ? ' · ' + esc(t.time) : ''}</span>`;
  }

  function taskRow(t) {
    return `<div class="row ${t.done ? 'done' : ''}">
      <input type="checkbox" class="check" data-toggle="${t.id}" ${t.done ? 'checked' : ''} aria-label="Marquer comme fait">
      <div class="main" data-edit-task="${t.id}">
        <div class="title">${t.important ? '<span class="star" title="Important">★</span> ' : ''}${esc(t.title)}</div>
        <div class="meta">${dueTag(t)}${catTag(t.cat)}${t.repeat && t.repeat !== 'none' ? `<span>↻ ${REPEAT[t.repeat]}</span>` : ''}</div>
      </div>
    </div>`;
  }

  function subRow(s, date) {
    const trial = s.trialEnd && s.trialEnd >= today
      ? ` <span class="badge trial">Essai → ${esc(E.relDay(s.trialEnd, today))}</span>` : '';
    return `<div class="row">
      <div class="main" data-edit-sub="${s.id}">
        <div class="title">${esc(s.name)}${trial}</div>
        <div class="meta"><span>💳 ${esc(E.relDay(date, today))}</span><span>${FREQ[s.freq] || ''}</span>${catTag(s.cat)}</div>
      </div>
      <div class="right">${E.money(Number(s.amount) || 0)}${s.freq !== 'monthly' ? `<small>${E.money(E.monthlyCost(s))}/mois</small>` : ''}</div>
    </div>`;
  }

  const section = (title, count, inner) =>
    `<div class="section-title"><span>${title}</span>${count != null ? `<span class="count">${count}</span>` : ''}</div>${inner}`;
  const list = (rows) => `<div class="list">${rows.join('')}</div>`;
  const empty = (icon, text) => `<div class="empty"><span class="big">${icon}</span>${text}</div>`;

  /* ---------- Vue : Aujourd'hui ---------- */
  function renderToday() {
    const s = state.settings;
    const sum = E.buildSummary(state, today);
    const payments7 = state.subs
      .map((x) => ({ sub: x, date: E.subNextPayment(x, today) }))
      .filter((p) => E.daysBetween(today, p.date) <= 7)
      .sort((a, b) => a.date.localeCompare(b.date));
    const dateLine = new Date().toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' });

    let html = `<p class="date-line">${dateLine}</p>`;
    if (ui.push && ui.push.changed) {
      html += `<div class="card" data-view-link="settings"><b>⚠️ Notifications à reconfigurer</b><br><small>Ton téléphone a changé d'abonnement aux notifications. Ouvre les Réglages pour mettre à jour GitHub.</small></div>`;
    }
    html += `<div class="stats">
      <div class="stat ${sum.overdue.length ? 'alert' : ''}"><b>${sum.overdue.length}</b><span>En retard</span></div>
      <div class="stat"><b>${sum.dueToday.length}</b><span>Aujourd'hui</span></div>
      <div class="stat"><b>${sum.soon.length}</b><span>Dans ${s.soonDays} j</span></div>
    </div>`;

    const bm = E.budgetMonth(state, today.slice(0, 7), today);
    if (bm.totalIncome || bm.totalSpent) {
      const left = E.round2(bm.totalBudget - bm.totalSpent);
      html += `<div class="card tap budget-mini" data-action="open-budget">
        <div><b>Budget ${((m) => (/^[aeiouâ]/.test(m) ? "d'" : 'de ') + m)(E.parse(today).toLocaleDateString('fr-FR', { month: 'long' }))}</b>
          <small>${left >= 0 ? `Reste ${E.money(left)} à dépenser` : `⚠️ Budget dépassé de ${E.money(-left)}`}</small></div>
        <div class="right"><span class="${bm.balance < 0 ? 'neg' : bm.balance > 0 ? 'pos' : ''}">${signed(bm.balance)}</span><small>solde</small></div>
      </div>`;
    }

    if (sum.overdue.length) html += section('En retard', sum.overdue.length, list(sum.overdue.map(taskRow)));
    if (sum.dueToday.length) html += section("Aujourd'hui", sum.dueToday.length, list(sum.dueToday.map(taskRow)));
    if (sum.soon.length) html += section('Bientôt', sum.soon.length, list(sum.soon.map(taskRow)));
    if (sum.trials.length) {
      html += section("Fins d'essai", sum.trials.length, list(sum.trials.map((x) => subRow(x, E.subNextPayment(x, today)))));
    }
    if (payments7.length) html += section('Paiements cette semaine', payments7.length, list(payments7.map((p) => subRow(p.sub, p.date))));

    if (!sum.overdue.length && !sum.dueToday.length && !sum.soon.length && !payments7.length && !sum.trials.length) {
      html += `<div class="card">${empty('✨', state.tasks.length
        ? "Rien d'urgent. Profite de ta journée !"
        : 'Bienvenue ! Appuie sur <b>+</b> pour ajouter ta première tâche.')}</div>`;
    }
    return html;
  }

  /* ---------- Vue : Tâches ---------- */
  function renderTasks() {
    const chips = [['todo', 'À faire'], ['done', 'Terminées']]
      .map(([k, l]) => `<button class="chip ${ui.taskFilter === k ? 'on' : ''}" data-filter="${k}">${l}</button>`).join('');
    const cats = [`<button class="chip ${ui.taskCat === 'all' ? 'on' : ''}" data-cat="all">Toutes</button>`]
      .concat(state.categories.map((c) => `<button class="chip ${ui.taskCat === c.id ? 'on' : ''}" data-cat="${esc(c.id)}"><span class="dot" style="background:${safeColor(c.color)}"></span>${esc(c.name)}</button>`))
      .join('');
    let html = `<div class="chips">${chips}</div><div class="chips">${cats}</div>`;

    const tasks = state.tasks.filter((t) => ui.taskCat === 'all' || t.cat === ui.taskCat);

    if (ui.taskFilter === 'done') {
      const done = tasks.filter((t) => t.done).sort((a, b) => (b.doneAt || '').localeCompare(a.doneAt || ''));
      if (!done.length) return html + `<div class="card">${empty('📭', 'Aucune tâche terminée.')}</div>`;
      return html + section('Terminées', done.length, list(done.map(taskRow))) +
        `<div class="actions" style="margin-top:12px"><button class="btn danger" data-action="clear-done">Supprimer les tâches terminées</button></div>`;
    }

    const todo = tasks.filter((t) => !t.done)
      .sort((a, b) => (a.due || '9999').localeCompare(b.due || '9999') || (b.important ? 1 : 0) - (a.important ? 1 : 0));
    if (!todo.length) return html + `<div class="card">${empty('🎉', 'Tout est fait ! Appuie sur <b>+</b> pour ajouter une tâche.')}</div>`;

    const groups = [
      ['En retard', (t) => t.due && t.due < today],
      ["Aujourd'hui", (t) => t.due === today],
      ['7 prochains jours', (t) => t.due && t.due > today && E.daysBetween(today, t.due) <= 7],
      ['Plus tard', (t) => t.due && E.daysBetween(today, t.due) > 7],
      ['Sans échéance', (t) => !t.due],
    ];
    for (const [label, fn] of groups) {
      const items = todo.filter(fn);
      if (items.length) html += section(label, items.length, list(items.map(taskRow)));
    }
    return html;
  }

  /* ---------- Vue : Matrice ---------- */
  function renderMatrix() {
    const d = state.settings.urgentDays;
    const todo = state.tasks.filter((t) => !t.done)
      .sort((a, b) => (a.due || '9999').localeCompare(b.due || '9999'));
    const Q = [
      ['do', 'Faire maintenant', 'Important · Urgent'],
      ['plan', 'Planifier', 'Important · Pas urgent'],
      ['quick', 'Expédier / déléguer', 'Pas important · Urgent'],
      ['later', 'Plus tard', 'Pas important · Pas urgent'],
    ];
    const quads = Q.map(([k, title, sub]) => {
      const items = todo.filter((t) => E.quadrant(t, today, d) === k);
      const inner = items.length ? items.map((t) => {
        const late = t.due && t.due < today;
        return `<div class="qitem">
          <input type="checkbox" class="check" data-toggle="${t.id}" aria-label="Marquer comme fait">
          <div class="main" data-edit-task="${t.id}">${esc(t.title)}
            ${t.due ? `<small class="${late ? 'late' : ''}">${esc(E.relDay(t.due, today))}</small>` : '<small>sans échéance</small>'}
          </div></div>`;
      }).join('') : '<div class="none">Rien ici</div>';
      return `<div class="quad ${k}"><h2>${title}</h2><div class="sub">${sub} · ${items.length}</div>${inner}</div>`;
    }).join('');
    return `<p class="matrix-help">Urgent = échéance dans ${d} jour${d > 1 ? 's' : ''} ou moins. La matrice se recalcule automatiquement chaque jour. Marque une tâche ★ importante dans sa fiche.</p>
      <div class="matrix">${quads}</div>`;
  }

  /* ---------- Vue : Abonnements ---------- */
  function renderSubs() {
    if (!state.subs.length) {
      return `<div class="card">${empty('💳', 'Aucun abonnement. Appuie sur <b>+</b> pour suivre tes paiements récurrents (Netflix, téléphone, salle de sport…).')}</div>`;
    }
    const monthly = state.subs.reduce((acc, s) => acc + E.monthlyCost(s), 0);
    const rows = state.subs
      .map((s) => ({ s, date: E.subNextPayment(s, today) }))
      .sort((a, b) => a.date.localeCompare(b.date))
      .map(({ s, date }) => subRow(s, date));
    return `<div class="totals">
        <div class="stat"><b>${E.money(monthly)}</b><span>par mois</span></div>
        <div class="stat"><b>${E.money(monthly * 12)}</b><span>par an</span></div>
      </div>` + section('Prochains paiements', state.subs.length, list(rows));
  }

  /* ---------- Vue : Budget ---------- */
  const CHEVRON_L = '<svg viewBox="0 0 24 24"><path d="m15 18-6-6 6-6"/></svg>';
  const CHEVRON_R = '<svg viewBox="0 0 24 24"><path d="m9 18 6-6-6-6"/></svg>';

  function renderBudget() {
    const tabs = [['month', 'Mois'], ['stats', 'Bilan'], ['subs', 'Abos']]
      .map(([k, l]) => `<button class="seg-btn ${ui.budgetTab === k ? 'on' : ''}" data-btab="${k}">${l}</button>`).join('');
    const body = ui.budgetTab === 'subs' ? renderSubs() : ui.budgetTab === 'stats' ? renderBudgetStats() : renderBudgetMonth();
    return `<div class="seg">${tabs}</div>${body}`;
  }

  const monthNav = (label) => `<div class="month-nav">
      <button class="icon-btn" data-bmonth="-1" aria-label="Mois précédent">${CHEVRON_L}</button>
      <h2>${label}</h2>
      <button class="icon-btn" data-bmonth="1" aria-label="Mois suivant">${CHEVRON_R}</button>
    </div>`;

  function expenseRow(l) {
    const b = l.budget;
    const t = l.total;
    const ratio = b > 0 ? t / b : t > 0 ? 1 : 0;
    const overBy = E.round2(t - b);
    let note = '';
    if (t < 0) note = `<span class="gain">Gain de ${E.money(-t)}</span>`;
    else if (overBy > 0) note = `<span class="late">⚠️ Dépassé de ${E.money(overBy)}</span>`;
    else if (l.cat.auto) note = `<span>${l.pays.length} prélèvement${l.pays.length > 1 ? 's' : ''} prévu${l.pays.length > 1 ? 's' : ''}</span>`;
    return `<div class="row tap" data-bcat="${esc(l.cat.id)}">
      <span class="swatch" style="background:${slotColor(l.cat)}"></span>
      <div class="main">
        <div class="title">${esc(l.cat.name)}${l.cat.auto ? ' <span class="badge">auto</span>' : ''}</div>
        <div class="meter small"><i style="width:${Math.min(100, Math.max(0, ratio * 100))}%;background:${slotColor(l.cat)}"></i></div>
        ${note ? `<div class="meta">${note}</div>` : ''}
      </div>
      <div class="right">${E.money(t)}<small>sur ${E.money(b)}</small></div>
    </div>`;
  }

  function opRow(op) {
    if (op.p) {
      const future = op.p.date > today;
      return `<div class="row tap ${future ? 'future' : ''}" data-edit-sub="${op.p.sub.id}">
        <div class="main"><div class="title">${esc(op.p.sub.name)}</div>
          <div class="meta"><span>${shortDate(op.p.date)}</span><span>Abonnement · ${future ? 'à venir' : 'prélevé'}</span></div></div>
        <div class="right">${signed(-op.p.amount)}</div></div>`;
    }
    const t = op.t;
    const cat = bcatById(t.cat);
    const flow = cat && cat.type === 'income' ? t.amount : -t.amount;
    return `<div class="row tap" ${t.adj ? `data-bcat="${esc(t.cat)}"` : `data-edit-tx="${t.id}"`}>
      <div class="main"><div class="title">${esc(t.label || (cat ? cat.name : 'Sans catégorie'))}</div>
        <div class="meta"><span>${shortDate(t.date)}</span>${cat ? `<span><span class="dot" style="background:${cat.type === 'income' ? 'var(--pos)' : slotColor(cat)}"></span>${esc(cat.name)}</span>` : ''}</div></div>
      <div class="right ${flow > 0 ? 'pos' : ''}">${signed(flow)}</div></div>`;
  }

  function renderBudgetMonth() {
    const ym = ui.budgetMonth;
    const m = E.budgetMonth(state, ym, today);
    const over = m.totalSpent > m.totalBudget;
    const pct = m.totalBudget > 0 ? Math.min(100, (m.totalSpent / m.totalBudget) * 100) : m.totalSpent > 0 ? 100 : 0;

    let html = monthNav(ymLabel(ym));
    html += `<div class="card hero">
      <span class="hero-label">Solde du mois</span>
      <b class="hero-num ${m.balance < 0 ? 'neg' : m.balance > 0 ? 'pos' : ''}">${signed(m.balance)}</b>
      <div class="hero-sub"><span>Revenus <b>${E.money(m.totalIncome)}</b></span><span>Dépenses <b>${E.money(m.totalSpent)}</b></span></div>
      <div class="meter"><i class="${over ? 'over' : ''}" style="width:${pct}%"></i></div>
      <div class="hero-foot">${over
        ? `⚠️ Budget dépassé de <b>${E.money(E.round2(m.totalSpent - m.totalBudget))}</b> (budget ${E.money(m.totalBudget)})`
        : `Reste <b>${E.money(E.round2(m.totalBudget - m.totalSpent))}</b> sur un budget de ${E.money(m.totalBudget)}`}</div>
    </div>`;

    html += section('Revenus', E.money(m.totalIncome), list(m.incomes.map((l) => `<div class="row tap" data-bcat="${esc(l.cat.id)}">
        <div class="main"><div class="title">${esc(l.cat.name)}</div>
          <div class="meta"><span>${l.txs.length} opération${l.txs.length > 1 ? 's' : ''}</span></div></div>
        <div class="right">${E.money(l.total)}</div></div>`)));

    html += section('Dépenses', `${E.money(m.totalSpent)} / ${E.money(m.totalBudget)}`, list(m.expenses.map(expenseRow)));

    // Répartition : une barre empilée + une légende chiffrée (qui sert aussi de tableau).
    const parts = m.expenses.filter((l) => l.total > 0).sort((a, b) => b.total - a.total);
    const tot = parts.reduce((a, l) => a + l.total, 0);
    if (tot > 0) {
      const bar = parts.map((l) => `<i style="flex:${l.total} 1 0;background:${slotColor(l.cat)}"></i>`).join('');
      const legend = parts.map((l) => `<div class="leg-row tap" data-bcat="${esc(l.cat.id)}">
          <span class="swatch" style="background:${slotColor(l.cat)}"></span>
          <span class="leg-name">${esc(l.cat.name)}</span>
          <span class="leg-val">${E.money(l.total)}</span>
          <span class="leg-pct">${Math.round((l.total / tot) * 100)} %</span></div>`).join('');
      html += section('Où part ton argent', null, `<div class="card"><div class="stack" role="img" aria-label="Répartition des dépenses par catégorie">${bar}</div>${legend}</div>`);
    }

    const ops = m.txs.map((t) => ({ date: t.date, t }))
      .concat(m.subPays.map((p) => ({ date: p.date, p })))
      .sort((a, b) => b.date.localeCompare(a.date));
    html += section('Opérations', ops.length || null, ops.length
      ? list(ops.map(opRow))
      : `<div class="card">${empty('🧾', 'Aucune opération ce mois-ci. Appuie sur <b>+</b> pour ajouter une dépense ou un revenu.')}</div>`);
    return html;
  }

  // Barres groupées Revenus / Dépenses par mois (un seul axe, en euros).
  function barChart(data) {
    const W = 340, H = 170, top = 12, bottom = 22, left = 4, right = 4;
    const max = Math.max(1, ...data.map((d) => Math.max(d.totalIncome, d.totalSpent)));
    const step = Math.pow(10, Math.floor(Math.log10(max)));
    const niceMax = Math.ceil(max / step) * step;
    const y = (v) => top + (H - top - bottom) * (1 - Math.max(0, v) / niceMax);
    const base = y(0);
    const gw = (W - left - right) / data.length;
    const bw = Math.min(16, gw * 0.32);
    const barPath = (x, v) => {
      const h = base - y(v);
      if (h <= 0.5) return '';
      const r = Math.min(4, bw / 2, h);
      return `M${x},${base}V${base - h + r}Q${x},${base - h} ${x + r},${base - h}H${x + bw - r}Q${x + bw},${base - h} ${x + bw},${base - h + r}V${base}Z`;
    };
    const sel = ui.statsSel == null ? data.length - 1 : ui.statsSel;
    let g = [0.5, 1].map((f) => {
      const yy = y(niceMax * f);
      return `<line x1="${left}" x2="${W - right}" y1="${yy}" y2="${yy}" style="stroke:var(--line);stroke-width:1"/>
        <text x="${left}" y="${yy - 3}" class="tick">${E.money(niceMax * f).replace(',00', '')}</text>`;
    }).join('');
    data.forEach((d, i) => {
      const gx = left + i * gw;
      const cx = gx + gw / 2;
      if (i === sel) g += `<rect x="${gx + 2}" y="${top - 6}" width="${gw - 4}" height="${base - top + 6}" rx="6" style="fill:var(--surface-2)"/>`;
      g += `<path d="${barPath(cx - bw - 1, d.totalIncome)}" style="fill:var(--c1)"/>`;
      g += `<path d="${barPath(cx + 1, d.totalSpent)}" style="fill:var(--c2)"/>`;
      g += `<text x="${cx}" y="${H - 6}" text-anchor="middle" class="tick ${i === sel ? 'sel' : ''}">${E.parse(d.ym + '-01').toLocaleDateString('fr-FR', { month: 'short' }).replace('.', '')}</text>`;
      g += `<rect x="${gx}" y="0" width="${gw}" height="${H}" style="fill:transparent;cursor:pointer" data-bar="${i}"/>`;
    });
    g += `<line x1="${left}" x2="${W - right}" y1="${base}" y2="${base}" style="stroke:var(--muted);stroke-width:1;opacity:.5"/>`;
    const d = data[sel];
    const tip = `<div class="tip"><b>${ymLabel(d.ym)}</b>
      <span><i class="sw" style="background:var(--c1)"></i>Revenus ${E.money(d.totalIncome)}</span>
      <span><i class="sw" style="background:var(--c2)"></i>Dépenses ${E.money(d.totalSpent)}</span>
      <span>Solde <b class="${d.balance < 0 ? 'neg' : d.balance > 0 ? 'pos' : ''}">${signed(d.balance)}</b></span></div>`;
    return `<div class="card chart">
      <div class="chart-legend"><span><i class="sw" style="background:var(--c1)"></i>Revenus</span><span><i class="sw" style="background:var(--c2)"></i>Dépenses</span></div>
      ${tip}
      <svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Revenus et dépenses par mois">${g}</svg>
    </div>`;
  }

  function renderBudgetStats() {
    const n = ui.statsRange;
    const months = [];
    for (let i = n - 1; i >= 0; i--) months.push(E.addMonthsYm(ui.budgetMonth, -i));
    const data = months.map((ym) => E.budgetMonth(state, ym, today));
    const active = data.filter((d) => d.totalIncome || d.totalSpent);
    const avg = (f) => (active.length ? E.round2(active.reduce((a, d) => a + f(d), 0) / active.length) : 0);
    const cumul = E.round2(data.reduce((a, d) => a + d.balance, 0));

    const chips = [[3, '3 mois'], [6, '6 mois'], [12, '12 mois']]
      .map(([k, l]) => `<button class="chip ${n === k ? 'on' : ''}" data-range="${k}">${l}</button>`).join('');
    let html = monthNav(`${E.parse(months[0] + '-01').toLocaleDateString('fr-FR', { month: 'short', year: '2-digit' })} → ${E.parse(months[n - 1] + '-01').toLocaleDateString('fr-FR', { month: 'short', year: '2-digit' })}`);
    html += `<div class="chips">${chips}</div>`;
    html += `<div class="stats money">
      <div class="stat"><b class="${cumul < 0 ? 'neg' : cumul > 0 ? 'pos' : ''}">${signed(cumul)}</b><span>Solde cumulé</span></div>
      <div class="stat"><b>${E.money(avg((d) => d.totalIncome))}</b><span>Revenus / mois</span></div>
      <div class="stat"><b>${E.money(avg((d) => d.totalSpent))}</b><span>Dépenses / mois</span></div>
    </div>`;
    html += barChart(data);

    html += section('Mois par mois', null, `<div class="card"><table class="tbl">
      <thead><tr><th>Mois</th><th>Revenus</th><th>Dépenses</th><th>Solde</th></tr></thead>
      <tbody>${data.slice().reverse().map((d) => `<tr class="tap" data-goto-month="${d.ym}">
        <td>${E.parse(d.ym + '-01').toLocaleDateString('fr-FR', { month: 'short', year: '2-digit' })}</td>
        <td>${E.money(d.totalIncome)}</td><td>${E.money(d.totalSpent)}</td>
        <td class="${d.balance < 0 ? 'neg' : d.balance > 0 ? 'pos' : ''}">${signed(d.balance)}</td></tr>`).join('')}</tbody>
    </table></div>`);

    const expCats = state.budgetCats.filter((c) => c.type === 'expense');
    const last = data[data.length - 1];
    const rows = expCats.map((c) => {
      const a = avg((d) => (d.expenses.find((l) => l.cat.id === c.id) || { total: 0 }).total);
      const b = (last.expenses.find((l) => l.cat.id === c.id) || { budget: 0 }).budget;
      return { c, a, b };
    }).sort((x, y) => y.a - x.a);
    html += section('Moyenne par catégorie', null, `<div class="card"><table class="tbl">
      <thead><tr><th>Catégorie</th><th>Moy. / mois</th><th>Budget</th></tr></thead>
      <tbody>${rows.map(({ c, a, b }) => `<tr><td><span class="swatch inline" style="background:${slotColor(c)}"></span>${esc(c.name)}</td>
        <td class="${a > b ? 'neg' : ''}">${a > b ? '⚠️ ' : ''}${E.money(a)}</td><td>${E.money(b)}</td></tr>`).join('')}</tbody>
    </table><p class="matrix-help" style="margin:10px 0 0">Moyenne calculée sur les mois où tu as saisi des opérations.</p></div>`);
    return html;
  }

  /* ---------- Vue : Calendrier ---------- */
  function calendarItems(start, end) {
    const map = {};
    const add = (d, item) => { (map[d] = map[d] || []).push(item); };
    state.tasks.forEach((t) => { if (t.due && t.due >= start && t.due <= end) add(t.due, { type: 'task', t }); });
    state.subs.forEach((s) => {
      E.occurrencesBetween(s.anchor, s.freq, start, end).forEach((d) => add(d, { type: 'pay', s }));
      if (s.trialEnd && s.trialEnd >= start && s.trialEnd <= end) add(s.trialEnd, { type: 'trial', s });
    });
    return map;
  }

  function renderCalendar() {
    const first = ui.calMonth;
    const f = E.parse(first);
    const offset = (f.getDay() + 6) % 7;
    const dim = new Date(f.getFullYear(), f.getMonth() + 1, 0).getDate();
    const cells = Math.ceil((offset + dim) / 7) * 7;
    const start = E.addDays(first, -offset);
    const end = E.addDays(start, cells - 1);
    const items = calendarItems(start, end);
    const month = f.toLocaleDateString('fr-FR', { month: 'long', year: 'numeric' });

    let grid = ['L', 'M', 'M', 'J', 'V', 'S', 'D'].map((d) => `<div class="dow">${d}</div>`).join('');
    for (let i = 0; i < cells; i++) {
      const d = E.addDays(start, i);
      const its = items[d] || [];
      const dots = its.slice(0, 4).map((it) => it.type === 'task'
        ? `<i style="background:${it.t.done ? 'var(--line)' : safeColor((catById(it.t.cat) || {}).color || '#4f46e5')}"></i>`
        : '<i class="pay"></i>').join('');
      const cls = [E.parse(d).getMonth() !== f.getMonth() ? 'other' : '', d === today ? 'today' : '', d === ui.calSel ? 'sel' : ''].join(' ');
      grid += `<button class="cal-day ${cls}" data-day="${d}" aria-label="${d}"><span class="num">${E.parse(d).getDate()}</span><span class="dots">${dots}</span></button>`;
    }

    const sel = ui.calSel;
    const selItems = calendarItems(sel, sel)[sel] || [];
    const selLabel = E.parse(sel).toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' });
    const rows = selItems.map((it) => {
      if (it.type === 'task') return taskRow(it.t);
      if (it.type === 'pay') return subRow(it.s, sel);
      return `<div class="row"><div class="main" data-edit-sub="${it.s.id}"><div class="title">⏳ Fin de l'essai : ${esc(it.s.name)}</div><div class="meta"><span>Pense à résilier si besoin</span></div></div></div>`;
    });

    return `<div class="card">
        <div class="cal-head">
          <button class="icon-btn" data-cal-nav="-1" aria-label="Mois précédent"><svg viewBox="0 0 24 24"><path d="m15 18-6-6 6-6"/></svg></button>
          <h2>${month}</h2>
          <button class="icon-btn" data-cal-nav="1" aria-label="Mois suivant"><svg viewBox="0 0 24 24"><path d="m9 18 6-6-6-6"/></svg></button>
        </div>
        <div class="cal-grid">${grid}</div>
        <div class="legend"><span><i></i>Tâche</span><span><i class="pay"></i>Paiement</span></div>
      </div>` +
      section(selLabel, selItems.length || null, rows.length ? list(rows) : `<div class="card">${empty('🌤️', 'Rien de prévu ce jour-là.')}</div>`);
  }

  /* ---------- Vue : Réglages ---------- */
  function renderSettings() {
    const s = state.settings;
    const p = ui.push || {};
    const numSelect = (key, max) => `<select data-setting="${key}">${Array.from({ length: max + 1 }, (_, i) => i)
      .map((i) => `<option value="${i}" ${s[key] === i ? 'selected' : ''}>${i} jour${i > 1 ? 's' : ''}</option>`).join('')}</select>`;

    let status;
    if (!p.supported) status = '<span class="status warn">Notifications non disponibles sur ce navigateur</span>';
    else if (p.permission === 'denied') status = '<span class="status warn">Notifications bloquées dans les réglages du téléphone</span>';
    else if (p.changed) status = '<span class="status warn">Abonnement modifié : recopie la configuration dans GitHub</span>';
    else if (p.config) status = '<span class="status ok">Notifications activées sur ce téléphone</span>';
    else status = '<span class="status">Notifications pas encore activées</span>';

    const notif = `<div class="card">
      <h3>🔔 Résumé du matin (8h)</h3>
      ${status}
      <p>Chaque matin, GitHub envoie un « réveil » à ton téléphone, qui affiche le résumé construit avec tes données (elles ne quittent jamais le téléphone).</p>
      ${p.config ? `<p><b>Étape 2 :</b> copie ce texte dans le secret GitHub <code>PUSH_CONFIG</code> (voir le guide README).</p>
        <pre class="config">${esc(p.config)}</pre>` : ''}
      <div class="btns">
        ${p.supported && !p.config ? '<button class="btn primary small" data-action="enable-push">1. Activer les notifications</button>' : ''}
        ${p.supported && p.changed ? '<button class="btn primary small" data-action="enable-push">Mettre à jour</button>' : ''}
        ${p.config ? '<button class="btn primary small" data-action="copy-config">Copier la configuration</button>' : ''}
        ${p.supported ? '<button class="btn small" data-action="test-notif">Tester le résumé</button>' : ''}
      </div>
    </div>`;

    const rules = `<div class="card">
      <h3>⏱️ Matrice et rappels</h3>
      <label class="field"><span>Une tâche devient urgente à moins de…</span>${numSelect('urgentDays', 14)}</label>
      <label class="field"><span>Le résumé annonce les tâches à venir dans…</span>${numSelect('soonDays', 14)}</label>
      <label class="field"><span>Prévenir d'un paiement d'abonnement…</span>${numSelect('paymentAlertDays', 14)}<small>0 = seulement le jour même</small></label>
      <label class="field"><span>Prévenir de la fin d'un essai gratuit…</span>${numSelect('trialAlertDays', 14)}</label>
    </div>`;

    const cats = `<div class="card">
      <h3>🏷️ Catégories des tâches</h3>
      ${state.categories.map((c) => `<div class="cat-row">
        <input type="color" value="${safeColor(c.color)}" data-cat-color="${esc(c.id)}" aria-label="Couleur">
        <input type="text" value="${esc(c.name)}" data-cat-name="${esc(c.id)}" aria-label="Nom">
        <button class="icon-btn" data-action="del-cat" data-id="${esc(c.id)}" aria-label="Supprimer"><svg viewBox="0 0 24 24"><path d="M18 6 6 18M6 6l12 12"/></svg></button>
      </div>`).join('')}
      <div class="btns" style="margin-top:8px"><button class="btn small" data-action="add-cat">+ Ajouter une catégorie</button></div>
    </div>`;

    const bcatRows = (type) => state.budgetCats.filter((c) => c.type === type).map((c) => `<div class="cat-row">
        <span class="swatch" style="background:${type === 'income' ? 'var(--pos)' : slotColor(c)}"></span>
        <input type="text" value="${esc(c.name)}" data-bcat-name="${esc(c.id)}" aria-label="Nom">
        ${c.auto ? '<span class="badge" title="Calculée à partir de tes abonnements">auto</span>'
          : `<button class="icon-btn" data-action="del-bcat" data-id="${esc(c.id)}" aria-label="Supprimer"><svg viewBox="0 0 24 24"><path d="M18 6 6 18M6 6l12 12"/></svg></button>`}
      </div>`).join('');
    const bcats = `<div class="card">
      <h3>💰 Catégories du budget</h3>
      <p>Pour régler le budget d'une catégorie, va dans Budget et touche-la.</p>
      <div class="sub-h">Revenus</div>${bcatRows('income')}
      <div class="btns" style="margin:8px 0 14px"><button class="btn small" data-action="add-bcat" data-type="income">+ Revenu</button></div>
      <div class="sub-h">Dépenses</div>${bcatRows('expense')}
      <div class="btns" style="margin-top:8px"><button class="btn small" data-action="add-bcat" data-type="expense">+ Dépense</button></div>
    </div>`;

    const data = `<div class="card">
      <h3>💾 Sauvegarde</h3>
      <p>Tes données sont stockées uniquement sur ce téléphone. Exporte-les régulièrement pour ne rien perdre.</p>
      <div class="btns">
        <button class="btn small" data-action="export">Exporter</button>
        <button class="btn small" data-action="import">Importer</button>
        <button class="btn small danger" data-action="wipe">Tout effacer</button>
      </div>
      <input type="file" id="import-file" accept="application/json,.json" hidden>
    </div>`;

    return `<div class="settings">
      <button class="back" data-action="back"><svg viewBox="0 0 24 24"><path d="m15 18-6-6 6-6"/></svg>Retour</button>
      ${notif}${rules}${cats}${bcats}${data}
      <p class="matrix-help" style="text-align:center">Échéances · v2</p>
    </div>`;
  }

  /* ---------- Rendu principal ---------- */
  function render() {
    const R = { today: renderToday, tasks: renderTasks, matrix: renderMatrix, budget: renderBudget, calendar: renderCalendar, settings: renderSettings };
    $('#view').innerHTML = R[view]();
    $('#view-title').textContent = TITLES[view];
    document.querySelectorAll('#tabbar button').forEach((b) => b.classList.toggle('active', b.dataset.view === view));
    $('#fab').hidden = view === 'settings';
    $('#fab').setAttribute('aria-label', view !== 'budget' ? 'Ajouter une tâche'
      : ui.budgetTab === 'subs' ? 'Ajouter un abonnement' : 'Ajouter une dépense ou un revenu');
  }

  function setView(v) {
    if (v === 'settings' && view !== 'settings') history.pushState({ settings: true }, '');
    if (v !== 'settings' && view === 'settings' && history.state && history.state.settings) {
      view = v; history.back(); render(); return;
    }
    view = v;
    render();
    window.scrollTo(0, 0);
  }

  /* ---------- Feuilles (formulaires) ---------- */
  const sheet = $('#sheet');
  function openSheet(html) {
    sheet.innerHTML = `<div class="grab"></div>${html}`;
    if (!sheet.open) {
      sheet.showModal();
      history.pushState({ sheet: true }, '');
    }
    sheet.scrollTop = 0;
    const first = sheet.querySelector('input[autofocus]');
    if (first && !first.value) first.focus();
  }
  function closeSheet() { if (sheet.open) sheet.close(); }
  sheet.addEventListener('close', () => { if (history.state && history.state.sheet) history.back(); });
  sheet.addEventListener('click', (e) => { if (e.target === sheet) closeSheet(); });
  window.addEventListener('popstate', () => {
    if (sheet.open) { sheet.close(); return; }
    if (view === 'settings') { view = 'today'; render(); }
  });

  const catOptions = (sel) => `<option value="">Aucune</option>` +
    state.categories.map((c) => `<option value="${esc(c.id)}" ${c.id === sel ? 'selected' : ''}>${esc(c.name)}</option>`).join('');

  function openTaskForm(id, defaults) {
    const t = state.tasks.find((x) => x.id === id) || Object.assign({ title: '', due: '', time: '', important: false, cat: '', repeat: 'none', notes: '' }, defaults);
    openSheet(`<form id="task-form" data-id="${id || ''}">
      <h2>${id ? 'Modifier la tâche' : 'Nouvelle tâche'}</h2>
      <label class="field"><span>Titre</span><input name="title" required maxlength="200" value="${esc(t.title)}" placeholder="Ex. : Renouveler mon passeport" autofocus></label>
      <div class="grid2">
        <label class="field"><span>Échéance</span><input type="date" name="due" value="${esc(t.due)}"></label>
        <label class="field"><span>Heure (option)</span><input type="time" name="time" value="${esc(t.time)}"></label>
      </div>
      <label class="toggle"><div><b>★ Importante</b><small>Compte vraiment pour toi (l'urgence est calculée selon l'échéance)</small></div>
        <input type="checkbox" class="switch" name="important" ${t.important ? 'checked' : ''}></label>
      <div class="grid2">
        <label class="field"><span>Catégorie</span><select name="cat">${catOptions(t.cat)}</select></label>
        <label class="field"><span>Répétition</span><select name="repeat">${Object.entries(REPEAT)
          .map(([k, l]) => `<option value="${k}" ${t.repeat === k ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
      </div>
      <label class="field"><span>Notes</span><textarea name="notes" maxlength="2000">${esc(t.notes)}</textarea></label>
      <div class="actions">
        ${id ? '<button type="button" class="btn danger" data-action="delete-task">Supprimer</button>' : '<button type="button" class="btn" data-action="close-sheet">Annuler</button>'}
        <button class="btn primary">Enregistrer</button>
      </div>
    </form>`);
  }

  function saveTaskForm(form) {
    const fd = new FormData(form);
    const id = form.dataset.id;
    const data = {
      title: fd.get('title').trim(),
      due: fd.get('due') || '',
      time: fd.get('time') || '',
      important: fd.get('important') === 'on',
      cat: fd.get('cat') || '',
      repeat: fd.get('repeat') || 'none',
      notes: fd.get('notes').trim(),
    };
    if (!data.title) return;
    if (data.repeat !== 'none' && !data.due) data.due = today;
    if (id) {
      const t = state.tasks.find((x) => x.id === id);
      if (data.due !== t.due || data.repeat !== t.repeat) data.anchor = data.due;
      Object.assign(t, data);
    } else {
      state.tasks.push(Object.assign({ id: uid(), done: false, createdAt: new Date().toISOString(), anchor: data.due }, data));
    }
    save(); closeSheet(); render();
    toast(id ? 'Tâche modifiée' : 'Tâche ajoutée');
  }

  function openSubForm(id) {
    const s = state.subs.find((x) => x.id === id) || { name: '', amount: '', freq: 'monthly', anchor: today, cat: '', trialEnd: '', notes: '' };
    const next = id ? E.subNextPayment(s, today) : s.anchor;
    openSheet(`<form id="sub-form" data-id="${id || ''}" data-next="${next}">
      <h2>${id ? "Modifier l'abonnement" : 'Nouvel abonnement'}</h2>
      <label class="field"><span>Nom</span><input name="name" required maxlength="100" value="${esc(s.name)}" placeholder="Ex. : Netflix" autofocus></label>
      <div class="grid2">
        <label class="field"><span>Montant (€)</span><input type="number" name="amount" required min="0" step="0.01" inputmode="decimal" value="${esc(s.amount)}"></label>
        <label class="field"><span>Fréquence</span><select name="freq">${Object.entries(FREQ)
          .map(([k, l]) => `<option value="${k}" ${s.freq === k ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
      </div>
      <label class="field"><span>Prochain paiement</span><input type="date" name="anchor" required value="${esc(next)}">
        <small>Les paiements suivants sont calculés automatiquement.</small></label>
      <label class="field"><span>Fin de l'essai gratuit (option)</span><input type="date" name="trialEnd" value="${esc(s.trialEnd)}">
        <small>Tu seras prévenu avant la fin de l'essai pour résilier à temps.</small></label>
      <label class="field"><span>Catégorie</span><select name="cat">${catOptions(s.cat)}</select></label>
      <label class="field"><span>Notes</span><textarea name="notes" maxlength="2000" placeholder="Ex. : résiliation sur le site, rubrique Compte">${esc(s.notes)}</textarea></label>
      <div class="actions">
        ${id ? '<button type="button" class="btn danger" data-action="delete-sub">Supprimer</button>' : '<button type="button" class="btn" data-action="close-sheet">Annuler</button>'}
        <button class="btn primary">Enregistrer</button>
      </div>
    </form>`);
  }

  function saveSubForm(form) {
    const fd = new FormData(form);
    const id = form.dataset.id;
    const data = {
      name: fd.get('name').trim(),
      amount: Math.round(parseFloat(String(fd.get('amount')).replace(',', '.')) * 100) / 100 || 0,
      freq: fd.get('freq'),
      cat: fd.get('cat') || '',
      trialEnd: fd.get('trialEnd') || '',
      notes: fd.get('notes').trim(),
    };
    const anchor = fd.get('anchor');
    if (!data.name || !anchor) return;
    if (id) {
      const s = state.subs.find((x) => x.id === id);
      // On garde la date d'origine si l'utilisateur n'a pas touché au champ (préserve le jour du mois, ex. le 31).
      if (anchor !== form.dataset.next || data.freq !== s.freq) data.anchor = anchor;
      Object.assign(s, data);
    } else {
      state.subs.push(Object.assign({ id: uid(), anchor }, data));
    }
    save(); closeSheet(); render();
    toast(id ? 'Abonnement modifié' : 'Abonnement ajouté');
  }

  /* ---------- Formulaires du budget ---------- */
  const bcatOptions = (type, sel) => state.budgetCats.filter((c) => c.type === type)
    .map((c) => `<option value="${esc(c.id)}" ${c.id === sel ? 'selected' : ''}>${esc(c.name)}</option>`).join('');

  function defaultTxDate() {
    return ui.budgetMonth === today.slice(0, 7) ? today : ui.budgetMonth + '-01';
  }

  function openTxForm(id, defaults) {
    defaults = defaults || {};
    const t = state.transactions.find((x) => x.id === id);
    const cat = t ? bcatById(t.cat) : null;
    const type = cat ? cat.type : defaults.type || 'expense';
    const sel = t ? t.cat : defaults.cat || ui.lastTxCat[type];
    openSheet(`<form id="tx-form" data-id="${id || ''}">
      <h2>${id ? "Modifier l'opération" : 'Nouvelle opération'}</h2>
      <div class="seg">
        <label class="seg-btn"><input type="radio" name="type" value="expense" ${type === 'expense' ? 'checked' : ''}>Dépense</label>
        <label class="seg-btn"><input type="radio" name="type" value="income" ${type === 'income' ? 'checked' : ''}>Revenu</label>
      </div>
      <label class="field"><span>Montant (€)</span><input type="number" name="amount" required min="0.01" step="0.01" inputmode="decimal" value="${t ? Math.abs(t.amount) : ''}" placeholder="0,00" autofocus></label>
      <label class="field"><span>Catégorie</span><select name="cat" required>${bcatOptions(type, sel)}</select></label>
      <label class="field"><span>Libellé (option)</span><input name="label" maxlength="100" value="${esc(t ? t.label : '')}" placeholder="Ex. : Kebab avec les potes"></label>
      <label class="field"><span>Date</span><input type="date" name="date" required value="${t ? t.date : defaults.date || defaultTxDate()}"></label>
      <label class="toggle" id="gain-toggle" ${type === 'income' ? 'hidden' : ''}>
        <div><b>Gain ou remboursement</b><small>Réduit les dépenses de la catégorie (ex. : gain au Gamble, un pote qui te rembourse)</small></div>
        <input type="checkbox" class="switch" name="gain" ${t && cat && cat.type === 'expense' && t.amount < 0 ? 'checked' : ''}></label>
      <div class="actions">
        ${id ? '<button type="button" class="btn danger" data-action="delete-tx">Supprimer</button>' : '<button type="button" class="btn" data-action="close-sheet">Annuler</button>'}
        <button class="btn primary">Enregistrer</button>
      </div>
    </form>`);
  }

  function saveTxForm(form) {
    const fd = new FormData(form);
    const id = form.dataset.id;
    const type = fd.get('type');
    let amount = parseAmount(fd.get('amount'));
    if (!(amount > 0)) { toast('Indique un montant supérieur à 0'); return; }
    const cat = fd.get('cat');
    if (!cat) { toast('Crée d’abord une catégorie dans les Réglages'); return; }
    if (type === 'expense' && fd.get('gain') === 'on') amount = -amount;
    const data = { date: fd.get('date'), cat, amount, label: fd.get('label').trim() };
    if (id) Object.assign(state.transactions.find((x) => x.id === id), data);
    else state.transactions.push(Object.assign({ id: uid() }, data));
    ui.lastTxCat[type] = cat;
    ui.budgetMonth = data.date.slice(0, 7);
    save(); closeSheet(); render();
    toast(id ? 'Opération modifiée' : type === 'income' ? 'Revenu ajouté' : 'Dépense ajoutée');
  }

  function openBudgetCat(id) {
    const ym = ui.budgetMonth;
    const m = E.budgetMonth(state, ym, today);
    const l = m.incomes.concat(m.expenses).find((x) => x.cat.id === id);
    if (!l) return;
    const cat = l.cat;
    const raw = E.budgetAt(cat, ym, state.budgetOverrides);
    const autoSum = E.round2(l.pays.reduce((a, p) => a + p.amount, 0));
    const ops = l.txs.map((t) => ({ date: t.date, t })).concat(l.pays.map((p) => ({ date: p.date, p })))
      .sort((a, b) => b.date.localeCompare(a.date));
    openSheet(`<form id="bcat-form" data-id="${esc(id)}" data-budget="${raw == null ? '' : raw}">
      <h2>${esc(cat.name)}</h2>
      <p class="sheet-sub">${ymLabel(ym)}</p>
      ${cat.type === 'expense' ? `
        <label class="field"><span>Budget du mois (€)</span>
          <input type="number" name="budget" min="0" step="0.01" inputmode="decimal" value="${raw == null ? '' : raw}" placeholder="${cat.auto ? 'Auto : ' + E.money(autoSum) : '0,00'}">
          ${cat.auto ? '<small>Laisse vide pour utiliser automatiquement la somme de tes abonnements du mois.</small>' : ''}</label>
        <div class="radios">
          <label><input type="radio" name="scope" value="forward" checked> Ce mois-ci et les mois suivants</label>
          <label><input type="radio" name="scope" value="month"> Ce mois-ci seulement</label>
        </div>` : ''}
      <label class="field"><span>Total du mois (€)</span>
        <input type="number" name="total" step="0.01" inputmode="decimal" value="${l.total}">
        <small>Tu peux corriger directement le total, comme dans ton Excel : la différence est enregistrée comme un ajustement.</small></label>
      ${ops.length ? `<div class="sub-h">Opérations</div>${list(ops.map(opRow))}` : ''}
      <div class="actions">
        <button type="button" class="btn" data-action="add-tx-cat" data-type="${cat.type}">+ Opération</button>
        <button class="btn primary">Enregistrer</button>
      </div>
    </form>`);
  }

  function saveBudgetCat(form) {
    const fd = new FormData(form);
    const id = form.dataset.id;
    const ym = ui.budgetMonth;
    const cat = bcatById(id);

    if (cat.type === 'expense' && fd.get('budget') !== form.dataset.budget) {
      const v = String(fd.get('budget')).trim();
      const val = v === '' ? (cat.auto ? null : 0) : parseAmount(v);
      const ov = state.budgetOverrides;
      if (fd.get('scope') === 'month') {
        ov[ym] = ov[ym] || {};
        if (v === '' && cat.auto) delete ov[ym][id]; else ov[ym][id] = val;
      } else {
        cat.budgets = (cat.budgets || []).filter((b) => b.from < ym).concat({ from: ym, amount: val });
        Object.keys(ov).forEach((k) => { if (k >= ym) delete ov[k][id]; });
      }
    }

    const newTotal = parseAmount(fd.get('total'));
    if (!Number.isNaN(newTotal)) {
      const m = E.budgetMonth(state, ym, today);
      const cur = m.incomes.concat(m.expenses).find((x) => x.cat.id === id).total;
      const diff = E.round2(newTotal - cur);
      if (diff !== 0) {
        const adj = state.transactions.find((t) => t.adj && t.cat === id && t.date.slice(0, 7) === ym);
        if (adj) {
          adj.amount = E.round2(adj.amount + diff);
          if (adj.amount === 0) state.transactions = state.transactions.filter((t) => t !== adj);
        } else {
          const date = ym === today.slice(0, 7) ? today : ym < today.slice(0, 7) ? E.monthEnd(ym) : ym + '-01';
          state.transactions.push({ id: uid(), date, cat: id, amount: diff, label: 'Ajustement manuel', adj: true });
        }
      }
    }
    save(); closeSheet(); render();
    toast('Catégorie mise à jour');
  }

  /* ---------- Actions ---------- */
  let toastTimer;
  function toast(msg, undo) {
    const el = $('#toast');
    el.innerHTML = `<span>${esc(msg)}</span>${undo ? '<button type="button">Annuler</button>' : ''}`;
    if (undo) el.querySelector('button').onclick = () => { undo(); el.classList.remove('show'); };
    el.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.remove('show'), undo ? 5000 : 2200);
  }

  function snapshotUndo(key) {
    key = key || 'tasks';
    const snap = JSON.stringify(state[key]);
    return () => { state[key] = JSON.parse(snap); save(); render(); };
  }

  function toggleTask(id) {
    const t = state.tasks.find((x) => x.id === id);
    if (!t) return;
    const undo = snapshotUndo();
    if (t.done) {
      t.done = false; t.doneAt = null;
      save(); render();
      return;
    }
    t.done = true;
    t.doneAt = new Date().toISOString();
    let msg = 'Bravo, tâche terminée !';
    if (t.repeat && t.repeat !== 'none' && t.due) {
      const anchor = t.anchor || t.due;
      // prochaine occurrence après l'échéance actuelle ET après aujourd'hui
      const due = E.nextOccurrence(anchor, t.repeat, maxStr(E.addDays(t.due, 1), E.addDays(today, 1)));
      state.tasks.push(Object.assign({}, t, { id: uid(), done: false, doneAt: null, due, anchor, createdAt: new Date().toISOString() }));
      msg = `Fait ! Prochaine fois : ${E.relDay(due, today)}`;
    }
    save();
    setTimeout(render, 180); // laisse voir la coche
    toast(msg, undo);
  }

  /* ---------- Notifications push ---------- */
  const b64url = (buf) => btoa(String.fromCharCode.apply(null, new Uint8Array(buf)))
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  const fromB64url = (s) => {
    s = s.replace(/-/g, '+').replace(/_/g, '/');
    while (s.length % 4) s += '=';
    return Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
  };

  // Clés VAPID générées sur le téléphone : pas besoin d'installer quoi que ce soit sur un ordinateur.
  async function getVapidKeys() {
    let keys = await E.kvGet('vapid');
    if (keys && keys.publicKey) return keys;
    const kp = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
    const pub = await crypto.subtle.exportKey('raw', kp.publicKey);
    const jwk = await crypto.subtle.exportKey('jwk', kp.privateKey);
    keys = { publicKey: b64url(pub), privateKey: jwk.d };
    await E.kvSet('vapid', keys);
    return keys;
  }

  async function refreshPushStatus() {
    const supported = 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
    ui.push = { supported, permission: supported ? Notification.permission : 'denied' };
    if (!supported) return;
    const saved = await E.kvGet('pushConfig');
    const reg = await Promise.race([navigator.serviceWorker.ready, new Promise((r) => setTimeout(r, 4000))]);
    if (!reg) { ui.push.supported = false; return; }
    const sub = await reg.pushManager.getSubscription();
    if (saved) {
      ui.push.config = saved;
      ui.push.changed = !sub || JSON.parse(saved).subscription.endpoint !== sub.endpoint;
    }
  }

  async function enablePush() {
    try {
      const perm = await Notification.requestPermission();
      if (perm !== 'granted') {
        toast('Notifications refusées : autorise-les dans les paramètres Android de l’app.');
        await refreshPushStatus(); render();
        return;
      }
      const reg = await navigator.serviceWorker.ready;
      const keys = await getVapidKeys();
      let sub = await reg.pushManager.getSubscription();
      if (sub && sub.options.applicationServerKey && b64url(sub.options.applicationServerKey) !== keys.publicKey) {
        await sub.unsubscribe(); sub = null;
      }
      if (!sub) sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: fromB64url(keys.publicKey) });
      const config = JSON.stringify({
        subject: location.protocol === 'https:' ? location.origin : 'mailto:echeances@localhost.invalid',
        publicKey: keys.publicKey,
        privateKey: keys.privateKey,
        subscription: sub.toJSON(),
      });
      await E.kvSet('pushConfig', config);
      await refreshPushStatus(); render();
      toast('Notifications activées. Copie maintenant la configuration.');
    } catch (err) {
      console.error(err);
      toast('Impossible d’activer les notifications : ' + err.message);
    }
  }

  async function testNotification() {
    if (Notification.permission !== 'granted') {
      const perm = await Notification.requestPermission();
      if (perm !== 'granted') { toast('Autorise d’abord les notifications.'); return; }
    }
    const reg = await navigator.serviceWorker.ready;
    reg.active.postMessage('test-summary');
    toast('Notification envoyée');
  }

  /* ---------- Sauvegarde ---------- */
  function exportData() {
    const payload = { app: 'echeances', version: 2, exportedAt: new Date().toISOString(),
      tasks: state.tasks, subs: state.subs, categories: state.categories, settings: state.settings,
      budgetCats: state.budgetCats, transactions: state.transactions, budgetOverrides: state.budgetOverrides };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `echeances-sauvegarde-${today}.json`;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    toast('Sauvegarde exportée');
  }

  async function importData(file) {
    try {
      const data = JSON.parse(await file.text());
      if (data.app !== 'echeances' || !Array.isArray(data.tasks) || !Array.isArray(data.subs)) throw new Error('format');
      const nTx = (data.transactions || []).length;
      if (!confirm(`Remplacer tes données actuelles par cette sauvegarde (${data.tasks.length} tâches, ${data.subs.length} abonnements, ${nTx} opérations de budget) ?`)) return;
      state = withDefaults({ tasks: data.tasks, subs: data.subs, categories: data.categories, settings: data.settings,
        budgetCats: data.budgetCats, transactions: data.transactions, budgetOverrides: data.budgetOverrides });
      await save(); render();
      toast('Sauvegarde importée');
    } catch (e) {
      toast("Ce fichier n'est pas une sauvegarde Échéances valide.");
    }
  }

  /* ---------- Événements ---------- */
  document.addEventListener('click', (e) => {
    const el = e.target.closest('[data-view], [data-view-link], [data-edit-task], [data-edit-sub], [data-edit-tx], [data-bcat], [data-btab], [data-bmonth], [data-range], [data-bar], [data-goto-month], [data-filter], [data-cat], [data-cal-nav], [data-day], [data-action], #btn-settings, #fab');
    if (!el) return;
    const d = el.dataset;

    if (el.id === 'btn-settings') return setView('settings');
    if (el.id === 'fab') {
      if (view === 'budget') return ui.budgetTab === 'subs' ? openSubForm() : openTxForm();
      return openTaskForm(null, view === 'calendar' ? { due: ui.calSel } : {});
    }
    if (d.view) return setView(d.view);
    if (d.viewLink) return setView(d.viewLink);
    if (d.editTask) return openTaskForm(d.editTask);
    if (d.editSub) return openSubForm(d.editSub);
    if (d.filter) { ui.taskFilter = d.filter; return render(); }
    if (d.cat) { ui.taskCat = d.cat; return render(); }
    if (d.calNav) { ui.calMonth = E.addMonths(ui.calMonth, Number(d.calNav)); return render(); }
    if (d.editTx) return openTxForm(d.editTx);
    if (d.bcat) return openBudgetCat(d.bcat);
    if (d.btab) { ui.budgetTab = d.btab; return render(); }
    if (d.bmonth) { ui.budgetMonth = E.addMonthsYm(ui.budgetMonth, Number(d.bmonth)); ui.statsSel = null; return render(); }
    if (d.range) { ui.statsRange = Number(d.range); ui.statsSel = null; return render(); }
    if (d.bar) { ui.statsSel = Number(d.bar); return render(); }
    if (d.gotoMonth) { ui.budgetMonth = d.gotoMonth; ui.budgetTab = 'month'; render(); window.scrollTo(0, 0); return; }
    if (d.day) {
      ui.calSel = d.day;
      if (d.day.slice(0, 7) !== ui.calMonth.slice(0, 7)) ui.calMonth = d.day.slice(0, 8) + '01';
      return render();
    }

    switch (d.action) {
      case 'close-sheet': return closeSheet();
      case 'back': return setView('today');
      case 'delete-task': {
        const id = $('#task-form').dataset.id;
        const undo = snapshotUndo();
        state.tasks = state.tasks.filter((t) => t.id !== id);
        save(); closeSheet(); render(); toast('Tâche supprimée', undo);
        return;
      }
      case 'delete-sub': {
        const id = $('#sub-form').dataset.id;
        const s = state.subs.find((x) => x.id === id);
        if (!confirm(`Supprimer l'abonnement « ${s.name} » ?`)) return;
        state.subs = state.subs.filter((x) => x.id !== id);
        save(); closeSheet(); render(); toast('Abonnement supprimé');
        return;
      }
      case 'clear-done': {
        const undo = snapshotUndo();
        state.tasks = state.tasks.filter((t) => !t.done);
        save(); render(); toast('Tâches terminées supprimées', undo);
        return;
      }
      case 'enable-push': return enablePush();
      case 'copy-config':
        navigator.clipboard.writeText(ui.push.config)
          .then(() => toast('Configuration copiée'))
          .catch(() => toast('Copie impossible : sélectionne le texte à la main'));
        return;
      case 'test-notif': return testNotification();
      case 'add-cat':
        state.categories.push({ id: uid(), name: 'Nouvelle catégorie', color: '#0ea5e9' });
        save(); render();
        return;
      case 'del-cat': {
        const c = catById(d.id);
        if (!confirm(`Supprimer la catégorie « ${c.name} » ? Les tâches concernées n'auront plus de catégorie.`)) return;
        state.categories = state.categories.filter((x) => x.id !== d.id);
        state.tasks.forEach((t) => { if (t.cat === d.id) t.cat = ''; });
        state.subs.forEach((s) => { if (s.cat === d.id) s.cat = ''; });
        if (ui.taskCat === d.id) ui.taskCat = 'all';
        save(); render();
        return;
      }
      case 'export': return exportData();
      case 'import': return $('#import-file').click();
      case 'open-budget':
        ui.budgetTab = 'month'; ui.budgetMonth = today.slice(0, 7);
        return setView('budget');
      case 'delete-tx': {
        const id = $('#tx-form').dataset.id;
        const undo = snapshotUndo('transactions');
        state.transactions = state.transactions.filter((t) => t.id !== id);
        save(); closeSheet(); render(); toast('Opération supprimée', undo);
        return;
      }
      case 'add-tx-cat': {
        const id = $('#bcat-form').dataset.id;
        return openTxForm(null, { type: d.type, cat: id });
      }
      case 'add-bcat': {
        const used = state.budgetCats.filter((c) => c.type === 'expense').map((c) => c.slot);
        const slot = d.type === 'expense' ? [0, 1, 2, 3, 4, 5, 6, 7].find((i) => !used.includes(i)) : undefined;
        state.budgetCats.push({ id: uid(), name: d.type === 'income' ? 'Nouveau revenu' : 'Nouvelle dépense', type: d.type,
          slot: slot == null ? null : slot, budgets: [] });
        save(); render();
        const inputs = document.querySelectorAll('[data-bcat-name]');
        const last = inputs[d.type === 'income' ? state.budgetCats.filter((c) => c.type === 'income').length - 1 : inputs.length - 1];
        if (last) { last.focus(); last.select(); }
        return;
      }
      case 'del-bcat': {
        const c = bcatById(d.id);
        const n = state.transactions.filter((t) => t.cat === d.id).length;
        if (!confirm(`Supprimer la catégorie « ${c.name} »${n ? ` et ses ${n} opération(s)` : ''} ?`)) return;
        state.budgetCats = state.budgetCats.filter((x) => x.id !== d.id);
        state.transactions = state.transactions.filter((t) => t.cat !== d.id);
        save(); render();
        return;
      }
      case 'wipe':
        if (!confirm('Effacer TOUTES les tâches, abonnements et opérations de budget de ce téléphone ? Pense à exporter avant.')) return;
        if (!confirm('Vraiment sûr ? Cette action est définitive.')) return;
        state.tasks = []; state.subs = []; state.transactions = []; state.budgetOverrides = {};
        save(); render(); toast('Données effacées');
        return;
    }
  });

  document.addEventListener('change', (e) => {
    const el = e.target;
    const d = el.dataset;
    if (d.toggle) return toggleTask(d.toggle);
    if (el.name === 'type' && el.form && el.form.id === 'tx-form') {
      el.form.cat.innerHTML = bcatOptions(el.value, ui.lastTxCat[el.value]);
      $('#gain-toggle').hidden = el.value === 'income';
      return;
    }
    if (d.bcatName != null) { const c = bcatById(d.bcatName); if (c) { c.name = el.value.trim() || c.name; save(); } return; }
    if (d.setting) { state.settings[d.setting] = Number(el.value); save(); return; }
    if (d.catName != null) { const c = catById(d.catName); if (c) { c.name = el.value.trim() || c.name; save(); } return; }
    if (d.catColor != null) { const c = catById(d.catColor); if (c) { c.color = safeColor(el.value); save(); } return; }
    if (el.id === 'import-file' && el.files[0]) { importData(el.files[0]); el.value = ''; }
  });

  document.addEventListener('submit', (e) => {
    e.preventDefault();
    if (e.target.id === 'task-form') saveTaskForm(e.target);
    if (e.target.id === 'sub-form') saveSubForm(e.target);
    if (e.target.id === 'tx-form') saveTxForm(e.target);
    if (e.target.id === 'bcat-form') saveBudgetCat(e.target);
  });

  // La matrice et les listes se recalculent quand la date change (app restée ouverte, retour au premier plan).
  function checkDayChange() {
    const now = E.todayStr();
    if (now !== today) {
      if (ui.calSel === today) ui.calSel = now;
      today = now;
      render();
    }
  }
  document.addEventListener('visibilitychange', () => { if (!document.hidden) { checkDayChange(); refreshPushStatus().then(render); } });
  setInterval(checkDayChange, 60000);

  /* ---------- Démarrage ---------- */
  (async function start() {
    await load();
    render();
    if ('serviceWorker' in navigator) {
      try { await navigator.serviceWorker.register('sw.js'); } catch (e) { console.warn('SW', e); }
    }
    await refreshPushStatus();
    render();
  })();
})();
