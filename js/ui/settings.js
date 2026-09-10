// Einrichtung und Datenhoheit. Der Token liegt lokal im Browser — deshalb hier
// auch klar sagen, was das heißt und wie man ihn wieder los wird.

import * as db from '../db.js';
import * as sync from '../sync.js';
import { GitHub } from '../github.js';
import { icon, toast, confirmSheet } from './components.js';
import { formatBytes } from '../models.js';
import { escape } from './timeline.js';

export async function view({ navigate }) {
  const s = await db.getSettings();
  const est = await db.storageEstimate();
  const persisted = navigator.storage?.persisted ? await navigator.storage.persisted().catch(() => false) : false;
  const conflicts = await db.all('conflicts');
  const counts = {
    entries: (await db.listEntries()).length,
    conditions: (await db.listConditions()).length,
    files: (await db.all('attachments')).filter(a => !a.deleted).length,
    local: (await db.all('attachments')).filter(a => !a.deleted && a.blob).length
  };

  return {
    title: 'Einstellungen',
    html: `<form class="form" id="setform">
      <h2 class="section-h" style="margin-top:.25rem">Privates Repo</h2>
      <div class="banner">${icon('info')}<span>Die App liegt öffentlich auf GitHub Pages, deine Daten nicht.
        Sie gehören in ein <b>separates, privates</b> Repo. Wer den Link zur App kennt, sieht nichts von dir.</span></div>

      <div class="row2">
        <div class="field"><label for="s-owner">GitHub-Benutzer</label>
          <input type="text" id="s-owner" value="${escape(s.repoOwner)}" placeholder="samuel" autocapitalize="off" spellcheck="false"></div>
        <div class="field"><label for="s-repo">Repo</label>
          <input type="text" id="s-repo" value="${escape(s.repoName)}" placeholder="krankenakte" autocapitalize="off" spellcheck="false"></div>
      </div>
      <div class="field"><label for="s-branch">Branch</label>
        <input type="text" id="s-branch" value="${escape(s.branch)}" placeholder="main" autocapitalize="off" spellcheck="false"></div>

      <div class="field"><label for="s-token">Zugriffstoken</label>
        <input type="password" id="s-token" value="${escape(s.token)}" placeholder="github_pat_…" autocapitalize="off" spellcheck="false">
        <span class="hint">Fine-grained Token, nur auf dieses eine Repo, Berechtigung <b>Contents: Read and write</b>.
        Er wird ausschließlich in diesem Browser gespeichert und nur an api.github.com geschickt.</span></div>

      <div class="btnrow">
        <button type="button" class="btn" id="s-test">${icon('check')} Verbindung prüfen</button>
        <button type="submit" class="btn primary">Speichern</button>
      </div>

      <label class="pain-off" style="margin-top:.25rem">
        <input type="checkbox" id="s-auto" ${s.autoSync ? 'checked' : ''}> Nach jeder Änderung automatisch synchronisieren</label>

      <h2 class="section-h">Synchronisation</h2>
      <div class="factgrid">
        <div class="fact"><dt>Einträge</dt><dd>${counts.entries}</dd></div>
        <div class="fact"><dt>Themen</dt><dd>${counts.conditions}</dd></div>
        <div class="fact"><dt>Dateien</dt><dd>${counts.local}/${counts.files}</dd></div>
        <div class="fact"><dt>Offen</dt><dd id="s-pending">${sync.status.pending}</dd></div>
      </div>
      <div class="btnrow">
        <button type="button" class="btn" id="s-sync">${icon('sync')} Jetzt synchronisieren</button>
        <button type="button" class="btn ghost" id="s-fetchall">${icon('download')} Alle Dateien lokal laden</button>
      </div>
      <span class="hint">Fotos und Aufnahmen werden sonst erst beim Öffnen geladen — das spart Mobilfunkvolumen.</span>

      ${conflicts.length ? `<div class="banner warn">${icon('alert')}
        <span><b>${conflicts.length} Konflikt(e).</b> Zwei Geräte haben denselben Eintrag geändert.
        Die neuere Fassung steht in der App, die andere ist gesichert.</span>
        <button type="button" class="btn ghost" id="s-conf">Ansehen</button></div>` : ''}

      <h2 class="section-h">Dieses Gerät</h2>
      <div class="factgrid">
        <div class="fact"><dt>Belegt</dt><dd>${est ? formatBytes(est.usage) : '—'}</dd></div>
        <div class="fact"><dt>Verfügbar</dt><dd>${est ? formatBytes(est.quota) : '—'}</dd></div>
      </div>
      ${persisted ? '' : `<div class="banner warn">${icon('alert')}
        <span>Der Browser darf diese Daten bisher löschen, wenn der Speicher knapp wird.</span>
        <button type="button" class="btn ghost" id="s-persist">Schützen</button></div>`}

      <div class="field" style="margin-top:.5rem"><label for="s-theme">Darstellung</label>
        <select id="s-theme">
          <option value="system" ${s.theme === 'system' ? 'selected' : ''}>Wie das System</option>
          <option value="light" ${s.theme === 'light' ? 'selected' : ''}>Hell</option>
          <option value="dark" ${s.theme === 'dark' ? 'selected' : ''}>Dunkel</option>
        </select></div>

      <h2 class="section-h">Sicherung</h2>
      <div class="btnrow">
        <button type="button" class="btn" id="s-export">${icon('download')} Export als JSON</button>
      </div>
      <span class="hint">Nur Text und Metadaten. Die eigentliche Sicherung ist das Git-Repo — dort liegt jede Version.</span>

      <h2 class="section-h">Zurücksetzen</h2>
      <div class="btnrow" style="flex-direction:column">
        <button type="button" class="btn danger wide" id="s-wipe">${icon('trash')} Lokale Daten löschen</button>
      </div>
      <span class="hint">Löscht nur diesen Browser, nicht das Repo. Danach lädt der nächste Sync alles neu.</span>
    </form>`,

    mount(root) {
      const q = sel => root.querySelector(sel);
      const read = () => ({
        repoOwner: q('#s-owner').value.trim(),
        repoName: q('#s-repo').value.trim().replace(/^.*\//, ''),
        branch: q('#s-branch').value.trim() || 'main',
        token: q('#s-token').value.trim(),
        autoSync: q('#s-auto').checked,
        theme: q('#s-theme').value
      });

      q('#setform').onsubmit = async ev => {
        ev.preventDefault();
        const next = await db.saveSettings(read());
        applyTheme(next.theme);
        toast('Gespeichert');
      };
      q('#s-theme').onchange = async () => {
        const next = await db.saveSettings({ theme: q('#s-theme').value });
        applyTheme(next.theme);
      };

      q('#s-test').onclick = async () => {
        const cfg = read();
        if (!cfg.repoOwner || !cfg.repoName || !cfg.token) { toast('Benutzer, Repo und Token ausfüllen.', 'err'); return; }
        q('#s-test').disabled = true;
        try {
          const gh = new GitHub({ token: cfg.token, owner: cfg.repoOwner, repo: cfg.repoName, branch: cfg.branch });
          const info = await gh.verify();
          await db.saveSettings(cfg);
          toast(info.private ? `Verbunden mit ${info.full_name}` : `Verbunden — aber ${info.full_name} ist ÖFFENTLICH`, info.private ? '' : 'err');
        } catch (err) { toast(err.message, 'err'); }
        finally { q('#s-test').disabled = false; }
      };

      q('#s-sync').onclick = async () => {
        q('#s-sync').disabled = true;
        try { const r = await sync.sync(); toast(r ? `Synchron: ${r.pulled} geladen, ${r.pushed} gesichert` : 'Läuft schon …'); }
        catch (err) { toast(err.message, 'err'); }
        finally { q('#s-sync').disabled = false; q('#s-pending').textContent = sync.status.pending; }
      };

      q('#s-fetchall').onclick = async () => {
        q('#s-fetchall').disabled = true;
        try {
          const n = await sync.fetchAllBlobs((i, total) => { q('#s-fetchall').textContent = `Lade ${i}/${total}`; });
          toast(n ? `${n} Dateien geladen` : 'Alles schon lokal');
        } catch (err) { toast(err.message, 'err'); }
        finally { q('#s-fetchall').disabled = false; q('#s-fetchall').innerHTML = `${icon('download')} Alle Dateien lokal laden`; }
      };

      q('#s-persist')?.addEventListener('click', async () => {
        const ok = await db.requestPersistence();
        toast(ok ? 'Speicher ist jetzt geschützt.' : 'Der Browser hat abgelehnt — häufiger benutzen hilft.', ok ? '' : 'err');
      });

      q('#s-conf')?.addEventListener('click', () => navigate('#/konflikte'));

      q('#s-export').onclick = async () => {
        const data = {
          exportedAt: new Date().toISOString(),
          conditions: await db.listConditions(),
          entries: await db.listEntries(),
          attachments: (await db.all('attachments')).filter(a => !a.deleted)
            .map(({ blob, thumb, ...rest }) => { void blob; void thumb; return rest; })
        };
        const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }));
        const a = document.createElement('a');
        a.href = url;
        a.download = `krankenakte-${new Date().toISOString().slice(0, 10)}.json`;
        a.click();
        setTimeout(() => URL.revokeObjectURL(url), 4000);
      };

      q('#s-wipe').onclick = async () => {
        if (await confirmSheet('Lokale Daten löschen',
          'Alles in diesem Browser wird entfernt. Nicht synchronisierte Änderungen sind dann weg.')) {
          await db.wipeAll();
          toast('Lokal geleert');
          navigate('#/', { replace: true });
          location.reload();
        }
      };
    }
  };
}

export function applyTheme(theme) {
  if (theme === 'system') document.documentElement.removeAttribute('data-theme');
  else document.documentElement.setAttribute('data-theme', theme);
}

export async function conflictsView({ back }) {
  const rows = await db.all('conflicts');
  return {
    title: 'Konflikte',
    back: true,
    html: rows.length ? `<div class="form">${rows.map(c => `
      <div class="banner" style="display:block">
        <div class="dur" style="color:var(--ink-dim);font-size:.75rem">${new Date(c.at).toLocaleString('de-DE')} · ${c.store}</div>
        <b>${escape(c.losing.title || c.losing.name || c.recordId)}</b>
        <div class="prose" style="font-size:.9375rem;margin-top:.5rem">${escape(c.losing.body || c.losing.notes || '')}</div>
        <div class="btnrow" style="margin-top:.75rem">
          <button class="btn ghost" data-drop="${c.id}">Verwerfen</button>
        </div>
      </div>`).join('')}</div>`
      : '<div class="empty"><h2>Keine Konflikte</h2><p>Alle Geräte sind sich einig.</p></div>',
    mount(root) {
      root.querySelectorAll('[data-drop]').forEach(b => {
        b.onclick = async () => { await db.del('conflicts', b.dataset.drop); back('#/einstellungen'); };
      });
    }
  };
}
