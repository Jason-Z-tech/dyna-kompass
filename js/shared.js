'use strict';

// Gemeinsame Bausteine für beide Seiten (Typ-Rangliste und G-Max-Konter).
// Klassisches Skript statt ES-Modul, damit die Seite auch per Doppelklick (file://) läuft.

const Dyna = (() => {
  const TYPE_ORDER = ['NORMAL', 'FIRE', 'WATER', 'GRASS', 'ELECTRIC', 'ICE', 'FIGHTING', 'POISON', 'GROUND',
    'FLYING', 'PSYCHIC', 'BUG', 'ROCK', 'GHOST', 'DRAGON', 'DARK', 'STEEL', 'FAIRY'];

  // ---------- DOM ----------

  // Baut Elemente ohne innerHTML, damit Daten nie als HTML interpretiert werden.
  function el(tag, props = {}, children = []) {
    const node = document.createElement(tag);
    for (const [key, value] of Object.entries(props)) {
      if (value === null || value === undefined || value === false) continue;
      if (key === 'class') node.className = value;
      else if (key === 'text') node.textContent = value;
      else if (key === 'style') for (const [prop, v] of Object.entries(value)) node.style.setProperty(prop, v);
      else if (key.startsWith('on')) node.addEventListener(key.slice(2), value);
      else node.setAttribute(key, value === true ? '' : value);
    }
    for (const child of [].concat(children)) {
      if (child === null || child === undefined || child === false) continue;
      node.append(child instanceof Node ? child : document.createTextNode(String(child)));
    }
    return node;
  }

  const formatNumber = (n, digits = 0) => n.toLocaleString('de-CH', { minimumFractionDigits: digits, maximumFractionDigits: digits });
  const formatFactor = (f) => `×${f.toLocaleString('de-CH', { maximumFractionDigits: 2 })}`;
  const slugOf = (type) => type.toLowerCase();

  // ---------- Datum ----------

  // Erscheinungstage sind reine Kalendertage ("2026-10-24"). Sie werden ohne Zeitzonen-Umrechnung
  // ausgegeben – sonst zeigen Geräte westlich von Greenwich den Vortag.
  const isDayOnly = (iso) => /^\d{4}-\d{2}-\d{2}$/.test(iso);
  const formatWith = (iso, options) => new Date(iso).toLocaleDateString('de-CH', isDayOnly(iso) ? { ...options, timeZone: 'UTC' } : options);
  const formatDate = (iso) => formatWith(iso, { day: 'numeric', month: 'long', year: 'numeric' });

  // Heutiger Kalendertag auf dem Gerät als "JJJJ-MM-TT" – so lässt er sich direkt mit releaseDate vergleichen.
  function todayIso() {
    const now = new Date();
    const pad = (n) => String(n).padStart(2, '0');
    return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
  }

  // Für Marken: "24. Oktober", mit Jahr nur, wenn es nicht das laufende ist.
  function formatDay(iso) {
    const sameYear = iso.slice(0, 4) === todayIso().slice(0, 4);
    return sameYear ? formatWith(iso, { day: 'numeric', month: 'long' }) : formatDate(iso);
  }

  // Angekündigt, aber noch nicht erschienen: Der Erscheinungstag liegt nach dem heutigen Tag.
  // Gigadynamax-Einträge tragen kein Datum und gelten immer als erschienen.
  const isUpcoming = (pokemon) => Boolean(pokemon.releaseDate) && pokemon.releaseDate > todayIso();

  // ---------- Kampf-Logik ----------

  // Schnellste Treffer zuerst (lädt die Dyna-Leiste), bei Gleichstand mehr Schaden pro Sekunde.
  const bySpeedThenDps = (a, b) => a.durationS - b.durationS || b.power / b.durationS - a.power / a.durationS;

  function fastMovesFor(pokemon, includeElite) {
    return pokemon.fastMoves.filter((m) => includeElite || !m.elite);
  }

  function fastestMove(pokemon, includeElite) {
    return [...fastMovesFor(pokemon, includeElite)].sort(bySpeedThenDps)[0] ?? null;
  }

  // Alle Max-Attacken, die ein Pokémon einsetzen kann: Dynamax je Sofort-Attacken-Typ, Gigadynamax fest.
  function rolesOf(pokemon, data, includeElite) {
    const fast = fastMovesFor(pokemon, includeElite);
    if (!fast.length) return [];
    if (pokemon.kind === 'gigantamax') {
      return [makeRole(pokemon, pokemon.gmaxMove.type, data.rules.gmaxMovePower, fastestMove(pokemon, includeElite), data)];
    }
    return [...new Set(fast.map((m) => m.type))].map((type) => {
      const bestFast = fast.filter((m) => m.type === type).sort(bySpeedThenDps)[0];
      return makeRole(pokemon, type, data.rules.maxMovePower, bestFast, data);
    });
  }

  function makeRole(pokemon, type, power, fastMove, data) {
    const stab = pokemon.types.includes(type);
    return {
      pokemon,
      type,
      fastMove,
      stab,
      maxMoveName: pokemon.kind === 'gigantamax' ? pokemon.gmaxMove.name : data.maxMoves[type],
      // Relativer Schaden einer Max-Attacke Stufe 3 bei Level 40 (gleicher Gegner für alle).
      maxDamage: (power * pokemon.atk40 * (stab ? data.rules.stab : 1)) / 100,
      hitsPerSecond: 1 / fastMove.durationS,
      bulk: (pokemon.def40 * pokemon.hp40) / 100,
    };
  }

  // Faktor eines Angriffstyps gegen einen oder zwei Verteidigertypen (z. B. 2.56, 1.6, 0.625).
  function effectiveness(data, attackType, defenderTypes) {
    return defenderTypes.reduce((f, t) => f * data.typeEffectiveness[attackType][t], 1);
  }

  // ---------- Bausteine ----------

  function typeChip(type, data, small = false) {
    return el('span', { class: `type-chip type-${slugOf(type)}${small ? ' type-chip--small' : ''}`, text: data.types[type] });
  }

  function kindBadge(pokemon) {
    const isGmax = pokemon.kind === 'gigantamax';
    return el('span', { class: `badge badge--${pokemon.kind}`, text: isGmax ? 'G-Max' : 'Dynamax' });
  }

  // Marke "Ab 24. Oktober" für angekündigte Pokémon; für erschienene gibt es keine (null).
  function upcomingBadge(pokemon) {
    if (!isUpcoming(pokemon)) return null;
    return el('span', { class: 'badge badge--upcoming', text: `Ab ${formatDay(pokemon.releaseDate)}` });
  }

  // Marke "Nur Asien-Pazifik" für Pokémon, die nur in einer Weltregion erscheinen; sonst keine (null).
  function regionBadge(pokemon) {
    if (!pokemon.region) return null;
    return el('span', { class: 'badge badge--region', text: `Nur ${pokemon.region}` });
  }

  // Ohne Bild (Plan B, --no-images): Pokédex-Nummer auf einem Verlauf der Typfarben.
  function artFallback(pokemon) {
    const [first, second = first] = pokemon.types.map(slugOf);
    return el('span', {
      class: 'art__fallback',
      style: { '--c1': `var(--t-${first})`, '--c2': `var(--t-${second})` },
    }, [pokemon.dex ? `#${String(pokemon.dex).padStart(3, '0')}` : '?']);
  }

  function pokemonArt(pokemon, { eager = false, size = 'md' } = {}) {
    const isGmax = pokemon.kind === 'gigantamax';
    return el('div', { class: `art art--${size}${isGmax ? ' art--gmax' : ''}` }, [
      pokemon.image
        ? el('img', { src: pokemon.image, alt: '', width: 256, height: 256, loading: eager ? 'eager' : 'lazy', decoding: 'async' })
        : artFallback(pokemon),
    ]);
  }

  function meter(label, valueText, ratio, modifier) {
    const pct = Math.max(4, Math.min(100, Math.round(ratio * 100)));
    return el('div', { class: `meter meter--${modifier}` }, [
      el('div', { class: 'meter__head' }, [el('span', { text: label }), el('strong', { text: valueText })]),
      el('div', { class: 'meter__track', role: 'img', 'aria-label': `${label}: ${valueText}` }, [
        el('span', { class: 'meter__fill', style: { '--fill': `${pct}%` } }),
      ]),
    ]);
  }

  function eliteBadge(text = 'Elite-TM') {
    return el('span', { class: 'badge badge--elite', text });
  }

  // Waagrechte Wischleiste mit Pfeil-Knöpfen; die Pfeile erscheinen nur, wenn es etwas zu scrollen gibt.
  function enhanceScroller(scroller) {
    const wrap = scroller.parentElement;
    const makeArrow = (dir) => el('button', {
      type: 'button',
      class: `scroll-arrow scroll-arrow--${dir}`,
      'aria-label': dir === 'prev' ? 'Nach links scrollen' : 'Nach rechts scrollen',
      tabindex: '-1',
      onclick: () => scroller.scrollBy({ left: (dir === 'prev' ? -1 : 1) * scroller.clientWidth * 0.8, behavior: 'smooth' }),
    });
    const prev = makeArrow('prev');
    const next = makeArrow('next');
    wrap.append(prev, next);
    const update = () => {
      const max = scroller.scrollWidth - scroller.clientWidth;
      prev.hidden = scroller.scrollLeft <= 2;
      next.hidden = scroller.scrollLeft >= max - 2;
    };
    scroller.addEventListener('scroll', update, { passive: true });
    window.addEventListener('resize', update);
    new ResizeObserver(update).observe(scroller);
    update();
    return update;
  }

  // Scrollt ein Element sanft mittig in die Wischleiste, ohne die Seite zu verschieben.
  function centerInScroller(scroller, item) {
    if (!scroller || !item) return;
    const left = item.offsetLeft - (scroller.clientWidth - item.offsetWidth) / 2;
    scroller.scrollTo({ left, behavior: 'smooth' });
  }

  // Scrollt zum Element, falls es oberhalb des sichtbaren Bereichs liegt (z. B. nach Typwechsel).
  function revealIfAbove(element, offset = 0) {
    const top = element.getBoundingClientRect().top;
    if (top < offset) window.scrollTo({ top: window.scrollY + top - offset, behavior: 'smooth' });
  }

  function loadData(containerId) {
    const data = window.POKEMON_DATA;
    if (data?.pokemon?.length) return data;
    document.getElementById(containerId).replaceChildren(el('div', { class: 'state state--error' }, [
      el('p', { class: 'state__title', text: 'Die Daten konnten nicht geladen werden.' }),
      el('p', { text: 'Die Datei data/pokemon-data.js fehlt oder ist leer. Führe "node scripts/build-data.mjs" aus.' }),
    ]));
    return null;
  }

  function renderSources(data) {
    const target = document.getElementById('sources');
    if (!target) return;
    const { gameMaster, releases, official, names, gameMasterDate } = data.sources;
    const link = (source) => el('a', { href: source.url, text: source.name });
    const hasArtwork = data.pokemon.some((p) => p.image);
    target.replaceChildren(
      'Quellen: Spieldaten von ', link(gameMaster), ` (Stand ${formatDate(gameMasterDate)}), `,
      'Erscheinungsdaten aus dem ', link(releases),
      // Eine ältere Daten-Datei aus dem Browser-Cache kennt diese Quelle noch nicht.
      ...(official ? [', bei Vor-Ort-Events und Regionen nach den Ankündigungen auf ', link(official)] : []),
      ', deutsche Namen', hasArtwork ? ' und Bilder' : '', ' von ', link(names), '. ',
      `Berechnet für Level ${data.rules.level} mit ${data.rules.iv}.`,
      // Im Plan-B-Modus (ohne Bilder) entfällt der Artwork-Hinweis automatisch.
      hasArtwork ? ' Artworks © Pokémon/Nintendo/Creatures/GAME FREAK.' : '',
    );
  }

  // Liest den Wert eines Hash-Schlüssels (#typ=fire) bzw. setzt ihn, ohne neuen Verlaufseintrag.
  function readHash() {
    return Object.fromEntries(new URLSearchParams(location.hash.slice(1)));
  }
  function writeHash(values) {
    const params = new URLSearchParams(values);
    history.replaceState(null, '', new URL(`#${params}`, location.href));
  }

  return {
    TYPE_ORDER, el, formatNumber, formatDate, formatFactor, slugOf, isUpcoming,
    bySpeedThenDps, fastestMove, rolesOf, effectiveness,
    typeChip, kindBadge, upcomingBadge, regionBadge, pokemonArt, meter, eliteBadge,
    enhanceScroller, centerInScroller, revealIfAbove, loadData, renderSources, readHash, writeHash,
  };
})();
