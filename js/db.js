// IndexedDB-Schicht. Die App ist local-first: alles läuft gegen diese Datenbank,
// Sync mit GitHub passiert asynchron im Hintergrund.

const DB_NAME = 'verlauf';
const DB_VERSION = 1;
let _db = null;

export function open() {
  if (_db) return Promise.resolve(_db);
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = ev => {
      const db = req.result;
      if (!db.objectStoreNames.contains('entries')) {
        const s = db.createObjectStore('entries', { keyPath: 'id' });
        s.createIndex('date', 'date');
        s.createIndex('conditionId', 'conditionId');
        s.createIndex('dirty', 'dirty');
      }
      if (!db.objectStoreNames.contains('conditions')) {
        const s = db.createObjectStore('conditions', { keyPath: 'id' });
        s.createIndex('dirty', 'dirty');
      }
      if (!db.objectStoreNames.contains('attachments')) {
        const s = db.createObjectStore('attachments', { keyPath: 'id' });
        s.createIndex('entryId', 'entryId');
        s.createIndex('dirty', 'dirty');
      }
      if (!db.objectStoreNames.contains('meta')) db.createObjectStore('meta', { keyPath: 'key' });
      if (!db.objectStoreNames.contains('conflicts')) db.createObjectStore('conflicts', { keyPath: 'id' });
      void ev;
    };
    req.onsuccess = () => {
      _db = req.result;
      _db.onversionchange = () => { _db.close(); _db = null; };
      resolve(_db);
    };
    req.onerror = () => reject(req.error);
  });
}

function tx(store, mode = 'readonly') {
  return open().then(db => db.transaction(store, mode).objectStore(store));
}
const wrap = req => new Promise((res, rej) => { req.onsuccess = () => res(req.result); req.onerror = () => rej(req.error); });

export const get = (store, id) => tx(store).then(s => wrap(s.get(id)));
export const all = store => tx(store).then(s => wrap(s.getAll()));
export const put = (store, val) => tx(store, 'readwrite').then(s => wrap(s.put(val)));
export const del = (store, id) => tx(store, 'readwrite').then(s => wrap(s.delete(id)));

export function putMany(store, vals) {
  return open().then(db => new Promise((res, rej) => {
    const t = db.transaction(store, 'readwrite');
    const s = t.objectStore(store);
    vals.forEach(v => s.put(v));
    t.oncomplete = () => res(vals.length);
    t.onerror = () => rej(t.error);
  }));
}

export function byIndex(store, index, value) {
  return tx(store).then(s => wrap(s.index(index).getAll(value)));
}

/* ── Meta / Einstellungen ──────────────────────────────── */
export async function getMeta(key, fallback = null) {
  const row = await get('meta', key);
  return row === undefined || row === null ? fallback : row.value;
}
export const setMeta = (key, value) => put('meta', { key, value });

const SETTINGS_DEFAULTS = {
  repoOwner: '', repoName: '', branch: 'main', token: '',
  autoSync: true, theme: 'system', imageMaxPx: 2048, imageQuality: 0.85,
  audioBitrate: 32000
};
export async function getSettings() {
  return { ...SETTINGS_DEFAULTS, ...(await getMeta('settings', {})) };
}
export async function saveSettings(patch) {
  const next = { ...(await getSettings()), ...patch };
  await setMeta('settings', next);
  return next;
}
export const isConfigured = s => Boolean(s.repoOwner && s.repoName && s.token);

/* ── Domänen-Helfer ────────────────────────────────────── */
const live = rows => rows.filter(r => !r.deleted);

export async function listEntries({ conditionId = null } = {}) {
  let rows = live(await all('entries'));
  if (conditionId) rows = rows.filter(e => e.conditionId === conditionId);
  return rows.sort((a, b) =>
    (b.date + (b.time || '')).localeCompare(a.date + (a.time || '')) ||
    b.createdAt.localeCompare(a.createdAt));
}
export async function listConditions() {
  const rows = live(await all('conditions'));
  const order = { aktiv: 0, reha: 1, chronisch: 2, ausgeheilt: 3 };
  return rows.sort((a, b) =>
    (order[a.status] ?? 9) - (order[b.status] ?? 9) ||
    (b.startDate || '').localeCompare(a.startDate || ''));
}
export const listAttachments = entryId => byIndex('attachments', 'entryId', entryId).then(live);

export function touch(rec) {
  rec.updatedAt = new Date().toISOString();
  rec.dirty = 1;
  return rec;
}

export async function saveEntry(entry) { await put('entries', touch(entry)); return entry; }
export async function saveCondition(c) { await put('conditions', touch(c)); return c; }

/** Tombstone statt echtem Löschen — sonst kommt der Eintrag beim nächsten Pull zurück. */
export async function softDelete(store, id) {
  const rec = await get(store, id);
  if (!rec) return;
  rec.deleted = 1;
  await put(store, touch(rec));
  if (store === 'entries') {
    for (const a of await byIndex('attachments', 'entryId', id)) {
      a.deleted = 1; await put('attachments', touch(a));
    }
  }
}

export async function countDirty() {
  const [e, c, a] = await Promise.all([all('entries'), all('conditions'), all('attachments')]);
  return [...e, ...c, ...a].filter(r => r.dirty).length;
}

export async function storageEstimate() {
  if (!navigator.storage?.estimate) return null;
  try { return await navigator.storage.estimate(); } catch { return null; }
}

/** Ohne persistente Berechtigung räumt iOS Safari den Speicher irgendwann ab. */
export async function requestPersistence() {
  if (!navigator.storage?.persist) return false;
  try {
    if (await navigator.storage.persisted()) return true;
    return await navigator.storage.persist();
  } catch { return false; }
}

export async function wipeAll() {
  const db = await open();
  await new Promise((res, rej) => {
    const t = db.transaction(['entries', 'conditions', 'attachments', 'conflicts'], 'readwrite');
    ['entries', 'conditions', 'attachments', 'conflicts'].forEach(s => t.objectStore(s).clear());
    t.oncomplete = res; t.onerror = () => rej(t.error);
  });
  await setMeta('sync', null);
}
