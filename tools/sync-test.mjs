#!/usr/bin/env node
// Sync-Test gegen echtes GitHub. Zwei Browserprofile = zwei Geräte.
// Läuft ausschließlich gegen krankenakte-test; der Repo-Name steht fest im Code,
// damit ein Tippfehler nicht die echte Akte trifft.
//
//   node tools/sync-test.mjs
//
// Braucht ~/.config/verlauf-test-token (Contents: Read and write).

import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { connect, sleep } from './cdp.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OWNER = 'SamuelBleher', REPO = 'krankenakte-test', BRANCH = 'main';
const PORT = 8752;
const TOKEN = fs.readFileSync(path.join(process.env.HOME, '.config/verlauf-test-token'), 'utf8').trim();

let pass = 0, fail = 0;
const ok = (label, cond, detail = '') => {
  if (cond) { pass++; console.log('  ok   ' + label); }
  else { fail++; console.log('  FAIL ' + label + (detail ? '  → ' + detail : '')); }
};

/* ── GitHub direkt, zum Gegenprüfen ────────────────────── */
const api = async (p, opts = {}) => {
  const r = await fetch(`https://api.github.com/repos/${OWNER}/${REPO}${p}`, {
    ...opts,
    headers: { Authorization: `Bearer ${TOKEN}`, Accept: 'application/vnd.github+json',
               'X-GitHub-Api-Version': '2022-11-28', ...(opts.headers || {}) }
  });
  if (!r.ok) throw new Error(`${p} → ${r.status} ${await r.text()}`);
  return r.status === 204 ? null : r.json();
};

const headSha = async () => (await api(`/git/ref/heads/${BRANCH}`)).object.sha;

async function listFiles() {
  const tree = await api(`/git/trees/${await headSha()}?recursive=1`);
  return tree.tree.filter(n => n.type === 'blob').map(n => n.path).sort();
}
async function readFile(p) {
  const files = await api(`/git/trees/${await headSha()}?recursive=1`);
  const node = files.tree.find(n => n.path === p);
  if (!node) return null;
  const r = await fetch(`https://api.github.com/repos/${OWNER}/${REPO}/git/blobs/${node.sha}`,
    { headers: { Authorization: `Bearer ${TOKEN}`, Accept: 'application/vnd.github.raw' } });
  return r.text();
}

/** Repo auf nur README zurücksetzen. */
async function resetRepo() {
  const parent = await headSha();
  const blob = await api('/git/blobs', { method: 'POST',
    body: JSON.stringify({ content: '# krankenakte-test\n\nTestdaten. Wird automatisch überschrieben.\n', encoding: 'utf-8' }) });
  const tree = await api('/git/trees', { method: 'POST',
    body: JSON.stringify({ tree: [{ path: 'README.md', mode: '100644', type: 'blob', sha: blob.sha }] }) });
  const commit = await api('/git/commits', { method: 'POST',
    body: JSON.stringify({ message: 'Testlauf: zurückgesetzt', tree: tree.sha, parents: [parent] }) });
  await api(`/git/refs/heads/${BRANCH}`, { method: 'PATCH',
    body: JSON.stringify({ sha: commit.sha, force: true }) });
}

/* ── Zwei Geräte ───────────────────────────────────────── */
function findChromium() {
  const base = path.join(process.env.HOME, '.cache/ms-playwright');
  if (fs.existsSync(base)) for (const d of fs.readdirSync(base).filter(x => x.startsWith('chromium-'))) {
    const p = path.join(base, d, 'chrome-linux/chrome');
    if (fs.existsSync(p)) return p;
  }
  return '/usr/bin/google-chrome';
}

const procs = [];
async function device(name, port) {
  const profile = fs.mkdtempSync(`/tmp/verlauf-${name}-`);
  const br = spawn(findChromium(), ['--headless=new', '--no-sandbox', '--disable-gpu',
    `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`, 'about:blank'], { stdio: 'ignore' });
  procs.push({ br, profile });
  await sleep(3000);
  const c = await connect(port);
  await c.send('Page.enable'); await c.send('Runtime.enable'); await c.send('Log.enable');
  await c.send('Network.enable');
  await c.send('Network.setBypassServiceWorker', { bypass: true });
  await c.send('Network.setCacheDisabled', { cacheDisabled: true });

  const base = `http://127.0.0.1:${PORT}/`;
  const load = async (hash = '#/') => { await c.send('Page.navigate', { url: base + hash }); await sleep(1600); };
  await load();
  await c.eval(`(async () => {
    const db = await import('/js/db.js');
    await db.saveSettings({ repoOwner: ${JSON.stringify(OWNER)}, repoName: ${JSON.stringify(REPO)},
      branch: ${JSON.stringify(BRANCH)}, token: ${JSON.stringify(TOKEN)}, autoSync: false });
  })()`);

  return {
    name, c, load,
    eval: expr => c.eval(expr),
    sync: () => c.eval(`(async () => { const s = await import('/js/sync.js');
      try { const r = await s.sync(); return { ok: true, ...r }; }
      catch (e) { return { ok: false, error: e.message }; } })()`),
    entries: () => c.eval(`(async () => { const db = await import('/js/db.js');
      return (await db.listEntries()).map(e => ({ id: e.id, title: e.title, pain: e.pain,
        body: e.body, helped: e.helped, date: e.date, dirty: e.dirty })); })()`),
    conditions: () => c.eval(`(async () => { const db = await import('/js/db.js');
      return (await db.listConditions()).map(c => ({ id: c.id, name: c.name, status: c.status })); })()`),
    wipe: () => c.eval(`(async () => { const db = await import('/js/db.js'); await db.wipeAll(); return true; })()`)
  };
}

/* ── Lauf ──────────────────────────────────────────────── */
const srv = spawn('python3', ['-m', 'http.server', String(PORT), '--bind', '127.0.0.1'], { cwd: ROOT, stdio: 'ignore' });
process.on('exit', () => { try { srv.kill(); procs.forEach(p => { p.br.kill(); fs.rmSync(p.profile, { recursive: true, force: true }); }); } catch { /* egal */ } });

console.log(`Repo: ${OWNER}/${REPO}\n`);
await resetRepo();
console.log('Repo zurückgesetzt:', (await listFiles()).join(', '), '\n');

const A = await device('a', 9601);
const B = await device('b', 9602);

// 1. Anlegen und hochladen
console.log('1. Gerät A legt an und synchronisiert');
const created = await A.eval(`(async () => {
  const db = await import('/js/db.js');
  const m = await import('/js/models.js');
  const c = m.emptyCondition({ name: 'Knie links — Test', bodyPart: 'Knie', side: 'links', status: 'reha', startDate: '2026-03-07' });
  await db.saveCondition(c);
  const e = m.emptyEntry({ date: '2026-03-09', time: '15:00', type: 'arzt', conditionId: c.id,
    title: 'Erstvorstellung', body: 'Verdacht auf Riss.', helped: 'Kühlen.', pain: 7, practitioner: 'Dr. Weber' });
  await db.saveEntry(e);
  return { cid: c.id, eid: e.id };
})()`);
let r = await A.sync();
ok('Sync läuft durch', r.ok, r.error);
let files = await listFiles();
ok('Eintragsdatei liegt im Repo', files.some(f => f.startsWith('eintraege/2026/') && f.endsWith('.md')), files.join(', '));
ok('Themendatei liegt im Repo', files.some(f => f.startsWith('themen/')), files.join(', '));
const entryPath = files.find(f => f.startsWith('eintraege/'));
const md = await readFile(entryPath);
ok('Frontmatter enthält Schmerzwert', /schmerz: 7/.test(md));
ok('Freitext ist enthalten', md.includes('Verdacht auf Riss.'));
ok('"Was geholfen hat" ist enthalten', md.includes('## Was geholfen hat') && md.includes('Kühlen.'));
ok('nichts mehr offen', (await A.entries()).every(e => !e.dirty));

// 2. Zweites Gerät holt ab
console.log('\n2. Gerät B holt ab');
r = await B.sync();
ok('Sync läuft durch', r.ok, r.error);
let bEntries = await B.entries(), bConds = await B.conditions();
ok('Eintrag angekommen', bEntries.length === 1 && bEntries[0].title === 'Erstvorstellung', JSON.stringify(bEntries));
ok('Thema angekommen', bConds.length === 1 && bConds[0].name === 'Knie links — Test', JSON.stringify(bConds));
ok('Schmerz identisch', bEntries[0]?.pain === 7);
ok('Freitext identisch', bEntries[0]?.body === 'Verdacht auf Riss.');
ok('geholfen identisch', bEntries[0]?.helped === 'Kühlen.');
ok('gleiche ID (kein Duplikat)', bEntries[0]?.id === created.eid);

// 3. Änderung von B nach A
console.log('\n3. B ändert, A holt ab');
await B.eval(`(async () => { const db = await import('/js/db.js');
  const e = (await db.listEntries())[0]; e.pain = 4; e.body = 'Nachkontrolle: besser.'; await db.saveEntry(e); })()`);
r = await B.sync(); ok('B pusht', r.ok, r.error);
r = await A.sync(); ok('A pullt', r.ok, r.error);
let aEntries = await A.entries();
ok('Änderung angekommen', aEntries[0]?.pain === 4 && aEntries[0]?.body === 'Nachkontrolle: besser.', JSON.stringify(aEntries[0]));

// 4. Titeländerung = neuer Dateiname, alte Datei muss weg
console.log('\n4. Umbenennen');
const before = (await listFiles()).find(f => f.startsWith('eintraege/'));
await A.eval(`(async () => { const db = await import('/js/db.js');
  const e = (await db.listEntries())[0]; e.title = 'Kontrolle nach zwei Wochen'; await db.saveEntry(e); })()`);
r = await A.sync(); ok('A pusht Umbenennung', r.ok, r.error);
files = await listFiles();
const after = files.find(f => f.startsWith('eintraege/'));
ok('neuer Dateiname', after && after.includes('kontrolle-nach-zwei-wochen'), after);
ok('alte Datei entfernt', !files.includes(before), `alt=${before}`);
ok('genau eine Eintragsdatei', files.filter(f => f.startsWith('eintraege/')).length === 1, files.join(', '));

// 5. Konflikt: beide ändern denselben Eintrag offline
console.log('\n5. Konflikt');
await A.eval(`(async () => { const db = await import('/js/db.js');
  const e = (await db.listEntries())[0]; e.body = 'Fassung von A.'; await db.saveEntry(e); })()`);
await sleep(1100);   // B ist nachweislich neuer
await B.sync();      // B holt erst den Stand von Schritt 4
await B.eval(`(async () => { const db = await import('/js/db.js');
  const e = (await db.listEntries())[0]; e.body = 'Fassung von B.'; await db.saveEntry(e); })()`);
r = await B.sync(); ok('B pusht zuerst', r.ok, r.error);
r = await A.sync(); ok('A synchronisiert danach', r.ok, r.error);
aEntries = await A.entries();
const conflicts = await A.eval(`(async () => { const db = await import('/js/db.js');
  return (await db.all('conflicts')).map(c => c.losing?.body); })()`);
ok('neuere Fassung gewinnt', aEntries[0]?.body === 'Fassung von B.', aEntries[0]?.body);
ok('ältere Fassung ist gesichert', conflicts.includes('Fassung von A.'), JSON.stringify(conflicts));

// 6. Löschen
console.log('\n6. Löschen');
const delId = aEntries[0].id;
await A.eval(`(async () => { const db = await import('/js/db.js'); await db.softDelete('entries', ${JSON.stringify(delId)}); })()`);
r = await A.sync(); ok('A pusht Löschung', r.ok, r.error);
files = await listFiles();
ok('Datei aus dem Repo entfernt', !files.some(f => f.startsWith('eintraege/')), files.join(', '));
r = await B.sync(); ok('B synchronisiert', r.ok, r.error);
ok('Eintrag auch auf B weg', (await B.entries()).length === 0, JSON.stringify(await B.entries()));

// 7. Gerät ohne lokale Daten stellt alles wieder her
console.log('\n7. Wiederherstellung auf leerem Gerät');
await A.eval(`(async () => { const db = await import('/js/db.js');
  const m = await import('/js/models.js');
  const cs = await db.listConditions();
  await db.saveEntry(m.emptyEntry({ date: '2026-05-02', type: 'physio', title: 'Physio Einheit 9',
    conditionId: cs[0].id, pain: 2, body: 'Läuft.' }));
})()`);
await A.sync();
await B.wipe();
await B.load();
r = await B.sync(); ok('leeres Gerät synchronisiert', r.ok, r.error);
bEntries = await B.entries();
ok('Eintrag wiederhergestellt', bEntries.length === 1 && bEntries[0].title === 'Physio Einheit 9', JSON.stringify(bEntries));
ok('Thema wiederhergestellt', (await B.conditions()).length === 1);

// 8. Anhänge: der Pfad, über den Befundfotos und Aufnahmen laufen
console.log('\n8. Anhang (Binärdatei)');
const att = await A.eval(`(async () => {
  const db = await import('/js/db.js');
  const m = await import('/js/models.js');
  // Kleines PNG erzeugen, damit echte Bytes durch Base64, Blob-API und Git laufen.
  const cv = document.createElement('canvas'); cv.width = 64; cv.height = 40;
  const g = cv.getContext('2d');
  g.fillStyle = '#0E1418'; g.fillRect(0, 0, 64, 40);
  g.fillStyle = '#D2495F'; g.fillRect(8, 8, 40, 12);
  const blob = await new Promise(r => cv.toBlob(r, 'image/png'));
  const buf = new Uint8Array(await blob.arrayBuffer());
  const e = (await db.listEntries())[0];
  const a = {
    id: m.newId('a'), entryId: e.id, blob, thumb: null, kind: 'image',
    name: 'Befund.png', bytes: blob.size, seconds: 0, ext: 'png', mime: 'image/png',
    path: null, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
    dirty: 1, deleted: 0
  };
  await db.put('attachments', a);
  await db.saveEntry(e);
  return { id: a.id, size: blob.size, head: Array.from(buf.slice(0, 8)) };
})()`);
r = await A.sync(); ok('A pusht Anhang', r.ok, r.error);
files = await listFiles();
const binPath = files.find(f => f.startsWith('dateien/'));
ok('Datei liegt im Repo', Boolean(binPath), files.join(', '));
const entryMd = await readFile(files.find(f => f.startsWith('eintraege/')));
ok('Eintrag verweist auf den Anhang', entryMd.includes('anhaenge:') && entryMd.includes('Befund.png'));

// Bytes im Repo müssen exakt denen im Browser entsprechen
const blobNode = (await api(`/git/trees/${await headSha()}?recursive=1`)).tree.find(n => n.path === binPath);
const raw = await fetch(`https://api.github.com/repos/${OWNER}/${REPO}/git/blobs/${blobNode.sha}`,
  { headers: { Authorization: `Bearer ${TOKEN}`, Accept: 'application/vnd.github.raw' } });
const bytes = new Uint8Array(await raw.arrayBuffer());
ok('Dateigröße stimmt', bytes.length === att.size, `${bytes.length} statt ${att.size}`);
ok('PNG-Signatur unversehrt', [...bytes.slice(0, 8)].join() === att.head.join(),
   [...bytes.slice(0, 8)].join());

// B lädt die Datei bei Bedarf nach
r = await B.sync(); ok('B synchronisiert', r.ok, r.error);
const fetched = await B.eval(`(async () => {
  const db = await import('/js/db.js');
  const sync = await import('/js/sync.js');
  const a = (await db.all('attachments')).filter(x => !x.deleted)[0];
  if (!a) return { err: 'kein Anhang bekannt' };
  const hadBlob = Boolean(a.blob);
  const blob = await sync.ensureBlob(a.id);
  const buf = new Uint8Array(await blob.arrayBuffer());
  return { hadBlob, name: a.name, size: blob.size, head: Array.from(buf.slice(0, 8)) };
})()`);
ok('B kennt den Anhang', fetched.name === 'Befund.png', JSON.stringify(fetched));
ok('B lädt ihn erst bei Bedarf', fetched.hadBlob === false);
ok('Bytes identisch nach dem Nachladen', fetched.size === att.size && fetched.head.join() === att.head.join(),
   JSON.stringify(fetched));

console.log(`\n${pass} bestanden, ${fail} fehlgeschlagen`);
process.exit(fail ? 1 : 0);
