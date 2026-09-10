// Eintrag anlegen/bearbeiten. Zwei Dinge sind hier wichtiger als Schönheit:
// schnelles Erfassen direkt nach einer Verletzung, und dass eine laufende
// Aufnahme niemals verloren geht — deshalb wird der Eintrag ab dem ersten
// Anhang sofort persistiert, nicht erst beim Speichern.

import * as db from '../db.js';
import * as sync from '../sync.js';
import { prepareImage, objectUrl } from '../images.js';
import { Recorder, isSupported as micSupported, extForMime } from '../audio.js';
import { icon, toast, chooser, confirmSheet, sheet } from './components.js';
import {
  ENTRY_TYPES, emptyEntry, emptyCondition, conditionTitle, painColor, newId,
  attachmentKind, formatDuration, formatBytes, PAIN_WORDS, CONDITION_COLORS, typeLabel
} from '../models.js';
import { escape } from './timeline.js';

export async function view({ params, navigate, back }) {
  const isNew = params.id === 'neu';
  let entry, persisted = !isNew;

  if (isNew) {
    const lastCond = await db.getMeta('lastConditionId', null);
    const preset = new URLSearchParams(location.hash.split('?')[1] || '');
    entry = emptyEntry({
      conditionId: preset.get('thema') || lastCond || null,
      type: preset.get('typ') || 'tagebuch'
    });
  } else {
    entry = await db.get('entries', params.id);
    if (!entry) return { title: 'Nicht gefunden', html: '<div class="empty"><p>Dieser Eintrag existiert nicht mehr.</p></div>' };
  }

  let conditions = await db.listConditions();
  let attachments = persisted ? await db.listAttachments(entry.id) : [];
  let recorder = null;

  const html = `
  <form class="form" id="entryform" autocomplete="off">
    <div class="row2">
      <div class="field"><label for="f-date">Datum</label><input type="date" id="f-date" value="${entry.date}" required></div>
      <div class="field"><label for="f-time">Uhrzeit</label><input type="time" id="f-time" value="${entry.time || ''}"></div>
    </div>

    <div class="field">
      <label>Art</label>
      <div class="typegrid" id="types">
        ${ENTRY_TYPES.map(t => `<button type="button" class="typebtn" data-type="${t.id}"
            aria-pressed="${t.id === entry.type}">${icon(t.icon)}<span>${t.label}</span></button>`).join('')}
      </div>
    </div>

    <div class="field">
      <label for="f-title">Titel</label>
      <input type="text" id="f-title" value="${escape(entry.title)}" placeholder="${placeholderFor(entry.type)}">
    </div>

    <div class="field">
      <label>Thema</label>
      <button type="button" class="btn wide" id="condbtn" style="justify-content:space-between"></button>
    </div>

    <div class="field pain-wrap">
      <div class="pain-head">
        <span class="pain-val" id="painval">—</span>
        <span class="pain-word" id="painword">Schmerz nicht erfasst</span>
      </div>
      <input type="range" id="f-pain" min="0" max="10" step="1" value="${entry.pain ?? 3}"
             aria-label="Schmerz von 0 bis 10" ${entry.pain == null ? 'disabled' : ''}>
      <label class="pain-off"><input type="checkbox" id="painon" ${entry.pain != null ? 'checked' : ''}> Schmerz erfassen</label>
    </div>

    <div class="field">
      <label for="f-body">Wie war es?</label>
      <textarea id="f-body" placeholder="Was ist passiert, was wurde gesagt, wie hat es sich angefühlt.">${escape(entry.body)}</textarea>
    </div>

    <div class="field">
      <label for="f-helped">Was geholfen hat</label>
      <textarea id="f-helped" style="min-height:5rem" placeholder="Kühlen, Dehnung X, Ibu 400, zwei Tage Pause …">${escape(entry.helped)}</textarea>
      <span class="hint">Das Feld, das dir in einem Jahr am meisten bringt.</span>
    </div>

    <div class="row2">
      <div class="field"><label for="f-prac">Behandler</label><input type="text" id="f-prac" value="${escape(entry.practitioner)}" placeholder="Dr. …"></div>
      <div class="field"><label for="f-place">Ort</label><input type="text" id="f-place" value="${escape(entry.place)}" placeholder="Praxis, Klinik"></div>
    </div>

    <div class="field">
      <label>Anhänge</label>
      <div class="attach-row">
        <button type="button" class="btn" id="btn-cam">${icon('camera')} Foto</button>
        <button type="button" class="btn" id="btn-file">${icon('paperclip')} Datei</button>
        <button type="button" class="btn" id="btn-rec">${icon('mic')} Aufnehmen</button>
      </div>
      <input type="file" id="in-cam" accept="image/*" capture="environment" multiple hidden>
      <input type="file" id="in-file" accept="image/*,application/pdf,audio/*" multiple hidden>
      <div id="recbox"></div>
      <div class="att-grid" id="attgrid" style="margin-top:.6rem"></div>
    </div>

    <div class="btnrow" style="flex-direction:column;margin-top:.5rem">
      <button type="submit" class="btn primary wide">${icon('check')} Speichern</button>
      ${isNew ? '' : `<button type="button" class="btn danger wide" id="btn-del">${icon('trash')} Eintrag löschen</button>`}
    </div>
  </form>`;

  return {
    title: isNew ? 'Neuer Eintrag' : 'Eintrag bearbeiten',
    html,
    async mount(root) {
      const q = sel => root.querySelector(sel);
      const form = q('#entryform');

      /* ── Art ── */
      q('#types').addEventListener('click', e => {
        const b = e.target.closest('[data-type]');
        if (!b) return;
        entry.type = b.dataset.type;
        root.querySelectorAll('[data-type]').forEach(x => x.setAttribute('aria-pressed', String(x === b)));
        q('#f-title').placeholder = placeholderFor(entry.type);
      });

      /* ── Thema ── */
      const drawCond = () => {
        const c = conditions.find(x => x.id === entry.conditionId);
        q('#condbtn').innerHTML = c
          ? `<span class="chip plain"><i class="swatch" style="--c:${c.color}"></i>${escape(conditionTitle(c))}</span>`
          : `<span style="color:var(--ink-dim)">Keinem Thema zugeordnet</span>`;
      };
      drawCond();
      q('#condbtn').onclick = () => {
        const opts = [
          { id: '', label: 'Keinem Thema zuordnen' },
          ...conditions.map(c => ({ id: c.id, label: conditionTitle(c), color: c.color })),
          { id: '__new', label: '+ Neues Thema anlegen' }
        ];
        chooser('Thema', opts, entry.conditionId || '', async v => {
          if (v === '__new') {
            const created = await quickCondition();
            if (created) { conditions = await db.listConditions(); entry.conditionId = created.id; }
          } else entry.conditionId = v || null;
          drawCond();
        });
      };

      /* ── Schmerz ── */
      const range = q('#f-pain'), toggle = q('#painon');
      const drawPain = () => {
        const on = toggle.checked;
        const v = Number(range.value);
        range.disabled = !on;
        q('#painval').textContent = on ? v : '—';
        q('#painword').textContent = on ? PAIN_WORDS[v] : 'Schmerz nicht erfasst';
        const c = on ? painColor(v) : 'var(--ink-dim)';
        q('.pain-wrap').style.setProperty('--pain', c);
      };
      range.oninput = drawPain;
      toggle.onchange = drawPain;
      drawPain();

      /* ── Anhänge ── */
      const drawAtts = () => {
        const grid = q('#attgrid');
        grid.innerHTML = attachments.filter(a => !a.deleted).map(a => {
          const src = a.thumb ? objectUrl('t' + a.id, a.thumb) : (a.blob && a.kind === 'image' ? objectUrl('f' + a.id, a.blob) : null);
          const inner = src
            ? `<img src="${src}" alt="">`
            : `<span class="label">${icon(a.kind === 'audio' ? 'mic' : a.kind === 'pdf' ? 'file' : 'image')}<br>${escape(a.name || '')}</span>`;
          return `<button type="button" class="att" data-att="${a.id}" title="${escape(a.name || '')}">
            ${inner}<span class="kind">${a.kind === 'audio' ? formatDuration(a.seconds) : formatBytes(a.bytes)}</span></button>`;
        }).join('');
        grid.querySelectorAll('[data-att]').forEach(b => {
          b.onclick = async () => {
            const a = attachments.find(x => x.id === b.dataset.att);
            if (await confirmSheet('Anhang entfernen', escape(a.name || 'Diese Datei') + ' wird aus dem Eintrag entfernt.', 'Entfernen')) {
              a.deleted = 1;
              if (persisted) await db.put('attachments', db.touch(a));
              else await db.del('attachments', a.id);
              attachments = attachments.filter(x => x.id !== a.id);
              drawAtts();
            }
          };
        });
      };
      drawAtts();

      const ensurePersisted = async () => {
        readForm();
        if (!persisted) { await db.saveEntry(entry); persisted = true; }
        return entry.id;
      };

      const addFiles = async files => {
        if (!files?.length) return;
        await ensurePersisted();
        const settings = await db.getSettings();
        for (const file of files) {
          const kind = attachmentKind(file.type, file.name);
          let blob = file, thumb = null, bytes = file.size;
          if (kind === 'image') {
            toast('Bild wird verkleinert …');
            const prepped = await prepareImage(file, { maxPx: settings.imageMaxPx, quality: settings.imageQuality });
            blob = prepped.blob; thumb = prepped.thumb; bytes = prepped.blob.size;
          }
          const ext = (file.name.split('.').pop() || '').toLowerCase().slice(0, 5) ||
                      (blob.type.split('/')[1] || 'bin').replace(/[^a-z0-9]/g, '');
          const att = {
            id: newId('a'), entryId: entry.id, blob, thumb, kind,
            name: file.name || 'Anhang', bytes, seconds: 0, ext,
            mime: blob.type, path: null, createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(), dirty: 1, deleted: 0
          };
          await db.put('attachments', att);
          attachments.push(att);
        }
        drawAtts();
        toast(`${files.length} ${files.length === 1 ? 'Anhang' : 'Anhänge'} hinzugefügt`);
      };

      q('#btn-cam').onclick = () => q('#in-cam').click();
      q('#btn-file').onclick = () => q('#in-file').click();
      q('#in-cam').onchange = e => { addFiles([...e.target.files]); e.target.value = ''; };
      q('#in-file').onchange = e => { addFiles([...e.target.files]); e.target.value = ''; };

      /* ── Aufnahme ── */
      q('#btn-rec').onclick = () => {
        if (!micSupported()) { toast('Dieser Browser kann nicht aufnehmen.', 'err'); return; }
        openRecorder();
      };

      function openRecorder() {
        const box = q('#recbox');
        box.innerHTML = `
          <div class="rec" id="rec" style="margin-top:.6rem">
            <div class="rec-time" id="rectime">0:00</div>
            <div class="rec-state" id="recstate">Bereit</div>
            <div class="levels" id="levels">${'<i></i>'.repeat(24)}</div>
            <label class="consent"><input type="checkbox" id="consent">
              <span>Ich habe gefragt und die Zustimmung bekommen, dieses Gespräch aufzunehmen.
              Ohne Einwilligung ist eine Aufnahme in Deutschland strafbar (§ 201 StGB).</span></label>
            <div class="btnrow">
              <button type="button" class="btn primary" id="rec-go">${icon('mic')} Aufnahme starten</button>
              <button type="button" class="btn ghost" id="rec-close">Schließen</button>
            </div>
          </div>`;
        const rb = sel => box.querySelector(sel);
        const bars = [...box.querySelectorAll('.levels i')];
        let idx = 0;

        rb('#rec-close').onclick = () => { recorder?.cancel(); recorder = null; box.innerHTML = ''; };

        rb('#rec-go').onclick = async () => {
          if (!rb('#consent').checked && !recorder) {
            toast('Bitte erst die Einwilligung bestätigen.', 'err');
            return;
          }
          if (!recorder) {
            recorder = new Recorder({ bitrate: (await db.getSettings()).audioBitrate });
            recorder.addEventListener('tick', () => { rb('#rectime').textContent = formatDuration(recorder.seconds); });
            recorder.addEventListener('level', e => {
              const v = e.detail;
              bars[idx % bars.length].style.height = `${3 + v * 27}px`;
              bars[idx % bars.length].style.background = v > 0.08 ? 'var(--signal)' : 'var(--line)';
              idx++;
            });
            recorder.addEventListener('nowakelock', () =>
              toast('Bildschirm bleibt evtl. nicht an — App im Vordergrund lassen.', 'err'));
            recorder.addEventListener('failed', () => toast('Aufnahme abgebrochen.', 'err'));
            try { await recorder.start(); }
            catch { recorder = null; toast('Kein Zugriff aufs Mikrofon.', 'err'); return; }
            await ensurePersisted();
            renderLive();
          }
        };

        function renderLive() {
          rb('#rec').classList.add('live');
          rb('#recstate').innerHTML = '<i class="dot"></i>Nimmt auf — App offen lassen';
          rb('.btnrow').innerHTML = `
            <button type="button" class="btn" id="rec-pause">${icon('pause')} Pause</button>
            <button type="button" class="btn primary" id="rec-stop">${icon('stop')} Fertig</button>`;
          rb('#rec-pause').onclick = () => {
            if (recorder.state === 'recording') {
              recorder.pause();
              rb('#rec-pause').innerHTML = `${icon('play')} Weiter`;
              rb('#recstate').textContent = 'Pausiert';
              rb('#rec').classList.remove('live');
            } else {
              recorder.resume();
              rb('#rec-pause').innerHTML = `${icon('pause')} Pause`;
              rb('#recstate').innerHTML = '<i class="dot"></i>Nimmt auf — App offen lassen';
              rb('#rec').classList.add('live');
            }
          };
          rb('#rec-stop').onclick = async () => {
            const result = await recorder.stop();
            const consented = rb('#consent')?.checked;
            recorder = null;
            box.innerHTML = '';
            if (!result || !result.blob.size) { toast('Nichts aufgenommen.', 'err'); return; }
            const stamp = new Date().toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' });
            const att = {
              id: newId('a'), entryId: entry.id, blob: result.blob, thumb: null, kind: 'audio',
              name: `Gespräch ${stamp}.${result.ext}`, bytes: result.blob.size, seconds: result.seconds,
              ext: extForMime(result.mime), mime: result.mime, path: null,
              consent: consented ? 'mündlich eingeholt' : '',
              createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), dirty: 1, deleted: 0
            };
            await db.put('attachments', att);
            attachments.push(att);
            drawAtts();
            if (!entry.title) { entry.title = 'Arztgespräch'; q('#f-title').value = entry.title; }
            if (entry.type === 'tagebuch') {
              entry.type = 'arzt';
              root.querySelectorAll('[data-type]').forEach(x => x.setAttribute('aria-pressed', String(x.dataset.type === 'arzt')));
            }
            await db.saveEntry(readForm());
            toast(`Aufnahme gesichert (${formatDuration(result.seconds)})`);
          };
        }
      }

      /* ── Speichern ── */
      function readForm() {
        entry.date = q('#f-date').value || entry.date;
        entry.time = q('#f-time').value;
        entry.title = q('#f-title').value.trim();
        entry.body = q('#f-body').value.trim();
        entry.helped = q('#f-helped').value.trim();
        entry.practitioner = q('#f-prac').value.trim();
        entry.place = q('#f-place').value.trim();
        entry.pain = toggle.checked ? Number(range.value) : null;
        return entry;
      }

      form.onsubmit = async ev => {
        ev.preventDefault();
        readForm();
        if (!entry.title) entry.title = typeLabel(entry.type);
        await db.saveEntry(entry);
        if (entry.conditionId) await db.setMeta('lastConditionId', entry.conditionId);
        toast('Gespeichert');
        sync.refreshPending();
        const s = await db.getSettings();
        if (s.autoSync && db.isConfigured(s) && navigator.onLine) sync.sync().catch(() => {});
        navigate('#/eintrag/' + entry.id, { replace: true });
      };

      root.querySelector('#btn-del')?.addEventListener('click', async () => {
        if (await confirmSheet('Eintrag löschen', 'Der Eintrag und seine Anhänge werden entfernt — auch aus dem Repo beim nächsten Sync.')) {
          await db.softDelete('entries', entry.id);
          toast('Gelöscht');
          sync.refreshPending();
          back('#/');
        }
      });

      // Angefangene Aufnahme nicht stillschweigend verlieren.
      window.addEventListener('hashchange', () => recorder?.cancel(), { once: true });
    }
  };
}

function placeholderFor(type) {
  return {
    arzt: 'Kontrolle Knie, Dr. …', befund: 'MRT rechtes Knie',
    physio: 'Physio — Einheit 4', behandlung: 'Ibuprofen 400, Tape',
    verletzung: 'Umgeknickt beim Fußball', sport: 'Lauf, 8 km',
    tagebuch: 'Wie geht es dem Knie heute?', sonstiges: 'Notiz'
  }[type] || 'Kurzer Titel';
}

/** Thema direkt aus dem Editor anlegen, ohne den Eintrag zu verlassen. */
function quickCondition() {
  return new Promise(resolve => {
    sheet('Neues Thema', `
      <div class="field"><label for="qc-name">Name</label>
        <input type="text" id="qc-name" placeholder="Knie links — Innenmeniskus"></div>
      <div class="btnrow" style="margin-top:1rem"><button class="btn primary wide" id="qc-ok">Anlegen</button></div>`, {
      onMount(panel, close) {
        const input = panel.querySelector('#qc-name');
        input.focus();
        panel.querySelector('#qc-ok').onclick = async () => {
          const name = input.value.trim();
          if (!name) { close(); resolve(null); return; }
          const existing = await db.listConditions();
          const c = emptyCondition({ name, color: CONDITION_COLORS[existing.length % CONDITION_COLORS.length] });
          await db.saveCondition(c);
          close(); resolve(c);
        };
        input.onkeydown = e => { if (e.key === 'Enter') { e.preventDefault(); panel.querySelector('#qc-ok').click(); } };
      }
    });
  });
}
