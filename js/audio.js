// Aufnahme von Arztgesprächen. iOS beendet MediaRecorder, sobald die App in den
// Hintergrund geht oder das Display sperrt — deshalb halten wir währenddessen
// einen Wake Lock und melden es offen, wenn er nicht zu bekommen ist.

const CANDIDATES = [
  'audio/webm;codecs=opus',
  'audio/webm',
  'audio/mp4;codecs=mp4a.40.2',
  'audio/mp4',
  'audio/ogg;codecs=opus'
];

export function pickMime() {
  if (!self.MediaRecorder?.isTypeSupported) return '';
  return CANDIDATES.find(m => MediaRecorder.isTypeSupported(m)) || '';
}
export const isSupported = () => Boolean(navigator.mediaDevices?.getUserMedia && self.MediaRecorder);

export function extForMime(mime = '') {
  if (mime.includes('webm')) return 'webm';
  if (mime.includes('mp4') || mime.includes('m4a') || mime.includes('aac')) return 'm4a';
  if (mime.includes('ogg')) return 'ogg';
  return 'bin';
}

export class Recorder extends EventTarget {
  constructor({ bitrate = 32000 } = {}) {
    super();
    this.bitrate = bitrate;
    this.state = 'idle';        // idle | recording | paused | stopped
    this.chunks = [];
    this.seconds = 0;
    this.level = 0;
    this._wakeLock = null;
    this._tick = null;
    this._raf = null;
  }

  _emit(type, detail) { this.dispatchEvent(new CustomEvent(type, { detail })); }

  async start() {
    if (this.state === 'recording') return;
    this.stream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true, channelCount: 1 }
    });
    const mimeType = pickMime();
    const opts = { audioBitsPerSecond: this.bitrate };
    if (mimeType) opts.mimeType = mimeType;
    this.mime = mimeType || 'audio/webm';

    this.rec = new MediaRecorder(this.stream, opts);
    this.chunks = [];
    this.rec.ondataavailable = e => { if (e.data && e.data.size) this.chunks.push(e.data); };
    this.rec.onerror = e => this._emit('failed', e.error || new Error('Aufnahme abgebrochen'));
    this.rec.start(4000);       // regelmäßige Chunks: bei Absturz ist weniger weg

    this.state = 'recording';
    this.seconds = 0;
    this._startClock();
    this._startMeter();
    await this._lockScreen();
    this._emit('change');
  }

  pause() {
    if (this.state !== 'recording') return;
    this.rec.pause(); this.state = 'paused';
    clearInterval(this._tick); this._tick = null;
    this._emit('change');
  }
  resume() {
    if (this.state !== 'paused') return;
    this.rec.resume(); this.state = 'recording';
    this._startClock();
    this._emit('change');
  }

  async stop() {
    if (!this.rec || this.state === 'stopped' || this.state === 'idle') return null;
    const blob = await new Promise(res => {
      this.rec.onstop = () => res(new Blob(this.chunks, { type: this.mime }));
      this.rec.stop();
    });
    this._teardown();
    this.state = 'stopped';
    this._emit('change');
    return { blob, mime: this.mime, seconds: this.seconds, ext: extForMime(this.mime) };
  }

  cancel() { this._teardown(); this.state = 'idle'; this.chunks = []; this._emit('change'); }

  _teardown() {
    clearInterval(this._tick); this._tick = null;
    cancelAnimationFrame(this._raf); this._raf = null;
    try { this._audioCtx?.close(); } catch { /* egal */ }
    this._audioCtx = null;
    this.stream?.getTracks().forEach(t => t.stop());
    this._releaseScreen();
  }

  _startClock() {
    clearInterval(this._tick);
    this._tick = setInterval(() => { this.seconds++; this._emit('tick', this.seconds); }, 1000);
  }

  _startMeter() {
    try {
      const Ctx = self.AudioContext || self.webkitAudioContext;
      this._audioCtx = new Ctx();
      const src = this._audioCtx.createMediaStreamSource(this.stream);
      const analyser = this._audioCtx.createAnalyser();
      analyser.fftSize = 512;
      src.connect(analyser);
      const buf = new Uint8Array(analyser.frequencyBinCount);
      const loop = () => {
        analyser.getByteTimeDomainData(buf);
        let peak = 0;
        for (let i = 0; i < buf.length; i++) peak = Math.max(peak, Math.abs(buf[i] - 128));
        this.level = Math.min(1, peak / 90);
        this._emit('level', this.level);
        this._raf = requestAnimationFrame(loop);
      };
      loop();
    } catch { /* Pegelanzeige ist Beiwerk */ }
  }

  async _lockScreen() {
    try {
      if (navigator.wakeLock?.request) {
        this._wakeLock = await navigator.wakeLock.request('screen');
        this._wakeLock.addEventListener('release', () => { this._wakeLock = null; });
      } else {
        this._emit('nowakelock');
      }
    } catch { this._emit('nowakelock'); }
  }
  _releaseScreen() { try { this._wakeLock?.release(); } catch { /* egal */ } this._wakeLock = null; }
}

/** Dauer eines vorhandenen Blobs bestimmen (für importierte Dateien). */
export function probeDuration(blob) {
  return new Promise(res => {
    const url = URL.createObjectURL(blob);
    const el = new Audio();
    const done = v => { URL.revokeObjectURL(url); res(v); };
    el.onloadedmetadata = () => {
      // Chrome liefert bei Opus-WebM ohne Dauer-Header Infinity.
      if (el.duration === Infinity) {
        el.currentTime = 1e6;
        el.ontimeupdate = () => { el.ontimeupdate = null; done(isFinite(el.duration) ? el.duration : 0); };
      } else done(el.duration || 0);
    };
    el.onerror = () => done(0);
    el.src = url;
  });
}
