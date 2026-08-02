// WebAudio 现场合成音效，无音频文件

export class Sound {
  constructor() {
    this.ctx = null;
    this.last = {}; // 各类音效的节流时间戳
  }

  unlock() {
    if (!this.ctx) {
      try { this.ctx = new (window.AudioContext || window.webkitAudioContext)(); } catch { /* 无音频设备 */ }
    }
    if (this.ctx?.state === 'suspended') this.ctx.resume();
  }

  drain(events) {
    if (!this.ctx) return;
    for (const e of events) this.play(e);
  }

  play(e) {
    const gap = { shot: 70, boom: 90, deposit: 400, move: 150, select: 100, ready: 200 }[e.type] ?? 50;
    const now = performance.now();
    if (now - (this.last[e.type] || 0) < gap) return;
    this.last[e.type] = now;

    switch (e.type) {
      case 'shot': {
        const kind = e.w || '';
        if (kind === 'mg' || kind === 'pods') this.noise(0.06, 2200, 0.10);
        else if (kind === 'laserT' || kind === 'beam') this.tone(1400, 0.12, 'sawtooth', 0.07, 300);
        else if (kind === 'railW') this.tone(180, 0.25, 'square', 0.14, 60);
        else this.noise(0.12, 700, 0.16); // 炮弹/导弹
        break;
      }
      case 'boom': this.noise(e.big ? 0.5 : 0.28, e.big ? 300 : 500, e.big ? 0.3 : 0.18); break;
      case 'deposit': this.tone(880, 0.06, 'square', 0.06); this.tone(1320, 0.08, 'square', 0.05, null, 0.06); break;
      case 'place': this.noise(0.15, 400, 0.2); this.tone(220, 0.15, 'sine', 0.12); break;
      case 'ready': this.tone(660, 0.09, 'sine', 0.1); this.tone(990, 0.12, 'sine', 0.1, null, 0.09); break;
      case 'error': this.tone(160, 0.2, 'square', 0.1); break;
      case 'move': this.tone(500, 0.04, 'sine', 0.05); break;
      case 'select': this.tone(700, 0.04, 'sine', 0.05); break;
      case 'capture': [523, 659, 784, 1046].forEach((f, i) => this.tone(f, 0.12, 'sine', 0.1, null, i * 0.1)); break;
      case 'win': [523, 659, 784, 1046, 1318].forEach((f, i) => this.tone(f, 0.25, 'triangle', 0.12, null, i * 0.18)); break;
      case 'lose': [400, 350, 300, 220].forEach((f, i) => this.tone(f, 0.35, 'triangle', 0.12, null, i * 0.25)); break;
    }
  }

  // 基础合成器：音调
  tone(freq, dur, type = 'sine', gain = 0.1, slideTo = null, delay = 0) {
    const ctx = this.ctx;
    if (!ctx) return;
    const t0 = ctx.currentTime + delay;
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t0);
    if (slideTo) osc.frequency.exponentialRampToValueAtTime(Math.max(30, slideTo), t0 + dur);
    g.gain.setValueAtTime(gain, t0);
    g.gain.exponentialRampToValueAtTime(0.001, t0 + dur);
    osc.connect(g).connect(ctx.destination);
    osc.start(t0); osc.stop(t0 + dur + 0.05);
  }

  // 基础合成器：滤波噪声（爆炸/枪声）
  noise(dur, filterFreq = 800, gain = 0.15) {
    const ctx = this.ctx;
    if (!ctx) return;
    const t0 = ctx.currentTime;
    const len = Math.max(1, Math.floor(ctx.sampleRate * dur));
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / len);
    const src = ctx.createBufferSource();
    src.buffer = buf;
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass'; filter.frequency.value = filterFreq;
    const g = ctx.createGain();
    g.gain.value = gain;
    src.connect(filter).connect(g).connect(ctx.destination);
    src.start(t0);
  }
}
