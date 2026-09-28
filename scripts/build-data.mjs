// Baut data/pokemon-data.js aus den Spieldaten (Game Master), den Release-Listen des
// Pokémon-GO-Wikis und PokeAPI (deutsche Namen, Bilder). Nur Node-Bordmittel.
// Aufruf: node scripts/build-data.mjs [--refresh] [--no-images]
//   --refresh    Spieldaten und Wiki-Listen neu herunterladen
//   --no-images  Plan B: ohne offizielle Artworks bauen und assets/img/ entfernen

import { mkdir, readFile, writeFile, access, rm } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CACHE_DIR = path.join(ROOT, 'scripts', '.cache');
const IMG_RAW_DIR = path.join(CACHE_DIR, 'img');
const IMG_DIR = path.join(ROOT, 'assets', 'img');
const OUT_FILE = path.join(ROOT, 'data', 'pokemon-data.js');
const REFRESH = process.argv.includes('--refresh');
const NO_IMAGES = process.argv.includes('--no-images');

const GAME_MASTER_URL = 'https://raw.githubusercontent.com/PokeMiners/game_masters/master/latest/latest.json';
const GAME_MASTER_COMMITS_URL = 'https://api.github.com/repos/PokeMiners/game_masters/commits?per_page=1';
const WIKI_API = 'https://pokemongo.fandom.com/api.php?action=parse&prop=wikitext&format=json&page=';
const WIKI_DYNAMAX_PAGE = 'List_of_Dynamax_Pok%C3%A9mon_by_release_date';
const WIKI_GIGANTAMAX_PAGE = 'Gigantamax';
const POKEAPI = 'https://pokeapi.co/api/v2';

// Max-Attacken auf Stufe 3 (Quelle für alle Max-Werte: Pokémon GO Wiki, Seite "Max Moves").
const MAX_MOVE_POWER = 350;
const GMAX_MOVE_POWER = 450;
const STAB = 1.2;
// Dyna-Wall: +60 KP pro Schild (Stufe 3), max. 3 Schilde. Dyna-Kur: heilt 16 % der KP des Heilers.
const MAX_GUARD_HP = 60;
const MAX_GUARD_USES = 3;
const MAX_SPIRIT_HEAL = 0.16;
// CP-Multiplikator für Level 40 und 50, gerechnet wird mit perfekten Werten (15/15/15).
const CPM_40 = 0.7903;
const CPM_50 = 0.84029999;
const PERFECT_IV = 15;

const TYPES = {
  NORMAL: 'Normal', FIRE: 'Feuer', WATER: 'Wasser', GRASS: 'Pflanze', ELECTRIC: 'Elektro',
  ICE: 'Eis', FIGHTING: 'Kampf', POISON: 'Gift', GROUND: 'Boden', FLYING: 'Flug',
  PSYCHIC: 'Psycho', BUG: 'Käfer', ROCK: 'Gestein', GHOST: 'Geist', DRAGON: 'Drache',
  DARK: 'Unlicht', STEEL: 'Stahl', FAIRY: 'Fee',
};

// ---------- Hilfsfunktionen ----------

const typeKey = (gmType) => gmType?.replace('POKEMON_TYPE_', '');

async function exists(file) {
  try { await access(file); return true; } catch { return false; }
}

async function fetchWithRetry(url, asJson, tries = 3) {
  for (let attempt = 1; ; attempt++) {
    try {
      const res = await fetch(url, { headers: { 'User-Agent': 'pokemon-go-dynamax-builder' } });
      if (res.status === 404) return null;
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return asJson ? await res.json() : Buffer.from(await res.arrayBuffer());
    } catch (err) {
      if (attempt >= tries) throw new Error(`Download fehlgeschlagen: ${url} (${err.message})`);
      await new Promise((r) => setTimeout(r, 1000 * attempt));
    }
  }
}

// Lädt JSON und legt es im Cache ab, damit wiederholte Builds schnell sind.
async function cachedJson(name, url, { refreshable = false } = {}) {
  const file = path.join(CACHE_DIR, `${name}.json`);
  if (await exists(file) && !(refreshable && REFRESH)) {
    return JSON.parse(await readFile(file, 'utf8'));
  }
  const data = await fetchWithRetry(url, true);
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, JSON.stringify(data));
  return data;
}

// Führt async-Aufgaben mit begrenzter Parallelität aus (schont die PokeAPI).
async function mapLimited(items, limit, fn) {
  const results = new Array(items.length);
  let next = 0;
  const workers = Array.from({ length: limit }, async () => {
    while (next < items.length) {
      const i = next++;
      results[i] = await fn(items[i], i);
    }
  });
  await Promise.all(workers);
  return results;
}

const titleCase = (id) => id.toLowerCase().split(/[_\s-]+/).map((w) => w[0].toUpperCase() + w.slice(1)).join(' ');

// ---------- Wiki: welche Pokémon sind wirklich erschienen? ----------

function parseTemplateParams(raw) {
  const positional = [];
  const named = {};
  for (const part of raw.split('|')) {
    const eq = part.indexOf('=');
    if (eq > 0) named[part.slice(0, eq).trim()] = part.slice(eq + 1).trim();
    else positional.push(part.trim());
  }
  return { positional, named };
}

function parseReleasedDynamax(wikitext, today) {
  const sections = wikitext.split(/^==([^=].*?)==\s*$/m);
  const released = new Map();
  for (let i = 1; i < sections.length; i += 2) {
    const heading = sections[i].replace(/\{\{Nth\|(\d+)\}\}/, '$1').trim();
    const date = new Date(heading);
    if (Number.isNaN(date.getTime()) || date > today) continue;
    for (const m of sections[i + 1].matchAll(/\{\{P\|([^}]*)\}\}/g)) {
      const { positional, named } = parseTemplateParams(m[1]);
      if (named.dynamax !== 't') continue;
      const key = `${positional[0]}|${named.form ?? ''}`;
      if (!released.has(key)) {
        released.set(key, { name: positional[0], form: named.form ?? null, releaseDate: date.toISOString().slice(0, 10) });
      }
    }
  }
  return [...released.values()];
}

function parseReleasedGigantamax(wikitext) {
  const start = wikitext.indexOf('{{PH|Gigantamax Pokémon}}');
  const end = wikitext.indexOf('{{PH|Unreleased Gigantamax Pokémon}}', start);
  if (start < 0 || end < 0) throw new Error('Gigantamax-Liste im Wiki nicht gefunden – Seitenaufbau hat sich geändert.');
  const block = wikitext.slice(start, end);
  return [...block.matchAll(/\{\{P\|([^}]*)\}\}/g)]
    .map((m) => parseTemplateParams(m[1]))
    .filter(({ named }) => named.gigantamax === 't')
    .map(({ positional, named }) => ({ name: positional[0], form: named.form ?? null }));
}

// ---------- Game Master auswerten ----------

const SPECIAL_SPECIES_IDS = { 'Nidoran♀': 'NIDORAN_FEMALE', 'Nidoran♂': 'NIDORAN_MALE' };

function speciesIdFromName(name) {
  return SPECIAL_SPECIES_IDS[name] ?? name.toUpperCase().replace(/[.'’:]/g, '').replace(/[\s-]+/g, '_');
}

function formIdFromWiki(speciesId, wikiForm) {
  if (!wikiForm) return null;
  const clean = wikiForm.replace(/\s+(Form|Style)$/i, '').toUpperCase().replace(/[\s-]+/g, '_');
  return `${speciesId}_${clean}`;
}

function indexGameMaster(gm) {
  const pokemon = new Map();   // pokemonId -> [pokemonSettings]
  const moves = new Map();     // Attacken-Name -> moveSettings (Raid-/Max-Kampf-Werte)
  const moveNamesById = new Map(); // Neuere Attacken haben nur eine Nummer als ID
  const gmaxMoves = new Map(); // "POKEMON|FORM" -> movementId
  const maxMoveByType = new Map(); // Typ -> Max-Attacke (z. B. FIRE -> VN_BM_001)
  const typeScalars = new Map();   // Angriffstyp -> Faktoren gegen alle Verteidigertypen
  const dexById = new Map();   // pokemonId -> Pokédex-Nummer
  for (const { templateId, data } of gm) {
    if (data?.pokemonSettings) {
      const p = data.pokemonSettings;
      if (!pokemon.has(p.pokemonId)) pokemon.set(p.pokemonId, []);
      pokemon.get(p.pokemonId).push(p);
      const dex = Number(/^V(\d{4})_POKEMON_/.exec(templateId)?.[1]);
      if (dex) dexById.set(p.pokemonId, dex);
    } else if (data?.moveSettings && /^V\d+_MOVE_|^VN_BM_/.test(templateId)) {
      const name = templateId.replace(/^V\d+_MOVE_/, '');
      moves.set(name, data.moveSettings);
      if (typeof data.moveSettings.movementId === 'number') moveNamesById.set(data.moveSettings.movementId, name);
    } else if (data?.sourdoughMoveMappingSettings) {
      for (const m of data.sourdoughMoveMappingSettings.mappings) {
        gmaxMoves.set(`${m.pokemonId}|${m.form ?? ''}`, m.move);
      }
    } else if (data?.breadMoveMappings) {
      for (const m of data.breadMoveMappings.mappings) maxMoveByType.set(typeKey(m.type), m.move);
    } else if (data?.typeEffective) {
      typeScalars.set(typeKey(data.typeEffective.attackType), data.typeEffective.attackScalar);
    }
  }
  return { pokemon, moves, moveNamesById, gmaxMoves, maxMoveByType, typeScalars, dexById };
}

// Reihenfolge der Verteidiger-Typen in "attackScalar" (interne Typ-Nummerierung des Spiels).
const SCALAR_ORDER = ['NORMAL', 'FIGHTING', 'FLYING', 'POISON', 'GROUND', 'ROCK', 'BUG', 'GHOST', 'STEEL',
  'FIRE', 'WATER', 'GRASS', 'ELECTRIC', 'PSYCHIC', 'ICE', 'DRAGON', 'DARK', 'FAIRY'];

// Typ-Tabelle: effectiveness[Angriffstyp][Verteidigertyp] = Faktor (1.6 / 1 / 0.625 / 0.390625).
function buildTypeEffectiveness(index) {
  if (index.typeScalars.size !== SCALAR_ORDER.length) {
    throw new Error(`Typ-Tabelle unvollständig: ${index.typeScalars.size} statt 18 Typen in den Spieldaten.`);
  }
  const table = {};
  for (const [attackType, scalars] of index.typeScalars) {
    table[attackType] = Object.fromEntries(SCALAR_ORDER.map((defType, i) => [defType, scalars[i]]));
  }
  return table;
}

// Deutsche Namen der Max-Attacken je Typ, z. B. FIRE -> "Dyna-Brand" (vfxName "max_flare").
async function loadMaxMoveNames(index) {
  const result = {};
  await mapLimited([...index.maxMoveByType], 6, async ([type, moveId]) => {
    const slug = index.moves.get(moveId).vfxName.replace(/_/g, '-');
    const data = await cachedJson(`pokeapi/move-${slug}`, `${POKEAPI}/move/${slug}`).catch(() => null);
    result[type] = germanName(data?.names) ?? titleCase(slug);
  });
  return result;
}

function findSettings(index, speciesId, formId) {
  const all = index.pokemon.get(speciesId);
  if (!all) return null;
  if (formId) return all.find((p) => p.form === formId) ?? null;
  return all.find((p) => p.form === `${speciesId}_NORMAL`) ?? all.find((p) => !p.form) ?? all[0];
}

// Das Wiki nennt bei Gigadynamax keine Form. Hat eine Art mehrere Gigadynamax-Formen
// (z. B. Riffex Hoch-/Tiefform), bekommt jede Form einen eigenen Eintrag.
function expandGmaxForms(index, released) {
  return released.flatMap((src) => {
    if (src.form) return [src];
    const speciesId = speciesIdFromName(src.name);
    const forms = [...index.gmaxMoves.keys()]
      .filter((k) => k.startsWith(`${speciesId}|`))
      .map((k) => k.split('|')[1])
      .filter((f) => f && f !== `${speciesId}_NORMAL`);
    return forms.length > 1 ? forms.map((formId) => ({ ...src, formId })) : [src];
  });
}

function gmaxMoveFor(index, speciesId, formId) {
  const form = formId ?? `${speciesId}_NORMAL`;
  return index.gmaxMoves.get(`${speciesId}|${form}`) ?? index.gmaxMoves.get(`${speciesId}|`) ?? null;
}

// ---------- Kennzahlen ----------

function effectiveStats(base, cpm) {
  return {
    atk: (base.baseAttack + PERFECT_IV) * cpm,
    def: (base.baseDefense + PERFECT_IV) * cpm,
    hp: Math.floor((base.baseStamina + PERFECT_IV) * cpm),
  };
}

function combatPower(base, cpm) {
  const a = base.baseAttack + PERFECT_IV;
  const d = base.baseDefense + PERFECT_IV;
  const s = base.baseStamina + PERFECT_IV;
  return Math.max(10, Math.floor((a * Math.sqrt(d) * Math.sqrt(s) * cpm * cpm) / 10));
}

const moveName = (index, id) => (typeof id === 'number' ? index.moveNamesById.get(id) : id);

function describeMove(index, rawId, isElite, names) {
  const moveId = moveName(index, rawId);
  const m = moveId && index.moves.get(moveId);
  if (!m) return null;
  return {
    id: moveId,
    name: names.get(moveId) ?? titleCase(moveId.replace(/_FAST$/, '')),
    type: typeKey(m.pokemonType),
    power: m.power ?? 0,
    durationS: m.durationMs / 1000,
    energy: m.energyDelta ?? 0,
    elite: isElite,
  };
}


// ---------- Deutsche Namen und Bilder (PokeAPI) ----------

const germanName = (names) => names?.find((n) => n.language.name === 'de')?.name ?? null;

function pokeApiMoveSlug(moveId) {
  return moveId.replace(/_FAST$/, '').toLowerCase().replace(/_/g, '-');
}

function pokeApiPokemonSlug(speciesId, formId, gmax) {
  let slug = speciesId.toLowerCase().replace(/_/g, '-');
  if (formId) slug = formId.toLowerCase().replace(/_/g, '-');
  else if (speciesId === 'TOXTRICITY') slug = 'toxtricity-amped';
  return gmax ? `${slug}-gmax` : slug;
}

async function loadMoveNames(moveIds) {
  const names = new Map();
  await mapLimited([...moveIds], 6, async (id) => {
    const slug = id.startsWith('VN_BM_') ? null : pokeApiMoveSlug(id);
    if (!slug) return;
    const data = await cachedJson(`pokeapi/move-${slug}`, `${POKEAPI}/move/${slug}`).catch(() => null);
    const de = germanName(data?.names);
    if (de) names.set(id, de);
  });
  return names;
}

// Deutscher Formname, z. B. "Hoch-Form" für TOXTRICITY_AMPED; sonst englisch.
async function germanFormName(entry) {
  const slug = entry.formId.toLowerCase().replace(/_/g, '-');
  const form = await cachedJson(`pokeapi/form-${slug}`, `${POKEAPI}/pokemon-form/${slug}`).catch(() => null);
  return germanName(form?.form_names) ?? titleCase(entry.formId.slice(entry.speciesId.length + 1));
}

// Standardform einer Art bei PokeAPI, z. B. "darmanitan-standard" für Flampivian.
async function defaultVarietySlug(dex) {
  const species = await cachedJson(`pokeapi/species-${dex}`, `${POKEAPI}/pokemon-species/${dex}`).catch(() => null);
  return species?.varieties?.find((v) => v.is_default)?.pokemon?.name ?? null;
}

async function loadImage(key, slugs, dex) {
  const target = path.join(IMG_RAW_DIR, `${key}.png`);
  if (await exists(target)) return true;
  const candidates = [...slugs, dex ? await defaultVarietySlug(dex) : null];
  for (const s of candidates.filter(Boolean)) {
    const data = await cachedJson(`pokeapi/pokemon-${s}`, `${POKEAPI}/pokemon/${s}`).catch(() => null);
    const url = data?.sprites?.other?.['official-artwork']?.front_default;
    if (!url) continue;
    const buf = await fetchWithRetry(url, false);
    if (!buf) continue;
    await mkdir(IMG_RAW_DIR, { recursive: true });
    await writeFile(target, buf);
    return true;
  }
  return false;
}

// ---------- Datensätze bauen ----------

function buildEntry(index, source, kind, moveNames) {
  const speciesId = speciesIdFromName(source.name);
  const formId = source.formId ?? formIdFromWiki(speciesId, source.form);
  const settings = findSettings(index, speciesId, formId);
  if (!settings) return { error: `Nicht in den Spieldaten gefunden: ${source.name} ${source.form ?? ''}` };

  const types = [typeKey(settings.type), typeKey(settings.type2)].filter(Boolean);
  const fast = [
    ...(settings.quickMoves ?? []).map((id) => describeMove(index, id, false, moveNames)),
    ...(settings.eliteQuickMove ?? []).map((id) => describeMove(index, id, true, moveNames)),
  ].filter(Boolean);
  const charged = [
    ...(settings.cinematicMoves ?? []).map((id) => describeMove(index, id, false, moveNames)),
    ...(settings.eliteCinematicMove ?? []).map((id) => describeMove(index, id, true, moveNames)),
  ].filter(Boolean);

  const s40 = effectiveStats(settings.stats, CPM_40);
  const key = `${kind}-${(formId ?? speciesId).toLowerCase()}`;
  const entry = {
    key,
    kind, // "dynamax" oder "gigantamax"
    speciesId,
    formId,
    dex: index.dexById.get(speciesId) ?? null,
    nameEn: source.name + (formId ? ` (${titleCase(formId.slice(speciesId.length + 1))})` : ''),
    types,
    base: { atk: settings.stats.baseAttack, def: settings.stats.baseDefense, sta: settings.stats.baseStamina },
    cp40: combatPower(settings.stats, CPM_40),
    cp50: combatPower(settings.stats, CPM_50),
    // Effektive Werte bei Level 40 und 15/15/15 – Grundlage für die Rangliste im Browser.
    atk40: Math.round(s40.atk * 10) / 10,
    def40: Math.round(s40.def * 10) / 10,
    hp40: s40.hp,
    fastMoves: fast,
    chargedMoves: charged,
    gmaxMove: null,
    releaseDate: source.releaseDate ?? null,
  };

  if (kind === 'gigantamax') {
    const moveId = gmaxMoveFor(index, speciesId, formId);
    const move = moveId && index.moves.get(moveId);
    if (!move) return { error: `Keine G-Max-Attacke gefunden: ${source.name}` };
    const vfx = move.vfxName.replace(/^gmax_/, '');
    entry.gmaxMove = { id: moveId, name: `G-Max ${titleCase(vfx)}`, type: typeKey(move.pokemonType) };
  }
  return { entry };
}

// ---------- Ablauf ----------

async function main() {
  await mkdir(CACHE_DIR, { recursive: true });
  const today = new Date();

  console.log('1/5 Spieldaten laden …');
  const gm = await cachedJson('game-master', GAME_MASTER_URL, { refreshable: true });
  const commits = await cachedJson('game-master-commit', GAME_MASTER_COMMITS_URL, { refreshable: true });
  const index = indexGameMaster(gm);

  console.log('2/5 Release-Listen aus dem Wiki laden …');
  const dynWiki = await cachedJson('wiki-dynamax', WIKI_API + WIKI_DYNAMAX_PAGE, { refreshable: true });
  const gmaxWiki = await cachedJson('wiki-gigantamax', WIKI_API + WIKI_GIGANTAMAX_PAGE, { refreshable: true });
  const releasedDyn = parseReleasedDynamax(dynWiki.parse.wikitext['*'], today);
  const releasedGmax = expandGmaxForms(index, parseReleasedGigantamax(gmaxWiki.parse.wikitext['*']));
  console.log(`   ${releasedDyn.length} Dynamax, ${releasedGmax.length} Gigadynamax erschienen`);

  console.log('3/5 Deutsche Namen laden …');
  const moveIds = new Set();
  for (const src of [...releasedDyn, ...releasedGmax]) {
    const sid = speciesIdFromName(src.name);
    const s = findSettings(index, sid, formIdFromWiki(sid, src.form));
    for (const id of [...(s?.quickMoves ?? []), ...(s?.eliteQuickMove ?? []), ...(s?.cinematicMoves ?? []), ...(s?.eliteCinematicMove ?? [])]) {
      const name = moveName(index, id);
      if (name) moveIds.add(name);
    }
  }
  const moveNames = await loadMoveNames(moveIds);
  const maxMoveNames = await loadMaxMoveNames(index);

  const entries = [];
  const errors = [];
  for (const [list, kind] of [[releasedDyn, 'dynamax'], [releasedGmax, 'gigantamax']]) {
    for (const src of list) {
      const { entry, error } = buildEntry(index, src, kind, moveNames);
      if (error) errors.push(error); else entries.push(entry);
    }
  }

  await mapLimited(entries, 6, async (e) => {
    if (!e.dex) return;
    const species = await cachedJson(`pokeapi/species-${e.dex}`, `${POKEAPI}/pokemon-species/${e.dex}`).catch(() => null);
    const base = germanName(species?.names) ?? e.nameEn;
    const formLabel = e.formId ? ` (${await germanFormName(e)})` : '';
    e.name = e.kind === 'gigantamax' ? `Gigadynamax-${base}${formLabel}` : `${base}${formLabel}`;
  });

  const missingImages = [];
  if (NO_IMAGES) {
    // Plan B: Die Seite zeigt statt Artworks Pokédex-Nummer und Typfarben.
    console.log('4/5 Ohne Bilder (--no-images): assets/img/ wird entfernt …');
    for (const e of entries) e.image = null;
    await rm(IMG_DIR, { recursive: true, force: true });
    console.log('5/5 Daten schreiben …');
  } else {
    console.log('4/5 Bilder laden …');
    await mapLimited(entries, 4, async (e) => {
      const gmax = e.kind === 'gigantamax';
      const slugs = [pokeApiPokemonSlug(e.speciesId, e.formId, gmax)];
      if (gmax) slugs.push(pokeApiPokemonSlug(e.speciesId, e.formId, false));
      const ok = await loadImage(e.key, slugs, gmax ? null : e.dex);
      e.image = ok ? `assets/img/${e.key}.png` : null;
      if (!ok) missingImages.push(e.nameEn);
    });

    console.log('5/5 Bilder verkleinern und Daten schreiben …');
    await mkdir(IMG_DIR, { recursive: true });
    const resize = spawnSync('powershell', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File',
      path.join(ROOT, 'scripts', 'resize-images.ps1'), '-Source', IMG_RAW_DIR, '-Target', IMG_DIR, '-Size', '256'], { encoding: 'utf8' });
    if (resize.status !== 0) throw new Error(`Bilder verkleinern fehlgeschlagen:\n${resize.stderr || resize.stdout}`);
  }

  entries.sort((a, b) => (a.dex ?? 9999) - (b.dex ?? 9999) || a.kind.localeCompare(b.kind));
  const output = {
    generatedAt: new Date().toISOString(),
    sources: {
      gameMasterDate: commits?.[0]?.commit?.author?.date ?? null,
      gameMaster: { name: 'PokeMiners/game_masters', url: 'https://github.com/PokeMiners/game_masters' },
      releases: { name: 'Pokémon GO Wiki (Fandom)', url: 'https://pokemongo.fandom.com/wiki/List_of_Dynamax_Pok%C3%A9mon_by_release_date' },
      names: { name: 'PokeAPI', url: 'https://pokeapi.co/' },
    },
    rules: {
      maxMovePower: MAX_MOVE_POWER, gmaxMovePower: GMAX_MOVE_POWER, stab: STAB,
      maxGuardHp: MAX_GUARD_HP, maxGuardUses: MAX_GUARD_USES, maxSpiritHeal: MAX_SPIRIT_HEAL,
      level: 40, iv: '15/15/15',
    },
    types: TYPES,
    maxMoves: maxMoveNames,
    typeEffectiveness: buildTypeEffectiveness(index),
    pokemon: entries,
  };
  await mkdir(path.dirname(OUT_FILE), { recursive: true });
  await writeFile(OUT_FILE, `// Automatisch erzeugt von scripts/build-data.mjs – nicht von Hand bearbeiten.\nwindow.POKEMON_DATA = ${JSON.stringify(output)};\n`);

  console.log(`\nFertig: ${entries.length} Einträge → ${path.relative(ROOT, OUT_FILE)}`);
  if (errors.length) console.warn(`\nWarnung – nicht zugeordnet (${errors.length}):\n  ${errors.join('\n  ')}`);
  if (missingImages.length) console.warn(`\nWarnung – ohne Bild (${missingImages.length}):\n  ${missingImages.join('\n  ')}`);
}

main().catch((err) => {
  console.error(`\nFehler: ${err.message}`);
  process.exit(1);
});
