// 专业音频引擎 v2（纯 WebAudio 合成，无音频文件，离线可用）：
// - 电影级分层音色：瞬态裂纹 + 主体 + 次低音 + 余烬尾音，经生成式脉冲响应卷积混响
// - 空间化：声像偏移 + 距离衰减 + 距离低通（越远越闷）+ 每次开火随机音高/响度抖动
// - 自适应作战配乐：A 小调军事合成循环，鼓/贝斯/琶音/弦垫随战况烈度分层，大爆炸自动闪避压低音乐
// - 环境风声；音量设置持久化 localStorage

const LS_KEY = 'mra-audio-v2';

export class Sound {
  constructor() {
    this.ctx = null;
    this.last = {};
    this.settings = { sfx: 0.9, music: 0.45, muted: false };
    try { Object.assign(this.settings, JSON.parse(localStorage.getItem(LS_KEY) || '{}')); } catch { /* 忽略坏档 */ }
    this.heat = 0;        // 平滑后的战斗烈度 0~1（驱动配乐分层）
    this.eventHeat = 0;
    this.step = 0;
    this.nextStepT = 0;
    this.bpm = 92;
  }

  unlock() {
    if (this.ctx) { if (this.ctx.state === 'suspended') this.ctx.resume(); return; }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    const ctx = this.ctx = new AC();

    // 主链：sfxBus/musicBus → master → 压缩器 → 输出
    this.master = ctx.createGain();
    this.comp = ctx.createDynamicsCompressor();
    this.comp.threshold.value = -14;
    this.comp.knee.value = 20;
    this.comp.ratio.value = 4;
    this.comp.attack.value = 0.003;
    this.master.connect(this.comp).connect(ctx.destination);
    this.sfxBus = ctx.createGain();
    this.musicBus = ctx.createGain();
    this.sfxBus.connect(this.master);
    this.musicBus.connect(this.master);

    // 卷积混响：2.2s 指数衰减立体声噪声脉冲响应（战场空间感的关键）
    const irLen = Math.floor(ctx.sampleRate * 2.2);
    const ir = ctx.createBuffer(2, irLen, ctx.sampleRate);
    for (let ch = 0; ch < 2; ch++) {
      const d = ir.getChannelData(ch);
      for (let i = 0; i < irLen; i++) {
        d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / irLen, 2.8);
      }
    }
    this.verb = ctx.createConvolver();
    this.verb.buffer = ir;
    this.verbIn = ctx.createGain();
    this.verbIn.gain.value = 0.4;
    this.verbIn.connect(this.verb).connect(this.master);

    // 共享白噪声缓冲
    const len = ctx.sampleRate * 2;
    this.noiseBuf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = this.noiseBuf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;

    // 琶音延迟总线
    this.delay = ctx.createDelay(1);
    this.delay.delayTime.value = 60 / this.bpm / 2;
    this.delayFb = ctx.createGain();
    this.delayFb.gain.value = 0.3;
    const delayTone = ctx.createBiquadFilter();
    delayTone.type = 'lowpass';
    delayTone.frequency.value = 2200;
    this.delay.connect(this.delayFb).connect(this.delay);
    this.delay.connect(delayTone).connect(this.musicBus);

    this.startWind();
    this.applyVolumes();
    this.nextStepT = ctx.currentTime + 0.1;
  }

  applyVolumes() {
    if (!this.ctx) return;
    this.master.gain.value = this.settings.muted ? 0 : 1;
    this.sfxBus.gain.value = this.settings.sfx * this.settings.sfx;
    this.musicBase = this.settings.music * this.settings.music * 0.9;
    // 爆炸闪避会调度 musicBus 的自动化曲线：直接赋值会被旧曲线覆盖导致调音量无效，先清掉
    this.musicBus.gain.cancelScheduledValues(this.ctx.currentTime);
    this.musicBus.gain.value = this.musicBase;
    try { localStorage.setItem(LS_KEY, JSON.stringify(this.settings)); } catch { /* 隐私模式 */ }
  }

  setSetting(k, v) {
    this.settings[k] = v;
    this.applyVolumes();
  }

  // ---------- 空间化输出 ----------
  // 声像 + 距离衰减 + 距离低通；返回带混送（越近的爆炸混响越足）
  spatial(x, y, cam) {
    const ctx = this.ctx;
    const g = ctx.createGain();
    let vol = 1, pan = 0, muffle = 1;
    if (cam && typeof x === 'number') {
      const dx = x - cam.x, dy = y - cam.y;
      const d = Math.hypot(dx, dy);
      vol = Math.max(0.1, 1 - d / 42);
      pan = Math.max(-1, Math.min(1, dx / 24)) * 0.7;
      muffle = Math.max(0.18, 1 - d / 70);
    }
    g.gain.value = vol;
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 400 + 19600 * muffle;
    lp.Q.value = 0.4;
    g.connect(lp);
    if (ctx.createStereoPanner) {
      const p = ctx.createStereoPanner();
      p.pan.value = pan;
      lp.connect(p).connect(this.sfxBus);
    } else {
      lp.connect(this.sfxBus);
    }
    const send = ctx.createGain();
    send.gain.value = 0.55 * vol;
    lp.connect(send).connect(this.verbIn);
    return g;
  }

  drain(events, cam = null) {
    if (!this.ctx) return;
    const now = performance.now();
    for (const e of events) {
      if (e.type === 'shot') this.eventHeat = Math.min(1.2, this.eventHeat + 0.025);
      if (e.type === 'boom') this.eventHeat = Math.min(1.2, this.eventHeat + (e.big ? 0.16 : 0.08));
      if (e.type === 'underAttack') this.eventHeat = Math.min(1.2, this.eventHeat + 0.2);
      if (e.type === 'superHit') this.eventHeat = Math.min(1.2, this.eventHeat + 0.5); // 超武落点直接拉满段位
      if (e.type === 'siren') this.eventHeat = Math.min(1.2, this.eventHeat + 0.15);
      const gap = { shot: 60, boom: 80, deposit: 350, move: 140, select: 90, ready: 400, error: 250, underAttack: 1500, promote: 300, superLaunch: 1200, superHit: 900, siren: 550, killConfirm: 1200, lowPower: 2500 }[e.type] ?? 60;
      if (now - (this.last[e.type] || 0) < gap) continue;
      this.last[e.type] = now;
      this.play(e, cam);
    }
  }

  update(dt) {
    if (!this.ctx) return;
    // 热度动态：攻击快（战斗一起音乐立刻跟上）、衰减慢（战斗结束余韵保留）
    this.eventHeat = Math.max(0, this.eventHeat - dt * 0.28);
    this.heat += (Math.min(1, this.eventHeat) - this.heat) * Math.min(1, dt * 2.2);
    this.scheduleMusic();
    // 远处战场闷雷：战斗热度中上时随机低频滚雷，增强空间纵深（静音/零音量时不白建节点）
    if (!this.settings.muted && this.settings.music > 0 && this.heat > 0.3 && Math.random() < dt * 0.14) {
      this.noise({ dur: 1.2 + Math.random(), type: 'lowpass', freq: 120, gain: 0.05 + this.heat * 0.06, delay: 0.1, out: this.musicBus });
    }
  }

  play(e, cam) {
    const S = (x, y) => this.spatial(x, y, cam);
    switch (e.type) {
      case 'shot': return this.bankShot(e.w, S(e.x, e.y));
      case 'boom': return this.bankBoom(e.big, S(e.x, e.y));
      case 'deposit': this.coin(S(e.x, e.y)); break;
      case 'place': this.place(S(e.x, e.y)); break;
      case 'ready': this.ready(); break;
      case 'error': this.error(); break;
      case 'move': this.ack(520, 0.05, 0.06); break;
      case 'select': this.ack(880, 0.04, 0.05); break;
      case 'capture': this.fanfare([523, 659, 784, 1046], 0.12, 'sine'); break;
      case 'promote': this.promote(); break;
      case 'underAttack': this.klaxon(); break;
      case 'superLaunch': this.superCharge(S(e.x, e.y)); break;
      case 'superHit': this.superBoom(S(e.x, e.y)); break;
      case 'siren': this.strikeSiren(S(e.x, e.y)); break; // 敌方超武充能循环警报
      case 'killConfirm': this.killConfirm(); break;      // 击杀确认
      case 'lowPower': this.lowPowerAlarm(); break;       // 低电力闷警报
      case 'techDone': this.techDone(); break;
      case 'win': this.jingle(true); break;
      case 'lose': this.jingle(false); break;
    }
  }

  // ---------- 武器音色库（每次开火随机音高/响度抖动，避免复制感） ----------
  bankShot(kind, out) {
    switch (kind) {
      case 'mg': // 突击步枪：脆裂瞬态 + 中频主体
        this.noise({ dur: 0.035, type: 'highpass', freq: 3000, gain: 0.4, out });
        this.noise({ dur: 0.05, type: 'bandpass', freq: 1500 + Math.random() * 500, gain: 0.5, out });
        this.noise({ dur: 0.03, type: 'bandpass', freq: 1200, gain: 0.3, out, delay: 0.045 });
        break;
      case 'sniperW': // 反器材狙击：钉墙瞬态 + 低频拖尾
        this.noise({ dur: 0.025, type: 'highpass', freq: 4500, gain: 0.55, out });
        this.noise({ dur: 0.09, type: 'bandpass', freq: 900, gain: 0.6, out });
        this.thump(95, 0.18, 0.5, out, 0.01);
        this.noise({ dur: 0.3, type: 'lowpass', freq: 500, gain: 0.2, out, delay: 0.06 });
        break;
      case 'rpg': case 'aamissile': case 'samW':
        this.noise({ dur: 0.05, type: 'lowpass', freq: 1100, gain: 0.45, out }); // 出膛
        this.whoosh(0.34, 650, 2900, 0.5, out);
        break;
      case 'pods':
        for (let i = 0; i < 3; i++) this.whoosh(0.16, 1100, 3200, 0.34, out, i * 0.06);
        break;
      case 'reaperW': // 空地导弹： heavier
        this.noise({ dur: 0.06, type: 'lowpass', freq: 800, gain: 0.5, out });
        this.whoosh(0.45, 420, 2200, 0.55, out);
        this.thump(85, 0.25, 0.5, out, 0.02);
        break;
      case 'mlrsW': // 火箭弹齐射：连串扫频
        this.noise({ dur: 0.07, type: 'lowpass', freq: 900, gain: 0.5, out });
        this.whoosh(0.5, 500, 2400, 0.5, out);
        this.whoosh(0.4, 700, 2800, 0.35, out, 0.09);
        break;
      case 'cruise':
        this.whoosh(0.7, 260, 1500, 0.55, out);
        this.thump(70, 0.35, 0.6, out);
        break;
      case 'cannon': { // 125mm：瞬态脆裂 + 中频主体 + 低频砰
        this.noise({ dur: 0.02, type: 'highpass', freq: 3500, gain: 0.5, out });
        this.noise({ dur: 0.18, type: 'lowpass', freq: 900, freqEnd: 300, gain: 0.85, out });
        this.thump(105, 0.3, 0.95, out);
        this.noise({ dur: 0.4, type: 'lowpass', freq: 220, gain: 0.22, out, delay: 0.1 });
        break;
      }
      case 'hcannon': { // 152mm：更沉更远
        this.noise({ dur: 0.025, type: 'highpass', freq: 2800, gain: 0.55, out });
        this.noise({ dur: 0.26, type: 'lowpass', freq: 650, freqEnd: 200, gain: 1.0, out });
        this.thump(72, 0.45, 1.05, out);
        this.noise({ dur: 0.6, type: 'lowpass', freq: 180, gain: 0.3, out, delay: 0.12 });
        break;
      }
      case 'beam':
        this.zap(1500, 170, 0.2, 0.4, out);
        this.tone({ freq: 2600, dur: 0.24, type: 'sine', gain: 0.16, slideTo: 700, out });
        break;
      case 'laserT':
        this.zap(2300, 380, 0.12, 0.32, out);
        break;
      case 'railW': // 电磁轨道炮：充能爬升 + 电弧爆裂
        this.tone({ freq: 160, dur: 0.34, type: 'sawtooth', gain: 0.16, slideTo: 820, out });
        this.noise({ dur: 0.1, type: 'highpass', freq: 2800, gain: 0.55, out, delay: 0.34 });
        this.noise({ dur: 0.06, type: 'bandpass', freq: 5200, gain: 0.35, out, delay: 0.36 });
        this.thump(85, 0.32, 0.85, out, 0.34);
        break;
      case 'teslaW': // 磁暴电弧：充能爬升 + 电流爆裂 + 低频震荡
        this.tone({ freq: 70, dur: 0.28, type: 'sawtooth', gain: 0.27, slideTo: 700, out, lp: 2600 });
        this.noise({ dur: 0.06, type: 'highpass', freq: 3200, gain: 0.55, out, delay: 0.26 });
        this.noise({ dur: 0.2, type: 'bandpass', freq: 1800 + Math.random() * 800, gain: 0.4, out, delay: 0.28 });
        this.thump(80, 0.25, 0.75, out, 0.27);
        break;
      case 'prismW': case 'mirageW': // 光棱/幻影光束：高频切裂 + 下滑光鸣
        this.zap(1900, 320, 0.16, 0.35, out);
        this.tone({ freq: 2700, dur: 0.2, type: 'sine', gain: 0.12, slideTo: 800, out });
        break;
      case 'kirovW': // 重型航弹投放：挂架释放闷响 + 长下坠风声
        this.noise({ dur: 0.09, type: 'lowpass', freq: 600, gain: 0.5, out });
        this.whoosh(0.55, 380, 1600, 0.4, out, 0.05);
        break;
      case 'apocW': // 天启双联导弹：粗重出膛 + 双联扫频
        this.noise({ dur: 0.05, type: 'lowpass', freq: 1000, gain: 0.5, out });
        this.whoosh(0.4, 480, 2400, 0.5, out);
        this.thump(90, 0.22, 0.6, out, 0.02);
        break;
      default:
        this.noise({ dur: 0.12, type: 'lowpass', freq: 700, gain: 0.5, out });
    }
  }

  bankBoom(big, out) {
    // 大爆炸自动压低音乐（闪避），0.4s 后恢复
    const t = this.ctx.currentTime;
    this.musicBus.gain.cancelScheduledValues(t);
    if (big) {
      this.musicBus.gain.setTargetAtTime(this.musicBase * 0.35, t, 0.02);
      this.musicBus.gain.setTargetAtTime(this.musicBase, t + 0.45, 0.6);
      // 瞬态裂纹 → 主体轰鸣 → 次低音 → 余烬滚雷 → 碎裂噼啪
      this.noise({ dur: 0.05, type: 'highpass', freq: 2500, gain: 0.65, out });
      this.noise({ dur: 0.55, type: 'lowpass', freq: 600, freqEnd: 140, gain: 1.0, out });
      this.tone({ freq: 58, dur: 0.9, type: 'sine', gain: 0.95, slideTo: 24, out });
      this.noise({ dur: 1.9, type: 'lowpass', freq: 150, gain: 0.32, out, delay: 0.14 });
      for (let i = 0; i < 4; i++) {
        this.noise({ dur: 0.05 + Math.random() * 0.05, type: 'bandpass', freq: 900 + Math.random() * 1400, gain: 0.22, out, delay: 0.16 + Math.random() * 0.5 });
      }
    } else {
      this.noise({ dur: 0.04, type: 'highpass', freq: 3200, gain: 0.35, out });
      this.noise({ dur: 0.32, type: 'lowpass', freq: 800, freqEnd: 260, gain: 0.72, out });
      this.tone({ freq: 105, dur: 0.26, type: 'sine', gain: 0.6, slideTo: 38, out });
    }
  }

  // ---------- UI / 语音位 ----------
  ack(freq, dur, gain) {
    this.tone({ freq, dur, type: 'sine', gain, vary: false });
    this.tone({ freq: freq * 1.5, dur: dur + 0.03, type: 'sine', gain: gain * 0.7, delay: dur * 0.5, vary: false });
  }
  ready() {
    this.tone({ freq: 660, dur: 0.1, type: 'triangle', gain: 0.14, vary: false });
    this.tone({ freq: 990, dur: 0.16, type: 'triangle', gain: 0.14, delay: 0.09, vary: false });
    this.tone({ freq: 1320, dur: 0.2, type: 'sine', gain: 0.08, delay: 0.16, vary: false });
  }
  techDone() { // 科技研发完成：上行军号
    this.fanfare([440, 554, 659, 880], 0.15, 'sawtooth');
  }
  error() {
    this.tone({ freq: 150, dur: 0.09, type: 'square', gain: 0.1, vary: false });
    this.tone({ freq: 120, dur: 0.14, type: 'square', gain: 0.1, delay: 0.1, vary: false });
  }
  coin(out) {
    this.tone({ freq: 1245, dur: 0.07, type: 'square', gain: 0.07, out, vary: false });
    this.tone({ freq: 1865, dur: 0.1, type: 'square', gain: 0.06, out, delay: 0.06, vary: false });
    // 矿石倾泻哗啦声（三连颗粒）
    for (let i = 0; i < 3; i++) {
      this.noise({ dur: 0.05, type: 'bandpass', freq: 900 + Math.random() * 900, gain: 0.1, out, delay: 0.05 + i * 0.07 });
    }
  }
  place(out) {
    this.noise({ dur: 0.22, type: 'lowpass', freq: 320, gain: 0.55, out });
    this.tone({ freq: 175, dur: 0.2, type: 'sine', gain: 0.32, slideTo: 85, out });
    this.tone({ freq: 440, dur: 0.12, type: 'triangle', gain: 0.1, out, delay: 0.18, vary: false });
  }
  promote() {
    this.fanfare([587, 740, 880], 0.14, 'sawtooth');
    this.noise({ dur: 0.25, type: 'highpass', freq: 5000, gain: 0.08, delay: 0.1 });
  }
  klaxon() {
    // 受击警报是最重要的提醒音：双音加大音量 + 高低交替更刺耳
    for (let i = 0; i < 3; i++) {
      this.tone({ freq: i % 2 ? 466 : 622, dur: 0.16, type: 'square', gain: 0.13, delay: i * 0.17, vary: false, lp: 2200 });
    }
  }
  // 超级武器：天顶充能爬升（预警期）
  superCharge(out) {
    this.tone({ freq: 80, dur: 1.6, type: 'sawtooth', gain: 0.13, slideTo: 920, out, lp: 2400 });
    this.tone({ freq: 130, dur: 1.6, type: 'sine', gain: 0.09, slideTo: 1350, out });
    this.noise({ dur: 1.7, type: 'bandpass', freq: 3200, gain: 0.09, out });
  }
  // 超级武器落点：史诗级分层爆响 + 更长闪避
  superBoom(out) {
    const t = this.ctx.currentTime;
    this.musicBus.gain.cancelScheduledValues(t);
    this.musicBus.gain.setTargetAtTime(this.musicBase * 0.28, t, 0.02);
    this.musicBus.gain.setTargetAtTime(this.musicBase, t + 1.0, 0.9);
    this.noise({ dur: 0.06, type: 'highpass', freq: 2200, gain: 0.8, out });
    this.noise({ dur: 0.95, type: 'lowpass', freq: 700, freqEnd: 110, gain: 1.1, out });
    this.tone({ freq: 46, dur: 1.5, type: 'sine', gain: 1.05, slideTo: 18, out });
    this.noise({ dur: 2.6, type: 'lowpass', freq: 140, gain: 0.4, out, delay: 0.18 });
    for (let i = 0; i < 5; i++) {
      this.noise({ dur: 0.05 + Math.random() * 0.06, type: 'bandpass', freq: 700 + Math.random() * 1600, gain: 0.24, out, delay: 0.2 + Math.random() * 0.7 });
    }
  }
  // 敌方超武充能：双音上滑警报（循环触发形成警报声浪）
  strikeSiren(out) {
    this.tone({ freq: 620, dur: 0.24, type: 'square', gain: 0.075, slideTo: 980, out, lp: 2200, vary: false });
    this.tone({ freq: 980, dur: 0.24, type: 'square', gain: 0.075, slideTo: 620, out, lp: 2200, delay: 0.24, vary: false });
  }
  // 击杀确认：金属脆响 + 无线电咔哒（有冷却限频，不刷屏）
  killConfirm() {
    this.tone({ freq: 1320, dur: 0.05, type: 'triangle', gain: 0.09, vary: false, lp: 4000 });
    this.tone({ freq: 880, dur: 0.07, type: 'triangle', gain: 0.07, delay: 0.05, vary: false, lp: 4000 });
    this.noise({ dur: 0.02, type: 'highpass', freq: 4500, gain: 0.05, delay: 0.11 });
  }
  // 低电力：双音闷警报
  lowPowerAlarm() {
    for (let i = 0; i < 2; i++) {
      this.tone({ freq: i % 2 ? 220 : 165, dur: 0.28, type: 'square', gain: 0.075, lp: 900, delay: i * 0.3, vary: false });
    }
  }
  fanfare(notes, dur, type) {
    notes.forEach((f, i) => this.tone({ freq: f, dur, type, gain: 0.12, delay: i * 0.1, vary: false, lp: 3200 }));
  }
  jingle(win) {
    if (win) {
      this.fanfare([523, 659, 784, 1046, 1318], 0.3, 'triangle');
      [523, 659, 784].forEach(f => this.tone({ freq: f, dur: 1.6, type: 'sine', gain: 0.05, delay: 0.5, vary: false }));
    } else {
      this.fanfare([392, 330, 262, 196], 0.4, 'triangle');
      this.tone({ freq: 98, dur: 2.0, type: 'sine', gain: 0.09, delay: 0.3, vary: false });
    }
  }

  // ---------- 合成器原语 ----------
  // 音调：支持滑音、延迟、低通、随机抖动（vary 默认开）
  tone({ freq, dur, type = 'sine', gain = 0.1, slideTo = null, delay = 0, out = null, lp = null, vary = true }) {
    const ctx = this.ctx;
    if (!ctx) return;
    const t0 = ctx.currentTime + delay;
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.type = type;
    if (vary) freq *= 0.94 + Math.random() * 0.12;
    osc.frequency.setValueAtTime(Math.max(20, freq), t0);
    if (slideTo) osc.frequency.exponentialRampToValueAtTime(Math.max(20, slideTo), t0 + dur);
    g.gain.setValueAtTime(0, t0);
    g.gain.linearRampToValueAtTime(gain * (vary ? 0.85 + Math.random() * 0.3 : 1), t0 + Math.min(0.012, dur * 0.2));
    g.gain.exponentialRampToValueAtTime(0.0008, t0 + dur);
    let node = osc;
    if (lp) {
      const f = ctx.createBiquadFilter();
      f.type = 'lowpass'; f.frequency.value = lp;
      osc.connect(f); node = f;
    }
    node.connect(g).connect(out || this.sfxBus);
    osc.start(t0); osc.stop(t0 + dur + 0.08);
  }

  noise({ dur, type = 'lowpass', freq = 800, freqEnd = null, gain = 0.15, delay = 0, out = null }) {
    const ctx = this.ctx;
    if (!ctx) return;
    const t0 = ctx.currentTime + delay;
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuf;
    src.loop = true;
    src.playbackRate.value = 0.85 + Math.random() * 0.3;
    const filter = ctx.createBiquadFilter();
    filter.type = type;
    filter.frequency.setValueAtTime(freq * (0.9 + Math.random() * 0.2), t0);
    if (freqEnd) filter.frequency.exponentialRampToValueAtTime(freqEnd, t0 + dur);
    filter.Q.value = type === 'bandpass' ? 1.1 : 0.8;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t0);
    g.gain.linearRampToValueAtTime(gain * (0.85 + Math.random() * 0.3), t0 + dur * 0.12);
    g.gain.exponentialRampToValueAtTime(0.0008, t0 + dur);
    src.connect(filter).connect(g).connect(out || this.sfxBus);
    src.start(t0); src.stop(t0 + dur + 0.05);
  }

  thump(f0, dur, vol, out, delay = 0) {
    this.tone({ freq: f0, dur, type: 'sine', gain: vol, slideTo: f0 * 0.35, delay, out });
  }
  whoosh(dur, f0, f1, vol, out, delay = 0) {
    this.noise({ dur, type: 'bandpass', freq: f0, freqEnd: f1, gain: vol, delay, out });
  }
  zap(f0, f1, dur, vol, out) {
    this.tone({ freq: f0, dur, type: 'sawtooth', gain: vol, slideTo: f1, out, lp: 3200 });
  }

  // ---------- 环境风 ----------
  startWind() {
    const ctx = this.ctx;
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuf;
    src.loop = true;
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 320;
    lp.Q.value = 0.4;
    const g = ctx.createGain();
    g.gain.value = 0.026;
    const lfo = ctx.createOscillator();
    lfo.frequency.value = 0.09;
    const lfoG = ctx.createGain();
    lfoG.gain.value = 0.013;
    lfo.connect(lfoG).connect(g.gain);
    src.connect(lp).connect(g).connect(this.musicBus);
    src.start();
    lfo.start();
  }

  // ---------- 自适应配乐 v3：8 小节乐段编曲 ----------
  // 结构：A 段(0-3 小节) 主题动机 → B 段(4-7) 回应；第 7 小节军鼓滚奏填入；
  // 热度四档：t0 巡逻(弦垫+太鼓行进) → t1 交火(+底鼓/镲/琶音) → t2 战斗(+军鼓+主旋律) → t3 高潮(移调+镲片加密)
  scheduleMusic() {
    const ctx = this.ctx;
    if (!ctx) return;
    // 静音/音乐音量为零：跳过节点调度，只推进步进指针（省 CPU）
    if (this.settings.muted || this.settings.music <= 0) {
      this.nextStepT = ctx.currentTime;
      return;
    }
    const spb = 60 / this.bpm / 4;
    const ahead = ctx.currentTime + 0.3;
    if (this.nextStepT < ctx.currentTime - 0.5) this.nextStepT = ctx.currentTime;
    while (this.nextStepT < ahead) {
      this.step16(this.step, this.nextStepT);
      this.nextStepT += spb;
      this.step++;
    }
  }

  // 主旋律：A 小调五声军乐动机（32 步 = 4 小节，-1 为休止），call-response 呼吸感
  static MELODY = [
    0, -1, -1, 2, 3, -1, 2, -1, 0, -1, -1, -1, -1, -1, 4, -1,
    3, -1, -1, 2, 3, -1, 5, -1, 4, -1, 3, -1, 2, -1, -1, -1,
    0, -1, -1, 2, 3, -1, 2, -1, 5, -1, -1, 4, 3, -1, 2, -1,
    1, -1, 2, -1, 3, -1, -1, -1, 2, -1, 1, -1, 0, -1, -1, -1,
  ];

  step16(i, t) {
    const ctx = this.ctx;
    const heat = this.heat;
    const bar = Math.floor(i / 16);           // 小节号（全曲递增）
    const barInPhrase = bar % 8;              // 8 小节乐段内位置
    const s = i % 16;
    const roots = [55.0, 43.65, 65.41, 49.0]; // Am F C G
    // 和声：进行为 Am–F–C–G。F/C/G 是大三和弦，三度必须用大 семітон（4 半音），
    // 统一用小三度会把整段变成 Am–Fm–Cm–Gm 的浑浊平行小和弦
    const third = bar % 4 === 0 ? Math.pow(2, 3 / 12) : Math.pow(2, 4 / 12);
    // 高潮段（t3 且乐段末两小节）整体上移小三度，随后落回——推高潮的编曲手法
    const lift = heat > 0.78 && barInPhrase >= 6 ? 1.189 : 1;
    const root = roots[bar % 4] * lift;
    const delay = t - ctx.currentTime;
    const spb16 = (60 / this.bpm / 4);
    // 热度分层阈值
    const t1 = 0.22, t2 = 0.5, t3 = 0.78;

    // 弦垫（每小节换和弦）：B 段改开放排列 + 更亮低通，与 A 段形成明暗对比
    if (s === 0 && heat > 0.08) {
      const open = barInPhrase >= 4;
      const voicing = open
        ? [[2, 0], [2 * third, 6], [3, -6], [4, 5]]
        : [[2, 0], [2 * third, 7], [2.996, -6], [4, 5]];
      for (const [mul, det] of voicing) {
        const osc = ctx.createOscillator();
        osc.type = 'sawtooth';
        osc.frequency.value = root * mul;
        osc.detune.value = det;
        const f = ctx.createBiquadFilter();
        f.type = 'lowpass';
        f.frequency.value = 420 + heat * 900 + (open ? 200 : 0);
        const g = ctx.createGain();
        const g0 = 0.014 + heat * 0.03;
        g.gain.setValueAtTime(0, t);
        g.gain.linearRampToValueAtTime(g0, t + 0.4);
        g.gain.setValueAtTime(g0, t + spb16 * 14);
        g.gain.linearRampToValueAtTime(0, t + spb16 * 16);
        osc.connect(f).connect(g).connect(this.musicBus);
        osc.start(t); osc.stop(t + spb16 * 16 + 0.05);
      }
    }
    // 贝斯脉冲（8 分）：底鼓落点让频 40%（侧链泵感）
    if (s % 2 === 0 && heat > 0.12) {
      const duck = (s === 0 || s === 8) ? 0.6 : 1;
      this.tone({
        freq: root * 2, dur: spb16 * 0.85, type: 'sawtooth', gain: (0.055 + heat * 0.07) * duck,
        delay, out: this.musicBus, lp: 350 + heat * 900, vary: false,
      });
    }
    // 巡逻段太鼓行进脉冲（低热度不空场：每小节第 1/9 步低沉太鼓）
    if (heat <= t1 && (s === 0 || s === 8)) {
      this.tone({ freq: 68, dur: 0.3, type: 'sine', gain: 0.09, slideTo: 40, delay, out: this.musicBus, vary: false });
    }
    // 底鼓：click + 音高坠落；高潮段加第 4 拍推进
    if (heat > t1 && (s === 0 || s === 8 || (heat > 0.45 && s === 11) || (heat > t3 && s === 4))) {
      this.tone({ freq: 950, dur: 0.014, type: 'sine', gain: 0.06, delay, out: this.musicBus, vary: false });
      this.tone({ freq: 135, dur: 0.17, type: 'sine', gain: 0.17 + heat * 0.1, slideTo: 36, delay, out: this.musicBus, vary: false });
    }
    // 军鼓（正常背拍 + 乐段末小节滚奏填入）
    if (heat > 0.55 && (s === 4 || s === 12)) {
      this.noise({ dur: 0.055, type: 'highpass', freq: 3500, gain: 0.08, delay, out: this.musicBus });
      this.noise({ dur: 0.13, type: 'bandpass', freq: 1800, gain: 0.11 + heat * 0.06, delay, out: this.musicBus });
    }
    if (heat > 0.55 && barInPhrase === 7 && s >= 12) {
      const k = (s - 12) / 4; // 滚奏渐强
      this.noise({ dur: 0.04, type: 'bandpass', freq: 1800, gain: 0.05 + k * 0.09, delay, out: this.musicBus });
    }
    // 段落转换镲片（每 8 小节开头）
    if (heat > t2 && s === 0 && barInPhrase === 0) {
      this.noise({ dur: 0.8, type: 'highpass', freq: 6000, gain: 0.06, delay, out: this.musicBus });
    }
    // 镲（正常 8 分反拍；高潮段 16 分加密）
    if (heat > 0.3 && (s % 4 === 2 || (heat > t3 && s % 2 === 1))) {
      this.noise({ dur: 0.045, type: 'highpass', freq: 7500, gain: 0.03 + heat * 0.04, delay, out: this.musicBus });
    }
    // 琶音（16 分）：方波 + 低通 + 延迟总线；三度随和弦大小切换；高潮段上移八度
    if (heat > t1) {
      const chord = [root * 4, root * 4 * third, root * 6, root * 8];
      const f = chord[[0, 2, 1, 3, 0, 3, 1, 2, 0, 2, 3, 1, 0, 1, 2, 3][s]] * (heat > t3 ? 2 : 1);
      this.tone({
        freq: f, dur: spb16 * 0.55, type: 'square', gain: 0.02 + heat * 0.038,
        delay, out: this.arpOut ?? (this.arpOut = this.makeArpBus()), lp: 2600, vary: false,
      });
    }
    // 主旋律（战斗热度解锁）：五声动机 + 延迟总线，与琶音形成前后景
    if (heat > t2) {
      const step = Sound.MELODY[(bar % 4) * 16 + s];
      if (step >= 0) {
        const freq = root * 8 * Math.pow(2, step / 12);
        this.tone({
          freq, dur: spb16 * 1.5, type: 'triangle', gain: 0.05 + (heat - t2) * 0.08,
          delay, out: this.arpOut, lp: 3400, vary: false,
        });
      }
    }
  }

  makeArpBus() {
    const g = this.ctx.createGain();
    g.gain.value = 0.8;
    g.connect(this.musicBus);
    g.connect(this.delay);
    return g;
  }
}
