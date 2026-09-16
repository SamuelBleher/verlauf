# Verlauf — persönliche Krankenakte

Eine kleine Web-App für die eigene Krankengeschichte: Verletzungen und
Beschwerden über die Zeit verfolgen, Arztbriefe und MRT-Befunde
abfotografieren, Arztgespräche aufnehmen, festhalten wie sich etwas angefühlt
hat und was geholfen hat.

Läuft im Browser, lässt sich auf dem Handy wie eine App installieren,
funktioniert offline. Kein Server, keine laufenden Kosten.

## Wie die Daten liegen

Die App wird öffentlich auf GitHub Pages ausgeliefert — die **Daten nicht**.
Die kommen in ein zweites, privates Repo:

```
eintraege/2026/2026-03-07-umgeknickt-beim-fussball-a1b2c3.md
themen/knie-links-innenmeniskus-d4e5f6.md
dateien/2026/a-xxxx.jpg      Fotos, PDFs
dateien/2026/a-yyyy.m4a      Aufnahmen
dateien/2026/a-yyyy.txt      Transkript dazu
```

Jeder Eintrag ist eine Markdown-Datei mit YAML-Frontmatter. Das ist Absicht:
die Akte bleibt ohne diese App lesbar — in Obsidian, in jedem Editor, in
zwanzig Jahren. Git gibt es gratis dazu: jede Änderung ist eine Version, nichts
wird still überschrieben.

Auf dem Gerät liegt alles in IndexedDB, die App arbeitet also offline und
synchronisiert im Hintergrund. Fotos und Aufnahmen werden erst beim Öffnen
nachgeladen, damit der erste Sync unterwegs kein Datenvolumen frisst.

## Einrichten

**1. Datenrepo anlegen.** Auf GitHub ein neues Repo, z. B. `krankenakte`,
**Private**, mit README initialisieren. Private Repos sind kostenlos.

**2. Token erzeugen.** Settings → Developer settings → Personal access tokens →
**Fine-grained tokens** → Generate new token:

- Repository access: **Only select repositories** → `krankenakte`
- Permissions → Repository permissions → **Contents: Read and write**
- Ablaufdatum nach Geschmack; danach in der App neu eintragen

Der Token kommt nur in den Browser-Speicher dieses Geräts und geht
ausschließlich an `api.github.com`.

**3. App veröffentlichen.** Dieses Repo zu GitHub pushen, dann
Settings → Pages → Source: *Deploy from a branch* → `main` / `/ (root)`.
Nach ein paar Minuten liegt sie unter
`https://<benutzer>.github.io/<repo>/`.

Der App-Code ist öffentlich, deine Daten nicht. Wer die URL kennt, sieht eine
leere App.

**4. Aufs Handy.** URL öffnen → Teilen → *Zum Home-Bildschirm*. Dann in den
Einstellungen der App Benutzer, Repo und Token eintragen und
**Verbindung prüfen** drücken.

## Arztgespräche aufnehmen

Im Eintrag auf **Aufnehmen**. Zwei Dinge dazu:

- **Rechtlich:** Ein Gespräch ohne Einwilligung aufzunehmen ist in Deutschland
  strafbar (§ 201 StGB). Vorher fragen — die meisten sagen ja. Die App verlangt
  eine Bestätigung und schreibt sie zur Aufnahme dazu.
- **Technisch:** iOS stoppt die Aufnahme, sobald die App in den Hintergrund geht
  oder das Display sperrt. Die App hält währenddessen einen Wake Lock, aber sie
  muss im Vordergrund bleiben. Ins Meeting also mit offener App und Handy auf
  dem Tisch.

Aufnahmen laufen mono mit 32 kbit/s — ein Gespräch von 20 Minuten wiegt etwa
5 MB.

### Transkripte

Nach dem Sync auf dem eigenen Rechner:

```sh
./tools/transkribieren.sh ~/krankenakte
```

Sucht Aufnahmen ohne Transkript, jagt sie durch `transcribe` (faster-whisper +
pyannote) und committet die Texte zurück. Beim nächsten Sync zeigt die App sie
unter dem Player an — und die Suche findet ab dann auch, was im Gespräch gesagt
wurde. Alles läuft lokal, es wird nichts hochgeladen.

Gemessen auf einem 8-Kern-Laptop (Ryzen AI 7 PRO 350), `large-v3-turbo`:

| | Tempo | 20-Minuten-Termin |
|---|---|---|
| ohne Sprechertrennung (`DIARIZE=0`) | ~4x Echtzeit | ≈ 5 min |
| mit Sprechertrennung | ~1,2x Echtzeit | ≈ 17 min |

Eine GPU braucht es dafür nicht.

**Wichtig:** Das Skript wandelt jede Aufnahme zuerst mit `tools/zu-wav.py` nach
16-kHz-Mono-WAV. pyannote bricht sonst auf komprimierten Containern ab — bei
`.webm` (das Format der App) mit einem TypeError, bei `.ogg` mit einer falschen
Sample-Zahl. Die Umwandlung läuft über PyAV, ffmpeg wird nicht gebraucht.

Stellschrauben: `MODEL=small` (schneller), `DIARIZE=0`, `PUSH=0`, `LANG_CODE=en`.

## Entwickeln

Kein Build, keine Abhängigkeiten. Reine ES-Module.

```sh
python3 -m http.server 8731
# http://127.0.0.1:8731
```

```
js/db.js         IndexedDB
js/sync.js       Sync-Motor gegen GitHub
js/repo.js       Datensatz ⇄ Markdown-Datei
js/github.js     API-Client
js/audio.js      Aufnahme
js/images.js     Bilder verkleinern
js/ui/           Ansichten
```

Nach Änderungen an App-Dateien `VERSION` in `sw.js` hochzählen, sonst hält der
Service Worker die alte Fassung noch einen Start lang fest.

### Prüfen

```sh
node tools/check.mjs           # Struktur, Layout, Kontrast, Überdeckung
node tools/check.mjs --shots   # zusätzlich Screenshots nach screenshots/
```

Läuft jede Ansicht in hell und dunkel bei 320/390/430 px durch. Neben den
üblichen Layoutprüfungen testet er mit `elementFromPoint`, ob etwas **über**
dem Inhalt liegt — genau dieser Fehler war einmal unsichtbar für jede reine
DOM-Prüfung und hat die App als schwarze Fläche ausgeliefert.

Sync gegen echtes GitHub:

```sh
node tools/sync-test.mjs
```

Zwei Browserprofile spielen zwei Geräte. Geprüft werden Hochladen, Abholen,
Änderungen in beide Richtungen, Umbenennen (alte Datei muss verschwinden),
Konflikte, Löschen, Wiederherstellung auf einem leeren Gerät und der
Binärpfad für Fotos — dort byteweise. Läuft ausschließlich gegen
`krankenakte-test`; der Name steht fest im Skript. Braucht
`~/.config/verlauf-test-token` mit Contents: Read and write auf genau dieses
eine Repo.

Für Screenshots braucht es ein Chromium, das auch wirklich rastert; das
System-Chrome auf diesem Rechner tut das nicht:

```sh
npx playwright@1.45.3 install chromium
```

`tools/seed.html` legt einen reproduzierbaren Demoverlauf an (und löscht dabei
vorhandene lokale Daten — nie auf dem Gerät mit der echten Akte öffnen).

## Grenzen

- Ein GitHub-Repo sollte unter ~1 GB bleiben. Bei komprimierten Fotos und
  32-kbit/s-Audio reicht das für viele Jahre; große Video-DICOMs gehören nicht
  hier hinein.
- Zwei Geräte, die denselben Eintrag offline ändern: die neuere Fassung gewinnt,
  die andere landet unter Einstellungen → Konflikte. Verloren geht nichts.
- Das ist eine persönliche Notizsammlung, kein Medizinprodukt.
