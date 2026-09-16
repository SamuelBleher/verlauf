// Router und Rahmen. Hash-Routing, weil GitHub Pages keine Rewrites kann —
// ein Reload auf /eintrag/xyz wäre sonst ein 404.

import * as db from './db.js';
import * as sync from './sync.js';
import { icon, toast } from './ui/components.js';
import * as timeline from './ui/timeline.js';
import * as entryEdit from './ui/entry-edit.js';
import * as entryView from './ui/entry-view.js';
import * as conditions from './ui/conditions.js';
import * as search from './ui/search.js';
import * as settings from './ui/settings.js';

const viewEl = document.getElementById('view');
const topbarEl = document.getElementById('topbar');
const tabbarEl = document.getElementById('tabbar');

const TABS = [
  { href: '#/', label: 'Verlauf', icon: 'timeline' },
  { href: '#/themen', label: 'Themen', icon: 'layers' },
  { href: '#/eintrag/neu', label: 'Neu', icon: 'plus', add: true },
  { href: '#/suche', label: 'Suche', icon: 'search' },
  { href: '#/einstellungen', label: 'Mehr', icon: 'settings' }
];

const ROUTES = [
  [/^#?\/?$/,                            () => timeline.view],
  [/^#\/themen$/,                        () => conditions.listView],
  [/^#\/thema\/([^/]+)\/bearbeiten$/,    () => conditions.editView, 'id'],
  [/^#\/thema\/([^/]+)$/,                () => conditions.detailView, 'id'],
  [/^#\/eintrag\/([^/?]+)\/bearbeiten$/, () => entryEdit.view, 'id'],
  [/^#\/eintrag\/neu/,                   () => entryEdit.view, null, { id: 'neu' }],
  [/^#\/eintrag\/([^/?]+)$/,             () => entryView.view, 'id'],
  [/^#\/suche$/,                         () => search.view],
  [/^#\/einstellungen$/,                 () => settings.view],
  [/^#\/konflikte$/,                     () => settings.conflictsView]
];

let scrollMemory = new Map();
let currentHash = '';

function navigate(hash, { replace = false } = {}) {
  if (replace) location.replace(hash);
  else location.hash = hash;
}
function back(fallback = '#/') {
  if (history.length > 1) history.back();
  else navigate(fallback, { replace: true });
}

function matchRoute(hash) {
  const clean = hash.split('?')[0];
  for (const [re, get, key, preset] of ROUTES) {
    const m = re.exec(clean);
    if (m) {
      const params = { ...(preset || {}) };
      if (key) params[key] = decodeURIComponent(m[1]);
      return { render: get(), params };
    }
  }
  return null;
}

async function render() {
  const hash = location.hash || '#/';
  if (currentHash) scrollMemory.set(currentHash, viewEl.parentElement === document.body ? window.scrollY : window.scrollY);
  currentHash = hash;

  const route = matchRoute(hash);
  if (!route) {
    viewEl.innerHTML = '<div class="empty"><h2>Seite nicht gefunden</h2></div>';
    drawTopbar({ title: 'Verlauf' });
    return;
  }

  let page;
  try {
    page = await route.render({ params: route.params, navigate, back });
  } catch (err) {
    console.error(err);
    viewEl.innerHTML = `<div class="empty"><h2>Da ist etwas schiefgegangen</h2><p>${err.message || err}</p></div>`;
    return;
  }

  viewEl.innerHTML = page.html || '';
  drawTopbar(page);
  drawTabs(hash);
  page.mount?.(viewEl);

  const y = scrollMemory.get(hash);
  window.scrollTo(0, page.back ? 0 : (y || 0));
  viewEl.focus({ preventScroll: true });
}

function drawTopbar(page) {
  const left = page.back
    ? `<button class="iconbtn" id="tb-back" aria-label="Zurück">${icon('back')}</button>`
    : '';
  const action = page.action
    ? `<a class="iconbtn" href="${page.action.href}" aria-label="${page.action.label}">${icon(page.action.icon)}</a>`
    : `<button class="iconbtn" id="tb-sync" aria-label="Synchronisieren">${icon('sync')}</button>`;

  topbarEl.innerHTML = `${left}
    <h1>${page.title || 'Verlauf'}${page.subtitle ? `<span class="sub">${page.subtitle}</span>` : ''}</h1>
    <span id="tb-state"></span>${action}`;
  topbarEl.querySelector('#tb-back')?.addEventListener('click', () => back());
  topbarEl.querySelector('#tb-sync')?.addEventListener('click', runSync);
  drawSyncState();
}

function drawTabs(hash) {
  const activeFor = h => {
    if (h === '#/') return /^#?\/?$/.test(hash) || hash.startsWith('#/eintrag/');
    if (h === '#/themen') return hash.startsWith('#/thema');
    if (h === '#/einstellungen') return hash.startsWith('#/einstellungen') || hash.startsWith('#/konflikte');
    return hash.startsWith(h);
  };
  tabbarEl.innerHTML = TABS.map(t => `
    <button class="tab${t.add ? ' add' : ''}" data-href="${t.href}"
      ${!t.add && activeFor(t.href) ? 'aria-current="page"' : ''}>
      ${t.add ? `<span class="ring">${icon(t.icon)}</span>` : icon(t.icon)}
      <span>${t.label}</span>
    </button>`).join('');
  tabbarEl.querySelectorAll('[data-href]').forEach(b => {
    b.onclick = () => navigate(b.dataset.href);
  });
}

function drawSyncState() {
  const slot = document.getElementById('tb-state');
  if (!slot) return;
  const { running, lastError, pending } = sync.status;
  if (running) { slot.innerHTML = `<span class="syncdot pending"></span>`; return; }
  if (lastError) { slot.innerHTML = `<span class="syncdot err" title="${lastError}"></span>`; return; }
  if (pending) { slot.innerHTML = `<span class="syncdot pending" title="${pending} nicht gesichert"></span>`; return; }
  slot.innerHTML = sync.status.lastSyncAt ? `<span class="syncdot ok"></span>` : '';
}

async function runSync() {
  const s = await db.getSettings();
  if (!db.isConfigured(s)) { navigate('#/einstellungen'); toast('Erst das private Repo eintragen.'); return; }
  const btn = document.getElementById('tb-sync');
  btn?.querySelector('svg')?.classList.add('spin');
  try {
    const r = await sync.sync();
    if (r) toast(r.pulled || r.pushed ? `${r.pulled} geladen, ${r.pushed} gesichert` : 'Alles aktuell');
    if (r && r.pulled) render();
  } catch (err) { toast(err.message, 'err'); }
  finally { btn?.querySelector('svg')?.classList.remove('spin'); }
}

/* ── Start ─────────────────────────────────────────────── */

/** Ein leerer Bildschirm sagt nichts. Lieber zeigen, was schiefging. */
function fatal(err, hint) {
  const msg = (err && (err.message || err.name)) || String(err);
  viewEl.innerHTML = `<div class="empty">
    <h2>Die App konnte nicht starten</h2>
    <p>${hint || ''}</p>
    <p style="font-family:ui-monospace,monospace;font-size:.75rem;color:var(--ink-dim);
       word-break:break-word;text-align:left;background:var(--film);padding:.6rem;border-radius:8px">${
      String(msg).replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]))}</p>
    <button class="btn" onclick="location.reload()">Neu laden</button>
  </div>`;
  console.error(err);
}

/** IndexedDB fehlt im privaten Modus mancher Browser — ohne sie geht hier nichts. */
async function checkStorage() {
  if (!self.indexedDB) throw new Error('IndexedDB ist in diesem Browser nicht verfügbar.');
  await db.open();
}

async function boot() {
  try {
    await checkStorage();
  } catch (err) {
    fatal(err, 'Der Browser lässt keinen lokalen Speicher zu. Im privaten Modus ist das normal — bitte in einem normalen Tab öffnen.');
    return;
  }
  const s = await db.getSettings();
  settings.applyTheme(s.theme);
  await sync.init();
  db.requestPersistence();

  sync.bus.addEventListener('status', drawSyncState);
  sync.bus.addEventListener('done', drawSyncState);
  sync.bus.addEventListener('error', drawSyncState);

  window.addEventListener('hashchange', render);
  window.addEventListener('online', () => {
    db.getSettings().then(cfg => { if (cfg.autoSync && db.isConfigured(cfg)) sync.sync().catch(() => {}); });
  });
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState !== 'visible') return;
    db.getSettings().then(cfg => {
      if (cfg.autoSync && db.isConfigured(cfg) && navigator.onLine) {
        sync.sync().then(r => { if (r?.pulled) render(); }).catch(() => {});
      }
    });
  });

  document.getElementById('boot-note')?.remove();
  await render();

  if (db.isConfigured(s) && navigator.onLine && s.autoSync) {
    sync.sync().then(r => { if (r?.pulled) render(); }).catch(err => toast(err.message, 'err'));
  }

  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register(new URL('../sw.js', import.meta.url), { scope: './' })
      .catch(() => { /* offline ist dann eben nicht */ });
  }
}

window.addEventListener('unhandledrejection', ev => {
  if (!document.getElementById('boot-note')) return;   // nur während des Starts
  fatal(ev.reason, 'Beim Start ist ein Fehler aufgetreten.');
});

boot().catch(err => fatal(err, 'Beim Start ist ein Fehler aufgetreten.'));
