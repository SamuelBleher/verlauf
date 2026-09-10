// Vokabular und Datenmodell.

export const ENTRY_TYPES = [
  { id: 'arzt',      label: 'Arztbesuch',   icon: 'stethoscope' },
  { id: 'befund',    label: 'Befund',       icon: 'scan',   hint: 'MRT, Röntgen, Ultraschall, Labor' },
  { id: 'physio',    label: 'Physio',       icon: 'hand' },
  { id: 'behandlung',label: 'Behandlung',   icon: 'pill',   hint: 'Medikament, Spritze, OP, Tape' },
  { id: 'verletzung',label: 'Verletzung',   icon: 'bolt',   hint: 'Der Moment, in dem es passiert ist' },
  { id: 'sport',     label: 'Training',     icon: 'run' },
  { id: 'tagebuch',  label: 'Tagebuch',     icon: 'note',   hint: 'Wie geht es dir heute?' },
  { id: 'sonstiges', label: 'Sonstiges',    icon: 'dots' }
];
export const typeLabel = id => (ENTRY_TYPES.find(t => t.id === id) || {}).label || 'Eintrag';
export const typeIcon  = id => (ENTRY_TYPES.find(t => t.id === id) || {}).icon || 'note';

export const STATUSES = [
  { id: 'aktiv',      label: 'Akut' },
  { id: 'reha',       label: 'In Reha' },
  { id: 'chronisch',  label: 'Chronisch' },
  { id: 'ausgeheilt', label: 'Ausgeheilt' }
];
export const statusLabel = id => (STATUSES.find(s => s.id === id) || {}).label || '—';

export const BODY_PARTS = [
  'Kopf', 'Nacken', 'Schulter', 'Oberarm', 'Ellbogen', 'Unterarm', 'Handgelenk', 'Hand',
  'Brust', 'Oberer Rücken', 'Unterer Rücken', 'Hüfte', 'Leiste', 'Oberschenkel',
  'Knie', 'Unterschenkel', 'Achillessehne', 'Sprunggelenk', 'Fuß', 'Ganzkörper', 'Sonstiges'
];
export const SIDES = [
  { id: 'na',    label: '—' },
  { id: 'links', label: 'Links' },
  { id: 'rechts',label: 'Rechts' },
  { id: 'beide', label: 'Beidseitig' }
];
export const sideLabel = id => (SIDES.find(s => s.id === id) || {}).label || '';

// Farben für Themen — bewusst gedeckt, damit die Schmerzskala die einzige laute Farbe bleibt.
export const CONDITION_COLORS = [
  '#4FA396', '#5B8FC9', '#A87FC0', '#C9A227', '#D2793A', '#C25E6E', '#7E939D', '#66A85B'
];

export const PAIN_WORDS = [
  'kein Schmerz', 'kaum spürbar', 'leicht', 'gut auszuhalten', 'spürbar', 'störend',
  'belastend', 'stark', 'sehr stark', 'kaum aushaltbar', 'unerträglich'
];
export function painColor(p) {
  if (p == null) return null;
  if (p <= 2) return 'var(--p0)';
  if (p <= 5) return 'var(--p3)';
  if (p <= 7) return 'var(--p6)';
  return 'var(--p9)';
}

export function newId(prefix) {
  const rnd = crypto.getRandomValues(new Uint8Array(6));
  return prefix + '-' + Date.now().toString(36) + '-' +
    Array.from(rnd, b => b.toString(16).padStart(2, '0')).join('');
}

export function emptyEntry(overrides = {}) {
  const now = new Date();
  return {
    id: newId('e'),
    date: toDateInput(now),
    time: toTimeInput(now),
    type: 'tagebuch',
    conditionId: null,
    title: '',
    body: '',
    pain: null,
    helped: '',
    practitioner: '',
    place: '',
    tags: [],
    createdAt: now.toISOString(),
    updatedAt: now.toISOString(),
    dirty: 1,
    deleted: 0,
    ...overrides
  };
}

export function emptyCondition(overrides = {}) {
  const now = new Date();
  return {
    id: newId('c'),
    name: '',
    bodyPart: 'Knie',
    side: 'na',
    status: 'aktiv',
    startDate: toDateInput(now),
    endDate: '',
    color: CONDITION_COLORS[0],
    notes: '',
    createdAt: now.toISOString(),
    updatedAt: now.toISOString(),
    dirty: 1,
    deleted: 0,
    ...overrides
  };
}

export function conditionTitle(c) {
  if (!c) return '';
  const side = c.side && c.side !== 'na' ? ' ' + sideLabel(c.side).toLowerCase() : '';
  return c.name || (c.bodyPart + side);
}

/* ── Datum/Zeit ────────────────────────────────────────── */
const pad = n => String(n).padStart(2, '0');
export const toDateInput = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
export const toTimeInput = d => `${pad(d.getHours())}:${pad(d.getMinutes())}`;

const MONTHS = ['Januar','Februar','März','April','Mai','Juni','Juli','August','September','Oktober','November','Dezember'];
const DAYS = ['So','Mo','Di','Mi','Do','Fr','Sa'];

export function parseDate(entry) {
  const [y, m, d] = (entry.date || '1970-01-01').split('-').map(Number);
  const [hh, mm] = (entry.time || '00:00').split(':').map(Number);
  return new Date(y, (m || 1) - 1, d || 1, hh || 0, mm || 0);
}
export const monthKey = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}`;
export const monthName = d => MONTHS[d.getMonth()];
export const dayShort = d => DAYS[d.getDay()];

export function formatDateLong(d) {
  return `${d.getDate()}. ${MONTHS[d.getMonth()]} ${d.getFullYear()}`;
}
export function relativeDays(d) {
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const then = new Date(d); then.setHours(0, 0, 0, 0);
  const diff = Math.round((today - then) / 86400000);
  if (diff === 0) return 'heute';
  if (diff === 1) return 'gestern';
  if (diff === -1) return 'morgen';
  if (diff < 0) return `in ${-diff} Tagen`;
  if (diff < 31) return `vor ${diff} Tagen`;
  const months = Math.round(diff / 30.4);
  if (months < 24) return `vor ${months} Mon.`;
  return `vor ${Math.round(diff / 365)} Jahren`;
}
export function formatDuration(sec) {
  sec = Math.max(0, Math.round(sec || 0));
  const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = sec % 60;
  return h ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`;
}
export function formatBytes(n) {
  if (!n && n !== 0) return '';
  if (n < 1024) return n + ' B';
  if (n < 1048576) return (n / 1024).toFixed(0) + ' KB';
  return (n / 1048576).toFixed(1) + ' MB';
}

export function attachmentKind(mime = '', name = '') {
  if (mime.startsWith('image/')) return 'image';
  if (mime.startsWith('audio/')) return 'audio';
  if (mime === 'application/pdf' || /\.pdf$/i.test(name)) return 'pdf';
  return 'file';
}
