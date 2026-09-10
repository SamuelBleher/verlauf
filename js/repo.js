// Abbildung zwischen App-Datensätzen und Dateien im privaten Repo.
// Deutsche Pfade und Schlüssel, weil die Dateien in Obsidian gelesen werden.

import { stringifyFrontmatter, parseFrontmatter } from './markdown.js';
import { attachmentKind } from './models.js';

export const DIR_ENTRIES = 'eintraege';
export const DIR_CONDITIONS = 'themen';
export const DIR_FILES = 'dateien';
const HELPED_HEADING = '## Was geholfen hat';

export function slugify(s = '') {
  return String(s).toLowerCase()
    .replace(/ä/g, 'ae').replace(/ö/g, 'oe').replace(/ü/g, 'ue').replace(/ß/g, 'ss')
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 48);
}

const shortId = id => String(id).split('-').pop().slice(0, 6);

export function entryPath(entry) {
  const year = (entry.date || '1970').slice(0, 4);
  const slug = slugify(entry.title) || entry.type || 'eintrag';
  return `${DIR_ENTRIES}/${year}/${entry.date}-${slug}-${shortId(entry.id)}.md`;
}
export function conditionPath(c) {
  return `${DIR_CONDITIONS}/${slugify(c.name || c.bodyPart) || 'thema'}-${shortId(c.id)}.md`;
}
export function attachmentPath(att) {
  const year = (att.createdAt || new Date().toISOString()).slice(0, 4);
  return `${DIR_FILES}/${year}/${att.id}.${att.ext || 'bin'}`;
}
export const transcriptPathFor = filePath => filePath.replace(/\.[^.]+$/, '') + '.txt';

/* ── Eintrag → Markdown ────────────────────────────────── */
export function entryToMarkdown(entry, attachments = []) {
  const fm = {
    id: entry.id,
    datum: entry.date,
    uhrzeit: entry.time || '',
    typ: entry.type,
    thema: entry.conditionId || '',
    titel: entry.title || '',
    schmerz: entry.pain === null || entry.pain === undefined ? '' : entry.pain,
    behandler: entry.practitioner || '',
    ort: entry.place || '',
    tags: entry.tags || [],
    anhaenge: attachments.filter(a => !a.deleted).map(a => {
      const row = { id: a.id, datei: a.path || attachmentPath(a), typ: a.kind, name: a.name || '' };
      if (a.bytes) row.bytes = a.bytes;
      if (a.seconds) row.dauer = Math.round(a.seconds);
      if (a.consent) row.einwilligung = a.consent;
      return row;
    }),
    erstellt: entry.createdAt,
    geaendert: entry.updatedAt
  };
  let body = (entry.body || '').trim();
  if ((entry.helped || '').trim()) {
    body += (body ? '\n\n' : '') + HELPED_HEADING + '\n\n' + entry.helped.trim();
  }
  return stringifyFrontmatter(fm) + '\n\n' + body + '\n';
}

export function markdownToEntry(text, path) {
  const { data, body } = parseFrontmatter(text);
  let main = body, helped = '';
  const idx = body.indexOf(HELPED_HEADING);
  if (idx !== -1) {
    main = body.slice(0, idx).trim();
    helped = body.slice(idx + HELPED_HEADING.length).trim();
  }
  const pain = data.schmerz;
  return {
    entry: {
      id: data.id || 'e-' + slugify(path),
      date: data.datum || (path.match(/(\d{4}-\d{2}-\d{2})/) || [])[1] || '1970-01-01',
      time: data.uhrzeit == null ? '' : String(data.uhrzeit),
      type: data.typ || 'sonstiges',
      conditionId: data.thema || null,
      title: data.titel || '',
      body: main,
      helped,
      pain: pain === '' || pain === null || pain === undefined ? null : Number(pain),
      practitioner: data.behandler || '',
      place: data.ort || '',
      tags: Array.isArray(data.tags) ? data.tags.map(String) : [],
      createdAt: data.erstellt || new Date().toISOString(),
      updatedAt: data.geaendert || data.erstellt || new Date().toISOString(),
      dirty: 0, deleted: 0, path
    },
    attachments: (Array.isArray(data.anhaenge) ? data.anhaenge : [])
      .filter(a => a && typeof a === 'object' && a.datei)
      .map(a => ({
        id: a.id || a.datei,
        entryId: data.id,
        path: a.datei,
        kind: a.typ || attachmentKind('', a.datei),
        name: a.name || a.datei.split('/').pop(),
        bytes: a.bytes || 0,
        seconds: a.dauer || 0,
        consent: a.einwilligung || '',
        ext: (a.datei.split('.').pop() || 'bin'),
        blob: null, thumb: null,
        createdAt: data.erstellt || new Date().toISOString(),
        updatedAt: data.geaendert || new Date().toISOString(),
        dirty: 0, deleted: 0
      }))
  };
}

/* ── Thema → Markdown ──────────────────────────────────── */
export function conditionToMarkdown(c) {
  const fm = {
    id: c.id,
    name: c.name || '',
    koerperteil: c.bodyPart || '',
    seite: c.side || 'na',
    status: c.status || 'aktiv',
    seit: c.startDate || '',
    bis: c.endDate || '',
    farbe: c.color || '',
    erstellt: c.createdAt,
    geaendert: c.updatedAt
  };
  return stringifyFrontmatter(fm) + '\n\n' + (c.notes || '').trim() + '\n';
}

export function markdownToCondition(text, path) {
  const { data, body } = parseFrontmatter(text);
  return {
    id: data.id || 'c-' + slugify(path),
    name: data.name || '',
    bodyPart: data.koerperteil || 'Sonstiges',
    side: data.seite || 'na',
    status: data.status || 'aktiv',
    startDate: data.seit || '',
    endDate: data.bis || '',
    color: data.farbe || '#7E939D',
    notes: body,
    createdAt: data.erstellt || new Date().toISOString(),
    updatedAt: data.geaendert || data.erstellt || new Date().toISOString(),
    dirty: 0, deleted: 0, path
  };
}

export const README = `# Krankenakte

Datenablage der App **Verlauf**. Alles hier sind einfache Markdown- und Mediendateien —
lesbar ohne die App, z. B. direkt in Obsidian.

- \`${DIR_ENTRIES}/JAHR/\` — ein Eintrag pro Datei, YAML-Frontmatter plus Freitext
- \`${DIR_CONDITIONS}/\` — Themen (eine Verletzung, eine Krankheit) über die Zeit
- \`${DIR_FILES}/JAHR/\` — Fotos, PDFs, Tonaufnahmen

Liegt neben einer Tonaufnahme eine gleichnamige \`.txt\`-Datei, zeigt die App sie
als Transkript unter dem Player an.

Dieses Repo muss **privat** bleiben.
`;
