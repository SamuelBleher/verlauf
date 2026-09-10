// Sync-Motor. Grundregeln:
//   1. Nichts geht verloren. Bei einem echten Konflikt gewinnt die neuere Fassung,
//      die andere landet im Konfliktspeicher statt im Papierkorb.
//   2. Binärdateien werden erst beim Ansehen geladen — sonst zieht der erste Sync
//      auf dem Handy hunderte Megabyte Fotos.

import * as db from './db.js';
import { GitHub, GitHubError } from './github.js';
import * as repo from './repo.js';

const MIME = {
  jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp',
  heic: 'image/heic', gif: 'image/gif', pdf: 'application/pdf',
  webm: 'audio/webm', m4a: 'audio/mp4', ogg: 'audio/ogg', mp3: 'audio/mpeg', txt: 'text/plain'
};
const mimeFor = ext => MIME[String(ext).toLowerCase()] || 'application/octet-stream';

export const bus = new EventTarget();
const emit = (type, detail) => bus.dispatchEvent(new CustomEvent(type, { detail }));

export const status = { running: false, lastError: null, lastSyncAt: null, pending: 0 };

async function refreshPending() {
  status.pending = await db.countDirty();
  emit('status');
  return status.pending;
}

async function client() {
  const s = await db.getSettings();
  if (!db.isConfigured(s)) throw new GitHubError('Sync ist noch nicht eingerichtet.', 0, null);
  return new GitHub({ token: s.token, owner: s.repoOwner, repo: s.repoName, branch: s.branch || 'main' });
}

const loadState = () => db.getMeta('sync', { lastCommit: null, paths: {}, lastSyncAt: null });
const saveState = st => db.setMeta('sync', st);

/* ── Pull ──────────────────────────────────────────────── */

async function mergeRecord(store, remote) {
  const local = await db.get(store, remote.id);
  if (!local) { await db.put(store, remote); return 'neu'; }
  if (!local.dirty) {
    if (local.updatedAt === remote.updatedAt && local.path === remote.path) return null;
    await db.put(store, { ...remote });
    return 'aktualisiert';
  }
  // Beide Seiten verändert.
  if (new Date(remote.updatedAt) > new Date(local.updatedAt)) {
    await db.put('conflicts', {
      id: `${store}:${local.id}:${Date.now()}`, store, recordId: local.id,
      losing: local, at: new Date().toISOString(), reason: 'lokal überschrieben'
    });
    await db.put(store, { ...remote });
    return 'konflikt';
  }
  return null; // lokal ist neuer — bleibt dirty und wird gleich gepusht
}

async function pull(gh, state, onProgress = () => {}) {
  let head;
  try {
    head = await gh.headSha();
  } catch (err) {
    if (err.status === 409 || err.status === 404) return { head: null, empty: true, changed: 0 };
    throw err;
  }
  if (head === state.lastCommit) return { head, empty: false, changed: 0 };

  const tree = await gh.tree(head);
  const paths = {};
  for (const node of tree.tree) if (node.type === 'blob') paths[node.path] = node.sha;

  const mdPaths = Object.keys(paths).filter(p =>
    p.endsWith('.md') &&
    (p.startsWith(repo.DIR_ENTRIES + '/') || p.startsWith(repo.DIR_CONDITIONS + '/')));

  const changedPaths = mdPaths.filter(p => state.paths[p] !== paths[p]);
  let changed = 0, i = 0;

  for (const path of changedPaths) {
    onProgress(`Lade ${++i}/${changedPaths.length}`);
    const text = await gh.blobText(paths[path]);
    if (path.startsWith(repo.DIR_CONDITIONS + '/')) {
      const c = repo.markdownToCondition(text, path);
      if (await mergeRecord('conditions', c)) changed++;
    } else {
      const { entry, attachments } = repo.markdownToEntry(text, path);
      if (await mergeRecord('entries', entry)) changed++;
      for (const meta of attachments) {
        const local = await db.get('attachments', meta.id);
        const transcriptPath = repo.transcriptPathFor(meta.path);
        const hasTranscript = Boolean(paths[transcriptPath]);
        if (local) {
          // Lokalen Blob und lokale Änderungen nicht plattmachen.
          await db.put('attachments', {
            ...local, path: meta.path, name: meta.name, bytes: meta.bytes || local.bytes,
            seconds: meta.seconds || local.seconds, kind: meta.kind,
            transcriptPath: hasTranscript ? transcriptPath : local.transcriptPath || null
          });
        } else {
          await db.put('attachments', { ...meta, entryId: entry.id, transcriptPath: hasTranscript ? transcriptPath : null });
        }
      }
    }
  }

  // Remote gelöscht → lokal entfernen, sofern lokal nichts Ungesichertes dranhängt.
  for (const path of Object.keys(state.paths)) {
    if (paths[path] || !path.endsWith('.md')) continue;
    const store = path.startsWith(repo.DIR_CONDITIONS + '/') ? 'conditions' : 'entries';
    const rows = (await db.all(store)).filter(r => r.path === path && !r.dirty);
    for (const r of rows) { await db.del(store, r.id); changed++; }
  }

  // Transkripte einsammeln, die zwischenzeitlich dazugekommen sind.
  for (const att of await db.all('attachments')) {
    if (att.kind !== 'audio' || att.transcript || !att.path) continue;
    const tp = repo.transcriptPathFor(att.path);
    if (paths[tp] && paths[tp] !== att.transcriptSha) {
      const text = await gh.blobText(paths[tp]);
      await db.put('attachments', { ...att, transcript: text, transcriptPath: tp, transcriptSha: paths[tp] });
      changed++;
    }
  }

  state.lastCommit = head;
  state.paths = paths;
  return { head, empty: false, changed, truncated: tree.truncated };
}

/* ── Push ──────────────────────────────────────────────── */

async function push(gh, state, onProgress = () => {}) {
  const [entries, conditions, attachments] = await Promise.all([
    db.all('entries'), db.all('conditions'), db.all('attachments')
  ]);
  const dirtyEntries = entries.filter(e => e.dirty);
  const dirtyConds = conditions.filter(c => c.dirty);
  const dirtyAtts = attachments.filter(a => a.dirty);
  if (!dirtyEntries.length && !dirtyConds.length && !dirtyAtts.length) return { pushed: 0 };

  const tree = [];
  const removePaths = new Set();
  const written = [];

  // 1. Binärdateien zuerst als Blobs hochladen.
  let n = 0;
  for (const att of dirtyAtts) {
    if (att.deleted) { if (att.path) removePaths.add(att.path); written.push(['attachments', att, null]); continue; }
    if (!att.blob) { written.push(['attachments', att, att.path]); continue; }
    onProgress(`Datei ${++n}/${dirtyAtts.length}`);
    const path = att.path || repo.attachmentPath(att);
    const sha = await gh.createBlobFromBlob(att.blob);
    tree.push({ path, mode: '100644', type: 'blob', sha });
    written.push(['attachments', att, path]);
  }

  // 2. Themen.
  for (const c of dirtyConds) {
    const path = repo.conditionPath(c);
    if (c.deleted) { if (c.path) removePaths.add(c.path); written.push(['conditions', c, null]); continue; }
    if (c.path && c.path !== path) removePaths.add(c.path);
    tree.push({ path, mode: '100644', type: 'blob', content: repo.conditionToMarkdown(c) });
    written.push(['conditions', c, path]);
  }

  // 3. Einträge — inklusive der Anhänge, die gerade Pfade bekommen haben.
  const attByEntry = new Map();
  for (const a of attachments) {
    const pending = written.find(([s, rec]) => s === 'attachments' && rec.id === a.id);
    const merged = pending ? { ...a, path: pending[2] || a.path } : a;
    if (!attByEntry.has(a.entryId)) attByEntry.set(a.entryId, []);
    attByEntry.get(a.entryId).push(merged);
  }
  for (const e of dirtyEntries) {
    const path = repo.entryPath(e);
    if (e.deleted) { if (e.path) removePaths.add(e.path); written.push(['entries', e, null]); continue; }
    if (e.path && e.path !== path) removePaths.add(e.path);
    const atts = (attByEntry.get(e.id) || []).filter(a => !a.deleted);
    tree.push({ path, mode: '100644', type: 'blob', content: repo.entryToMarkdown(e, atts) });
    written.push(['entries', e, path]);
  }

  for (const p of removePaths) {
    if (!tree.some(t => t.path === p)) tree.push({ path: p, mode: '100644', type: 'blob', sha: null });
  }
  if (!tree.length) return { pushed: 0 };

  onProgress('Commit');
  const parent = state.lastCommit || await gh.headSha();
  const parentCommit = await gh.commit(parent);
  const newTree = await gh.createTree(parentCommit.tree.sha, tree);
  const message = commitMessage(dirtyEntries, dirtyConds, dirtyAtts);
  const commit = await gh.createCommit(message, newTree.sha, [parent]);
  await gh.updateRef(commit.sha);

  // 4. Lokal als sauber markieren.
  for (const [store, rec, path] of written) {
    if (path === null && rec.deleted) { await db.del(store, rec.id); continue; }
    const fresh = await db.get(store, rec.id);
    if (!fresh) continue;
    // Zwischenzeitlich weiter bearbeitet? Dann dirty lassen.
    if (fresh.updatedAt !== rec.updatedAt) { if (path) await db.put(store, { ...fresh, path }); continue; }
    await db.put(store, { ...fresh, dirty: 0, path: path || fresh.path });
  }

  state.lastCommit = commit.sha;
  const fresh = await gh.tree(commit.sha);
  state.paths = {};
  for (const node of fresh.tree) if (node.type === 'blob') state.paths[node.path] = node.sha;

  return { pushed: written.length, commit: commit.sha };
}

function commitMessage(entries, conds, atts) {
  const parts = [];
  const nE = entries.filter(e => !e.deleted).length;
  const nC = conds.filter(c => !c.deleted).length;
  const nA = atts.filter(a => !a.deleted && a.blob).length;
  if (nE) parts.push(`${nE} ${nE === 1 ? 'Eintrag' : 'Einträge'}`);
  if (nC) parts.push(`${nC} ${nC === 1 ? 'Thema' : 'Themen'}`);
  if (nA) parts.push(`${nA} ${nA === 1 ? 'Datei' : 'Dateien'}`);
  const del = [...entries, ...conds, ...atts].filter(r => r.deleted).length;
  if (del) parts.push(`${del} gelöscht`);
  return parts.length ? parts.join(', ') : 'Aktualisierung';
}

/* ── Öffentlich ────────────────────────────────────────── */

let queued = null;

export async function sync({ force = false } = {}) {
  if (status.running) { queued = queued || {}; return null; }
  status.running = true; status.lastError = null;
  emit('status');
  const onProgress = msg => { emit('progress', msg); };

  try {
    const gh = await client();
    const state = await loadState();

    if (force) { state.lastCommit = null; state.paths = {}; }

    const pulled = await pull(gh, state, onProgress);
    if (pulled.empty) {
      onProgress('Repo einrichten');
      state.lastCommit = await gh.initBranch([{ path: 'README.md', content: repo.README }]);
      state.paths = {};
    }
    const pushed = await push(gh, state, onProgress);
    if (pushed.pushed) await pull(gh, state, onProgress).catch(() => {});

    state.lastSyncAt = new Date().toISOString();
    await saveState(state);
    status.lastSyncAt = state.lastSyncAt;
    await refreshPending();
    emit('done', { pulled: pulled.changed, pushed: pushed.pushed, truncated: pulled.truncated });
    return { pulled: pulled.changed, pushed: pushed.pushed };
  } catch (err) {
    // Jemand anderes hat inzwischen gepusht → einmal neu aufsetzen.
    if (err instanceof GitHubError && (err.status === 409 || err.status === 422) && !force) {
      status.running = false;
      return sync({ force: true });
    }
    status.lastError = err.message || String(err);
    emit('error', err);
    throw err;
  } finally {
    status.running = false;
    emit('status');
    if (queued) { queued = null; setTimeout(() => sync().catch(() => {}), 400); }
  }
}

/** Datei bei Bedarf nachladen und lokal behalten. */
export async function ensureBlob(attachmentId) {
  const att = await db.get('attachments', attachmentId);
  if (!att) return null;
  if (att.blob) return att.blob;
  if (!att.path) return null;
  const gh = await client();
  const state = await loadState();
  let sha = state.paths[att.path];
  if (!sha) {
    const head = await gh.headSha();
    const tree = await gh.tree(head);
    state.paths = {};
    for (const node of tree.tree) if (node.type === 'blob') state.paths[node.path] = node.sha;
    await saveState(state);
    sha = state.paths[att.path];
  }
  if (!sha) throw new Error('Datei liegt nicht im Repo.');
  const buf = await gh.blobRaw(sha);
  const blob = new Blob([buf], { type: mimeFor(att.ext) });
  await db.put('attachments', { ...att, blob, bytes: blob.size });
  return blob;
}

/** Alle noch nicht lokal vorhandenen Dateien holen — für Offline-Nutzung. */
export async function fetchAllBlobs(onProgress = () => {}) {
  const missing = (await db.all('attachments')).filter(a => !a.blob && a.path && !a.deleted);
  let i = 0;
  for (const att of missing) {
    onProgress(++i, missing.length);
    try { await ensureBlob(att.id); } catch { /* einzelne Ausfälle nicht eskalieren */ }
  }
  return missing.length;
}

export async function init() {
  status.lastSyncAt = (await loadState()).lastSyncAt;
  await refreshPending();
}
export { refreshPending };
