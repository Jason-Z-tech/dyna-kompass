'use strict';

// Seite "G-Max-Konter": Team-Vorschläge, Angreifer, Tanks und Heiler gegen einen Gigadynamax-Boss.

(() => {
  const { el, TYPE_ORDER, formatNumber, formatFactor, slugOf } = Dyna;

  const LIST_SIZE = 12;
  const ROLE_TABS = [
    { id: 'attackers', label: 'Angreifer' },
    { id: 'tanks', label: 'Tanks' },
    { id: 'healers', label: 'Heiler' },
  ];

  const state = { bossKey: null, includeElite: true, tab: 'attackers' };
  let data = null;
  let bosses = [];

  const bossSlug = (boss) => (boss.formId ?? boss.speciesId).toLowerCase();
  const currentBoss = () => bosses.find((b) => b.key === state.bossKey) ?? bosses[0];

  // ---------- Berechnung ----------

  // Lade-Attacken des Bosses: Im Max-Kampf wählt er zufällig aus allen, auch Elite-Attacken.
  function bossMoves(boss) {
    return [...new Map(boss.chargedMoves.map((m) => [m.id, m])).values()];
  }

  // Durchschnittlicher Faktor, mit dem die Boss-Attacken ein Pokémon treffen (< 1 = resistent).
  function damageTaken(pokemon, moves) {
    return moves.reduce((sum, m) => sum + Dyna.effectiveness(data, m.type, pokemon.types), 0) / moves.length;
  }

  function analyse(boss) {
    const moves = bossMoves(boss);
    const { maxGuardHp, maxGuardUses, maxSpiritHeal } = data.rules;

    const attackers = [];
    const tanks = [];
    const healers = [];
    // Angekündigte Pokémon zählen erst ab ihrem Erscheinungstag – vorher kann sie niemand einsetzen.
    for (const p of data.pokemon.filter((x) => !Dyna.isUpcoming(x))) {
      const fast = Dyna.fastestMove(p, state.includeElite);
      if (!fast) continue;
      const taken = damageTaken(p, moves);
      const resisted = moves.filter((m) => Dyna.effectiveness(data, m.type, p.types) < 1);
      const weakTo = moves.filter((m) => Dyna.effectiveness(data, m.type, p.types) > 1);

      const best = Dyna.rolesOf(p, data, state.includeElite)
        .map((role) => ({ role, eff: Dyna.effectiveness(data, role.type, boss.types) }))
        .map((x) => ({ ...x, score: x.role.maxDamage * x.eff }))
        .sort((a, b) => b.score - a.score)[0];
      if (best) attackers.push({ pokemon: p, ...best, taken, weakTo });

      const survival = (p.def40 * p.hp40) / taken;
      tanks.push({ pokemon: p, fast, taken, resisted, weakTo, score: (p.def40 * (p.hp40 + maxGuardHp * maxGuardUses)) / taken / 100 });
      healers.push({ pokemon: p, fast, taken, resisted, weakTo, survival, heal: maxSpiritHeal * p.hp40 });
    }

    // Heiler, die schlechter durchhalten als der Durchschnitt, werden anteilig abgewertet.
    const survivals = healers.map((h) => h.survival).sort((a, b) => a - b);
    const median = survivals[Math.floor(survivals.length / 2)];
    for (const h of healers) h.score = h.heal * Math.min(1, h.survival / median);

    const byScore = (a, b) => b.score - a.score;
    return { moves, attackers: attackers.sort(byScore), tanks: tanks.sort(byScore), healers: healers.sort(byScore) };
  }

  // Nimmt die besten Einträge, ohne dieselbe Art doppelt ins Team zu setzen.
  function pickDistinct(list, count, usedSpecies) {
    const picked = [];
    for (const entry of list) {
      if (picked.length === count) break;
      if (usedSpecies.has(entry.pokemon.speciesId)) continue;
      usedSpecies.add(entry.pokemon.speciesId);
      picked.push(entry);
    }
    return picked;
  }

  function buildTeams(result) {
    const allOut = new Set();
    const balanced = new Set();
    const safe = new Set();
    return [
      {
        id: 'angriff',
        title: 'Voller Angriff',
        tagline: 'Schnellster Sieg',
        text: 'Drei Angreifer mit maximalem Schaden. Ideal für starke, eingespielte Gruppen – ohne Schutz aber riskant.',
        members: pickDistinct(result.attackers, 3, allOut).map((e) => ({ role: 'attacker', entry: e })),
      },
      {
        id: 'ausgewogen',
        title: 'Ausgewogen',
        tagline: 'Tank + 2 Angreifer',
        text: 'Der Tank setzt Dyna-Wall-Schilde und fängt die großen Attacken ab, die Angreifer bringen den Schaden.',
        members: [
          ...pickDistinct(result.tanks, 1, balanced).map((e) => ({ role: 'tank', entry: e })),
          ...pickDistinct(result.attackers, 2, balanced).map((e) => ({ role: 'attacker', entry: e })),
        ],
      },
      {
        id: 'sicher',
        title: 'Sicher mit Heilung',
        tagline: 'Tank + Heiler + Angreifer',
        text: 'Für kleinere oder schwächere Gruppen: Der Heiler hält mit Dyna-Kur alle am Leben, der Tank schützt.',
        members: [
          ...pickDistinct(result.tanks, 1, safe).map((e) => ({ role: 'tank', entry: e })),
          ...pickDistinct(result.healers, 1, safe).map((e) => ({ role: 'healer', entry: e })),
          ...pickDistinct(result.attackers, 1, safe).map((e) => ({ role: 'attacker', entry: e })),
        ],
      },
    ];
  }

  // ---------- Texte ----------

  const ROLE_LABEL = { attacker: 'Angreifer', tank: 'Tank', healer: 'Heiler' };
  const moveNames = (moves) => moves.map((m) => m.name).join(', ');

  function actionText(role, entry) {
    if (role === 'attacker') return [el('strong', { text: entry.role.maxMoveName }), ` über ${entry.role.fastMove.name}`, entry.role.fastMove.elite ? Dyna.eliteBadge() : null];
    if (role === 'tank') return [el('strong', { text: 'Dyna-Wall' }), ` · lädt mit ${entry.fast.name}`, entry.fast.elite ? Dyna.eliteBadge() : null];
    return [el('strong', { text: 'Dyna-Kur' }), ` · heilt ${formatNumber(entry.heal)} KP pro Einsatz`];
  }

  function reasonText(role, entry) {
    if (role === 'attacker') {
      const warn = entry.weakTo.length ? ` Achtung: anfällig für ${moveNames(entry.weakTo)}.` : '';
      return `${formatFactor(entry.eff)} effektiv gegen den Boss.${warn}`;
    }
    if (entry.resisted.length) return `Resistiert ${moveNames(entry.resisted)}.`;
    if (entry.weakTo.length) return `Sehr robust, aber anfällig für ${moveNames(entry.weakTo)}.`;
    return 'Sehr robust gegen alle Boss-Attacken.';
  }

  // Zusatz für Pokémon, die nur in einer Weltregion erscheinen – sonst leer.
  const regionNote = (pokemon) => (pokemon.region ? ` Erscheint nur in: ${pokemon.region}.` : '');

  // ---------- Darstellung ----------

  function renderBossBar() {
    const bar = document.getElementById('boss-bar');
    if (!bar.children.length) {
      bar.append(...bosses.map((boss) => el('button', {
        type: 'button',
        class: 'boss-btn',
        'data-boss': boss.key,
        onclick: () => selectBoss(boss.key),
      }, [
        Dyna.pokemonArt(boss, { size: 'sm', eager: true }),
        el('span', { class: 'boss-btn__name', text: boss.name.replace('Gigadynamax-', '') }),
        el('span', { class: 'boss-btn__types' }, boss.types.map((t) => el('span', { class: `type-dot type-${slugOf(t)}`, title: data.types[t] }))),
      ])));
    }
    for (const btn of bar.children) btn.setAttribute('aria-pressed', String(btn.dataset.boss === currentBoss().key));
  }

  function factorList(entries) {
    return el('div', { class: 'factor-list' }, entries.map(({ type, factor }) =>
      el('span', { class: `type-chip type-chip--small type-${slugOf(type)}` }, [`${data.types[type]} ${formatFactor(factor)}`])));
  }

  function bossPanel(boss, result) {
    const factors = TYPE_ORDER.map((type) => ({ type, factor: Dyna.effectiveness(data, type, boss.types) }));
    const weak = factors.filter((f) => f.factor > 1).sort((a, b) => b.factor - a.factor);
    const strong = factors.filter((f) => f.factor < 1).sort((a, b) => a.factor - b.factor);
    return el('section', { class: 'boss', 'aria-labelledby': 'boss-name' }, [
      Dyna.pokemonArt(boss, { size: 'lg', eager: true }),
      el('div', { class: 'boss__info' }, [
        el('p', { class: 'boss__label', text: 'Gigadynamax-Boss · 6-Sterne-Max-Kampf' }),
        el('h2', { class: 'boss__name', id: 'boss-name', text: boss.name }),
        el('div', { class: 'card__types' }, boss.types.map((t) => Dyna.typeChip(t, data))),
        el('div', { class: 'boss__facts' }, [
          el('div', {}, [el('h3', { text: 'Schwach gegen' }), factorList(weak)]),
          el('div', {}, [el('h3', { text: 'Resistent gegen' }), factorList(strong)]),
          el('div', {}, [
            el('h3', { text: 'Seine Attacken' }),
            el('ul', { class: 'boss__moves' }, result.moves.map((m) => el('li', {}, [
              el('span', { text: m.name }), Dyna.typeChip(m.type, data, true), m.elite ? Dyna.eliteBadge('Elite') : null,
            ]))),
          ]),
        ]),
      ]),
    ]);
  }

  function teamMember({ role, entry }) {
    const p = entry.pokemon;
    return el('li', { class: `member member--${role}` }, [
      Dyna.pokemonArt(p, { size: 'sm' }),
      el('div', { class: 'member__info' }, [
        el('p', { class: 'member__name' }, [
          el('span', { class: `role-badge role-badge--${role}`, text: ROLE_LABEL[role] }),
          el('span', { text: p.name }),
        ]),
        el('p', { class: 'member__action' }, actionText(role, entry)),
        el('p', { class: 'member__reason', text: `${reasonText(role, entry)}${regionNote(p)}` }),
      ]),
    ]);
  }

  function teamsSection(result) {
    const teams = buildTeams(result);
    return el('section', { class: 'teams', 'aria-labelledby': 'teams-title' }, [
      el('div', { class: 'section-head' }, [
        el('h2', { id: 'teams-title', text: 'Team-Vorschläge' }),
        el('p', { text: 'Jede*r bringt 3 Pokémon in den Max-Kampf. Drei Varianten – je nach Gruppe.' }),
      ]),
      el('div', { class: 'teams__grid' }, teams.map((team) => el('article', { class: `team team--${team.id}` }, [
        el('header', { class: 'team__head' }, [
          el('p', { class: 'team__tagline', text: team.tagline }),
          el('h3', { class: 'team__title', text: team.title }),
          el('p', { class: 'team__text', text: team.text }),
        ]),
        el('ol', { class: 'team__members' }, team.members.map(teamMember)),
      ]))),
    ]);
  }

  function listRow(tab, entry, rank, max) {
    const p = entry.pokemon;
    let metric;
    let detail;
    if (tab === 'attackers') {
      metric = Dyna.meter('Schaden gegen Boss', formatNumber(entry.score), entry.score / max, 'damage');
      detail = [el('strong', { text: entry.role.maxMoveName }), ` über ${entry.role.fastMove.name} · ${formatFactor(entry.eff)} effektiv`];
    } else if (tab === 'tanks') {
      metric = Dyna.meter('Hält aus', formatNumber(entry.score), entry.score / max, 'bulk');
      detail = [reasonText('tank', entry)];
    } else {
      metric = Dyna.meter('Heilwert', formatNumber(entry.score), entry.score / max, 'charge');
      detail = [`Heilt ${formatNumber(entry.heal)} KP pro Dyna-Kur · `, reasonText('healer', entry)];
    }
    return el('li', { class: 'row' }, [
      el('span', { class: 'row__rank', text: rank }),
      Dyna.pokemonArt(p, { size: 'sm' }),
      el('div', { class: 'row__info' }, [
        el('p', { class: 'row__name' }, [el('span', { text: p.name }), Dyna.kindBadge(p), Dyna.regionBadge(p)]),
        el('div', { class: 'card__types' }, p.types.map((t) => Dyna.typeChip(t, data, true))),
        el('p', { class: 'row__detail' }, detail),
      ]),
      el('div', { class: 'row__metric' }, [metric]),
    ]);
  }

  function listsSection(result) {
    const entries = result[state.tab].slice(0, LIST_SIZE);
    const max = result[state.tab][0]?.score ?? 1;
    const tabs = el('div', { class: 'tabs', role: 'tablist', 'aria-label': 'Rolle' }, ROLE_TABS.map((t) => el('button', {
      type: 'button',
      role: 'tab',
      id: `tab-${t.id}`,
      class: 'tabs__btn',
      'aria-selected': String(t.id === state.tab),
      'aria-controls': 'role-panel',
      tabindex: t.id === state.tab ? '0' : '-1',
      onclick: () => selectTab(t.id, true),
      onkeydown: onTabKey,
    }, [t.label])));
    return el('section', { class: 'lists', 'aria-labelledby': 'lists-title' }, [
      el('div', { class: 'section-head' }, [
        el('h2', { id: 'lists-title', text: 'Die Besten je Rolle' }),
        el('label', { class: 'toggle' }, [
          el('input', { id: 'elite', type: 'checkbox', checked: state.includeElite, autocomplete: 'off', onchange: (e) => { state.includeElite = e.target.checked; render(); document.getElementById('elite').focus(); } }),
          el('span', { class: 'toggle__track', 'aria-hidden': 'true' }),
          el('span', { text: 'Elite-Attacken einbeziehen' }),
        ]),
      ]),
      tabs,
      el('ol', { class: 'rows', id: 'role-panel', role: 'tabpanel', 'aria-labelledby': `tab-${state.tab}` },
        entries.map((e, i) => listRow(state.tab, e, i + 1, max))),
    ]);
  }

  function render() {
    const boss = currentBoss();
    state.bossKey = boss.key;
    renderBossBar();
    const result = analyse(boss);
    document.getElementById('counters').replaceChildren(bossPanel(boss, result), teamsSection(result), listsSection(result));
  }

  // ---------- Ereignisse ----------

  function selectBoss(key) {
    state.bossKey = key;
    Dyna.writeHash({ boss: bossSlug(currentBoss()) });
    render();
    const bar = document.getElementById('boss-bar');
    Dyna.centerInScroller(bar, bar.querySelector(`[data-boss="${key}"]`));
    Dyna.revealIfAbove(document.getElementById('counters'), 8);
  }

  function selectTab(id, focus = false) {
    state.tab = id;
    render();
    if (focus) document.getElementById(`tab-${id}`).focus();
  }

  // Pfeiltasten wechseln zwischen den Rollen-Tabs (Tastatur-Bedienung).
  function onTabKey(e) {
    const i = ROLE_TABS.findIndex((t) => t.id === state.tab);
    const moves = { ArrowRight: 1, ArrowLeft: -1, Home: -i, End: ROLE_TABS.length - 1 - i };
    if (!(e.key in moves)) return;
    e.preventDefault();
    const next = (i + moves[e.key] + ROLE_TABS.length) % ROLE_TABS.length;
    selectTab(ROLE_TABS[next].id, true);
  }

  function bossFromHash() {
    const slug = Dyna.readHash().boss;
    return bosses.find((b) => bossSlug(b) === slug)?.key ?? null;
  }

  function init() {
    data = Dyna.loadData('counters');
    if (!data) return;
    bosses = data.pokemon.filter((p) => p.kind === 'gigantamax');
    state.bossKey = bossFromHash() ?? bosses.find((b) => b.speciesId === 'CHARIZARD')?.key ?? bosses[0].key;
    Dyna.renderSources(data);
    render();
    Dyna.enhanceScroller(document.getElementById('boss-bar'));
    const bar = document.getElementById('boss-bar');
    Dyna.centerInScroller(bar, bar.querySelector(`[data-boss="${state.bossKey}"]`));
    window.addEventListener('hashchange', () => {
      const key = bossFromHash();
      if (key && key !== state.bossKey) { state.bossKey = key; render(); }
    });
  }

  document.addEventListener('DOMContentLoaded', init);
})();
