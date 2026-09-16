#!/usr/bin/env node
// Regressionslauf für die Oberfläche.
//
//   node tools/check.mjs            nur prüfen
//   node tools/check.mjs --shots    zusätzlich Screenshots nach screenshots/
//
// Prüft drei Dinge, die sich gegenseitig nicht ersetzen:
//   1. Struktur  — rendert die Ansicht überhaupt etwas
//   2. Layout    — kein horizontaler Überlauf, Tap-Ziele groß genug, Kontrast
//   3. Sichtbarkeit — elementFromPoint: liegt etwas ÜBER dem Inhalt?
// Punkt 3 gibt es, weil genau das einmal durchgerutscht ist: die Lightbox lag
// als schwarze Fläche über der ganzen App, während jede DOM-Prüfung grün war.

import { spawn } from 'node:child_process';
import { connect, sleep } from './cdp.mjs';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SHOTS = process.argv.includes('--shots');
const PORT = 8749, DEBUG_PORT = 9556;
const WIDTHS = [320, 390, 430];
const ROUTES = [
  ['#/', 'verlauf'], ['#/themen', 'themen'], ['#/eintrag/neu', 'neuer-eintrag'],
  ['#/suche', 'suche'], ['#/einstellungen', 'einstellungen']
];   // die Detailansicht mit Anhängen kommt nach dem Seeding dazu

const problems = [];
const note = m => problems.push(m);

function findChromium() {
  const base = path.join(process.env.HOME, '.cache/ms-playwright');
  if (fs.existsSync(base)) {
    for (const d of fs.readdirSync(base).filter(d => d.startsWith('chromium-'))) {
      const p = path.join(base, d, 'chrome-linux/chrome');
      if (fs.existsSync(p)) return p;
    }
  }
  // Systembrowser rastert auf diesem Rechner nicht, reicht aber zum Prüfen.
  return '/usr/bin/google-chrome';
}

const lum = css => {
  const [r, g, b] = css.match(/[\d.]+/g).slice(0, 3).map(Number)
    .map(v => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
const contrast = (fg, bg) => {
  const a = lum(fg), b = lum(bg);
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
};

const server = spawn('python3', ['-m', 'http.server', String(PORT), '--bind', '127.0.0.1'],
  { cwd: ROOT, stdio: 'ignore' });
const profile = fs.mkdtempSync('/tmp/verlauf-check-');
const browser = spawn(findChromium(), ['--headless=new', '--no-sandbox', '--disable-gpu',
  `--remote-debugging-port=${DEBUG_PORT}`, `--user-data-dir=${profile}`, '--hide-scrollbars', 'about:blank'],
  { stdio: 'ignore' });

const cleanup = () => { try { server.kill(); browser.kill(); fs.rmSync(profile, { recursive: true, force: true }); } catch { /* egal */ } };
process.on('exit', cleanup);

await sleep(3500);
const c = await connect(DEBUG_PORT);
await c.send('Page.enable'); await c.send('Runtime.enable'); await c.send('Log.enable'); await c.send('Network.enable');
await c.send('Network.setBypassServiceWorker', { bypass: true });
await c.send('Network.setCacheDisabled', { cacheDisabled: true });

const base = `http://127.0.0.1:${PORT}/`;
const go = async (url, wait = 1600) => { await c.send('Page.navigate', { url }); await sleep(wait); };

await c.send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
await go(base + 'tools/seed.html', 3000);
const seeded = await c.eval("document.getElementById('out').textContent");
if (!/fertig/.test(seeded)) note(`Demodaten fehlgeschlagen: ${seeded}`);
console.log('Demodaten:', seeded);
// Eintrag mit Bild und Aufnahme mitprüfen — dort entstehen die Anhangskarten.
const withAtts = (seeded.match(/\(([^)]+)\)/) || [])[1];
if (withAtts) ROUTES.push(['#/eintrag/' + withAtts, 'eintrag-anhaenge']);
else note('Eintrag mit Anhängen nicht gefunden');

for (const scheme of ['light', 'dark']) {
  await c.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: scheme }] });
  for (const width of WIDTHS) {
    await c.send('Emulation.setDeviceMetricsOverride', { width, height: 844, deviceScaleFactor: 1, mobile: true });
    for (const [hash, name] of ROUTES) {
      const tag = `${scheme} ${width}px ${hash}`;
      await go(base + hash);

      const r = await c.eval(`(() => {
        const view = document.getElementById('view');
        const out = {
          text: (view?.innerText || '').trim().length,
          fatal: /konnte nicht starten|Wird geladen/.test(view?.innerText || ''),
          overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
          past: [...document.querySelectorAll('#view *, .tabbar *, .topbar *')]
            .filter(e => { const b = e.getBoundingClientRect(); return b.width > 0 && b.right > ${width} + 1; })
            .map(e => e.className || e.tagName).slice(0, 3),
          taps: [...document.querySelectorAll('button, a, select, textarea, input:not([type=checkbox]):not([type=range])')]
            .filter(e => { const b = e.getBoundingClientRect(); return b.width > 0 && b.height > 0 && b.height < 32; })
            .map(e => (e.className || e.tagName) + ':' + Math.round(e.getBoundingClientRect().height)).slice(0, 4),
          overlays: [],
          // SVG ohne width/height wächst auf Containergröße. Zweimal passiert:
          // Lightbox als schwarze Fläche, Mikrofon über die ganze Aufnahmekarte.
          fatIcons: [...document.querySelectorAll('svg')]
            .filter(e => !e.classList.contains('spark') && !e.classList.contains('spark-lg'))
            .filter(e => { const b = e.getBoundingClientRect(); return b.width > 48 || b.height > 48; })
            .map(e => (e.parentElement?.className || '?') + ' → ' +
                 Math.round(e.getBoundingClientRect().width) + 'px').slice(0, 3)
        };
        // Sichtbarkeit: liegt an typischen Stellen das, was dort liegen soll?
        for (const el of document.querySelectorAll('#view h1, #view h2, .tl-title, .btn, .tab')) {
          const b = el.getBoundingClientRect();
          if (b.width < 4 || b.height < 4) continue;
          const top = document.elementFromPoint(b.left + b.width / 2, b.top + b.height / 2);
          if (top && top !== el && !el.contains(top) && !top.contains(el)) {
            // Topbar, Tabbar und Toast liegen absichtlich oben; Inhalt scrollt
            // darunter durch. Alles andere, was den Inhalt verdeckt, ist ein Fehler.
            if (!top.closest('.tabbar, .topbar, #toast')) {
              out.overlays.push((el.className || el.tagName) + ' verdeckt von ' + (top.id || top.className || top.tagName));
            }
          }
          if (out.overlays.length > 2) break;
        }
        const probe = document.querySelector('#view h2, #view h1, .tl-title');
        if (probe) {
          out.fg = getComputedStyle(probe).color;
          out.bg = getComputedStyle(document.body).backgroundColor;
        }
        return out;
      })()`);

      if (!r.text) note(`${tag}: Ansicht ist leer`);
      // Der Startfehler-Bildschirm hat Text — ohne diese Prüfung gilt er als "rendert".
      if (r.fatal) note(`${tag}: App startet nicht (Fehlerbildschirm steht)`);
      if (r.overflow > 0) note(`${tag}: ${r.overflow}px horizontaler Überlauf`);
      if (r.past.length) note(`${tag}: ragt rechts heraus — ${r.past.join(', ')}`);
      if (r.taps.length) note(`${tag}: Tap-Ziel unter 32px — ${r.taps.join(', ')}`);
      for (const o of r.overlays) note(`${tag}: ${o}`);
      for (const f of r.fatIcons) note(`${tag}: Icon zu groß — ${f}`);
      if (r.fg && r.bg) {
        const ratio = contrast(r.fg, r.bg);
        if (ratio < 4.5) note(`${tag}: Kontrast ${ratio.toFixed(2)}:1 (${r.fg} auf ${r.bg})`);
      }

      const { errors } = c.drain();
      for (const e of errors.filter(e => !/favicon/.test(e))) note(`${tag}: ${e}`);

      if (SHOTS && width === 390) {
        const dir = path.join(ROOT, 'screenshots');
        fs.mkdirSync(dir, { recursive: true });
        await c.screenshot(path.join(dir, `${name}-${scheme === 'dark' ? 'dunkel' : 'hell'}.png`));
      }
    }
  }
}

console.log(`\n${problems.length ? problems.length + ' Befund(e):' : 'Keine Befunde.'}`);
for (const p of problems) console.log('  - ' + p);
if (SHOTS) console.log('\nScreenshots in screenshots/');
c.close();
cleanup();
process.exit(problems.length ? 1 : 0);
