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

const VIEWPORTS = [
  { label: 'Desktop', width: 1280, height: 900 },
  { label: 'Tablet', width: 820, height: 1180, mobile: true },
  { label: 'Handy', width: 390, height: 844, mobile: true },
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
  })),
  countBadge: Number(document.querySelector('.type-bar__btn[aria-pressed="true"] .type-bar__count')?.textContent),
  kindCounts: Object.fromEntries([...document.querySelectorAll('[data-count]')].map((s) => [s.dataset.count, Number(s.textContent)])),
  resetVisible: !document.getElementById('reset').hidden,
  hitsVisible: !document.getElementById('search-hits').hidden,
}))()`);

const isSorted = (values) => values.every((v, i) => i === 0 || values[i - 1] >= v);

async function testRanking(page, vp) {
  const tag = `[${vp.label} · Rangliste]`;
  console.log(`${tag} läuft …`);
  await page.goto(url('index.html'));

  const typeButtons = await page.eval(`[...document.querySelectorAll('.type-bar__btn')].map((b) => b.dataset.type)`);
  check(typeButtons.length === 18, `${tag} 18 Typ-Knöpfe erwartet, gefunden: ${typeButtons.length}`);

  // Jeder Typ-Knopf
  for (const type of typeButtons) {
    await page.click(`.type-bar__btn[data-type="${type}"]`);
    const s = await rankingState(page);
    check(s.type === type, `${tag} Typ ${type}: Knopf nicht aktiv`);
    check(s.cards.length > 0 && s.cards.length === s.countBadge, `${tag} Typ ${type}: ${s.cards.length} Karten, Zähler zeigt ${s.countBadge}`);
    check(isSorted(s.cards.map((c) => c.values[0])), `${tag} Typ ${type}: nicht nach Schaden sortiert`);
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
  // Den ersten Treffer-Chip "Flug · Platz …" eindeutig markieren und anklicken.
  const flyingChip = await page.eval(`(() => {
    const btn = [...document.querySelectorAll('.search-hits__places button')].find((b) => b.textContent.startsWith('Flug'));
    if (btn) btn.dataset.test = 'flying-chip';
    return !!btn;
  })()`);
  check(flyingChip, `${tag} Suche: Glurak nicht in der Flug-Liste`);
  if (flyingChip) {
    await page.click('[data-test="flying-chip"]');
    s = await rankingState(page);
    check(s.type === 'FLYING' && s.cards.some((c) => c.name.includes('Glurak')), `${tag} Klick auf Treffer-Chip springt nicht zu Flug`);
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
    await testRanking(page, vp);
    await testCounters(page, vp);
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
