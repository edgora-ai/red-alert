// 粒子特效系统：Three.js Points 双批次（加法混合=火/火花/闪光，普通混合=烟/尘）
// + 冲击波环与焦土贴花对象池。所有纹理由 Canvas 程序生成，离线可用。

import * as THREE from '../../vendor/three.module.min.js';

function circleTex(soft = 0.5) {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const x = c.getContext('2d');
  const g = x.createRadialGradient(32, 32, 0, 32, 32, 32);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(soft, 'rgba(255,255,255,0.6)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  x.fillStyle = g;
  x.fillRect(0, 0, 64, 64);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function scorchTex() {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const x = c.getContext('2d');
  const g = x.createRadialGradient(64, 64, 8, 64, 64, 62);
  g.addColorStop(0, 'rgba(8,6,4,0.85)');
  g.addColorStop(0.55, 'rgba(12,9,6,0.55)');
  g.addColorStop(0.8, 'rgba(16,12,8,0.22)');
  g.addColorStop(1, 'rgba(0,0,0,0)');
  x.fillStyle = g;
  x.fillRect(0, 0, 128, 128);
  // 烧灼飞溅斑点
  for (let i = 0; i < 26; i++) {
    const a = Math.random() * Math.PI * 2, r = 20 + Math.random() * 42;
    x.fillStyle = `rgba(10,8,5,${0.12 + Math.random() * 0.2})`;
    x.beginPath();
    x.arc(64 + Math.cos(a) * r, 64 + Math.sin(a) * r, 2 + Math.random() * 7, 0, 7);
    x.fill();
  }
  return new THREE.CanvasTexture(c);
}

// 程序生成爆炸序列帧图集：10 帧火球翻滚（亮黄核心 → 橙红湍流 → 暗红消散）
function explosionAtlas() {
  const FR = 10, S = 160;
  const cv = document.createElement('canvas');
  cv.width = S * FR; cv.height = S;
  const c = cv.getContext('2d');
  let seed = 7;
  const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  for (let f = 0; f < FR; f++) {
    const k = f / (FR - 1);
    const cx = f * S + S / 2, cy = S / 2;
    const R = S * (0.16 + 0.32 * Math.sin(Math.min(1, k * 1.25) * Math.PI * 0.6));
    // 湍流火团（由内向外加速扩散，模拟翻滚）
    for (let i = 0; i < 30; i++) {
      const a = rnd() * Math.PI * 2;
      const rr = Math.pow(rnd(), 0.55) * R * (0.45 + k * 0.9);
      const br = R * (0.24 + rnd() * 0.3) * (1 - k * 0.3);
      const x = cx + Math.cos(a) * rr;
      const y = cy + Math.sin(a) * rr * (1 - k * 0.3);
      const hue = 52 - k * 46 - rnd() * 14;
      const light = 0.88 - k * 0.58 + rnd() * 0.08;
      const g = c.createRadialGradient(x, y, 0, x, y, Math.max(2, br));
      g.addColorStop(0, `hsla(${hue},96%,${light * 100}%,${0.8 * (1 - k * 0.72)})`);
      g.addColorStop(1, `hsla(${hue - 12},92%,${light * 50}%,0)`);
      c.fillStyle = g;
      c.beginPath(); c.arc(x, y, br, 0, 7); c.fill();
    }
    // 白热核心（前中期）
    if (k < 0.55) {
      const g = c.createRadialGradient(cx, cy, 0, cx, cy, R * 0.72);
      const kk = 1 - k / 0.55;
      g.addColorStop(0, `rgba(255,255,238,${0.95 * kk})`);
      g.addColorStop(0.5, `rgba(255,214,128,${0.65 * kk})`);
      g.addColorStop(1, 'rgba(255,150,40,0)');
      c.fillStyle = g;
      c.beginPath(); c.arc(cx, cy, R * 0.75, 0, 7); c.fill();
    }
  }
  const t = new THREE.CanvasTexture(cv);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

const VERT = /* glsl */`
attribute float aSize;
attribute vec3 aColor;
attribute float aAlpha;
uniform float uScale;
varying vec3 vColor;
varying float vAlpha;
void main() {
  vColor = aColor;
  vAlpha = aAlpha;
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  gl_PointSize = min(320.0, aSize * uScale / max(0.1, -mv.z));
  gl_Position = projectionMatrix * mv;
}`;

const FRAG = /* glsl */`
uniform sampler2D map;
varying vec3 vColor;
varying float vAlpha;
void main() {
  vec4 t = texture2D(map, gl_PointCoord);
  gl_FragColor = vec4(vColor, vAlpha * t.a);
  if (gl_FragColor.a < 0.004) discard;
}`;

class Layer {
  constructor(scene, max, blending, map, renderOrder) {
    this.max = max;
    this.parts = [];
    this.pos = new Float32Array(max * 3);
    this.col = new Float32Array(max * 3);
    this.size = new Float32Array(max);
    this.alpha = new Float32Array(max);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3));
    geo.setAttribute('aColor', new THREE.BufferAttribute(this.col, 3));
    geo.setAttribute('aSize', new THREE.BufferAttribute(this.size, 1));
    geo.setAttribute('aAlpha', new THREE.BufferAttribute(this.alpha, 1));
    geo.setDrawRange(0, 0);
    this.geo = geo;
    this.mat = new THREE.ShaderMaterial({
      vertexShader: VERT, fragmentShader: FRAG, map,
      uniforms: {
        map: { value: map },
        uScale: { value: 600 },
      },
      transparent: true, depthWrite: false, blending,
    });
    this.points = new THREE.Points(geo, this.mat);
    this.points.frustumCulled = false;
    this.points.renderOrder = renderOrder;
    scene.add(this.points);
  }
}

export class Particles {
  constructor(scene) {
    this.add = new Layer(scene, 2400, THREE.AdditiveBlending, circleTex(0.35), 8);
    this.smoke = new Layer(scene, 1100, THREE.NormalBlending, circleTex(0.15), 7);
    this.decalTex = scorchTex();
    this.decals = [];
    this.decalI = 0;
    for (let i = 0; i < 40; i++) {
      const m = new THREE.Mesh(
        new THREE.CircleGeometry(1, 22),
        new THREE.MeshBasicMaterial({ map: this.decalTex, transparent: true, depthWrite: false, opacity: 0 }),
      );
      m.rotation.x = -Math.PI / 2;
      m.renderOrder = 2;
      m.position.y = 0.015 + (i % 10) * 0.001;
      m.visible = false;
      scene.add(m);
      this.decals.push({ m, ttl: 0, max: 1 });
    }
    this.rings = [];
    this.ringI = 0;
    for (let i = 0; i < 14; i++) {
      const m = new THREE.Mesh(
        new THREE.RingGeometry(0.82, 1, 42),
        new THREE.MeshBasicMaterial({ color: 0xffc890, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, opacity: 0 }),
      );
      m.rotation.x = -Math.PI / 2;
      m.renderOrder = 9;
      m.visible = false;
      scene.add(m);
      this.rings.push({ m, ttl: 0, max: 1, r0: 0.3, r1: 2 });
    }
    // 爆炸序列帧精灵池（图集 UV 按帧切换，广告牌朝向相机）
    this.atlas = explosionAtlas();
    this.frames = [];
    for (let f = 0; f < 10; f++) {
      const geo = new THREE.PlaneGeometry(1, 1);
      const uv = geo.attributes.uv;
      for (let i = 0; i < uv.count; i++) {
        uv.setX(i, (f + uv.getX(i)) / 10);
      }
      this.frames.push(geo);
    }
    this.sprites = [];
    for (let i = 0; i < 16; i++) {
      const m = new THREE.Mesh(
        this.frames[0],
        new THREE.MeshBasicMaterial({ map: this.atlas, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, opacity: 0 }),
      );
      m.rotation.x = 0;
      m.visible = false;
      m.renderOrder = 10;
      scene.add(m);
      this.sprites.push({ m, t: 0, dur: 1, r: 1 });
    }
    this.spriteI = 0;
    this.cam = null;
  }

  setCamera(cam3) { this.cam = cam3; }

  fireball(x, z, r, dur = 0.55, alt = null) {
    const s = this.sprites[this.spriteI++ % this.sprites.length];
    s.t = 0; s.dur = dur; s.r = r;
    s.m.position.set(x, alt ?? r * 0.5 + 0.25, z);
    s.m.visible = true;
  }

  setViewScale(hpx, fovDeg) {
    const s = hpx * 0.5 / Math.tan(fovDeg * Math.PI / 360);
    this.add.mat.uniforms.uScale.value = s;
    this.smoke.mat.uniforms.uScale.value = s;
  }

  spawn(o) {
    const layer = o.layer === 'smoke' ? this.smoke : this.add;
    if (layer.parts.length >= layer.max) layer.parts.shift();
    layer.parts.push({
      x: o.x, y: o.y ?? 0.3, z: o.z,
      vx: o.vx || 0, vy: o.vy || 0, vz: o.vz || 0,
      life: o.life, max: o.life,
      s0: o.size, s1: o.sizeEnd ?? o.size,
      c0: o.col0, c1: o.col1 ?? o.col0,
      a: o.alpha ?? 1,
      grav: o.grav || 0, drag: o.drag || 0,
    });
  }

  ring(x, z, r0, r1, color, life = 0.45) {
    const r = this.rings[this.ringI++ % this.rings.length];
    r.m.position.set(x, 0.06, z);
    r.m.material.color.setHex(color);
    r.r0 = r0; r.r1 = r1;
    r.ttl = r.max = life;
    r.m.visible = true;
  }

  scorch(x, z, r) {
    const d = this.decals[this.decalI++ % this.decals.length];
    d.m.position.set(x, d.m.position.y, z);
    d.m.scale.setScalar(r);
    d.m.rotation.z = Math.random() * Math.PI * 2;
    d.m.material.opacity = 0.85;
    d.ttl = d.max = 40 + Math.random() * 15;
    d.m.visible = true;
  }

  // ---------- 预设组合 ----------
  explosion(x, z, r = 0.6) {
    // 序列帧火球（主角）+ 火舌粒子 + 浓烟 + 火花 + 冲击波环 + 焦土
    this.fireball(x, z, r * 1.5, 0.5 + r * 0.12);
    this.spawn({ x, y: 0.45, z, life: 0.12, size: r * 2.2, sizeEnd: r * 3.2, col0: 0xfff6cc, col1: 0xff8a2a, alpha: 1 });
    const nFire = Math.round(9 + r * 9);
    for (let i = 0; i < nFire; i++) {
      const a = Math.random() * Math.PI * 2, sp = (0.8 + Math.random() * 2.6) * r;
      this.spawn({
        x, y: 0.3 + Math.random() * 0.4, z,
        vx: Math.cos(a) * sp, vy: 1.2 + Math.random() * 2.2, vz: Math.sin(a) * sp,
        life: 0.3 + Math.random() * 0.4, size: r * 0.45, sizeEnd: r * (1.1 + Math.random()),
        col0: 0xffd070, col1: 0xb81e06, alpha: 0.95, grav: -2.2, drag: 2.4,
      });
    }
    const nSmoke = Math.round(5 + r * 6);
    for (let i = 0; i < nSmoke; i++) {
      const a = Math.random() * Math.PI * 2, sp = 0.3 + Math.random() * 1.1 * r;
      this.spawn({
        layer: 'smoke', x, y: 0.4 + Math.random() * 0.5, z,
        vx: Math.cos(a) * sp, vy: 0.7 + Math.random() * 1.1, vz: Math.sin(a) * sp,
        life: 1.1 + Math.random() * 1.2, size: r * 0.7, sizeEnd: r * (2.0 + Math.random() * 1.2),
        col0: 0x4c4a46, col1: 0x1c1a18, alpha: 0.38, grav: -0.5, drag: 1.2,
      });
    }
    const nSpark = Math.round(8 + r * 11);
    for (let i = 0; i < nSpark; i++) {
      const a = Math.random() * Math.PI * 2, up = 2.5 + Math.random() * 5;
      this.spawn({
        x, y: 0.35, z,
        vx: Math.cos(a) * (2 + Math.random() * 5), vy: up, vz: Math.sin(a) * (2 + Math.random() * 5),
        life: 0.25 + Math.random() * 0.4, size: 0.09, col0: 0xffe090, col1: 0xff6010, alpha: 1, grav: -11,
      });
    }
    this.ring(x, z, 0.25, r * 2.3, 0xffc890, 0.4);
    this.scorch(x, z, r * 1.5);
  }

  muzzle(x, z, dir, big, alt = 0.4) {
    this.fireball(x, z, big ? 0.55 : 0.32, 0.16, alt);
    // 出膛烟团
    this.spawn({
      layer: 'smoke', x: x + Math.cos(dir) * 0.2, y: alt, z: z + Math.sin(dir) * 0.2,
      vx: Math.cos(dir) * 1.6, vy: 0.3, vz: Math.sin(dir) * 1.6,
      life: 0.5, size: 0.14, sizeEnd: 0.5, col0: 0xb8b4ac, col1: 0x6a675f, alpha: 0.3, drag: 3,
    });
    for (let i = 0; i < (big ? 5 : 3); i++) {
      const a = dir + (Math.random() - 0.5) * 0.7, sp = 3 + Math.random() * 4;
      this.spawn({
        x, y: alt - 0.04, z, vx: Math.cos(a) * sp, vy: 0.5 + Math.random(), vz: Math.sin(a) * sp,
        life: 0.1 + Math.random() * 0.12, size: 0.07, col0: 0xffd880, col1: 0xff7010, alpha: 1, grav: -4,
      });
    }
  }

  impact(x, z, color = 0xffd080) {
    this.spawn({ x, y: 0.35, z, life: 0.1, size: 0.28, col0: color, alpha: 1 });
    for (let i = 0; i < 4; i++) {
      const a = Math.random() * Math.PI * 2;
      this.spawn({
        x, y: 0.3, z, vx: Math.cos(a) * 3, vy: 1.5 + Math.random() * 2, vz: Math.sin(a) * 3,
        life: 0.16 + Math.random() * 0.14, size: 0.06, col0: color, col1: 0xff6010, alpha: 1, grav: -9,
      });
    }
  }

  trail(x, z) {
    this.spawn({
      layer: 'smoke', x, y: 0.3 + Math.random() * 0.15, z,
      vx: (Math.random() - 0.5) * 0.3, vy: 0.25 + Math.random() * 0.3, vz: (Math.random() - 0.5) * 0.3,
      life: 0.6 + Math.random() * 0.5, size: 0.13, sizeEnd: 0.45 + Math.random() * 0.25,
      col0: 0xb0aea8, col1: 0x5c5a56, alpha: 0.3, grav: -0.2,
    });
  }

  dust(x, z) {
    this.spawn({
      layer: 'smoke', x, y: 0.1, z,
      vx: (Math.random() - 0.5) * 0.4, vy: 0.3 + Math.random() * 0.3, vz: (Math.random() - 0.5) * 0.4,
      life: 0.5 + Math.random() * 0.4, size: 0.16, sizeEnd: 0.55 + Math.random() * 0.3,
      col0: 0x6b6152, col1: 0x453e33, alpha: 0.2, grav: -0.1,
    });
  }

  buildDust(x, z, r) {
    for (let i = 0; i < 10; i++) {
      const a = Math.random() * Math.PI * 2, rr = r * (0.3 + Math.random() * 0.5);
      this.spawn({
        layer: 'smoke', x: x + Math.cos(a) * rr, y: 0.1, z: z + Math.sin(a) * rr,
        vx: Math.cos(a) * 1.2, vy: 0.4 + Math.random() * 0.5, vz: Math.sin(a) * 1.2,
        life: 0.8 + Math.random() * 0.6, size: 0.3, sizeEnd: 1.0 + Math.random() * 0.6,
        col0: 0x8a7d68, col1: 0x55493a, alpha: 0.35, grav: -0.1, drag: 2,
      });
    }
  }

  chimney(x, y, z) {
    this.spawn({
      layer: 'smoke', x, y, z,
      vx: 0.25 + Math.random() * 0.2, vy: 0.55 + Math.random() * 0.3, vz: (Math.random() - 0.5) * 0.2,
      life: 1.6 + Math.random() * 1.2, size: 0.12, sizeEnd: 0.55 + Math.random() * 0.35,
      col0: 0x9a9a96, col1: 0x4e4e4a, alpha: 0.22, grav: -0.12,
    });
  }

  update(dt) {
    // 爆炸序列帧精灵推进（广告牌朝向相机）
    for (const s of this.sprites) {
      if (!s.m.visible) continue;
      s.t += dt;
      const k = s.t / s.dur;
      if (k >= 1) { s.m.visible = false; continue; }
      const f = Math.min(9, Math.floor(k * 10));
      s.m.geometry = this.frames[f];
      if (this.cam) s.m.quaternion.copy(this.cam.quaternion);
      s.m.scale.setScalar(s.r * (0.85 + k * 1.15));
      s.m.material.opacity = 1 - Math.max(0, k - 0.55) / 0.45;
    }
    for (const layer of [this.add, this.smoke]) {
      const { parts, pos, col, size, alpha, geo } = layer;
      let n = 0;
      for (let i = parts.length - 1; i >= 0; i--) {
        const p = parts[i];
        if ((p.life -= dt) <= 0) { parts.splice(i, 1); continue; }
        p.vx -= p.vx * p.drag * dt; p.vz -= p.vz * p.drag * dt; p.vy -= p.vy * p.drag * dt;
        p.vy += p.grav * dt;
        p.x += p.vx * dt; p.y += p.vy * dt; p.z += p.vz * dt;
        if (p.y < 0.05 && p.grav < 0) { p.y = 0.05; p.vy = 0; }
        const k = 1 - p.life / p.max;
        pos[n * 3] = p.x; pos[n * 3 + 1] = p.y; pos[n * 3 + 2] = p.z;
        col[n * 3] = (p.c0 >> 16 & 255) / 255 + (((p.c1 >> 16 & 255) / 255) - ((p.c0 >> 16 & 255) / 255)) * k;
        col[n * 3 + 1] = (p.c0 >> 8 & 255) / 255 + (((p.c1 >> 8 & 255) / 255) - ((p.c0 >> 8 & 255) / 255)) * k;
        col[n * 3 + 2] = (p.c0 & 255) / 255 + (((p.c1 & 255) / 255) - ((p.c0 & 255) / 255)) * k;
        size[n] = p.s0 + (p.s1 - p.s0) * k;
        alpha[n] = p.a * (k < 0.15 ? k / 0.15 : 1 - (k - 0.15) / 0.85);
        n++;
      }
      geo.setDrawRange(0, n);
      geo.attributes.position.needsUpdate = true;
      geo.attributes.aColor.needsUpdate = true;
      geo.attributes.aSize.needsUpdate = true;
      geo.attributes.aAlpha.needsUpdate = true;
    }
    // 冲击波环
    for (const r of this.rings) {
      if (!r.m.visible) continue;
      if ((r.ttl -= dt) <= 0) { r.m.visible = false; continue; }
      const k = 1 - r.ttl / r.max;
      r.m.scale.setScalar(r.r0 + (r.r1 - r.r0) * k);
      r.m.material.opacity = (1 - k) * 0.8;
    }
    // 焦土贴花
    for (const d of this.decals) {
      if (!d.m.visible) continue;
      if ((d.ttl -= dt) <= 0) { d.m.visible = false; continue; }
      if (d.ttl < 8) d.m.material.opacity = 0.85 * d.ttl / 8;
    }
  }
}
