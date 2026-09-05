// 程序化材质贴图库：Canvas 生成金属面板/混凝土/迷彩/警示条纹/木板（离线可用）
// 所有贴图 256px、四方连续，供建筑与载具蒙皮使用

import * as THREE from '../../vendor/three.module.min.js';

function canvas2d(s = 256) {
  const cv = document.createElement('canvas');
  cv.width = cv.height = s;
  return [cv, cv.getContext('2d')];
}
function toTex(cv, rx = 1, ry = 1) {
  const t = new THREE.CanvasTexture(cv);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(rx, ry);
  return t;
}
function hash(x, y, k) {
  let h = (x * 374761393 + y * 668265263 + k * 1442695041) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

// 军用金属面板：竖向蒙皮缝 + 双排铆钉 + 顶部磨损 + 底部锈渍流挂
export function metalPanel(base = '#5a6570', dark = '#48525c', rx = 1, ry = 1) {
  const S = 256;
  const [cv, c] = canvas2d(S);
  c.fillStyle = base;
  c.fillRect(0, 0, S, S);
  // 竖向面板（每 64px 一条缝）
  for (let x = 0; x < S; x += 64) {
    c.fillStyle = dark;
    c.fillRect(x, 0, 3, S);
    c.fillStyle = 'rgba(255,255,255,0.08)';
    c.fillRect(x + 3, 0, 2, S);
    // 横向加强筋
    c.fillStyle = 'rgba(0,0,0,0.18)';
    c.fillRect(x, 58, 64, 3);
    c.fillRect(x, 186, 64, 3);
    // 双排铆钉
    c.fillStyle = 'rgba(20,24,28,0.9)';
    for (let y = 10; y < S; y += 28) {
      c.beginPath(); c.arc(x + 12, y, 2.2, 0, 7); c.fill();
      c.beginPath(); c.arc(x + 52, y, 2.2, 0, 7); c.fill();
    }
  }
  // 磨损亮边（顶部/随机划痕）
  c.fillStyle = 'rgba(255,255,255,0.06)';
  c.fillRect(0, 0, S, 6);
  for (let i = 0; i < 26; i++) {
    const x = hash(i, 1, 5) * S, y = hash(i, 2, 5) * S;
    c.fillStyle = `rgba(220,225,230,${0.05 + hash(i, 3, 5) * 0.08})`;
    c.fillRect(x, y, 3 + hash(i, 4, 5) * 16, 1.4);
  }
  // 锈渍流挂
  for (let i = 0; i < 9; i++) {
    const x = hash(i, 7, 9) * S, y = 120 + hash(i, 8, 9) * 120;
    const g = c.createLinearGradient(0, y, 0, y + 60);
    g.addColorStop(0, 'rgba(110,70,40,0.35)');
    g.addColorStop(1, 'rgba(110,70,40,0)');
    c.fillStyle = g;
    c.fillRect(x, y, 5 + hash(i, 9, 9) * 9, 60);
  }
  return toTex(cv, rx, ry);
}

// 混凝土：噪点 + 污渍 + 裂缝 + 分缝线
export function concrete(base = '#8d887a', rx = 1, ry = 1) {
  const S = 256;
  const [cv, c] = canvas2d(S);
  c.fillStyle = base;
  c.fillRect(0, 0, S, S);
  const img = c.getImageData(0, 0, S, S);
  for (let i = 0; i < img.data.length; i += 4) {
    const n = (Math.random() - 0.5) * 26;
    img.data[i] += n; img.data[i + 1] += n; img.data[i + 2] += n;
  }
  c.putImageData(img, 0, 0);
  // 污渍
  for (let i = 0; i < 10; i++) {
    const x = hash(i, 3, 11) * S, y = hash(i, 4, 11) * S, r = 12 + hash(i, 5, 11) * 40;
    const g = c.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, `rgba(40,38,30,${0.1 + hash(i, 6, 11) * 0.14})`);
    g.addColorStop(1, 'rgba(40,38,30,0)');
    c.fillStyle = g;
    c.beginPath(); c.arc(x, y, r, 0, 7); c.fill();
  }
  // 裂缝
  c.strokeStyle = 'rgba(30,28,24,0.4)';
  c.lineWidth = 1;
  for (let i = 0; i < 4; i++) {
    let x = hash(i, 1, 13) * S, y = hash(i, 2, 13) * S;
    c.beginPath(); c.moveTo(x, y);
    for (let s = 0; s < 6; s++) { x += (hash(i, s, 17) - 0.5) * 60; y += (hash(i, s, 19) - 0.5) * 60; c.lineTo(x, y); }
    c.stroke();
  }
  // 分缝线（十字）
  c.fillStyle = 'rgba(0,0,0,0.22)';
  c.fillRect(0, 0, S, 3); c.fillRect(0, 0, 3, S);
  return toTex(cv, rx, ry);
}

// 迷彩布（三色斑块）
export function camo(cols = ['#4a5d3a', '#39482e', '#5d6b48'], rx = 1, ry = 1) {
  const S = 256;
  const [cv, c] = canvas2d(S);
  c.fillStyle = cols[0];
  c.fillRect(0, 0, S, S);
  let seed = 42;
  const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  for (let i = 0; i < 46; i++) {
    c.fillStyle = cols[1 + (i % 2)];
    c.beginPath();
    const cx = rnd() * S, cy = rnd() * S, r = 16 + rnd() * 42;
    for (let a = 0; a <= Math.PI * 2 + 0.01; a += 0.5) {
      const rr = r * (0.6 + rnd() * 0.55);
      const x = cx + Math.cos(a) * rr, y = cy + Math.sin(a) * rr;
      a === 0 ? c.moveTo(x, y) : c.lineTo(x, y);
    }
    c.fill();
  }
  return toTex(cv, rx, ry);
}

// 警示条纹（黄黑斜纹，大门/机械用）
export function hazard(rx = 1, ry = 1) {
  const S = 128;
  const [cv, c] = canvas2d(S);
  c.fillStyle = '#d8a013';
  c.fillRect(0, 0, S, S);
  c.fillStyle = '#20242a';
  for (let x = -S; x < S * 2; x += 44) {
    c.beginPath();
    c.moveTo(x, S); c.lineTo(x + S, 0); c.lineTo(x + S + 22, 0); c.lineTo(x + 22, S);
    c.closePath(); c.fill();
  }
  // 磨损
  for (let i = 0; i < 60; i++) {
    c.fillStyle = `rgba(120,110,90,${0.08 + Math.random() * 0.16})`;
    c.fillRect(Math.random() * S, Math.random() * S, 3 + Math.random() * 8, 2 + Math.random() * 3);
  }
  return toTex(cv, rx, ry);
}

// 木板条箱
export function planks(rx = 1, ry = 1) {
  const S = 128;
  const [cv, c] = canvas2d(S);
  c.fillStyle = '#8a6a42';
  c.fillRect(0, 0, S, S);
  for (let y = 0; y < S; y += 22) {
    c.fillStyle = `rgba(60,42,22,${0.25 + Math.random() * 0.2})`;
    c.fillRect(0, y, S, 2.4);
    c.fillStyle = `rgba(255,230,190,${0.05 + Math.random() * 0.06})`;
    c.fillRect(0, y + 2.4, S, 3);
  }
  // 木纹划痕
  c.strokeStyle = 'rgba(70,50,26,0.4)';
  for (let i = 0; i < 30; i++) {
    c.beginPath();
    const y = Math.random() * S;
    c.moveTo(Math.random() * S, y);
    c.lineTo(Math.random() * S, y + (Math.random() - 0.5) * 4);
    c.stroke();
  }
  return toTex(cv, rx, ry);
}
