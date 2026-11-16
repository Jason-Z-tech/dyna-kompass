'use strict';

// Seite "Typ-Rangliste": beste Dynamax-/Gigadynamax-Angreifer je Typ.

(() => {
  const { el, TYPE_ORDER, formatNumber, formatDate, slugOf, isUpcoming } = Dyna;

  const DEFAULTS = { kind: 'all', sort: 'damage', includeElite: true, query: '' };
  const SORTS = {
    damage: (a, b) => b.maxDamage - a.maxDamage || b.hitsPerSecond - a.hitsPerSecond,
    charge: (a, b) => b.hitsPerSecond - a.hitsPerSecond || b.maxDamage - a.maxDamage,
    bulk: (a, b) => b.bulk - a.bulk || b.maxDamage - a.maxDamage,
  };

  const state = { type: 'FIRE', ...DEFAULTS };
  let data = null;
  let roles = [];
  let maxima = null;

  // ---------- Berechnung ----------

  function recomputeRoles() {
    roles = data.pokemon.flatMap((p) => Dyna.rolesOf(p, data, state.includeElite));
    maxima = {
      damage: Math.max(...roles.map((r) => r.maxDamage)),
      hits: Math.max(...roles.map((r) => r.hitsPerSecond)),
      bulk: Math.max(...roles.map((r) => r.bulk)),
    };
  }

  const matchesKind = (pokemon, kind = state.kind) => kind === 'all' || pokemon.kind === kind;

  // Suche: Groß- und Kleinschreibung, Akzente, Klammern, Bindestriche und Leerzeichen spielen keine Rolle, jedes Wort
  // muss vorkommen ("riffex tiefform" findet "Riffex (Tief-Form)"). "und", "oder" und Kommas trennen mehrere Suchen
  // ("riffex hoch und tiefform"). Ganze Art-Wörter grenzen auf die Art ein: "Dynamax-Riffex", "G-Max Riffex".
  const KIND_WORDS = { dynamax: ['dynamax'], gigantamax: ['gigadynamax', 'gigantamax', 'gmax'], special: ['spezial'] };
  const KIND_OF_WORD = { dynamax: 'dynamax', gigadynamax: 'gigantamax', gigantamax: 'gigantamax', gmax: 'gigantamax', spezial: 'special' };
  const squash = (text) => text.toLocaleLowerCase('de').normalize('NFD').replace(/\p{M}+/gu, '').replace(/[^\p{L}\p{N}]+/gu, '');
  const withGmax = (text) => text.toLocaleLowerCase('de').replace(/\bg[\s-]*max\b/g, 'gmax');
  const searchTexts = new WeakMap();
  let parsed = { query: null, alternatives: [] };

  // Jedes Feld für sich zusammengezogen und mit Leerzeichen getrennt: Suchwörter haben keine Leerzeichen und passen
  // so nie über eine Feldgrenze (sonst fände "Endyna" auch "Honweisel Vespiquen dynamax").
  function searchText(pokemon) {
    if (!searchTexts.has(pokemon)) {
      searchTexts.set(pokemon, [pokemon.name, pokemon.nameEn, ...(KIND_WORDS[pokemon.kind] ?? [])].map((t) => squash(withGmax(t))).join(' '));
    }
    return searchTexts.get(pokemon);
  }

  // Suchwörter trennen an Leerzeichen; ein Wort mit Bindestrich bleibt zusammen ("Ho-Oh", "Hoch-Form"). Nur ein Art-Wort
  // vorne zählt für sich ("Dynamax-Riffex", "G-Max-Riffex"); "Gigadynamax-…" bleibt ganz, denn so beginnen die Namen.
  const KIND_PREFIX = /^(dynamax|gmax|gigantamax|spezial)[^\p{L}\p{M}\p{N}]+(.+)$/u;
  const queryWords = (part) => withGmax(part).split(/\s+/).flatMap((token) => {
    const m = KIND_PREFIX.exec(token);
    return m ? [m[1], squash(m[2])] : [squash(token)];
  }).filter(Boolean);

  function queryAlternatives() {
    if (parsed.query !== state.query) {
      const alternatives = state.query.toLocaleLowerCase('de').split(/\s+(?:und|oder)(?:\s+|$)|[,;/+&]/)
        .map(queryWords)
        .filter((words) => words.length);
      parsed = { query: state.query, alternatives };
    }
    return parsed.alternatives;
  }

  const matchesWord = (pokemon, word) => (KIND_OF_WORD[word] ? pokemon.kind === KIND_OF_WORD[word] : searchText(pokemon).includes(word));

  function matchesQuery(pokemon) {
    if (!state.query) return true;
    return queryAlternatives().some((words) => words.every((word) => matchesWord(pokemon, word)));
  }

  // Rangliste eines Typs mit Art-Filter und Sortierung, ohne Suchfilter (für Platz-Nummern).
  function rankedList(type) {
    return roles.filter((r) => r.type === type && matchesKind(r.pokemon)).sort(SORTS[state.sort]);
  }

  // Platz-Nummern bekommen nur erschienene Pokémon. Angekündigte stehen dort, wo sie einsteigen
  // werden, zählen aber noch nicht mit (rank: null) – die Plätze zeigen, was heute einsetzbar ist.
  function withRanks(list) {
    let rank = 0;
    return list.map((role) => ({ role, rank: isUpcoming(role.pokemon) ? null : ++rank }));
  }

  // ---------- Karten ----------

  function moveLine(role) {
    return el('p', { class: 'card__move' }, [
      el('span', { class: 'card__max', text: role.maxMoveName }),
      ' über ',
      el('span', { text: role.fastMove.name }),
      role.fastMove.elite ? Dyna.eliteBadge() : null,
    ]);
  }

  function statBar(label, value, max) {
    return el('div', { class: 'stat' }, [
      el('span', { class: 'stat__label', text: label }),
      el('span', { class: 'stat__track' }, [el('span', { class: 'stat__fill', style: { '--fill': `${Math.round((value / max) * 100)}%` } })]),
      el('span', { class: 'stat__value', text: value }),
    ]);
  }

  function moveTable(title, moves, isFast) {
    const rows = moves.map((m) => el('tr', {}, [
      el('th', { scope: 'row' }, [
        el('span', { class: 'moves__name' }, [m.name, m.elite ? Dyna.eliteBadge('Elite') : null]),
        Dyna.typeChip(m.type, data, true),
      ]),
      el('td', { text: formatNumber(m.power) }),
      el('td', { text: `${formatNumber(m.durationS, 1)} s` }),
      el('td', { text: isFast ? `+${m.energy}` : formatNumber(Math.abs(m.energy)) }),
    ]));
    return el('div', { class: 'moves' }, [
      el('h4', { text: title }),
      el('table', {}, [
        el('thead', {}, [el('tr', {}, [
          el('th', { scope: 'col', text: 'Attacke' }), el('th', { scope: 'col', text: 'Stärke' }),
          el('th', { scope: 'col', text: 'Dauer' }), el('th', { scope: 'col', text: 'Energie' }),
        ])]),
        el('tbody', {}, rows),
      ]),
    ]);
  }

  function cardDetails(pokemon) {
    return el('div', { class: 'card__details' }, [
      el('div', { class: 'details__stats' }, [
        el('h4', { text: 'Basiswerte' }),
        statBar('Angriff', pokemon.base.atk, 350),
        statBar('Verteidigung', pokemon.base.def, 350),
        statBar('Ausdauer', pokemon.base.sta, 350),
        el('dl', { class: 'facts' }, [
          el('div', {}, [el('dt', { text: 'WP Level 40' }), el('dd', { text: formatNumber(pokemon.cp40) })]),
          el('div', {}, [el('dt', { text: 'WP Level 50' }), el('dd', { text: formatNumber(pokemon.cp50) })]),
          el('div', {}, [el('dt', { text: 'KP Level 40' }), el('dd', { text: formatNumber(pokemon.hp40) })]),
          pokemon.releaseDate
            ? el('div', {}, [
              el('dt', { text: `${pokemon.kind === 'gigantamax' ? 'Gigadynamax' : 'Dynamax'} ${isUpcoming(pokemon) ? 'ab' : 'seit'}` }),
              el('dd', { class: 'facts__date', text: formatDate(pokemon.releaseDate) }),
            ])
            : null,
        ]),
      ]),
      moveTable('Sofort-Attacken', pokemon.fastMoves, true),
      moveTable('Lade-Attacken', pokemon.chargedMoves, false),
    ]);
  }

  // rank ist null bei angekündigten Pokémon; position ist die Stelle in der angezeigten Liste (ab 0).
  function card(role, rank, position) {
    const { pokemon } = role;
    const upcoming = rank === null;
    const podium = !upcoming && rank <= 3 ? ` card--top card--top-${rank}` : '';
    return el('li', { class: `card${podium}${upcoming ? ' card--upcoming' : ''}`, style: { '--i': Math.min(position, 12) } }, [
      el('details', {}, [
        el('summary', { class: 'card__summary' }, [
          upcoming
            ? el('span', { class: 'card__rank card__rank--upcoming', text: 'bald', 'aria-label': 'Angekündigt, noch ohne Platz' })
            : el('span', { class: 'card__rank', text: rank, 'aria-label': `Platz ${rank}` }),
          Dyna.pokemonArt(pokemon, { eager: position < 4 }),
          el('div', { class: 'card__info' }, [
            el('h3', { class: 'card__name' }, [el('span', { text: pokemon.name }), Dyna.kindBadge(pokemon), Dyna.upcomingBadge(pokemon), Dyna.regionBadge(pokemon)]),
            el('div', { class: 'card__types' }, pokemon.types.map((t) => Dyna.typeChip(t, data, true))),
            moveLine(role),
          ]),
          el('div', { class: 'card__meters' }, [
            Dyna.meter('Max-Schaden', formatNumber(role.maxDamage), role.maxDamage / maxima.damage, 'damage'),
            Dyna.meter('Laden', `${formatNumber(role.hitsPerSecond, 1)} Treffer/s`, role.hitsPerSecond / maxima.hits, 'charge'),
            Dyna.meter('Haltbarkeit', formatNumber(role.bulk), role.bulk / maxima.bulk, 'bulk'),
          ]),
          el('span', { class: 'card__chevron', 'aria-hidden': 'true' }),
        ]),
        cardDetails(pokemon),
      ]),
    ]);
  }

  // ---------- Bereiche ----------

  function renderTypeBar() {
    const bar = document.getElementById('type-bar');
    if (!bar.children.length) {
      bar.append(...TYPE_ORDER.map((type) => el('button', {
        type: 'button',
        class: `type-chip type-${slugOf(type)} type-bar__btn`,
        'data-type': type,
        onclick: () => selectType(type),
      }, [el('span', { text: data.types[type] }), el('small', { class: 'type-bar__count' })])));
    }
    for (const btn of bar.children) {
      const type = btn.dataset.type;
      btn.setAttribute('aria-pressed', String(type === state.type));
      btn.querySelector('.type-bar__count').textContent = rankedList(type).length;
    }
  }

  function renderKindCounts() {
    for (const kind of ['all', 'dynamax', 'gigantamax']) {
      const count = roles.filter((r) => r.type === state.type && matchesKind(r.pokemon, kind)).length;
      document.querySelector(`[data-count="${kind}"]`).textContent = count;
    }
  }

  function renderSearchHits() {
    const box = document.getElementById('search-hits');
    if (!state.query) { box.hidden = true; box.replaceChildren(); return; }
    const hits = data.pokemon.filter((p) => p.kind !== 'boss' && matchesKind(p) && matchesQuery(p));
    box.hidden = false;
    if (!hits.length) {
      box.replaceChildren(el('p', { class: 'search-hits__empty', text: `Kein Pokémon gefunden für „${state.query}“.` }));
      return;
    }
    const rows = hits.slice(0, 8).map((p) => {
      const places = TYPE_ORDER
        .map((type) => ({ type, entry: withRanks(rankedList(type)).find(({ role }) => role.pokemon === p) }))
        .filter((x) => x.entry);
      // Angekündigte haben noch keinen Platz; das Datum steht schon in der Marke neben dem Namen.
      const placeText = (entry) => (entry.rank === null ? 'bald' : `Platz ${entry.rank}`);
      return el('li', { class: 'search-hits__row' }, [
        Dyna.pokemonArt(p, { size: 'sm' }),
        el('div', { class: 'search-hits__info' }, [
          el('p', { class: 'search-hits__name' }, [el('span', { text: p.name }), Dyna.kindBadge(p), Dyna.upcomingBadge(p), Dyna.regionBadge(p)]),
          places.length
            ? el('div', { class: 'search-hits__places' }, places.map(({ type, entry }) => el('button', {
              type: 'button',
              class: `type-chip type-chip--small type-${slugOf(type)}${type === state.type ? ' is-current' : ''}`,
              onclick: () => { selectType(type); revealRankingIfBelow(); },
            }, [`${data.types[type]} · ${placeText(entry)}`])))
            : el('p', { class: 'search-hits__none', text: 'Ohne Elite-Attacken in keiner Liste.' }),
        ]),
      ]);
    });
    // replaceChildren würde ein null als Text "null" einfügen – deshalb vorher aussortieren.
    box.replaceChildren(...[
      el('h2', { class: 'search-hits__title', text: `${hits.length} Treffer – antippen, um zum Typ zu springen` }),
      el('ul', { class: 'search-hits__list' }, rows),
      hits.length > 8 ? el('p', { class: 'search-hits__more', text: `… und ${hits.length - 8} weitere. Suche genauer eingrenzen.` }) : null,
    ].filter(Boolean));
  }

  function renderRanking() {
    const main = document.getElementById('ranking');
    const list = withRanks(rankedList(state.type)).filter(({ role }) => matchesQuery(role.pokemon));
    const upcomingCount = list.filter(({ rank }) => rank === null).length;

    const header = el('header', { class: `ranking__header type-${slugOf(state.type)}` }, [
      el('h2', {}, [el('span', { class: 'ranking__type', text: data.types[state.type] }), ' – die stärksten Angreifer']),
      el('p', { class: 'ranking__count' }, [
        `${list.length} Pokémon${upcomingCount ? `, davon ${upcomingCount} angekündigt` : ''} · `,
        el('span', { class: 'ranking__move', text: data.maxMoves[state.type] }),
      ]),
    ]);

    let body;
    if (list.length) {
      body = el('ol', { class: 'ranking__list' }, list.map(({ role, rank }, position) => card(role, rank, position)));
    } else {
      body = el('div', { class: 'state' }, [
        el('p', { class: 'state__title', text: `Keine Treffer bei ${data.types[state.type]}.` }),
        el('p', { text: emptyHint() }),
        el('button', { type: 'button', class: 'reset-btn', text: 'Filter zurücksetzen', onclick: resetFilters }),
      ]);
    }
    main.replaceChildren(header, body);
  }

  // Erklärt eine leere Liste: Ohne Suche liegt es an den Filtern; mit Suche stehen die Typen der Treffer oben –
  // außer die Suche findet gar nichts.
  function emptyHint() {
    if (!state.query) return 'Mit diesen Filtern gibt es hier keine Pokémon.';
    const anyHit = data.pokemon.some((p) => p.kind !== 'boss' && matchesKind(p) && matchesQuery(p));
    return anyHit ? 'Oben bei den Suchtreffern siehst du, in welchen Typen das Pokémon vorkommt.' : `Kein Pokémon passt zu „${state.query}“.`;
  }

  function renderResetButton() {
    const changed = state.kind !== DEFAULTS.kind || state.sort !== DEFAULTS.sort
      || state.includeElite !== DEFAULTS.includeElite || state.query !== DEFAULTS.query;
    document.getElementById('reset').hidden = !changed;
    document.getElementById('search-clear').hidden = !state.query;
  }

  function render() {
    // Eine Höhe, die der Treffer-Kasten nur für einen Filter-Tipp behalten hat (siehe bindControls), gilt nicht weiter.
    document.getElementById('search-hits').style.minHeight = '';
    renderMeta();
    renderTypeBar();
    renderKindCounts();
    renderSearchHits();
    renderRanking();
    renderResetButton();
  }

  // ---------- Zustand ----------

  // Übernimmt die Werte aus den Formularfeldern. Browser stellen diese beim Neuladen teils
  // wieder her – so passen Anzeige und Liste immer zusammen.
  function readControls() {
    const form = document.getElementById('controls');
    state.kind = form.querySelector('input[name="kind"]:checked')?.value ?? DEFAULTS.kind;
    state.sort = form.querySelector('input[name="sort"]:checked')?.value ?? DEFAULTS.sort;
    state.includeElite = form.querySelector('#elite').checked;
    state.query = form.querySelector('#search').value.trim();
  }

  function writeControls() {
    const form = document.getElementById('controls');
    form.querySelector(`input[name="kind"][value="${state.kind}"]`).checked = true;
    form.querySelector(`input[name="sort"][value="${state.sort}"]`).checked = true;
    form.querySelector('#elite').checked = state.includeElite;
    form.querySelector('#search').value = state.query;
  }

  // Höhe der klebenden Typ-Leiste, die den oberen Bildrand verdeckt (ab 1000 px klebt sie nicht).
  function typeBarOffset() {
    const typeBar = document.querySelector('.type-bar');
    return getComputedStyle(typeBar).position === 'sticky' ? typeBar.offsetHeight : 0;
  }

  // Ein Tipp auf einen Suchtreffer zeigt die Liste: Am Handy liegt sie unter den Filtern, oft außerhalb des Bildes.
  function revealRankingIfBelow() {
    const top = document.getElementById('ranking').getBoundingClientRect().top;
    if (top > window.innerHeight - 120) window.scrollTo({ top: window.scrollY + top - typeBarOffset() - 8, behavior: 'smooth' });
  }

  function selectType(type) {
    state.type = type;
    Dyna.writeHash({ typ: slugOf(type) });
    render();
    const bar = document.getElementById('type-bar');
    Dyna.centerInScroller(bar, bar.querySelector(`[data-type="${type}"]`));
    const barOffset = typeBarOffset();
    Dyna.revealIfAbove(document.getElementById('ranking'), barOffset + 8);
  }

  function resetFilters() {
    const includeEliteChanged = state.includeElite !== DEFAULTS.includeElite;
    Object.assign(state, DEFAULTS);
    writeControls();
    if (includeEliteChanged) recomputeRoles();
    render();
  }

  function typeFromHash() {
    const hash = Dyna.readHash();
    const slug = (hash.typ ?? location.hash.slice(1)).toUpperCase();
    return TYPE_ORDER.includes(slug) ? slug : null;
  }

  function bindControls() {
    const form = document.getElementById('controls');
    // "Suchen" auf der Handy-Tastatur schließt die Tastatur, damit die Treffer unter dem Suchfeld frei liegen. Am
    // Computer bleibt der Fokus im Feld, man kann weitertippen.
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      if (document.activeElement?.id === 'search' && window.matchMedia('(pointer: coarse)').matches) document.activeElement.blur();
    });
    form.addEventListener('change', (e) => {
      // Die Suche aktualisiert schon beim Tippen. Ihr "change" beim Verlassen des Feldes würde
      // sonst neu zeichnen, während man gerade auf einen Treffer klickt – der Klick ginge verloren.
      if (e.target.id === 'search') return;
      const eliteChanged = e.target.id === 'elite';
      // Am Handy stehen die Treffer über den Filtern. Ändert ein Filter ihre Zahl, bleibt der angetippte Filter
      // trotzdem unter dem Finger – sonst träfe ein zweiter Tipp die Zeile darunter.
      const anchor = e.target.closest('fieldset, .controls__row');
      const before = anchor?.getBoundingClientRect().top;
      readControls();
      if (eliteChanged) recomputeRoles();
      render();
      const shift = anchor ? anchor.getBoundingClientRect().top - before : 0;
      if (!shift) return;
      // Ganz oben auf der Seite reicht Scrollen nicht: Dann behält der Kasten so viel Höhe, dass nichts rutscht.
      const lack = -(window.scrollY + shift);
      window.scrollBy({ top: shift, behavior: 'instant' });
      const box = document.getElementById('search-hits');
      if (shift < 0 && lack > 0 && !box.hidden) box.style.minHeight = `${box.offsetHeight + lack}px`;
    });
    document.getElementById('search').addEventListener('input', () => { readControls(); render(); });
    document.getElementById('search-clear').addEventListener('click', () => {
      state.query = '';
      writeControls();
      render();
      document.getElementById('search').focus();
    });
    document.getElementById('reset').addEventListener('click', resetFilters);
    window.addEventListener('hashchange', () => {
      const type = typeFromHash();
      if (type && type !== state.type) { state.type = type; render(); }
    });
    // Zurück-Navigation aus dem Cache: Formularwerte erneut übernehmen.
    window.addEventListener('pageshow', (e) => {
      if (!e.persisted) return;
      readControls();
      recomputeRoles();
      render();
    });
  }

  function renderMeta() {
    const date = data.sources.gameMasterDate ? formatDate(data.sources.gameMasterDate) : 'unbekannt';
    // Erschienene je Art; Angekündigte (aller Arten) zählen extra. Sonder-Bosse sind keine Angreifer.
    const released = (kind) => data.pokemon.filter((p) => p.kind === kind && !isUpcoming(p)).length;
    const upcomingCount = data.pokemon.filter((p) => p.kind !== 'boss' && isUpcoming(p)).length;
    document.getElementById('data-meta').textContent = [
      `${released('dynamax')} Dynamax`,
      `${released('gigantamax')} Gigadynamax`,
      released('special') ? `${released('special')} Spezial` : null,
      upcomingCount ? `${upcomingCount} angekündigt` : null,
      `Spieldaten vom ${date}`,
    ].filter(Boolean).join(' · ');
  }

  function init() {
    data = Dyna.loadData('ranking');
    if (!data) return;
    state.type = typeFromHash() ?? state.type;
    readControls();
    recomputeRoles();
    Dyna.renderSources(data);
    render();
    Dyna.enhanceScroller(document.getElementById('type-bar'));
    bindControls();
    const bar = document.getElementById('type-bar');
    bar.querySelector(`[data-type="${state.type}"]`)?.scrollIntoView({ block: 'nearest', inline: 'center' });
  }

  document.addEventListener('DOMContentLoaded', init);
})();
