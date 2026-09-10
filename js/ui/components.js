// Gemeinsame UI-Bausteine: Icons, Overlays, kleine DOM-Helfer.

const P = {
  stethoscope: '<path d="M6 3v6a5 5 0 0 0 10 0V3M4 3h4M14 3h4M11 14v2a5 5 0 0 0 10 0v-1"/><circle cx="21" cy="12" r="2"/>',
  scan: '<path d="M3 8V5a2 2 0 0 1 2-2h3M16 3h3a2 2 0 0 1 2 2v3M21 16v3a2 2 0 0 1-2 2h-3M8 21H5a2 2 0 0 1-2-2v-3"/><path d="M7 12h10"/>',
  hand: '<path d="M8 13V5.5a1.5 1.5 0 0 1 3 0V12m0-1V4.5a1.5 1.5 0 0 1 3 0V12m0-1.5a1.5 1.5 0 0 1 3 0V13m0-1a1.5 1.5 0 0 1 3 0v4a6 6 0 0 1-6 6h-2a6 6 0 0 1-6-6v-3a1.5 1.5 0 0 1 3 0"/>',
  pill: '<rect x="2" y="9" width="20" height="6" rx="3" transform="rotate(-45 12 12)"/><path d="M8.5 8.5l7 7"/>',
  bolt: '<path d="M13 2 4 14h7l-1 8 9-12h-7l1-8z"/>',
  run: '<circle cx="15" cy="4" r="2"/><path d="M9 21l2-5-3-3 1-5 4 2 3 1M6 12l2-4M13 13l3 3 1 5"/>',
  note: '<path d="M5 3h9l5 5v13H5z"/><path d="M14 3v5h5M9 13h6M9 17h4"/>',
  dots: '<circle cx="5" cy="12" r="1.4"/><circle cx="12" cy="12" r="1.4"/><circle cx="19" cy="12" r="1.4"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  camera: '<path d="M3 8h3l2-3h8l2 3h3v12H3z"/><circle cx="12" cy="13" r="4"/>',
  mic: '<rect x="9" y="2" width="6" height="12" rx="3"/><path d="M5 11a7 7 0 0 0 14 0M12 18v4M9 22h6"/>',
  paperclip: '<path d="M21 11l-9 9a5 5 0 0 1-7-7l9-9a3.5 3.5 0 0 1 5 5l-9 9a2 2 0 0 1-3-3l8-8"/>',
  file: '<path d="M6 2h8l5 5v15H6z"/><path d="M14 2v5h5"/>',
  image: '<rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="8.5" cy="9.5" r="1.5"/><path d="M21 16l-5-5-6 6-2-2-5 5"/>',
  back: '<path d="M15 19l-7-7 7-7"/>',
  search: '<circle cx="11" cy="11" r="7"/><path d="M20 20l-4-4"/>',
  layers: '<path d="M12 3l9 5-9 5-9-5 9-5z"/><path d="M3 13l9 5 9-5M3 17.5l9 5 9-5"/>',
  timeline: '<path d="M6 3v18"/><circle cx="6" cy="7" r="2"/><circle cx="6" cy="16" r="2"/><path d="M10 7h10M10 16h7"/>',
  settings: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.6 1.6 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.6 1.6 0 0 0-2.7 1.1V21a2 2 0 1 1-4 0v-.1A1.6 1.6 0 0 0 7.9 19.4a1.6 1.6 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.6 1.6 0 0 0-1.1-2.7H2a2 2 0 1 1 0-4h.1a1.6 1.6 0 0 0 1.5-1.1 1.6 1.6 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1A1.6 1.6 0 0 0 9 3.6V3a2 2 0 1 1 4 0v.1a1.6 1.6 0 0 0 2.7 1.1l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.6 1.6 0 0 0 1.1 2.7H22a2 2 0 1 1 0 4h-.1a1.6 1.6 0 0 0-1.5 1.1z"/>',
  sync: '<path d="M21 12a9 9 0 0 1-15.5 6.2L3 16"/><path d="M3 12a9 9 0 0 1 15.5-6.2L21 8"/><path d="M21 4v4h-4M3 20v-4h4"/>',
  trash: '<path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/>',
  check: '<path d="M4 12l5 5L20 6"/>',
  x: '<path d="M6 6l12 12M18 6L6 18"/>',
  pause: '<path d="M8 5v14M16 5v14"/>',
  play: '<path d="M7 4l13 8-13 8z"/>',
  stop: '<rect x="6" y="6" width="12" height="12" rx="2"/>',
  edit: '<path d="M4 20h4L20 8l-4-4L4 16z"/>',
  alert: '<path d="M12 3l9 17H3z"/><path d="M12 10v4M12 17.5v.01"/>',
  download: '<path d="M12 3v12M7 11l5 5 5-5M4 21h16"/>',
  info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v5M12 8v.01"/>'
};

export function icon(name, cls = '') {
  return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"
    stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"${cls ? ` class="${cls}"` : ''}>${P[name] || P.dots}</svg>`;
}

export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

export function h(html) {
  const t = document.createElement('template');
  t.innerHTML = html.trim();
  return t.content.firstElementChild;
}

/* ── Toast ─────────────────────────────────────────────── */
let toastTimer;
export function toast(message, kind = '') {
  const el = document.getElementById('toast');
  el.textContent = message;
  el.className = 'toast' + (kind ? ' ' + kind : '');
  el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.hidden = true; }, kind === 'err' ? 5200 : 2600);
}

/* ── Sheet ─────────────────────────────────────────────── */
export function sheet(title, innerHtml, { onMount } = {}) {
  const host = document.getElementById('sheet');
  host.hidden = false;
  host.innerHTML = `<div class="scrim"></div><div class="panel" role="dialog" aria-modal="true" aria-label="${title}">
    <div class="grab"></div>${title ? `<h2>${title}</h2>` : ''}${innerHtml}</div>`;
  const close = () => { host.hidden = true; host.innerHTML = ''; document.removeEventListener('keydown', onKey); };
  const onKey = e => { if (e.key === 'Escape') close(); };
  document.addEventListener('keydown', onKey);
  host.querySelector('.scrim').addEventListener('click', close);
  onMount?.(host.querySelector('.panel'), close);
  host.querySelector('.panel').querySelector('button, [tabindex], input')?.focus();
  return close;
}

export function chooser(title, options, current, onPick) {
  return sheet(title, `<div class="optlist">${options.map(o => `
    <button class="opt" data-v="${o.id}" aria-pressed="${String(o.id) === String(current)}">
      ${o.color ? `<span class="swatch" style="--c:${o.color}"></span>` : ''}
      <span style="flex:1">${o.label}</span>
      ${String(o.id) === String(current) ? icon('check') : ''}
    </button>`).join('')}</div>`, {
    onMount(panel, close) {
      panel.addEventListener('click', e => {
        const b = e.target.closest('.opt');
        if (!b) return;
        close(); onPick(b.dataset.v);
      });
    }
  });
}

export function confirmSheet(title, message, confirmLabel = 'Löschen') {
  return new Promise(resolve => {
    let decided = false;
    const close = sheet(title, `
      <p style="margin:0 0 1rem;font-size:.875rem;color:var(--ink-mid);line-height:1.5">${message}</p>
      <div class="btnrow" style="flex-direction:column">
        <button class="btn danger wide" data-yes>${confirmLabel}</button>
        <button class="btn ghost wide" data-no>Abbrechen</button>
      </div>`, {
      onMount(panel, dismiss) {
        panel.querySelector('[data-yes]').onclick = () => { decided = true; dismiss(); resolve(true); };
        panel.querySelector('[data-no]').onclick = () => { decided = true; dismiss(); resolve(false); };
      }
    });
    const host = document.getElementById('sheet');
    new MutationObserver((m, obs) => {
      if (host.hidden && !decided) { obs.disconnect(); resolve(false); }
    }).observe(host, { attributes: true, attributeFilter: ['hidden'] });
    void close;
  });
}

/* ── Lightbox ──────────────────────────────────────────── */
export function lightbox(items, startIndex = 0) {
  const host = document.getElementById('lightbox');
  let i = startIndex;
  host.hidden = false;

  const render = () => {
    const it = items[i];
    host.innerHTML = `
      <header>
        <button class="iconbtn" data-close aria-label="Schließen">${icon('x')}</button>
        <span class="nm">${it.name || ''}</span>
        <span class="dur">${items.length > 1 ? `${i + 1}/${items.length}` : ''}</span>
      </header>
      <div class="stage">${it.url
        ? (it.kind === 'pdf'
            ? `<div style="text-align:center;color:#9FB3BB;padding:2rem">
                 ${icon('file')}<p style="margin:.75rem 0 1rem;font-size:.875rem">PDFs öffnet der Browser in einem eigenen Tab.</p>
                 <a class="btn" href="${it.url}" target="_blank" rel="noopener">Öffnen</a></div>`
            : `<img src="${it.url}" alt="${it.name || ''}">`)
        : '<span style="color:#9FB3BB">Wird geladen …</span>'}</div>
      <footer>
        ${items.length > 1 ? `<button class="btn ghost" data-prev ${i === 0 ? 'disabled' : ''}>Zurück</button>
        <button class="btn ghost" data-next ${i === items.length - 1 ? 'disabled' : ''}>Weiter</button>` : ''}
      </footer>`;
    host.querySelector('[data-close]').onclick = close;
    host.querySelector('[data-prev]')?.addEventListener('click', () => { i--; render(); });
    host.querySelector('[data-next]')?.addEventListener('click', () => { i++; render(); });
  };
  const onKey = e => {
    if (e.key === 'Escape') close();
    if (e.key === 'ArrowRight' && i < items.length - 1) { i++; render(); }
    if (e.key === 'ArrowLeft' && i > 0) { i--; render(); }
  };
  function close() { host.hidden = true; host.innerHTML = ''; document.removeEventListener('keydown', onKey); }
  document.addEventListener('keydown', onKey);
  render();
  return { update: render, close };
}

/* ── Sparkline für Themen ──────────────────────────────── */
export function sparkline(values, color = 'currentColor', w = 62, hgt = 26) {
  const pts = values.filter(v => v !== null && v !== undefined);
  if (pts.length < 2) return `<svg class="spark" viewBox="0 0 ${w} ${hgt}" aria-hidden="true"></svg>`;
  const step = w / (pts.length - 1);
  const y = v => hgt - 2 - (v / 10) * (hgt - 4);
  const d = pts.map((v, idx) => `${idx ? 'L' : 'M'}${(idx * step).toFixed(1)} ${y(v).toFixed(1)}`).join(' ');
  return `<svg class="spark" viewBox="0 0 ${w} ${hgt}" aria-hidden="true" fill="none">
    <path d="${d}" stroke="${color}" stroke-width="1.5" stroke-linejoin="round" stroke-linecap="round" opacity=".85"/>
    <circle cx="${((pts.length - 1) * step).toFixed(1)}" cy="${y(pts.at(-1)).toFixed(1)}" r="2" fill="${color}"/>
  </svg>`;
}
