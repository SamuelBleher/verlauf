// Themen: eine Verletzung oder Krankheit über ihre gesamte Laufzeit.
// Die Detailansicht ist das, was man einem neuen Arzt hinhält.

import * as db from '../db.js';
import * as sync from '../sync.js';
import { icon, toast, sparkline, confirmSheet } from './components.js';
import { renderList, loadIndex, wireRows, escape } from './timeline.js';
import { renderMarkdown } from '../markdown.js';
import {
  emptyCondition, conditionTitle, statusLabel, STATUSES, BODY_PARTS, SIDES,
  CONDITION_COLORS, parseDate, formatDateLong, relativeDays, painColor
} from '../models.js';

async function painSeries(conditionId) {
  const entries = await db.listEntries({ conditionId });
  return entries.slice().reverse().map(e => e.pain).filter(p => p !== null && p !== undefined);
}

export async function listView({ navigate }) {
  const conditions = await db.listConditions();
  if (!conditions.length) {
    return {
      title: 'Themen',
      html: `<div class="empty">
        <h2>Noch keine Themen</h2>
        <p>Ein Thema bündelt alles zu einer Sache — „Knie links, Innenmeniskus“ oder „Rücken“.
        Jeder Arztbesuch, jedes MRT und jede Physioeinheit hängt sich daran und ergibt einen Verlauf.</p>
        <button class="btn primary" data-new>${icon('plus')} Thema anlegen</button>
      </div>`,
      mount(root) { root.querySelector('[data-new]').onclick = () => navigate('#/thema/neu/bearbeiten'); }
    };
  }

  const entries = await db.listEntries();
  const rows = [];
  for (const c of conditions) {
    const mine = entries.filter(e => e.conditionId === c.id);
    const series = mine.slice().reverse().map(e => e.pain).filter(p => p != null);
    const last = mine[0];
    rows.push(`<button class="cond" data-cond="${c.id}">
      <i class="bar" style="--c:${c.color}"></i>
      <span>
        <h3>${escape(conditionTitle(c))}</h3>
        <span class="m">${mine.length} ${mine.length === 1 ? 'Eintrag' : 'Einträge'}${last ? ' · zuletzt ' + relativeDays(parseDate(last)) : ''}</span>
        <span class="m" style="margin-top:.3rem;display:block"><span class="status ${c.status}">${statusLabel(c.status)}</span></span>
      </span>
      ${sparkline(series, series.length ? painColor(series.at(-1)) : 'currentColor')}
    </button>`);
  }

  return {
    title: 'Themen',
    subtitle: `${conditions.length} ${conditions.length === 1 ? 'Thema' : 'Themen'}`,
    action: { icon: 'plus', label: 'Thema anlegen', href: '#/thema/neu/bearbeiten' },
    html: `<div class="cond-list">${rows.join('')}</div>`,
    mount(root) {
      root.addEventListener('click', e => {
        const b = e.target.closest('[data-cond]');
        if (b) navigate('#/thema/' + b.dataset.cond);
      });
    }
  };
}

export async function detailView({ params, navigate }) {
  const c = await db.get('conditions', params.id);
  if (!c || c.deleted) return { title: 'Thema', html: '<div class="empty"><h2>Nicht gefunden</h2></div>' };

  const entries = await db.listEntries({ conditionId: c.id });
  const { condById, attByEntry } = await loadIndex(entries);
  const series = await painSeries(c.id);
  const first = entries.at(-1), last = entries[0];

  const facts = [
    ['Status', statusLabel(c.status)],
    ['Seit', c.startDate ? formatDateLong(new Date(c.startDate)) : '—'],
    ['Einträge', String(entries.length)]
  ];
  if (series.length) facts.push(['Schmerz zuletzt', `<span style="color:${painColor(series.at(-1))}">${series.at(-1)}/10</span>`]);
  if (first && last && first !== last) facts.push(['Dauer', relativeDays(parseDate(first)).replace('vor ', '')]);

  return {
    title: 'Thema',
    back: true,
    action: { icon: 'edit', label: 'Thema bearbeiten', href: '#/thema/' + c.id + '/bearbeiten' },
    html: `
      <div class="detail">
        <div class="tl-meta">
          <span>${escape(c.bodyPart)}${c.side && c.side !== 'na' ? ' ' + (SIDES.find(s => s.id === c.side) || {}).label.toLowerCase() : ''}</span></div>
        <h1 class="detail-h1">${escape(conditionTitle(c))}</h1>
        ${series.length > 1 ? `<div style="margin:.75rem 0 1rem">
          ${sparkline(series, painColor(series.at(-1)), 320, 54, true)}
          <div class="spark-scale"><span>${series.length} Messungen</span><span>Schmerz 0–10</span></div>
        </div>` : ''}
        <dl class="factgrid">${facts.map(([k, v]) => `<div class="fact"><dt>${k}</dt><dd>${v}</dd></div>`).join('')}</dl>
        ${c.notes ? `<div class="prose">${renderMarkdown(c.notes)}</div>` : ''}
        <div class="btnrow" style="margin:1.25rem 0 .5rem">
          <button class="btn primary" data-add>${icon('plus')} Eintrag zu diesem Thema</button>
        </div>
      </div>
      ${entries.length ? `<h2 class="section-h pad" style="margin-top:1.5rem">Verlauf</h2>${renderList(entries, condById, attByEntry, { hideCondition: true })}`
        : '<div class="empty"><p>Noch keine Einträge zu diesem Thema.</p></div>'}`,
    mount(root) {
      root.querySelector('[data-add]').onclick = () => navigate(`#/eintrag/neu?thema=${c.id}`);
      wireRows(root, navigate);
    }
  };
}

export async function editView({ params, navigate, back }) {
  const isNew = params.id === 'neu';
  const existing = await db.listConditions();
  const c = isNew
    ? emptyCondition({ color: CONDITION_COLORS[existing.length % CONDITION_COLORS.length] })
    : await db.get('conditions', params.id);
  if (!c) return { title: 'Thema', html: '<div class="empty"><h2>Nicht gefunden</h2></div>' };

  return {
    title: isNew ? 'Neues Thema' : 'Thema bearbeiten',
    back: true,
    html: `<form class="form" id="condform">
      <div class="field"><label for="c-name">Name</label>
        <input type="text" id="c-name" value="${escape(c.name)}" placeholder="Knie links — Innenmeniskus" required>
        <span class="hint">So, wie du selbst darüber sprichst.</span></div>

      <div class="row2">
        <div class="field"><label for="c-part">Körperteil</label>
          <select id="c-part">${BODY_PARTS.map(p => `<option ${p === c.bodyPart ? 'selected' : ''}>${p}</option>`).join('')}</select></div>
        <div class="field"><label for="c-side">Seite</label>
          <select id="c-side">${SIDES.map(s => `<option value="${s.id}" ${s.id === c.side ? 'selected' : ''}>${s.label}</option>`).join('')}</select></div>
      </div>

      <div class="row2">
        <div class="field"><label for="c-status">Status</label>
          <select id="c-status">${STATUSES.map(s => `<option value="${s.id}" ${s.id === c.status ? 'selected' : ''}>${s.label}</option>`).join('')}</select></div>
        <div class="field"><label for="c-start">Seit</label>
          <input type="date" id="c-start" value="${c.startDate || ''}"></div>
      </div>

      <div class="field"><label>Farbe</label>
        <div class="typegrid" id="colors" style="grid-template-columns:repeat(auto-fill,minmax(3rem,1fr))">
          ${CONDITION_COLORS.map(col => `<button type="button" class="typebtn" data-color="${col}"
            aria-pressed="${col === c.color}" style="min-height:2.75rem;padding:.4rem">
            <span style="width:18px;height:18px;border-radius:4px;background:${col};display:block"></span></button>`).join('')}
        </div></div>

      <div class="field"><label for="c-notes">Notizen</label>
        <textarea id="c-notes" style="min-height:6rem" placeholder="Diagnose, Vorgeschichte, was Ärzte gesagt haben.">${escape(c.notes)}</textarea></div>

      <div class="btnrow" style="flex-direction:column">
        <button type="submit" class="btn primary wide">${icon('check')} Speichern</button>
        ${isNew ? '' : `<button type="button" class="btn danger wide" id="c-del">${icon('trash')} Thema löschen</button>`}
      </div>
    </form>`,
    mount(root) {
      const q = s => root.querySelector(s);
      let color = c.color;
      q('#colors').addEventListener('click', e => {
        const b = e.target.closest('[data-color]');
        if (!b) return;
        color = b.dataset.color;
        root.querySelectorAll('[data-color]').forEach(x => x.setAttribute('aria-pressed', String(x === b)));
      });

      q('#condform').onsubmit = async ev => {
        ev.preventDefault();
        Object.assign(c, {
          name: q('#c-name').value.trim(),
          bodyPart: q('#c-part').value,
          side: q('#c-side').value,
          status: q('#c-status').value,
          startDate: q('#c-start').value,
          notes: q('#c-notes').value.trim(),
          color
        });
        if (!c.name) { toast('Bitte einen Namen angeben.', 'err'); return; }
        await db.saveCondition(c);
        toast('Gespeichert');
        sync.refreshPending();
        const s = await db.getSettings();
        if (s.autoSync && db.isConfigured(s) && navigator.onLine) sync.sync().catch(() => {});
        navigate('#/thema/' + c.id, { replace: true });
      };

      q('#c-del')?.addEventListener('click', async () => {
        const n = (await db.listEntries({ conditionId: c.id })).length;
        const warn = n ? `${n} ${n === 1 ? 'Eintrag bleibt' : 'Einträge bleiben'} erhalten, aber ohne Thema.` : 'Es hängen keine Einträge daran.';
        if (await confirmSheet('Thema löschen', warn)) {
          await db.softDelete('conditions', c.id);
          toast('Gelöscht');
          sync.refreshPending();
          back('#/themen');
        }
      });
    }
  };
}
