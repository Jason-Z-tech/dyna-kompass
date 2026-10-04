// Klickt alle Knöpfe beider Seiten mit echten Mausklicks durch – auf Desktop und Handy.
// Aufruf: node tests/e2e.mjs

import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { launchBrowser } from './browser.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
// Ohne Angabe wird die lokale Kopie getestet, mit --url <Adresse> die veröffentlichte Seite.
const urlArg = process.argv.indexOf('--url');
const BASE = urlArg > 0 ? process.argv[urlArg + 1].replace(/\/?$/, '/') : null;
const url = (file, hash = '') => (BASE ? new URL(file, BASE).href : pathToFileURL(path.join(ROOT, file)).href) + hash;

// Jede Breite läuft in einer anderen Zeitzone: Ein Datum, das irgendwo über Weltzeit umgerechnet wird,
// verrutscht westlich oder östlich von Greenwich um einen Tag – und fällt dann hier auf.
const VIEWPORTS = [
  { label: 'Desktop', width: 1280, height: 900, timezone: 'Europe/Zurich' },
  { label: 'Tablet', width: 820, height: 1180, mobile: true, timezone: 'America/Los_Angeles' },
  { label: 'Handy', width: 390, height: 844, mobile: true, timezone: 'Pacific/Auckland' },
];

let passed = 0;
const failures = [];

function check(condition, message) {
  if (condition) passed++;
  else failures.push(message);
}

// Liest die aktuelle Rangliste aus dem DOM.
const rankingState = (page) => page.eval(`(() => ({
  type: document.querySelector('.type-bar__btn[aria-pressed="true"]')?.dataset.type,
  heading: document.querySelector('.ranking__type')?.textContent,
  kind: document.querySelector('input[name=kind]:checked').value,
  sort: document.querySelector('input[name=sort]:checked').value,
  elite: document.getElementById('elite').checked,
  cards: [...document.querySelectorAll('.ranking__list > li')].map((li) => ({
    name: li.querySelector('.card__name span').textContent,
    gmax: !!li.querySelector('.card__name .badge--gigantamax'),
    elite: !!li.querySelector('.card__move .badge--elite'),
    values: [...li.querySelectorAll('.meter strong')].map((s) => parseFloat(s.textContent.replace(/[’']/g, ''))),
    upcoming: li.classList.contains('card--upcoming'),
    upcomingBadge: li.querySelector('.card__name .badge--upcoming')?.textContent ?? null,
    regionBadge: li.querySelector('.card__name .badge--region')?.textContent ?? null,
    rankText: li.querySelector('.card__rank').textContent,
    podium: li.classList.contains('card--top'),
  })),
  countText: document.querySelector('.ranking__count')?.textContent,
  meta: document.getElementById('data-meta').textContent,
  countBadge: Number(document.querySelector('.type-bar__btn[aria-pressed="true"] .type-bar__count')?.textContent),
  kindCounts: Object.fromEntries([...document.querySelectorAll('[data-count]')].map((s) => [s.dataset.count, Number(s.textContent)])),
  resetVisible: !document.getElementById('reset').hidden,
  hitsVisible: !document.getElementById('search-hits').hidden,
}))()`);

const isSorted = (values) => values.every((v, i) => i === 0 || values[i - 1] >= v);

// ---------- Angekündigte Pokémon ----------

const pad2 = (n) => String(n).padStart(2, '0');
const localIsoDay = (date) => `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`;
const dayBefore = (isoDay) => new Date(Date.parse(`${isoDay}T00:00:00Z`) - 86400000).toISOString().slice(0, 10);
// Der Tag des Testlaufs. Er wird im Browser fest eingestellt, damit Seite und Test denselben Tag meinen –
// auch in einer anderen Zeitzone und wenn der Lauf über Mitternacht geht.
const TODAY = localIsoDay(new Date());

// Name -> Erscheinungstag und Region, direkt aus den Daten der Seite.
const pokemonFacts = async (page) => new Map((await page.eval(
  `window.POKEMON_DATA.pokemon.map((p) => [p.name, { releaseDate: p.releaseDate, region: p.region ?? null }])`)));

// Namen aller Pokémon, die an diesem Tag noch nicht erschienen sind – unabhängig von der Seite berechnet.
const upcomingAt = (facts, day) => new Set([...facts].filter(([, f]) => f.releaseDate && f.releaseDate > day).map(([name]) => name));

// Tageszahl eines Erscheinungstags, wie sie auf der Seite stehen muss: "2026-10-05" -> "5.".
const dayNumber = (isoDay) => `${Number(isoDay.slice(8))}.`;

// Stimmt die Marke eines angekündigten Pokémon? "Ab <Tag>. <Monat>", mit Jahr genau dann, wenn der
// Erscheinungstag nicht im Jahr des eingestellten Tages liegt.
function isUpcomingBadge(text, releaseDate, day) {
  const year = releaseDate.slice(0, 4) === day.slice(0, 4) ? '' : ` ${releaseDate.slice(0, 4)}`;
  return new RegExp(`^Ab ${Number(releaseDate.slice(8))}\\. \\p{L}+${year}$`, 'u').test(text ?? '');
}

// Prüft die Karten eines Typs: Angekündigte sind markiert und ohne Platz, alle anderen lückenlos nummeriert.
function checkUpcomingCards(s, facts, day, tag) {
  const expected = upcomingAt(facts, day);
  const wrong = s.cards.filter((c) => c.upcoming !== expected.has(c.name)).map((c) => c.name);
  check(wrong.length === 0, `${tag} falsch als angekündigt/erschienen markiert: ${wrong.join(', ')}`);
  const upcoming = s.cards.filter((c) => c.upcoming);
  check(upcoming.every((c) => !/\d/.test(c.rankText) && !c.podium), `${tag} angekündigte Karte mit Platznummer oder auf dem Podest`);
  // Die Marke nennt genau den Tag aus den Daten: "Ab 5. Oktober", in einem anderen Jahr "Ab 5. Januar 2027".
  const badBadge = upcoming.filter((c) => !isUpcomingBadge(c.upcomingBadge, facts.get(c.name).releaseDate, day));
  check(badBadge.length === 0, `${tag} Datums-Marke fehlt oder nennt den falschen Tag: ${badBadge.map((c) => `${c.name} "${c.upcomingBadge}"`).join(', ')}`);
  const released = s.cards.filter((c) => !c.upcoming);
  check(released.every((c, i) => c.rankText === String(i + 1) && !c.upcomingBadge && c.podium === (i < 3)),
    `${tag} Plätze der erschienenen Pokémon nicht lückenlos ab 1 (${released.map((c) => c.rankText).join(',')})`);
  const countLine = `${s.cards.length} Pokémon${upcoming.length ? `, davon ${upcoming.length} angekündigt` : ''} · `;
  check(s.countText.startsWith(countLine), `${tag} Zeile "${s.countText}" beginnt nicht mit "${countLine}"`);
  const badRegion = s.cards.filter((c) => c.regionBadge !== (facts.get(c.name).region ? `Nur ${facts.get(c.name).region}` : null));
  check(badRegion.length === 0, `${tag} Regions-Marke falsch bei: ${badRegion.map((c) => `${c.name} "${c.regionBadge}"`).join(', ')}`);
  // Angekündigte stehen an ihrer sortierten Stelle und zählen in allen Zählern mit.
  check(isSorted(s.cards.map((c) => c.values[0])), `${tag} Karten nicht nach Schaden sortiert`);
  const gmaxCards = s.cards.filter((c) => c.gmax).length;
  check(s.countBadge === s.cards.length && s.kindCounts.all === s.cards.length
    && s.kindCounts.gigantamax === gmaxCards && s.kindCounts.dynamax === s.cards.length - gmaxCards,
  `${tag} Zähler (Typ ${s.countBadge}, Art ${JSON.stringify(s.kindCounts)}) passen nicht zu ${s.cards.length} Karten, davon ${gmaxCards} Gigadynamax`);
}

async function testRanking(page, vp) {
  const tag = `[${vp.label} · Rangliste]`;
  console.log(`${tag} läuft …`);
  await page.goto(url('index.html'));

  const typeButtons = await page.eval(`[...document.querySelectorAll('.type-bar__btn')].map((b) => b.dataset.type)`);
  check(typeButtons.length === 18, `${tag} 18 Typ-Knöpfe erwartet, gefunden: ${typeButtons.length}`);
  check(await page.eval(`document.querySelectorAll('#sources a').length === Object.values(window.POKEMON_DATA.sources).filter((s) => s && s.url).length`),
    `${tag} Fußzeile verlinkt nicht jede Quelle aus den Daten`);
  const facts = await pokemonFacts(page);

  // Jeder Typ-Knopf
  for (const type of typeButtons) {
    await page.click(`.type-bar__btn[data-type="${type}"]`);
    const s = await rankingState(page);
    check(s.type === type, `${tag} Typ ${type}: Knopf nicht aktiv`);
    check(s.cards.length > 0 && s.cards.length === s.countBadge, `${tag} Typ ${type}: ${s.cards.length} Karten, Zähler zeigt ${s.countBadge}`);
    check(isSorted(s.cards.map((c) => c.values[0])), `${tag} Typ ${type}: nicht nach Schaden sortiert`);
    checkUpcomingCards(s, facts, TODAY, `${tag} Typ ${type}:`);
  }

  // Art-Filter mehrfach hin und her (der gemeldete Fehler)
  await page.click('.type-bar__btn[data-type="FIRE"]');
  const all = (await rankingState(page)).cards.length;
  for (const round of [1, 2]) {
    for (const kind of ['gigantamax', 'dynamax', 'all', 'gigantamax', 'all']) {
      await page.click(`input[name=kind][value=${kind}]`);
      const s = await rankingState(page);
      check(s.kind === kind, `${tag} Runde ${round}: Knopf ${kind} nicht gewählt`);
      if (kind === 'gigantamax') check(s.cards.length > 0 && s.cards.every((c) => c.gmax), `${tag} Runde ${round}: Gigadynamax zeigt falsche Karten`);
      if (kind === 'dynamax') check(s.cards.length > 0 && s.cards.every((c) => !c.gmax), `${tag} Runde ${round}: Dynamax zeigt Gigadynamax-Karten`);
      if (kind === 'all') check(s.cards.length === all, `${tag} Runde ${round}: Alle zeigt ${s.cards.length} statt ${all}`);
      check(s.kindCounts[kind] === s.cards.length, `${tag} Runde ${round}: Zähler bei ${kind} passt nicht`);
    }
  }

  // Sortierung
  for (const [sort, idx] of [['charge', 1], ['bulk', 2], ['damage', 0]]) {
    await page.click(`input[name=sort][value=${sort}]`);
    const s = await rankingState(page);
    check(s.sort === sort && isSorted(s.cards.map((c) => c.values[idx])), `${tag} Sortierung ${sort} falsch`);
  }

  // Elite-Schalter
  await page.click('.toggle');
  let s = await rankingState(page);
  check(!s.elite && s.cards.every((c) => !c.elite), `${tag} Elite aus: trotzdem Elite-Attacken sichtbar`);
  check(s.resetVisible, `${tag} Zurücksetzen-Knopf fehlt nach Filteränderung`);
  await page.click('.toggle');
  s = await rankingState(page);
  check(s.elite && s.cards.some((c) => c.elite), `${tag} Elite an: keine Elite-Attacke bei Feuer (Glurak) sichtbar`);

  // Zurücksetzen
  await page.click('input[name=kind][value=gigantamax]');
  await page.click('input[name=sort][value=bulk]');
  await page.click('#reset');
  s = await rankingState(page);
  check(s.kind === 'all' && s.sort === 'damage' && s.elite && !s.resetVisible, `${tag} Zurücksetzen stellt nicht alles zurück`);

  // Suche über alle Typen + Sprung per Treffer-Chip + Leeren
  await page.type('#search', 'glurak');
  s = await rankingState(page);
  const hits = await page.eval(`[...document.querySelectorAll('.search-hits__places button')].map((b) => b.textContent)`);
  check(s.hitsVisible && hits.length > 1, `${tag} Suche "glurak": keine Treffer über mehrere Typen (${hits.join(', ')})`);
  check(await page.eval(`[...document.getElementById('search-hits').childNodes].every((n) => n.nodeType === Node.ELEMENT_NODE)`), `${tag} Suchtreffer enthalten losen Text (z. B. "null")`);
  // Den ersten Treffer-Chip "Flug · Platz …" eindeutig markieren und anklicken.
  const flyingChip = await page.eval(`(() => {
    const btn = [...document.querySelectorAll('.search-hits__places button')].find((b) => b.textContent.startsWith('Flug'));
    if (!btn) return null;
    btn.dataset.test = 'flying-chip';
    return { text: btn.textContent, name: btn.closest('.search-hits__row').querySelector('.search-hits__name span').textContent };
  })()`);
  check(flyingChip, `${tag} Suche: Glurak nicht in der Flug-Liste`);
  if (flyingChip) {
    await page.click('[data-test="flying-chip"]');
    s = await rankingState(page);
    check(s.type === 'FLYING' && s.cards.some((c) => c.name.includes('Glurak')), `${tag} Klick auf Treffer-Chip springt nicht zu Flug`);
    // Der Platz im Chip ist derselbe wie auf der Karte – auch wenn die Suche die Liste kürzt.
    const hitCard = s.cards.find((c) => c.name === flyingChip.name);
    check(Boolean(hitCard) && flyingChip.text === `Flug · ${hitCard.upcoming ? 'bald' : `Platz ${hitCard.rankText}`}`,
      `${tag} Treffer-Chip "${flyingChip.text}" passt nicht zur Karte von ${flyingChip.name} (Platz-Feld "${hitCard?.rankText}")`);
  }
  await page.click('#search-clear');
  s = await rankingState(page);
  check(!s.hitsVisible && (await page.eval(`document.getElementById('search').value`)) === '', `${tag} Suche leeren funktioniert nicht`);

  // Karte auf- und zuklappen
  await page.click('.ranking__list > li:first-child summary');
  check(await page.eval(`document.querySelector('.ranking__list > li:first-child details').open`), `${tag} Karte klappt nicht auf`);
  check(await page.eval(`document.querySelectorAll('.ranking__list > li:first-child .moves tbody tr').length > 0`), `${tag} Details ohne Attacken`);
  await page.click('.ranking__list > li:first-child summary');
  check(!(await page.eval(`document.querySelector('.ranking__list > li:first-child details').open`)), `${tag} Karte klappt nicht zu`);

  // Wischleiste mit Pfeilen (nur wenn die Leiste scrollt)
  const scrollable = await page.eval(`(() => { const t = document.getElementById('type-bar'); t.scrollLeft = 0; return t.scrollWidth > t.clientWidth; })()`);
  if (scrollable) {
    await new Promise((r) => setTimeout(r, 200));
    await page.click('.type-bar .scroll-arrow--next');
    await new Promise((r) => setTimeout(r, 400));
    check(await page.eval(`document.getElementById('type-bar').scrollLeft > 0`), `${tag} Pfeil nach rechts scrollt nicht`);
  } else {
    check(await page.eval(`[...document.querySelectorAll('.type-bar__btn')].every((b) => { const r = b.getBoundingClientRect(); return r.right <= innerWidth && r.left >= 0; })`), `${tag} Nicht alle Typen sichtbar`);
  }

  // Direktlink per Adresse
  await page.goto(url('index.html', '#typ=water'));
  s = await rankingState(page);
  check(s.type === 'WATER' && s.heading === 'Wasser', `${tag} Link #typ=water öffnet nicht Wasser`);

  // Neuladen mit wiederhergestellten Formularwerten: Anzeige muss zur Liste passen
  await page.click('input[name=kind][value=gigantamax]');
  await page.reload();
  s = await rankingState(page);
  const consistent = s.kind === 'gigantamax' ? s.cards.every((c) => c.gmax) : s.kind === 'all';
  check(consistent, `${tag} Nach Neuladen passen Knopf (${s.kind}) und Liste nicht zusammen`);

  // Navigation zur Konter-Seite
  await page.click('.page-nav__link[href="konter.html"]');
  await new Promise((r) => setTimeout(r, 600));
  check((await page.eval('location.pathname')).endsWith('konter.html'), `${tag} Navigation zur Konter-Seite klappt nicht`);
}

const counterState = (page) => page.eval(`(() => ({
  boss: document.querySelector('.boss-btn[aria-pressed="true"]')?.dataset.boss,
  bossName: document.getElementById('boss-name')?.textContent,
  teams: [...document.querySelectorAll('.team')].map((t) => [...t.querySelectorAll('.member')].map((m) => ({
    role: m.className.replace('member member--', ''),
    name: m.querySelector('.member__name span:last-child').textContent,
  }))),
  tab: document.querySelector('.tabs__btn[aria-selected="true"]')?.textContent,
  rows: document.querySelectorAll('#role-panel > li').length,
  metric: document.querySelector('#role-panel .meter__head span')?.textContent,
  eliteInActions: document.querySelectorAll('.member__action .badge--elite, .row__detail .badge--elite').length,
  elite: document.getElementById('elite')?.checked,
}))()`);

async function testCounters(page, vp) {
  const tag = `[${vp.label} · Konter]`;
  console.log(`${tag} läuft …`);
  await page.goto(url('konter.html'));
  const bosses = await page.eval(`[...document.querySelectorAll('.boss-btn')].map((b) => b.dataset.boss)`);
  check(bosses.length === 18, `${tag} 18 Boss-Knöpfe erwartet, gefunden: ${bosses.length}`);

  for (const key of bosses) {
    await page.click(`.boss-btn[data-boss="${key}"]`);
    const s = await counterState(page);
    const btnName = await page.eval(`document.querySelector('.boss-btn[data-boss="${key}"] .boss-btn__name').textContent`);
    check(s.boss === key && s.bossName.includes(btnName), `${tag} Boss ${key}: Auswahl/Überschrift falsch (${s.bossName})`);
    check(s.teams.length === 3 && s.teams.every((t) => t.length === 3), `${tag} Boss ${key}: nicht 3 Teams à 3`);
    const [attack, balanced, safe] = s.teams;
    check(attack.every((m) => m.role === 'attacker'), `${tag} Boss ${key}: Voller Angriff enthält Nicht-Angreifer`);
    check(balanced.filter((m) => m.role === 'tank').length === 1, `${tag} Boss ${key}: Ausgewogen ohne genau 1 Tank`);
    check(safe.some((m) => m.role === 'healer') && safe.some((m) => m.role === 'tank'), `${tag} Boss ${key}: Sicher ohne Tank+Heiler`);
    check(s.teams.every((t) => new Set(t.map((m) => m.name)).size === t.length), `${tag} Boss ${key}: doppeltes Pokémon im Team`);
    check(s.rows === 12, `${tag} Boss ${key}: ${s.rows} statt 12 Zeilen`);
  }

  // Rollen-Tabs per Maus
  for (const [label, metric] of [['Tanks', 'Hält aus'], ['Heiler', 'Heilwert'], ['Angreifer', 'Schaden gegen Boss']]) {
    await page.click(`.tabs__btn:nth-child(${['Angreifer', 'Tanks', 'Heiler'].indexOf(label) + 1})`);
    const s = await counterState(page);
    check(s.tab === label && s.metric === metric && s.rows === 12, `${tag} Tab ${label}: falsche Liste (${s.tab}/${s.metric})`);
  }
  // Rollen-Tabs per Tastatur
  await page.eval(`document.querySelector('.tabs__btn[aria-selected="true"]').focus()`);
  await page.key('ArrowRight');
  let s = await counterState(page);
  check(s.tab === 'Tanks', `${tag} Pfeiltaste wechselt Tab nicht (${s.tab})`);
  check(await page.eval(`document.activeElement?.id === 'tab-tanks'`), `${tag} Fokus bleibt nicht auf dem Tab`);
  await page.key('ArrowLeft');

  // Elite-Schalter
  await page.click('.lists .toggle');
  s = await counterState(page);
  check(s.elite === false && s.eliteInActions === 0, `${tag} Elite aus: trotzdem Elite-Attacken im Vorschlag`);
  await page.click('.lists .toggle');
  s = await counterState(page);
  check(s.elite === true, `${tag} Elite lässt sich nicht wieder einschalten`);

  // Direktlink
  await page.goto(url('konter.html', '#boss=gengar'));
  s = await counterState(page);
  check(s.bossName === 'Gigadynamax-Gengar', `${tag} Link #boss=gengar öffnet ${s.bossName}`);

  // Navigation zurück
  await page.click('.page-nav__link[href="index.html"]');
  await new Promise((r) => setTimeout(r, 600));
  check((await page.eval('location.pathname')).endsWith('index.html'), `${tag} Navigation zur Rangliste klappt nicht`);
}

// Stellt Tag und Uhrzeit im Browser um: Vor dem Erscheinungstag sind Pokémon markiert und zählen bei den
// Kontern nicht mit, ab dem Tag sind sie ganz normal dabei. Die Tage kommen aus den Daten – so prüft
// der Test auch dann noch etwas, wenn alle heute angekündigten Pokémon längst erschienen sind.
async function testUpcoming(page, vp) {
  const tag = `[${vp.label} · Angekündigt]`;
  console.log(`${tag} läuft …`);
  await page.goto(url('index.html'));
  const facts = await pokemonFacts(page);
  const { total, gmaxTotal } = await page.eval(`({
    total: window.POKEMON_DATA.pokemon.length,
    gmaxTotal: window.POKEMON_DATA.pokemon.filter((p) => p.kind === 'gigantamax').length,
  })`);
  const typeButtons = await page.eval(`[...document.querySelectorAll('.type-bar__btn')].map((b) => b.dataset.type)`);
  const days = [...new Set([...facts.values()].map((f) => f.releaseDate).filter(Boolean))].sort();
  const firstDay = days[0];
  const lastDay = days.at(-1);
  const lateName = [...facts].find(([, f]) => f.releaseDate === lastDay)[0];
  // Das erste Dynamax-Pokémon erschien am 4. September 2024 – ein fester Anker gegen Daten,
  // die beim Bauen um einen Tag verrutschen.
  check(firstDay === '2024-09-04', `${tag} frühester Erscheinungstag in den Daten ist ${firstDay} statt 2024-09-04`);

  // Rangliste zu drei Zeitpunkten: vor dem allerersten Dynamax, eine halbe Stunde vor dem letzten
  // Erscheinungstag und eine halbe Stunde nach dessen Beginn.
  for (const [day, time] of [[dayBefore(firstDay), '23:30'], [dayBefore(lastDay), '23:30'], [lastDay, '00:30']]) {
    const expected = upcomingAt(facts, day);
    await page.setToday(day, time);
    await page.goto(url('index.html'));
    const marked = new Set();
    for (const type of typeButtons) {
      await page.click(`.type-bar__btn[data-type="${type}"]`);
      const s = await rankingState(page);
      checkUpcomingCards(s, facts, day, `${tag} ${day} ${time} Typ ${type}:`);
      for (const c of s.cards.filter((x) => x.upcoming)) marked.add(c.name);
    }
    check(marked.size === expected.size, `${tag} ${day} ${time}: ${marked.size} Pokémon markiert, erwartet ${expected.size}`);
    // Kopfzeile: erschienene Dynamax, Gigadynamax und Angekündigte ergeben zusammen alle Einträge.
    const { meta } = await rankingState(page);
    const metaStart = `${total - gmaxTotal - expected.size} Dynamax · ${gmaxTotal} Gigadynamax · ${expected.size ? `${expected.size} angekündigt · ` : ''}Spieldaten vom `;
    check(meta.startsWith(metaStart), `${tag} ${day} ${time}: Kopfzeile "${meta}" beginnt nicht mit "${metaStart}"`);
  }

  // Sucht ein Pokémon und liest seine Trefferzeile; der erste Sprung-Chip wird für einen Klick markiert.
  const searchHit = async (name) => {
    await page.type('#search', name);
    return page.eval(`(() => {
      const row = [...document.querySelectorAll('.search-hits__row')].find((r) => r.querySelector('.search-hits__name span').textContent === ${JSON.stringify(name)});
      const buttons = row ? [...row.querySelectorAll('.search-hits__places button')] : [];
      if (buttons[0]) buttons[0].dataset.test = 'hit-chip';
      return {
        chips: buttons.map((b) => b.textContent),
        upcomingBadge: row?.querySelector('.search-hits__name .badge--upcoming')?.textContent ?? null,
        regionBadge: row?.querySelector('.search-hits__name .badge--region')?.textContent ?? null,
      };
    })()`);
  };
  // Die Marken neben dem Namen im Suchtreffer: Datum nur vor dem Erscheinungstag, Region immer.
  const checkHitBadges = (hit, name, day, where) => {
    const fact = facts.get(name);
    const dateOk = fact.releaseDate && fact.releaseDate > day ? isUpcomingBadge(hit.upcomingBadge, fact.releaseDate, day) : hit.upcomingBadge === null;
    check(dateOk && hit.regionBadge === (fact.region ? `Nur ${fact.region}` : null),
      `${tag} ${where}: Suchtreffer für ${name} trägt die Marken "${hit.upcomingBadge}" / "${hit.regionBadge}"`);
  };

  // Suche und Details eines Pokémon kurz vor seinem Erscheinungstag und kurz nach dessen Beginn
  for (const [day, time, chipPattern, label] of [[dayBefore(lastDay), '23:30', / · bald$/, 'Dynamax ab'], [lastDay, '00:30', / · Platz \d+$/, 'Dynamax seit']]) {
    await page.setToday(day, time);
    await page.goto(url('index.html'));
    // Ein Pokémon, das nur in einer Region erscheint, trägt den Hinweis auch im Suchtreffer.
    const regional = [...facts].find(([, f]) => f.region)?.[0];
    if (regional) checkHitBadges(await searchHit(regional), regional, day, `${day} ${time}`);
    const hit = await searchHit(lateName);
    const { chips } = hit;
    check(chips.length > 0 && chips.every((c) => chipPattern.test(c)), `${tag} ${day} ${time}: Suchtreffer für ${lateName} zeigen "${chips.join(' | ')}"`);
    checkHitBadges(hit, lateName, day, `${day} ${time}`);
    if (!chips.length) continue;
    await page.click('[data-test="hit-chip"]');
    const found = await page.eval(`(() => {
      const li = [...document.querySelectorAll('.ranking__list > li')].find((x) => x.querySelector('.card__name span').textContent === ${JSON.stringify(lateName)});
      if (li) li.dataset.test = 'late-card';
      return !!li;
    })()`);
    check(found, `${tag} ${day} ${time}: Karte von ${lateName} nach Klick auf den Suchtreffer nicht in der Liste`);
    if (!found) continue;
    await page.click('[data-test="late-card"] summary');
    const shownDate = await page.eval(`(() => {
      const fact = document.querySelector('[data-test="late-card"] .facts div:last-child');
      return { label: fact.querySelector('dt').textContent, date: fact.querySelector('dd').textContent };
    })()`);
    check(shownDate.label === label && shownDate.date.startsWith(`${dayNumber(lastDay)} `) && shownDate.date.endsWith(` ${lastDay.slice(0, 4)}`),
      `${tag} ${day} ${time}: Details von ${lateName} zeigen "${shownDate.label} ${shownDate.date}" statt "${label}" mit dem ${dayNumber(lastDay)} ${lastDay.slice(0, 4)}`);
  }

  // Konter: alles, was die Seite vorschlägt – je Boss die Teams und die Listen aller drei Rollen-Tabs.
  const sweepCounters = async (bosses) => {
    const shown = [];
    for (const boss of bosses) {
      await page.click(`.boss-btn[data-boss="${boss}"]`);
      for (const tab of [1, 2, 3]) {
        await page.click(`.tabs__btn:nth-child(${tab})`);
        const items = await page.eval(`[
          ...[...document.querySelectorAll('.member')].map((m) => ({ kind: 'member', name: m.querySelector('.member__name span:last-child').textContent, note: m.querySelector('.member__reason').textContent })),
          ...[...document.querySelectorAll('#role-panel > li')].map((li) => ({ kind: 'row', name: li.querySelector('.row__name span:first-child').textContent, note: li.querySelector('.row__name .badge--region')?.textContent ?? '' })),
        ]`);
        shown.push(...items.map((item) => ({ ...item, boss, tab, releaseDate: facts.get(item.name).releaseDate, region: facts.get(item.name).region })));
      }
    }
    return shown;
  };

  // Vor dem allerersten Dynamax dürfen nur Gigadynamax-Pokémon vorgeschlagen werden (sie haben kein Datum).
  await page.setToday(dayBefore(firstDay), '23:30');
  await page.goto(url('konter.html'));
  const allBosses = await page.eval(`[...document.querySelectorAll('.boss-btn')].map((b) => b.dataset.boss)`);
  const defaultBoss = await page.eval(`document.querySelector('.boss-btn[aria-pressed="true"]').dataset.boss`);
  let shown = await sweepCounters([defaultBoss]);
  check(shown.length === 3 * (9 + 12) && shown.every((x) => !x.releaseDate), `${tag} Konter vor ${firstDay}: Dynamax-Pokémon vorgeschlagen, obwohl noch keines erschienen ist`);

  // Ab dem letzten Erscheinungstag sind alle dabei. Regionale Pokémon tragen überall ihren Hinweis.
  await page.setToday(lastDay, '00:30');
  await page.goto(url('konter.html'));
  shown = await sweepCounters(allBosses);
  check(shown.some((x) => x.releaseDate), `${tag} Konter am ${lastDay}: kein einziges Dynamax-Pokémon vorgeschlagen`);
  const badRegion = shown.filter((x) => (x.kind === 'row'
    ? x.note !== (x.region ? `Nur ${x.region}` : '')
    : x.note.includes('Erscheint nur in:') !== Boolean(x.region) || (x.region && !x.note.endsWith(` Erscheint nur in: ${x.region}.`))));
  check(badRegion.length === 0, `${tag} Konter: Regions-Hinweis falsch bei ${[...new Set(badRegion.map((x) => x.name))].join(', ')}`);

  // Das zuletzt erschienene Pokémon, das es in eine Angreifer- oder Tank-Liste schafft: Am Abend davor
  // darf es nirgends stehen, kurz nach Mitternacht muss es wieder da sein. (Diese beiden Listen hängen
  // nicht von den übrigen Pokémon ab – anders als die Heiler, die am Mittelwert aller gemessen werden.)
  const newest = shown.filter((x) => x.kind === 'row' && x.tab < 3 && x.releaseDate).sort((a, b) => b.releaseDate.localeCompare(a.releaseDate))[0];
  check(Boolean(newest), `${tag} Konter: kein Dynamax-Pokémon in den Angreifer- und Tank-Listen`);
  if (newest) {
    const eve = dayBefore(newest.releaseDate);
    await page.setToday(eve, '23:30');
    await page.goto(url('konter.html'));
    shown = await sweepCounters(allBosses);
    const tooEarly = [...new Set(shown.filter((x) => x.releaseDate && x.releaseDate > eve).map((x) => `${x.name} (Boss ${x.boss})`))];
    check(tooEarly.length === 0, `${tag} Konter am ${eve} um 23:30: noch nicht erschienen, aber vorgeschlagen: ${tooEarly.join(', ')}`);

    await page.setToday(newest.releaseDate, '00:30');
    await page.goto(url('konter.html'));
    shown = await sweepCounters([newest.boss]);
    check(shown.some((x) => x.name === newest.name), `${tag} Konter am ${newest.releaseDate} um 00:30: ${newest.name} fehlt bei Boss ${newest.boss}, obwohl erschienen`);
  }

  await page.setToday(TODAY);
}

async function testLegal(page, vp) {
  const tag = `[${vp.label} · Datenschutz]`;
  console.log(`${tag} läuft …`);
  for (const from of ['index.html', 'konter.html']) {
    await page.goto(url(from));
    await page.click('.footer a[href="datenschutz.html"]');
    await new Promise((r) => setTimeout(r, 600));
    const title = await page.eval(`document.querySelector('h1')?.textContent`);
    check(title === 'Datenschutz', `${tag} Link von ${from} öffnet nicht die Datenschutz-Seite (${title})`);
  }
  for (const target of ['index.html', 'konter.html']) {
    await page.goto(url('datenschutz.html'));
    await page.click(`.page-nav__link[href="${target}"]`);
    await new Promise((r) => setTimeout(r, 600));
    check((await page.eval('location.pathname')).endsWith(target), `${tag} Link zu ${target} klappt nicht`);
  }
}

if (BASE) console.log(`Teste veröffentlichte Seite: ${BASE}`);
for (const vp of VIEWPORTS) {
  const page = await launchBrowser(vp);
  try {
    await page.setToday(TODAY);
    await testRanking(page, vp);
    await testCounters(page, vp);
    await testUpcoming(page, vp);
    await testLegal(page, vp);
  } catch (err) {
    failures.push(`[${vp.label}] Abbruch: ${err.message}`);
  }
  for (const e of page.errors) failures.push(`[${vp.label}] JavaScript-Fehler: ${e}`);
  await page.close();
}

console.log(`\n${passed} Prüfungen bestanden, ${failures.length} fehlgeschlagen.`);
for (const f of failures) console.log(`  ✗ ${f}`);
process.exit(failures.length ? 1 : 0);
