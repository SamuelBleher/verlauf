// Jeder Eintrag wird eine Markdown-Datei mit YAML-Frontmatter. Das ist der Punkt:
// die Daten bleiben ohne diese App lesbar — in Obsidian, in jedem Editor, in 20 Jahren.

const NEEDS_QUOTE = /^[\s>|*&!%@`{[\]}#-]|[:#]\s|^$|^(true|false|null|yes|no|on|off)$|^-?\d+(\.\d+)?$|[\n"']/i;

function scalar(v) {
  if (v === null || v === undefined) return '';
  if (typeof v === 'number' || typeof v === 'boolean') return String(v);
  const s = String(v);
  if (s.includes('\n')) return JSON.stringify(s);
  return NEEDS_QUOTE.test(s) ? JSON.stringify(s) : s;
}

export function stringifyFrontmatter(obj) {
  const lines = ['---'];
  for (const [k, v] of Object.entries(obj)) {
    if (v === null || v === undefined || v === '') continue;
    if (Array.isArray(v)) {
      if (!v.length) continue;
      lines.push(`${k}:`);
      for (const item of v) {
        if (item && typeof item === 'object') {
          const pairs = Object.entries(item).filter(([, x]) => x !== null && x !== undefined && x !== '');
          if (!pairs.length) continue;
          lines.push(`  - ${pairs[0][0]}: ${scalar(pairs[0][1])}`);
          for (const [ik, iv] of pairs.slice(1)) lines.push(`    ${ik}: ${scalar(iv)}`);
        } else lines.push(`  - ${scalar(item)}`);
      }
    } else lines.push(`${k}: ${scalar(v)}`);
  }
  lines.push('---');
  return lines.join('\n');
}

function unscalar(raw) {
  const s = raw.trim();
  if (s === '') return '';
  if ((s[0] === '"' && s.at(-1) === '"') || (s[0] === "'" && s.at(-1) === "'")) {
    try { return JSON.parse(s[0] === "'" ? `"${s.slice(1, -1).replace(/"/g, '\\"')}"` : s); }
    catch { return s.slice(1, -1); }
  }
  if (s === 'true') return true;
  if (s === 'false') return false;
  if (s === 'null' || s === '~') return null;
  if (/^-?\d+$/.test(s)) return parseInt(s, 10);
  if (/^-?\d*\.\d+$/.test(s)) return parseFloat(s);
  return s;
}

/** Toleranter Parser für genau die Teilmenge, die wir schreiben (plus Handkorrekturen). */
export function parseFrontmatter(text) {
  const src = text.replace(/^﻿/, '');
  const m = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/.exec(src);
  if (!m) return { data: {}, body: src.trim() };
  const data = {};
  let key = null;
  for (const rawLine of m[1].split(/\r?\n/)) {
    if (!rawLine.trim() || /^\s*#/.test(rawLine)) continue;
    const indent = rawLine.length - rawLine.trimStart().length;
    const line = rawLine.trim();

    if (indent === 0 && !line.startsWith('-')) {
      const idx = line.indexOf(':');
      if (idx === -1) continue;
      key = line.slice(0, idx).trim();
      const rest = line.slice(idx + 1).trim();
      if (rest === '') data[key] = [];                 // Liste folgt eingerückt
      else if (rest.startsWith('[') && rest.endsWith(']')) {
        data[key] = rest.slice(1, -1).split(',').map(s => unscalar(s)).filter(s => s !== '');
      } else { data[key] = unscalar(rest); key = null; }
      continue;
    }
    if (!key) continue;
    if (!Array.isArray(data[key])) data[key] = [];

    if (line.startsWith('- ')) {
      const item = line.slice(2).trim();
      const idx = item.indexOf(':');
      if (idx > 0 && !/^https?:/i.test(item)) {
        data[key].push({ [item.slice(0, idx).trim()]: unscalar(item.slice(idx + 1)) });
      } else data[key].push(unscalar(item));
    } else {
      const last = data[key].at(-1);
      const idx = line.indexOf(':');
      if (last && typeof last === 'object' && idx > 0) last[line.slice(0, idx).trim()] = unscalar(line.slice(idx + 1));
    }
  }
  return { data, body: src.slice(m[0].length).trim() };
}

/* ── Anzeige ───────────────────────────────────────────── */
export function escapeHtml(s = '') {
  return String(s).replace(/[&<>"']/g, c =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function inline(s) {
  return escapeHtml(s)
    .replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>')
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/(^|[\s(])\*([^*\n]+)\*/g, '$1<em>$2</em>')
    .replace(/`([^`]+)`/g, '<code>$1</code>');
}

/** Bewusst winziger Renderer — Absätze, Listen, Betonung. Mehr braucht ein Tagebuch nicht. */
export function renderMarkdown(text = '') {
  const out = [];
  let list = null;
  const closeList = () => { if (list) { out.push(`</${list}>`); list = null; } };

  for (const raw of String(text).split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) { closeList(); continue; }
    const ul = /^[-*]\s+(.*)$/.exec(line);
    const ol = /^\d+[.)]\s+(.*)$/.exec(line);
    if (ul) {
      if (list !== 'ul') { closeList(); out.push('<ul>'); list = 'ul'; }
      out.push(`<li>${inline(ul[1])}</li>`);
    } else if (ol) {
      if (list !== 'ol') { closeList(); out.push('<ol>'); list = 'ol'; }
      out.push(`<li>${inline(ol[1])}</li>`);
    } else {
      closeList();
      const h = /^(#{1,4})\s+(.*)$/.exec(line);
      if (h) out.push(`<p><strong>${inline(h[2])}</strong></p>`);
      else out.push(`<p>${inline(line)}</p>`);
    }
  }
  closeList();
  return out.join('');
}

export const excerpt = (text = '', n = 160) => {
  const flat = String(text).replace(/[#*`_>]/g, '').replace(/\s+/g, ' ').trim();
  return flat.length > n ? flat.slice(0, n - 1).trimEnd() + '…' : flat;
};
