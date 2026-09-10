// Suche über alles, was Text ist — inklusive Transkripte von Arztgesprächen.

import * as db from '../db.js';
import { renderList, loadIndex, wireRows, escape } from './timeline.js';
import { icon } from './components.js';
import { ENTRY_TYPES } from '../models.js';

const norm = s => String(s || '').toLowerCase()
  .replace(/ä/g, 'ae').replace(/ö/g, 'oe').replace(/ü/g, 'ue').replace(/ß/g, 'ss');

export async function view({ navigate }) {
  const entries = await db.listEntries();
  const { conditions, condById, attByEntry } = await loadIndex(entries);
  const attachments = await db.all('attachments');

  const haystack = new Map();
  for (const e of entries) {
    const atts = attachments.filter(a => a.entryId === e.id && !a.deleted);
    haystack.set(e.id, norm([
      e.title, e.body, e.helped, e.practitioner, e.place, (e.tags || []).join(' '),
      atts.map(a => a.name + ' ' + (a.transcript || '')).join(' ')
    ].join(' ')));
  }

  return {
    title: 'Suche',
    html: `
      <div class="searchbar">
        <input type="search" id="q" placeholder="Meniskus, Dr. Weber, Ibuprofen …" autocomplete="off" enterkeyhint="search">
        <div class="tl-meta" style="margin:.6rem 0 .25rem;gap:.35rem">
          <button class="chip" data-filter="" aria-pressed="true">Alle</button>
          ${conditions.map(c => `<button class="chip" data-filter="thema:${c.id}"><i class="swatch" style="--c:${c.color}"></i>${escape(c.name || c.bodyPart)}</button>`).join('')}
          ${ENTRY_TYPES.map(t => `<button class="chip" data-filter="typ:${t.id}">${t.label}</button>`).join('')}
        </div>
      </div>
      <div id="results"></div>`,
    mount(root) {
      const input = root.querySelector('#q');
      const results = root.querySelector('#results');
      let filter = '';

      const run = () => {
        const terms = norm(input.value).split(/\s+/).filter(Boolean);
        let list = entries;
        if (filter.startsWith('thema:')) list = list.filter(e => e.conditionId === filter.slice(6));
        if (filter.startsWith('typ:')) list = list.filter(e => e.type === filter.slice(4));
        if (terms.length) list = list.filter(e => terms.every(t => haystack.get(e.id).includes(t)));

        if (!list.length) {
          results.innerHTML = `<div class="empty"><p>${terms.length || filter ? 'Nichts gefunden. Anderer Begriff?' : 'Tippe, um zu suchen.'}</p></div>`;
          return;
        }
        results.innerHTML = `<div class="tl-month" style="position:static"><b>${list.length} Treffer</b><i></i></div>`
          + renderList(list, condById, attByEntry);
      };

      input.oninput = run;
      root.querySelectorAll('[data-filter]').forEach(b => {
        b.onclick = () => {
          filter = b.dataset.filter === filter ? '' : b.dataset.filter;
          root.querySelectorAll('[data-filter]').forEach(x =>
            x.setAttribute('aria-pressed', String(x.dataset.filter === filter || (!filter && !x.dataset.filter))));
          run();
        };
      });
      wireRows(root, navigate);
      run();
      input.focus();
      void icon;
    }
  };
}
