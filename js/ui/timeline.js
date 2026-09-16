// Der Verlauf. Die Schmerz-Balken an der Spine sind die eigentliche Information:
// beim Scrollen sieht man den Schub und das Abklingen, ohne ein Diagramm zu öffnen.

import * as db from '../db.js';
import { icon, h } from './components.js';
import { objectUrl } from '../images.js';
import {
  parseDate, monthKey, monthName, dayShort, painColor, typeLabel,
  conditionTitle, PAIN_WORDS
} from '../models.js';
import { excerpt } from '../markdown.js';

const MAX_BAR = 118; // px — bewusst kurz, damit auch bei 320px Breite Text bleibt

function thumbHtml(att) {
  if (att.thumb) return `<span class="th"><img src="${objectUrl('t' + att.id, att.thumb)}" alt=""></span>`;
  if (att.blob && att.kind === 'image') return `<span class="th"><img src="${objectUrl('f' + att.id, att.blob)}" alt=""></span>`;
  const map = { audio: 'mic', pdf: 'file', image: 'image' };
  return `<span class="th">${icon(map[att.kind] || 'file')}</span>`;
}

export function entryRow(entry, condition, attachments = [], hideCondition = false) {
  const d = parseDate(entry);
  const hasPain = entry.pain !== null && entry.pain !== undefined;
  const color = painColor(entry.pain);
  const width = hasPain ? Math.round((entry.pain / 10) * MAX_BAR) : 0;
  const shown = attachments.slice(0, 4);
  const rest = attachments.length - shown.length;

  return `
  <button class="tl-item${hasPain ? '' : ' no-pain'}" data-entry="${entry.id}"
          style="${color ? `--pain:${color};` : ''}--painw:${width}px">
    <span class="tl-head">
      <span class="tl-day">${d.getDate()}<small>${dayShort(d)}</small></span>
      <span class="tl-body">
        <span class="tl-bar">
          <i class="tl-dot"></i>
          ${hasPain ? `<i class="tl-fill"></i><i class="tl-score">${entry.pain}</i>` : ''}
        </span>
        <span class="tl-title">${escape(entry.title) || typeLabel(entry.type)}</span>
        <span class="tl-meta">
          ${condition && !hideCondition ? `<span class="chip"><i class="swatch" style="--c:${condition.color}"></i>${escape(conditionTitle(condition))}</span>` : ''}
          <span>${typeLabel(entry.type)}</span>
          ${entry.practitioner ? `<span>${escape(entry.practitioner)}</span>` : ''}
        </span>
        ${entry.body ? `<span class="tl-excerpt">${escape(excerpt(entry.body, 130))}</span>` : ''}
        ${attachments.length ? `<span class="thumbs">${shown.map(thumbHtml).join('')}${rest > 0 ? `<span class="th more">+${rest}</span>` : ''}</span>` : ''}
      </span>
    </span>
  </button>`;
}

const escape = (s = '') => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

export function renderList(entries, condById, attByEntry, { hideCondition = false } = {}) {
  if (!entries.length) return '';
  const out = [];
  let month = null;
  for (const e of entries) {
    const d = parseDate(e);
    const key = monthKey(d);
    if (key !== month) {
      month = key;
      out.push(`<div class="tl-month"><b>${monthName(d)}</b><span>${d.getFullYear()}</span><i></i></div>`);
    }
    out.push(entryRow(e, condById.get(e.conditionId), attByEntry.get(e.id) || [], hideCondition));
  }
  return `<div class="tl">${out.join('')}</div>`;
}

export async function loadIndex(entries) {
  const conditions = await db.listConditions();
  const condById = new Map(conditions.map(c => [c.id, c]));
  const attByEntry = new Map();
  for (const a of await db.all('attachments')) {
    if (a.deleted) continue;
    if (!attByEntry.has(a.entryId)) attByEntry.set(a.entryId, []);
    attByEntry.get(a.entryId).push(a);
  }
  void entries;
  return { conditions, condById, attByEntry };
}

export async function view({ navigate }) {
  const entries = await db.listEntries();
  const { conditions, condById, attByEntry } = await loadIndex(entries);

  if (!entries.length) {
    return {
      title: 'Verlauf',
      subtitle: null,
      html: `<div class="empty">
        <h2>Noch nichts festgehalten</h2>
        <p>Fang mit dem an, was gerade akut ist: ein Arztbesuch, ein Befund, oder einfach wie sich heute etwas anfühlt.
        ${conditions.length ? '' : 'Ein Thema wie „Knie links“ bündelt später alles, was dazugehört.'}</p>
        <button class="btn primary" data-go="#/eintrag/neu">${icon('plus')} Ersten Eintrag anlegen</button>
      </div>`,
      mount(root) { root.querySelector('[data-go]').onclick = () => navigate('#/eintrag/neu'); }
    };
  }

  const active = conditions.filter(c => c.status === 'aktiv' || c.status === 'reha').length;
  return {
    title: 'Verlauf',
    subtitle: `${entries.length} ${entries.length === 1 ? 'Eintrag' : 'Einträge'}${active ? ` · ${active} offen` : ''}`,
    html: renderList(entries, condById, attByEntry),
    mount(root) { wireRows(root, navigate); }
  };
}

export function wireRows(root, navigate) {
  root.addEventListener('click', e => {
    const b = e.target.closest('[data-entry]');
    if (b) navigate('#/eintrag/' + b.dataset.entry);
  });
}

export const painWord = p => (p == null ? '' : PAIN_WORDS[Math.max(0, Math.min(10, p))]);
export { escape, h };
