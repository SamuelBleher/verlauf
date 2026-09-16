// Minimaler CDP-Client (WebSocket von Hand, keine Abhängigkeiten).
// Nötig, weil auf diesem Rechner weder Chrome noch Firefox headless rastern
// können — die UI wird deshalb numerisch geprüft statt per Screenshot.
//
//   google-chrome --headless=new --no-sandbox --disable-gpu \
//     --remote-debugging-port=9333 --user-data-dir=/tmp/x about:blank &
//   node tools/dein-test.mjs
import net from 'node:net';
import crypto from 'node:crypto';
import http from 'node:http';
import fs from 'node:fs';

const getJSON = url => new Promise((res, rej) => {
  http.get(url, r => { let d = ''; r.on('data', c => d += c); r.on('end', () => res(JSON.parse(d))); }).on('error', rej);
});

class WS {
  constructor(sock) { this.sock = sock; this.buf = Buffer.alloc(0); this.handlers = []; sock.on('data', d => this._onData(d)); }
  _onData(d) {
    this.buf = Buffer.concat([this.buf, d]);
    for (;;) {
      if (this.buf.length < 2) return;
      const len0 = this.buf[1] & 127;
      let off = 2, len = len0;
      if (len0 === 126) { if (this.buf.length < 4) return; len = this.buf.readUInt16BE(2); off = 4; }
      else if (len0 === 127) { if (this.buf.length < 10) return; len = Number(this.buf.readBigUInt64BE(2)); off = 10; }
      if (this.buf.length < off + len) return;
      const payload = this.buf.subarray(off, off + len);
      this.buf = this.buf.subarray(off + len);
      try { const msg = JSON.parse(payload.toString('utf8')); this.handlers.forEach(h => h(msg)); } catch { /* Ping/Pong */ }
    }
  }
  send(obj) {
    const data = Buffer.from(JSON.stringify(obj));
    const mask = crypto.randomBytes(4);
    const masked = Buffer.from(data);
    for (let i = 0; i < masked.length; i++) masked[i] ^= mask[i % 4];
    let head;
    if (data.length < 126) head = Buffer.from([0x81, 0x80 | data.length]);
    else if (data.length < 65536) { head = Buffer.alloc(4); head[0] = 0x81; head[1] = 0x80 | 126; head.writeUInt16BE(data.length, 2); }
    else { head = Buffer.alloc(10); head[0] = 0x81; head[1] = 0x80 | 127; head.writeBigUInt64BE(BigInt(data.length), 2); }
    this.sock.write(Buffer.concat([head, mask, masked]));
  }
  on(h) { this.handlers.push(h); }
  close() { try { this.sock.destroy(); } catch { /* egal */ } }
}

export async function connect(port) {
  const targets = await getJSON(`http://127.0.0.1:${port}/json/list`);
  const page = targets.find(t => t.type === 'page');
  if (!page) throw new Error('kein Page-Target — läuft Chrome mit --remote-debugging-port?');
  const u = new URL(page.webSocketDebuggerUrl);
  const sock = net.connect({ host: u.hostname, port: u.port });
  await new Promise(r => sock.once('connect', r));
  const key = crypto.randomBytes(16).toString('base64');
  sock.write(`GET ${u.pathname} HTTP/1.1\r\nHost: ${u.host}\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Key: ${key}\r\nSec-WebSocket-Version: 13\r\n\r\n`);
  const ws = await new Promise(res => {
    const onData = d => {
      const i = d.toString('binary').indexOf('\r\n\r\n');
      if (i === -1) return;
      sock.removeListener('data', onData);
      const w = new WS(sock);
      const rest = d.subarray(i + 4);
      if (rest.length) w._onData(rest);
      res(w);
    };
    sock.on('data', onData);
  });

  let id = 0;
  const pending = new Map();
  const events = [];
  ws.on(msg => {
    if (msg.id && pending.has(msg.id)) {
      const { res, rej } = pending.get(msg.id); pending.delete(msg.id);
      msg.error ? rej(new Error(msg.error.message)) : res(msg.result);
    } else if (msg.method) events.push(msg);
  });
  const send = (method, params = {}) => new Promise((res, rej) => {
    const i = ++id; pending.set(i, { res, rej }); ws.send({ id: i, method, params });
  });

  return {
    send, events, close: () => ws.close(),
    async eval(expression) {
      const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
      if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || 'eval error');
      return r.result.value;
    },
    async screenshot(path) {   // hier kaputt, siehe Kommentar oben — nur der Vollständigkeit halber
      const r = await send('Page.captureScreenshot', { format: 'png' });
      fs.writeFileSync(path, Buffer.from(r.data, 'base64'));
    },
    /** Konsolenfehler und fehlgeschlagene Requests seit dem letzten Aufruf. */
    drain() {
      const errors = [], failed = [];
      for (const e of events.splice(0)) {
        if (e.method === 'Log.entryAdded' && e.params.entry.level === 'error')
          errors.push(`[log] ${e.params.entry.text} ${e.params.entry.url || ''}`);
        if (e.method === 'Runtime.exceptionThrown')
          errors.push('[exc] ' + (e.params.exceptionDetails.exception?.description || e.params.exceptionDetails.text));
        if (e.method === 'Network.loadingFailed')
          failed.push(`${e.params.type} ${e.params.errorText}`);
      }
      return { errors, failed };
    }
  };
}
export const sleep = ms => new Promise(r => setTimeout(r, ms));
