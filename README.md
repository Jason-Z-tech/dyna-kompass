# Dyna-Kompass

Zwei Seiten für Max-Kämpfe in **Pokémon GO**:

- **Typ-Rangliste** (`index.html`): die stärksten Dynamax- und Gigadynamax-Angreifer für jeden der 18 Typen,
  mit Basiswerten, WP auf Level 40/50 und allen Attacken. Suche über alle Typen, Filter, Sortierung.
  Angekündigte Pokémon stehen schon in der Liste, markiert mit „Ab 24. Oktober“ und noch ohne Platz.
- **G-Max-Konter** (`konter.html`): für jeden Gigadynamax-Boss drei Team-Vorschläge
  (Voller Angriff · Ausgewogen · Sicher mit Heilung) und die besten Angreifer, Tanks und Heiler.

Für normale Raids ab 5 Sternen (Legendäre, Mega- und Crypto-Raids) gibt es den
[Raid-Kompass](https://jason-z-tech.github.io/raid-kompass/) – beide Seiten verlinken sich gegenseitig.

**Online:** https://jason-z-tech.github.io/dyna-kompass/

## Starten

Lokal: `index.html` doppelklicken. Die Seite braucht keinen Server und keine Installation.
Direktlinks: `index.html#typ=water`, `konter.html#boss=gengar`.

## Veröffentlichen (GitHub Pages)

Die Seite liegt im Repository `Jason-Z-tech/dyna-kompass` und wird von GitHub Pages direkt aus dem
Branch `main` ausgeliefert. Änderungen gehen online, sobald sie committet und gepusht sind:

```powershell
git add -A
git commit -m "Daten aktualisiert"
git push
```

Nach etwa einer Minute ist die neue Version online.

**Wenn sich etwas in `js/` oder `css/` geändert hat:** vor dem Push in `index.html`, `konter.html` und
`datenschutz.html` den Zusatz `?v=2026-10-05-3` an den Skript- und Stylesheet-Adressen auf das heutige Datum setzen
(suchen und ersetzen; am selben Tag mit `-2`, `-3` … anhängen). Browser behalten Dateien von GitHub Pages bis zu 10 Minuten und würden sonst alte und neue
Skripte mischen – die Seite bliebe für diese Besucher kurz leer. Nach einem reinen Daten-Update ist das nicht nötig.

GitHub Pages unterstützt keine eigenen HTTP-Header;
die Sicherheitsregeln (Content-Security-Policy) stehen deshalb als `<meta>`-Tag in jeder Seite.
`.nojekyll` sorgt dafür, dass GitHub die Dateien unverändert ausliefert.

## Testen

```powershell
node tests/e2e.mjs                                               # lokale Kopie
node tests/e2e.mjs --url https://jason-z-tech.github.io/dyna-kompass/   # veröffentlichte Seite
```

Startet ein unsichtbares Chrome (oder Edge) und klickt alle Knöpfe aller Seiten mit echten Mausklicks durch –
auf Desktop-, Tablet- und Handy-Breite. Prüft u. a., dass jeder Knopf reagiert, nicht verdeckt ist,
die angezeigte Liste zum gedrückten Knopf passt und der Browser keine Fehler meldet (z. B. fehlende Dateien).
Für angekündigte Pokémon stellt der Test Datum und Uhrzeit im Browser um: eine halbe Stunde vor dem
Erscheinungstag müssen sie markiert sein und bei den Kontern fehlen, eine halbe Stunde nach Mitternacht ganz
normal dabei sein. Jede Bildschirmbreite läuft dabei in einer anderen Zeitzone (Zürich, Los Angeles, Auckland),
damit ein um einen Tag verrutschtes Datum auffällt.

## Daten aktualisieren

Wenn neue Dynamax- oder Gigadynamax-Pokémon angekündigt werden oder erscheinen:

```powershell
node scripts/build-data.mjs --refresh
```

Das Skript:
1. lädt die aktuellen Spieldaten (Game Master von [PokeMiners](https://github.com/PokeMiners/game_masters)),
2. liest im [Pokémon GO Wiki](https://pokemongo.fandom.com/wiki/List_of_Dynamax_Pok%C3%A9mon_by_release_date), welche Dynamax-Pokémon erschienen oder **mit festem Datum angekündigt** sind (siehe [Angekündigte Pokémon](#angekündigte-pokémon)),
3. holt deutsche Namen und Bilder von [PokeAPI](https://pokeapi.co),
4. verkleinert die Bilder auf 256 px (`scripts/resize-images.ps1`, nutzt Windows-Bordmittel),
5. schreibt alles nach `data/pokemon-data.js`.

Ohne `--refresh` werden die zwischengespeicherten Daten aus `scripts/.cache/` verwendet.
Benötigt nur Node.js (ab Version 18), keine Pakete.

## Angekündigte Pokémon

Dynamax-Pokémon, die das Wiki schon mit festem Datum ankündigt, nimmt das Daten-Skript mit auf
(`releaseDate` liegt dann in der Zukunft). Bis zu ihrem Erscheinungstag

- stehen sie in der Typ-Rangliste an der Stelle, an der sie einsteigen werden – mit der Marke „Ab 24. Oktober“,
  aber ohne Platznummer. Die Plätze zeigen also immer, was heute einsetzbar ist.
- zählen sie bei den G-Max-Kontern nicht mit (weder in den Team-Vorschlägen noch in den Rollen-Listen).

Die Seite vergleicht dafür das Datum des Geräts mit dem Erscheinungstag und schaltet das Pokémon am Tag selbst
frei – ohne neuen Build und ohne Push. Ein `--refresh` braucht es erst wieder, wenn das Wiki Neues ankündigt
oder sich ein Datum ändert. Gigadynamax-Pokémon haben im Wiki kein Datum und kommen erst nach ihrem Erscheinen dazu.

### Korrekturen zum Wiki (`RELEASE_NOTES`)

Das Wiki nennt den Tag, an dem ein Pokémon zum ersten Mal **irgendwo auf der Welt** erscheint – auch wenn das
nur ein Vor-Ort-Event mit Ticket ist oder nur eine Weltregion. Die Seite soll aber sagen, ab wann alle es
bekommen können. Dafür gibt es oben in `scripts/build-data.mjs` die kleine, von Hand gepflegte Liste `RELEASE_NOTES`:

- `releaseDate` ersetzt das Wiki-Datum durch den Tag, ab dem das Pokémon weltweit erhältlich ist
  (Beispiel: Dialga laut Wiki 6.11.2026 in Sendai, weltweit erst am 14.11.2026).
- `region` nennt die Weltregion, in der ein Pokémon ausschließlich erscheint. Die Seite zeigt dann
  „Nur Asien-Pazifik“ auf der Karte und einen Hinweis in den Team-Vorschlägen.

Bei jedem Lauf listet das Skript auf, was das Wiki ankündigt, samt dem Satz aus dem Wiki. Nennt der Satz ein Event
oder Regionen und fehlt ein Eintrag, steht am Ende ein „Hinweis – bitte prüfen“. Dann die offizielle Ankündigung
auf [pokemongo.com](https://pokemongo.com/de/news) lesen, den Eintrag mit Quelle ergänzen und neu bauen.

## So wird gerechnet

- **Max-Schaden:** Stärke der Max-Attacke auf Stufe 3 (350, G-Max 450) × Angriff bei Level 40 mit 15/15/15 × 1,2 bei gleichem Typ (STAB). Danach ist sortiert.
- **Dyna-Attacke:** Bei Dynamax bestimmt der Typ der Sofort-Attacke den Typ der Max-Attacke. Pro Typ wird die schnellste passende Sofort-Attacke gewählt. Gigadynamax hat immer die feste G-Max-Attacke.
- **Laden:** Treffer pro Sekunde der gewählten Sofort-Attacke. In starken Max-Kämpfen bringt jeder Treffer etwa 1 Punkt für die Dyna-Leiste.
- **Haltbarkeit:** Verteidigung × KP bei Level 40.

Die Werte sind ein Vergleich untereinander, keine exakte Schadensberechnung gegen einen bestimmten Boss.

**G-Max-Konter** (Typ-Effektivität aus den Spieldaten):

- **Angreifer:** Max-Schaden × Effektivität der besten Max-Attacke gegen die Boss-Typen.
- **Tanks:** Verteidigung × (KP + 3 Dyna-Wall-Schilde à 60 KP) ÷ durchschnittliche Wirkung der Boss-Lade-Attacken.
- **Heiler:** Dyna-Kur heilt 16 % der KP des Heilers; wer die Boss-Attacken schlechter aushält als der Durchschnitt, wird abgewertet.
- Der Boss setzt zufällig Lade-Attacken aus seinem ganzen Pool ein (auch Elite), daher wird über alle gemittelt.
- Team-Vorschläge nehmen die Besten je Rolle, ohne dieselbe Art doppelt einzusetzen.

## Aufbau

```
index.html                Seite Typ-Rangliste
konter.html               Seite G-Max-Konter
datenschutz.html          Datenschutzerklärung
assets/favicon.svg        Seiten-Icon (eigenes Design)
css/style.css             Design (beide Seiten)
js/shared.js              gemeinsame Bausteine und Kampf-Logik
js/app.js                 Typ-Rangliste: Filter, Suche, Sortierung
js/counters.js            G-Max-Konter: Teams, Rollen-Listen
tests/e2e.mjs             Klick-Test aller Knöpfe
tests/browser.mjs         steuert Chrome für den Test
data/pokemon-data.js      erzeugte Daten (nicht von Hand bearbeiten)
assets/img/               Pokémon-Bilder (erzeugt)
assets/fonts/             Schriften, lokal eingebunden
scripts/build-data.mjs    Daten-Skript
scripts/resize-images.ps1 Bilder verkleinern
.nojekyll                 GitHub Pages liefert die Dateien unverändert aus
_headers                  Sicherheits-Header, falls die Seite später auf Netlify / Cloudflare Pages umzieht
```

## Lizenzen und Hinweise

- **Schriften:** Chakra Petch und Manrope, SIL Open Font License (siehe `assets/fonts/OFL-*.txt`).
- **Bilder:** Offizielle Artworks über PokeAPI. Sie sind urheberrechtlich geschützt (Nintendo / Creatures / GAME FREAK)
  und werden hier ohne Lizenz in einem nicht-kommerziellen Fanprojekt verwendet – wie auf vielen Pokémon-GO-Infoseiten.
- Inoffizielles, nicht-kommerzielles Fanprojekt ohne Verbindung zu Nintendo, The Pokémon Company oder Scopely.
  Pokémon, Pokémon GO und die Namen der Pokémon sind Marken von Nintendo. © Pokémon/Nintendo/Creatures/GAME FREAK.

## Plan B: Bilder entfernen

Falls eine Löschaufforderung (z. B. an GitHub) kommt, sofort ohne offizielle Bilder neu bauen und veröffentlichen:

```powershell
node scripts/build-data.mjs --no-images   # entfernt assets/img/, zeigt Pokédex-Nummer + Typfarben
git add -A
git commit -m "Offizielle Artworks entfernt"
git push
```

Wichtig: Die Bilder bleiben danach noch in der Git-Historie. Verlangt die Meldung auch deren Entfernung,
muss die Historie bereinigt oder das Repository neu angelegt werden.
Mit einem normalen `node scripts/build-data.mjs` kommen die Bilder aus dem Cache zurück.
