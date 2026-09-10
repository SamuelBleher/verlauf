// Einzelner Eintrag. Die Anhänge werden erst beim Öffnen aus dem Repo geladen,
// damit der erste Sync auf dem Handy nicht hunderte Megabyte zieht.

import * as db from '../db.js';
import * as sync from '../sync.js';
import { objectUrl } from '../images.js';
import { icon, toast, lightbox } from './components.js';
import { renderMarkdown } from '../markdown.js';
import {
  parseDate, formatDateLong, relativeDays, typeLabel, conditionTitle,
  painColor, PAIN_WORDS, formatDuration, formatBytes
} from '../models.js';
import { escape } from './timeline.js';

export async function view({ params, navigate }) {
  const entry = await db.get('entries', params.id);
  if (!entry || entry.deleted) {
    return { title: 'Eintrag', html: '<div class="empty"><h2>Nicht gefunden</h2><p>Dieser Eintrag existiert nicht mehr.</p></div>' };
  }
  const condition = entry.conditionId ? await db.get('conditions', entry.conditionId) : null;
  const attachments = await db.listAttachments(entry.id);
  const d = parseDate(entry);
  const audios = attachments.filter(a => a.kind === 'audio');
  const files = attachments.filter(a => a.kind !== 'audio');

  const facts = [];
  if (entry.pain !== null && entry.pain !== undefined) {
    facts.push(['Schmerz', `<span style="color:${painColor(entry.pain)}">${entry.pain}/10</span>`, PAIN_WORDS[entry.pain]]);
  }
  if (entry.practitioner) facts.push(['Behandler', escape(entry.practitioner)]);
  if (entry.place) facts.push(['Ort', escape(entry.place)]);

  const html = `
  <div class="detail">
    <div class="tl-meta" style="gap:.5rem">
      <span>${formatDateLong(d)}${entry.time ? ', ' + entry.time : ''}</span>
      <span>${relativeDays(d)}</span>
    </div>
    <h1 class="detail-h1">${escape(entry.title) || typeLabel(entry.type)}</h1>
    <div class="detail-meta">
      <span class="chip">${typeLabel(entry.type)}</span>
      ${condition ? `<button class="chip" data-cond="${condition.id}"><i class="swatch" style="--c:${condition.color}"></i>${escape(conditionTitle(condition))}</button>` : ''}
    </div>

    ${facts.length ? `<dl class="factgrid">${facts.map(([k, v, sub]) =>
      `<div class="fact"><dt>${k}</dt><dd>${v}</dd>${sub ? `<dt style="margin-top:.15rem">${sub}</dt>` : ''}</div>`).join('')}</dl>` : ''}

    ${entry.body ? `<div class="prose">${renderMarkdown(entry.body)}</div>` : ''}

    ${entry.helped ? `<h2 class="section-h">Was geholfen hat</h2>
      <div class="helped">${renderMarkdown(entry.helped)}</div>` : ''}

    ${audios.length ? `<h2 class="section-h">Aufnahmen</h2>
      <div id="audios">${audios.map(audioCard).join('')}</div>` : ''}

    ${files.length ? `<h2 class="section-h">Dateien</h2>
      <div class="att-grid" id="files">${files.map(fileCard).join('')}</div>` : ''}

    <div class="btnrow" style="margin:2rem 0 1rem;flex-direction:column">
      <button class="btn wide" data-edit>${icon('edit')} Bearbeiten</button>
    </div>
  </div>`;

  return {
    title: 'Eintrag',
    html,
    back: true,
    mount(root) {
      root.querySelector('[data-edit]').onclick = () => navigate('#/eintrag/' + entry.id + '/bearbeiten');
      root.querySelector('[data-cond]')?.addEventListener('click', () => navigate('#/thema/' + condition.id));

      // Audio sofort nachladen — ohne Datei ist die Karte sinnlos.
      audios.forEach(a => hydrateAudio(root, a));

      root.querySelectorAll('[data-file]').forEach(btn => {
        btn.onclick = async () => {
          const att = files.find(f => f.id === btn.dataset.file);
          const box = lightbox([{ name: att.name, kind: att.kind, url: att.blob ? objectUrl('f' + att.id, att.blob) : null }]);
          if (!att.blob) {
            try {
              const blob = await sync.ensureBlob(att.id);
              att.blob = blob;
              box.close();
              lightbox([{ name: att.name, kind: att.kind, url: objectUrl('f' + att.id, blob) }]);
            } catch (err) { box.close(); toast(err.message || 'Datei konnte nicht geladen werden.', 'err'); }
          }
        };
      });
    }
  };
}

function audioCard(a) {
  return `<div class="audio-card" data-audio="${a.id}">
    <div class="row">
      ${icon('mic')}
      <span class="nm">${escape(a.name || 'Aufnahme')}</span>
      <span class="dur">${formatDuration(a.seconds)}</span>
    </div>
    <div data-player>${a.blob ? '' : '<span class="dur">Wird geladen …</span>'}</div>
    ${a.consent ? `<div class="dur" style="margin-top:.4rem">Einwilligung: ${escape(a.consent)}</div>` : ''}
    ${a.transcript ? `<div class="transcript collapsed" data-transcript>${escape(a.transcript)}</div>
      <button class="btn ghost" style="margin-top:.5rem;min-height:34px;padding:.25rem .6rem;font-size:.8125rem" data-more>Ganzes Transkript</button>` : ''}
  </div>`;
}

function fileCard(a) {
  const src = a.thumb ? objectUrl('t' + a.id, a.thumb) : (a.blob && a.kind === 'image' ? objectUrl('f' + a.id, a.blob) : null);
  return `<button class="att" data-file="${a.id}">
    ${src ? `<img src="${src}" alt="${escape(a.name || '')}">`
          : `<span class="label">${icon(a.kind === 'pdf' ? 'file' : 'image')}<br>${escape(a.name || '')}</span>`}
    <span class="kind">${formatBytes(a.bytes)}</span></button>`;
}

async function hydrateAudio(root, att) {
  const card = root.querySelector(`[data-audio="${att.id}"]`);
  if (!card) return;
  const slot = card.querySelector('[data-player]');
  card.querySelector('[data-more]')?.addEventListener('click', e => {
    const t = card.querySelector('[data-transcript]');
    const open = t.classList.toggle('collapsed');
    e.target.textContent = open ? 'Ganzes Transkript' : 'Weniger';
  });

  let blob = att.blob;
  if (!blob) {
    try { blob = await sync.ensureBlob(att.id); }
    catch (err) { slot.innerHTML = `<span class="dur">${escape(err.message || 'Nicht verfügbar')}</span>`; return; }
  }
  if (!blob) { slot.innerHTML = '<span class="dur">Datei fehlt</span>'; return; }
  slot.innerHTML = `<audio controls preload="metadata" src="${objectUrl('f' + att.id, blob)}"></audio>`;
}
