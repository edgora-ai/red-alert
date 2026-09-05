// 低多边形军事装备模型库：基础几何体 + 程序化蒙皮（面板/铆钉/混凝土/迷彩）
// 所有模型以原点为中心、y=0 落地、车头朝 +x；1 单位 = 1 瓦片

import * as THREE from '../../vendor/three.module.min.js';
import { metalPanel, concrete, camo, hazard, planks } from './textures.js';

// 阵营涂装：玩家藏青钢 / 红军锈红钢，炮塔顶部与细节用阵营亮色
export const SIDE_COLORS = { player: '#4da3ff', enemy: '#ff5545' };
const HULL = { player: 0x3a5f82, enemy: 0x7d3d33 };
const ACCENT = { player: 0x4da3ff, enemy: 0xff5545 };
const DARK = 0x22262b;   // 履带/轮胎
const METAL = 0x3a4048;  // 炮管等深色金属

// 蒙皮纹理单例（懒生成，clone 调整平铺）
let _metal, _conc, _camo, _haz, _plk;
function tex(t, rx = 1, ry = 1) {
  const c = t.clone();
  c.needsUpdate = true;
  c.repeat.set(rx, ry);
  return c;
}
export function skin(kind) {
  _metal ??= metalPanel();
  _conc ??= concrete();
  _camo ??= camo();
  _haz ??= hazard();
  _plk ??= planks();
  return { metal: _metal, conc: _conc, camo: _camo, haz: _haz, planks: _plk }[kind];
}

function mat(color, o = {}) {
  return new THREE.MeshStandardMaterial({
    color: o.map ? 0xffffff : color,
    map: o.map ?? null,
    roughness: o.rough ?? 0.62, metalness: o.metal ?? 0.22,
    flatShading: o.flat ?? true,
    emissive: o.em ?? 0x000000, emissiveIntensity: o.emi ?? 1,
    transparent: o.alpha !== undefined, opacity: o.alpha ?? 1,
    envMapIntensity: 0.5,
  });
}
function box(w, h, d, color, x = 0, y = 0, z = 0, o = {}) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat(color, o));
  m.position.set(x, y, z); m.castShadow = true;
  return m;
}
function cyl(rt, rb, h, color, x = 0, y = 0, z = 0, o = {}) {
  const m = new THREE.Mesh(new THREE.CylinderGeometry(rt, rb, h, o.seg ?? 12), mat(color, o));
  m.position.set(x, y, z); m.castShadow = true;
  if (o.rx) m.rotation.x = o.rx;
  if (o.rz) m.rotation.z = o.rz;
  return m;
}
function sph(r, color, x = 0, y = 0, z = 0, o = {}) {
  const m = new THREE.Mesh(new THREE.SphereGeometry(r, o.seg ?? 12, o.seg ?? 10), mat(color, o));
  m.position.set(x, y, z); m.castShadow = true;
  return m;
}
function oct(r, color, x = 0, y = 0, z = 0, o = {}) {
  const m = new THREE.Mesh(new THREE.OctahedronGeometry(r), mat(color, o));
  m.position.set(x, y, z); m.castShadow = true;
  return m;
}
function cone(r, h, color, x = 0, y = 0, z = 0, o = {}) {
  const m = new THREE.Mesh(new THREE.ConeGeometry(r, h, o.seg ?? 10), mat(color, o));
  m.position.set(x, y, z); m.castShadow = true;
  return m;
}
// 沿 +x 的炮管（带后坐动画挂点）
function barrel(len, r, x, y, z) {
  const g = new THREE.Group();
  g.add(cyl(r * 0.85, r, len, METAL, 0, 0, 0, { rz: -Math.PI / 2 }));
  g.add(cyl(r * 1.4, r * 1.4, len * 0.14, DARK, len * 0.46, 0, 0, { rz: -Math.PI / 2 })); // 炮口制退器
  g.position.set(x, y, z);
  g.userData.baseX = x;
  return g;
}
function wheels(n, r, width, xs, z) {
  const g = new THREE.Group();
  for (const x of xs) for (const s of [-1, 1])
    g.add(cyl(r, r, width, DARK, x, r, s * z, { rx: Math.PI / 2, seg: 10 }));
  return g;
}

// ================= 车辆 =================

// 遥控武器站（现代坦克标配车长机枪塔）
function rws(x, y, z) {
  const g = new THREE.Group();
  g.add(box(0.07, 0.05, 0.07, METAL, 0, 0.025, 0));
  g.add(box(0.12, 0.015, 0.02, 0x2a2f36, 0.04, 0.05, 0));
  g.position.set(x, y, z);
  return g;
}
// 烟幕弹发射器（炮塔侧群组小管）
function smokeLaunchers(x, y, z) {
  const g = new THREE.Group();
  for (let i = 0; i < 3; i++) {
    const t = cyl(0.015, 0.015, 0.05, 0x3a4048, (i - 1) * 0.045, 0, 0);
    t.rotation.z = -0.6; t.rotation.y = 0.5;
    g.add(t);
  }
  g.position.set(x, y, z);
  return g;
}
// 通信天线
function antenna(x, y, z, h = 0.3) {
  const g = new THREE.Group();
  g.add(cyl(0.006, 0.006, h, 0x1a1e24, 0, h / 2, 0));
  g.add(sph(0.015, 0x1a1e24, 0, h, 0));
  g.position.set(x, y, z);
  return g;
}
// 履带行走装置：履带体 + 5 组负重轮 + 前后主/诱导轮
function trackAssembly(len, cx, z) {
  const g = new THREE.Group();
  g.add(box(len, 0.14, 0.09, DARK, cx, 0.11, z));
  const n = 5;
  for (let i = 0; i < n; i++) {
    const x = cx - len / 2 + (i + 0.5) * (len / n);
    g.add(cyl(0.072, 0.072, 0.13, 0x33383f, x, 0.1, z + 0.02, { rx: Math.PI / 2, seg: 10 }));
  }
  g.add(cyl(0.055, 0.055, 0.11, METAL, cx + len / 2 - 0.05, 0.14, z + 0.02, { rx: Math.PI / 2, seg: 8 }));
  g.add(cyl(0.055, 0.055, 0.11, METAL, cx - len / 2 + 0.05, 0.14, z + 0.02, { rx: Math.PI / 2, seg: 8 }));
  return g;
}

// 猎豹II 主战坦克：斜首装甲 + 单人炮塔 + 长滑膛炮 + 遥控武器站/烟幕弹/热成像仪
function cheetah(side) {
  const h = HULL[side], a = ACCENT[side];
  const g = new THREE.Group();
  for (const s of [-1, 1]) {
    g.add(trackAssembly(0.78, 0, s * 0.25));                     // 履带行走装置
    g.add(box(0.72, 0.09, 0.02, h, -0.02, 0.2, s * 0.33));       // 侧裙板
    // 侧裙附加反应装甲块
    for (const bx of [-0.22, 0.02, 0.24]) g.add(box(0.14, 0.06, 0.02, 0x2c343e, bx, 0.22, s * 0.345));
  }
  g.add(box(0.72, 0.13, 0.38, h, 0, 0.2, 0));                    // 车体
  const glacis = box(0.18, 0.12, 0.36, h, 0.38, 0.19, 0);        // 首上斜甲
  glacis.rotation.z = -0.55; g.add(glacis);
  const tur = new THREE.Group(); tur.position.set(-0.04, 0.3, 0);
  tur.add(box(0.36, 0.11, 0.3, h, 0, 0.02, 0));
  tur.add(box(0.2, 0.03, 0.2, a, -0.03, 0.09, 0, { em: a, emi: 0.25 })); // 阵营识别板
  const gun = barrel(0.58, 0.028, 0.2, 0.04, 0);                 // 125mm 滑膛炮
  tur.add(gun);
  tur.userData.barrels = [gun];
  tur.add(box(0.06, 0.05, 0.06, METAL, -0.16, 0.08, 0));         // 车长周视镜
  tur.add(box(0.09, 0.045, 0.09, 0x2c343e, -0.02, 0.095, -0.1)); // 热成像仪箱
  tur.add(rws(-0.12, 0.09, 0.08));                               // 遥控武器站
  tur.add(smokeLaunchers(0.08, 0.05, -0.16));                    // 烟幕弹
  tur.add(antenna(-0.2, 0.05, -0.12));                           // 通信天线
  g.add(tur);
  g.userData.turret = tur;
  return g;
}

// 暴君重型坦克：加宽车体 + 双联 152mm 重炮 + 爆反装甲
function tyrant(side) {
  const h = HULL[side], a = ACCENT[side];
  const g = new THREE.Group();
  for (const s of [-1, 1]) {
    g.add(trackAssembly(0.92, 0, s * 0.3));
    g.add(box(0.86, 0.1, 0.02, h, -0.02, 0.23, s * 0.4));
  }
  g.add(box(0.86, 0.16, 0.46, h, 0, 0.23, 0));
  const glacis = box(0.2, 0.15, 0.44, h, 0.44, 0.22, 0);
  glacis.rotation.z = -0.5; g.add(glacis);
  // 首上爆反装甲块
  for (const [bx, bz] of [[0.36, -0.12], [0.36, 0.12], [0.5, 0]]) {
    const era = box(0.12, 0.03, 0.12, 0x2c343e, bx, 0.3, bz);
    era.rotation.z = -0.5; g.add(era);
  }
  const tur = new THREE.Group(); tur.position.set(-0.06, 0.35, 0);
  tur.add(box(0.44, 0.13, 0.36, h, 0, 0.02, 0));
  tur.add(box(0.24, 0.03, 0.24, a, -0.05, 0.1, 0, { em: a, emi: 0.25 }));
  const gun1 = barrel(0.62, 0.032, 0.24, 0.05, -0.08);           // 双联重炮
  const gun2 = barrel(0.62, 0.032, 0.24, 0.05, 0.08);
  tur.add(gun1); tur.add(gun2);
  tur.userData.barrels = [gun1, gun2];
  tur.add(rws(-0.16, 0.1, 0.1));
  tur.add(antenna(-0.24, 0.06, -0.14, 0.34));
  g.add(tur);
  g.userData.turret = tur;
  return g;
}

// 猎手弹炮合一：六轮装甲车 + 双肩导弹箱 + 传感桅杆
function hunter(side) {
  const h = HULL[side], a = ACCENT[side];
  const g = new THREE.Group();
  g.add(box(0.66, 0.2, 0.4, h, 0, 0.22, 0));
  const nose = box(0.14, 0.14, 0.36, h, 0.38, 0.2, 0);
  nose.rotation.z = -0.45; g.add(nose);
  g.add(wheels(6, 0.09, 0.06, [-0.24, 0, 0.24], 0.23));
  g.add(antenna(-0.3, 0.3, -0.1, 0.28));                         // 传感/通信桅杆
  const tur = new THREE.Group(); tur.position.set(-0.05, 0.36, 0);
  for (const s of [-1, 1]) {
    const pod = box(0.26, 0.1, 0.1, METAL, 0, 0.02, s * 0.13);   // 导弹箱
    pod.rotation.z = 0.35; tur.add(pod);
    for (let i = 0; i < 3; i++) tur.add(cyl(0.02, 0.02, 0.02, 0xdddddd, 0.12 + i * 0.001, 0.05 + i * 0.0, s * 0.13 + (i - 1) * 0.035, { rz: -Math.PI / 2 }));
  }
  tur.add(box(0.08, 0.04, 0.08, a, -0.08, 0.06, 0, { em: a, emi: 0.3 }));
  g.add(tur);
  g.userData.turret = tur;
  return g;
}

// 雷霆远程火箭炮：高机动卡车底盘 + 箱式定向管束（现代化模块化发射箱）
function mlrs(side) {
  const h = HULL[side], a = ACCENT[side];
  const g = new THREE.Group();
  g.add(box(0.92, 0.09, 0.42, h, 0, 0.15, 0));                   // 底盘
  g.add(box(0.2, 0.2, 0.38, h, 0.36, 0.28, 0));                  // 装甲驾驶室
  g.add(box(0.14, 0.07, 0.32, 0x1a1e24, 0.44, 0.31, 0));         // 防弹风挡
  g.add(box(0.1, 0.1, 0.36, 0x3c444e, 0.2, 0.24, 0));            // 动力舱
  g.add(wheels(6, 0.1, 0.06, [-0.32, -0.05, 0.26], 0.24));
  const tur = new THREE.Group(); tur.position.set(-0.16, 0.24, 0);
  const pod = box(0.42, 0.26, 0.34, 0x3c444e, 0.02, 0.16, 0);    // 发射箱
  pod.rotation.z = 0.42;
  tur.add(pod);
  const face = box(0.03, 0.22, 0.3, 0x14181e, 0.23, 0.25, 0);    // 箱口
  face.rotation.z = 0.42;
  tur.add(face);
  for (let i = 0; i < 6; i++) {                                  // 3x2 定向管口
    const tx = 0.245, ty = 0.19 + (i % 3) * 0.07, tz = (Math.floor(i / 3) - 0.5) * 0.1;
    const tube = cyl(0.026, 0.026, 0.04, 0x0d1015, tx, ty, tz, { rz: -Math.PI / 2 });
    tube.rotation.y = Math.PI / 2 - 0.42 * 0; // 管口朝前上
    tur.add(tube);
  }
  tur.add(box(0.1, 0.03, 0.1, a, -0.14, 0.12, 0, { em: a, emi: 0.3 })); // 阵营灯
  g.add(tur);
  g.userData.turret = tur;
  return g;
}

// 长剑巡航导弹车：越野卡车底盘 + 起竖的发射箱
function longsword(side) {
  const h = HULL[side];
  const g = new THREE.Group();
  g.add(box(0.8, 0.1, 0.4, h, 0, 0.16, 0));                      // 底盘
  g.add(box(0.18, 0.18, 0.38, h, 0.32, 0.3, 0));                 // 驾驶室
  g.add(box(0.16, 0.06, 0.34, 0x1a1e24, 0.4, 0.26, 0));          // 风挡
  g.add(wheels(8, 0.1, 0.06, [-0.3, -0.1, 0.12, 0.3], 0.23));
  const tur = new THREE.Group(); tur.position.set(-0.12, 0.28, 0);
  const tube = cyl(0.11, 0.11, 0.66, 0xdde2e8, 0.1, 0.18, 0, { rz: -Math.PI / 3.2 }); // 发射筒起竖
  tur.add(tube);
  tur.add(cone(0.11, 0.14, 0xc0392b, 0.36, 0.35, 0));            // 红色弹头
  tur.children[1].rotation.z = -Math.PI / 3.2 + Math.PI / 2;
  g.add(tur);
  g.userData.turret = tur;
  return g;
}

// 极光粒子束坦克：未来风格悬浮感 + 发光棱镜
function aurora(side) {
  const h = HULL[side];
  const g = new THREE.Group();
  for (const s of [-1, 1]) g.add(box(0.74, 0.12, 0.14, 0x1c2128, 0, 0.1, s * 0.24));
  g.add(box(0.7, 0.12, 0.36, h, 0, 0.2, 0));
  const tur = new THREE.Group(); tur.position.set(-0.02, 0.3, 0);
  tur.add(cyl(0.16, 0.2, 0.08, 0x2c343e, 0, 0, 0));
  const prism = oct(0.13, 0x7df9ff, 0, 0.18, 0, { em: 0x7df9ff, emi: 1.6 }); // 充能棱镜
  tur.add(prism);
  tur.add(box(0.3, 0.02, 0.02, 0x7df9ff, 0.22, 0.06, 0, { em: 0x7df9ff, emi: 0.8 }));
  g.add(tur);
  g.userData.turret = tur;
  g.userData.prism = prism;
  return g;
}

// 驮马无人采矿车：重卡驾驶室 + 自卸货斗
function harvester(side) {
  const h = HULL[side];
  const g = new THREE.Group();
  g.add(box(0.95, 0.12, 0.5, h, 0, 0.18, 0));
  g.add(box(0.2, 0.22, 0.46, h, 0.38, 0.32, 0));                 // 驾驶室
  g.add(box(0.14, 0.08, 0.4, 0x10141a, 0.44, 0.36, 0));          // 风挡
  g.add(box(0.55, 0.2, 0.48, 0x4a4436, -0.14, 0.34, 0));         // 货斗
  const ore = box(0.48, 0.08, 0.4, 0xd4af37, -0.14, 0.44, 0, { em: 0xd4af37, emi: 0.3 });
  ore.visible = false;                                            // 有矿才显示
  g.add(ore);
  g.add(wheels(6, 0.11, 0.08, [-0.32, 0, 0.32], 0.27));
  g.userData.oreFill = ore;
  return g;
}

// 基地车 MCV：八轮超重型底盘 + 折叠建筑模块
function mcv(side) {
  const h = HULL[side], a = ACCENT[side];
  const g = new THREE.Group();
  g.add(box(1.15, 0.16, 0.6, h, 0, 0.22, 0));
  g.add(box(0.24, 0.24, 0.52, h, 0.44, 0.36, 0));                // 驾驶室
  g.add(box(0.18, 0.1, 0.46, 0x10141a, 0.5, 0.38, 0));
  const mod1 = box(0.5, 0.2, 0.52, 0x3c444e, -0.2, 0.4, 0);      // 折叠模块
  mod1.rotation.z = 0.12; g.add(mod1);
  const mod2 = box(0.3, 0.14, 0.52, a, -0.44, 0.44, 0, { em: a, emi: 0.2 });
  mod2.rotation.z = 0.25; g.add(mod2);
  g.add(wheels(8, 0.13, 0.09, [-0.42, -0.14, 0.14, 0.42], 0.32));
  return g;
}

// 幽灵武装无人机：四旋翼 + 机腹光电球
function ghost(side) {
  const a = ACCENT[side];
  const g = new THREE.Group();
  g.add(box(0.26, 0.09, 0.26, 0x2c343e, 0, 0, 0));
  g.add(box(0.1, 0.05, 0.1, a, 0.14, 0, 0, { em: a, emi: 0.4 })); // 机头识别灯
  g.add(sph(0.05, 0x111418, 0.1, -0.07, 0));                      // 光电吊舱
  const rotors = [];
  for (const [dx, dz] of [[1, 1], [1, -1], [-1, 1], [-1, -1]]) {
    g.add(box(0.24, 0.02, 0.04, 0x3c444e, dx * 0.17, 0.03, dz * 0.17));
    const r = cyl(0.13, 0.13, 0.008, 0x181c22, dx * 0.26, 0.07, dz * 0.26, { alpha: 0.75 });
    rotors.push(r); g.add(r);
  }
  g.userData.rotors = rotors;
  return g;
}

// 死神察打一体无人机：固定翼 pusher 布局 + 阻力风向舵 + 挂载空地导弹 + 光电转塔
function reaper(side) {
  const h = HULL[side], a = ACCENT[side];
  const g = new THREE.Group();
  g.add(cyl(0.045, 0.06, 0.55, 0xdde2e8, 0, 0, 0, { rz: -Math.PI / 2 })); // 机身（银灰复合材料）
  g.add(sph(0.05, 0x9aa2ab, 0.28, 0, 0));                        // 卫星通信鼓包
  g.add(box(0.2, 0.02, 0.62, 0xc4cad2, -0.02, 0.02, 0));         // 平直主翼
  const wingL = box(0.2, 0.02, 0.18, 0xc4cad2, -0.14, 0.02, 0.28); // 外翼段后掠
  wingL.rotation.y = 0.35; g.add(wingL);
  const wingR = box(0.2, 0.02, 0.18, 0xc4cad2, -0.14, 0.02, -0.28);
  wingR.rotation.y = -0.35; g.add(wingR);
  // V 形尾翼
  for (const s of [-1, 1]) {
    const fin = box(0.12, 0.02, 0.14, 0xc4cad2, -0.26, 0.06, s * 0.07);
    fin.rotation.x = s * 0.7; fin.rotation.z = 0.3;
    g.add(fin);
  }
  const prop = cyl(0.09, 0.09, 0.015, 0x2c343e, -0.29, 0, 0, { rz: -Math.PI / 2, alpha: 0.5 }); // 尾推螺旋桨（旋转让模糊盘）
  g.add(prop);
  const turret = new THREE.Group(); turret.position.set(0.2, -0.07, 0);
  turret.add(sph(0.05, 0x111418, 0, 0, 0));                      // 光电转塔
  turret.add(box(0.03, 0.02, 0.03, a, 0.02, 0.03, 0, { em: a, emi: 0.5 }));
  g.add(turret);
  // 翼下挂架：两枚地狱火
  for (const s of [-1, 1]) {
    g.add(box(0.03, 0.04, 0.02, 0x3c444e, 0.02, -0.03, s * 0.22));
    g.add(cyl(0.018, 0.018, 0.13, 0xdde2e8, 0.02, -0.07, s * 0.22, { rz: -Math.PI / 2 }));
    g.add(cone(0.018, 0.04, 0xc0392b, 0.1, -0.07, s * 0.22, { rz: -Math.PI / 2 }));
  }
  g.userData.turret = turret;
  return g;
}

// ================= 步兵 =================

function infantry(type, side) {
  const h = HULL[side];
  const g = new THREE.Group();
  g.add(box(0.1, 0.12, 0.09, DARK, 0, 0.06, 0));                  // 腿
  g.add(cyl(0.06, 0.075, 0.14, type === 'sniper' ? 0x2e3a2e : h, 0, 0.18, 0)); // 作战服（狙击手吉利布色）
  g.add(sph(0.055, type === 'engineer' ? 0xffd866 : type === 'sniper' ? 0x2e3a2e : h, 0, 0.3, 0)); // 头盔
  const yaw = new THREE.Group(); yaw.position.y = 0.2;
  if (type === 'rocket') yaw.add(cyl(0.03, 0.03, 0.26, 0x555f6a, 0.06, 0.06, 0, { rz: -Math.PI / 2.4 })); // 肩扛火箭筒
  else if (type === 'sniper') {                                   // 反器材狙击枪（长枪管+瞄具+两脚架）
    yaw.add(box(0.34, 0.02, 0.02, 0x1a1e24, 0.17, 0.03, 0));
    yaw.add(cyl(0.014, 0.014, 0.05, 0x0d1015, 0.12, 0.06, 0, { rz: -Math.PI / 2 })); // 瞄具
    yaw.add(box(0.02, 0.06, 0.01, 0x1a1e24, 0.26, -0.01, 0));
  }
  else if (type === 'rifle') yaw.add(box(0.2, 0.025, 0.025, METAL, 0.1, 0.02, 0)); // 步枪
  else yaw.add(box(0.08, 0.06, 0.05, 0xffd866, 0.08, -0.04, 0));  // 工程师工具箱
  g.add(yaw);
  g.userData.turret = yaw;
  return g;
}

// ================= 建筑 =================

function slab(w, h, side) {
  const g = new THREE.Group();
  g.add(box(w * 0.94, 0.07, h * 0.94, 0xffffff, 0, 0.035, 0, { map: tex(skin('conc'), w * 0.7, h * 0.7) }));
  g.add(box(w * 0.94, 0.075, 0.1, ACCENT[side], 0, 0.036, h * 0.44, { em: ACCENT[side], emi: 0.35 }));
  return g;
}

const BUILDING_BUILDERS = {
  yard(side) {
    const g = slab(3, 3, side), h = HULL[side];
    g.add(box(1.7, 0.5, 1.7, 0xffffff, -0.3, 0.32, -0.3, { map: tex(skin('metal'), 1.6, 1) })); // 主厂房金属蒙皮
    g.add(box(1.2, 0.2, 1.2, 0x3c444e, -0.3, 0.66, -0.3));
    g.add(box(0.9, 0.3, 0.05, 0xffffff, -0.3, 0.22, 0.56, { map: tex(skin('haz'), 1.4, 0.5) })); // 警示条纹大门
    const crane = new THREE.Group(); crane.position.set(0.9, 0.07, 0.9);
    crane.add(cyl(0.07, 0.09, 1.15, 0xc8a03c, 0, 0.58, 0));       // 塔吊立柱
    crane.add(box(1.5, 0.07, 0.07, 0xc8a03c, 0.55, 1.12, 0));     // 吊臂
    crane.add(box(0.2, 0.14, 0.14, 0x3c444e, -0.28, 1.12, 0));    // 配重
    crane.add(box(0.1, 0.12, 0.1, METAL, 1.1, 0.9, 0));           // 吊钩
    g.add(crane);
    g.userData.spin = { obj: crane, speed: 0.15 };
    return g;
  },
  power(side) {
    const g = slab(2, 2, side), h = HULL[side];
    g.add(box(1.1, 0.42, 1.1, 0xffffff, 0, 0.28, 0.1, { map: tex(skin('conc'), 1.4, 0.8) })); // 汽轮机厂房
    for (const x of [-0.3, 0.3]) {
      g.add(cyl(0.13, 0.16, 0.85, 0x8a4a3a, x, 0.5, -0.5));       // 红砖烟囱
      g.add(cyl(0.14, 0.14, 0.05, 0x1a1e24, x, 0.94, -0.5));
    }
    g.userData.smokeStacks = [{ x: -0.3, y: 0.98, z: -0.5 }, { x: 0.3, y: 0.98, z: -0.5 }];
    return g;
  },
  npower(side) {
    const g = slab(3, 3, side), h = HULL[side];
    g.add(cyl(0.48, 0.62, 1.0, 0xb8bfc6, -0.5, 0.57, -0.5));      // 冷却塔
    g.add(cyl(0.5, 0.5, 0.06, 0x8a939c, -0.5, 1.08, -0.5));
    g.add(box(1.2, 0.5, 1.2, 0xffffff, 0.6, 0.32, 0.6, { map: tex(skin('conc'), 1.6, 1) })); // 反应堆厂房
    g.add(sph(0.3, 0xdde2e8, 0.6, 0.62, 0.6));                    // 安全壳穹顶
    g.userData.smokeStacks = [{ x: -0.5, y: 1.12, z: -0.5 }];     // 冷却塔蒸汽
    return g;
  },
  refinery(side) {
    const g = slab(3, 2, side), h = HULL[side];
    for (const x of [-0.8, 0, 0.8]) g.add(cyl(0.18, 0.18, 0.75, 0x9aa2ab, x, 0.45, -0.45)); // 储料罐
    const hopper = cone(0.35, 0.5, 0xc8a03c, -0.6, 0.5, 0.45);    // 卸矿斗
    hopper.rotation.x = Math.PI; g.add(hopper);
    g.add(box(1.6, 0.24, 0.6, 0xffffff, 0.2, 0.19, 0.45, { map: tex(skin('metal'), 2, 0.8) }));
    return g;
  },
  barracks(side) {
    const g = slab(2, 2, side), h = HULL[side];
    g.add(box(1.3, 0.42, 1.3, 0xffffff, 0, 0.28, 0, { map: tex(skin('conc'), 1.6, 1.2) })); // 营房
    g.add(box(1.34, 0.06, 1.34, 0xffffff, 0, 0.52, 0, { map: tex(skin('camo'), 1.2, 1.2) })); // 迷彩伪装网檐
    g.add(box(0.3, 0.3, 0.06, 0x1a1e24, 0, 0.22, 0.66));          // 大门
    g.add(cyl(0.02, 0.02, 0.7, 0x8a939c, 0.5, 0.42, 0.5));        // 旗杆
    g.add(box(0.22, 0.14, 0.01, ACCENT[side], 0.62, 0.68, 0.5, { em: ACCENT[side], emi: 0.4 }));
    return g;
  },
  factory(side) {
    const g = slab(3, 3, side), h = HULL[side];
    g.add(box(2.3, 0.5, 1.9, 0xffffff, 0, 0.32, 0, { map: tex(skin('metal'), 2.6, 1) })); // 主厂房
    for (const x of [-0.75, 0, 0.75]) {                           // 锯齿屋顶
      const tooth = box(0.55, 0.28, 1.9, 0x3c444e, x, 0.68, 0);
      tooth.rotation.z = 0.5; g.add(tooth);
    }
    g.add(box(0.8, 0.4, 0.06, 0xffffff, 0, 0.28, 0.96, { map: tex(skin('haz'), 1, 0.6) })); // 警示条纹大门
    return g;
  },
  radar(side) {
    const g = slab(2, 2, side), h = HULL[side];
    g.add(box(1.0, 0.3, 1.0, 0xffffff, 0, 0.22, 0, { map: tex(skin('metal'), 1.2, 1.2) }));
    g.add(cyl(0.08, 0.1, 0.5, 0x8a939c, 0, 0.6, 0));
    const dish = new THREE.Group(); dish.position.set(0, 0.9, 0);
    const bowl = sph(0.42, 0xdde2e8, 0, 0, 0);                    // 抛物面天线
    bowl.scale.y = 0.45; dish.add(bowl);
    dish.add(box(0.04, 0.3, 0.04, METAL, 0.35, 0.1, 0));
    dish.rotation.z = -0.5;
    g.add(dish);
    g.userData.spin = { obj: dish, speed: 1.2 };
    return g;
  },
  laser(side) {
    const g = slab(1, 1, side);
    g.add(cyl(0.3, 0.38, 0.28, 0xffffff, 0, 0.2, 0, { map: tex(skin('metal'), 1, 0.6) })); // 装甲基座
    const crystal = oct(0.17, 0x7df9ff, 0, 0.55, 0, { em: 0x7df9ff, emi: 1.8 }); // 激光棱镜
    g.add(crystal);
    g.userData.bob = { obj: crystal, y: 0.55 };
    return g;
  },
  sam(side) {
    const g = slab(1, 1, side);
    g.add(box(0.7, 0.18, 0.7, 0xffffff, 0, 0.16, 0, { map: tex(skin('metal'), 1, 1) }));
    for (const [dx, dz] of [[-0.13, -0.13], [-0.13, 0.13], [0.13, -0.13], [0.13, 0.13]]) {
      const t = cyl(0.07, 0.07, 0.5, 0xdde2e8, dx, 0.42, dz);     // 四联发射筒
      t.rotation.x = dz * 0.7; t.rotation.z = -dx * 0.7;
      g.add(t);
      g.add(cone(0.07, 0.1, 0xc0392b, dx - dx * 0.24, 0.64, dz - dz * 0.24));
    }
    return g;
  },
  railgun(side) {
    const g = slab(1, 1, side);
    g.add(box(0.7, 0.22, 0.7, 0xffffff, 0, 0.18, 0, { map: tex(skin('metal'), 1, 1) }));
    const tur = new THREE.Group(); tur.position.set(-0.1, 0.34, 0);
    for (const s of [-1, 1]) {                                    // 双导轨
      const rail = box(0.85, 0.05, 0.05, METAL, 0.3, 0.08, s * 0.09);
      rail.rotation.z = 0.28; tur.add(rail);
    }
    const core = box(0.7, 0.02, 0.06, 0xffb347, 0.3, 0.08, 0, { em: 0xffb347, emi: 1.2 });
    core.rotation.z = 0.28; tur.add(core);
    g.add(tur);
    g.userData.turret = tur;
    return g;
  },
};

// ================= 地表装饰（实例化用） =================

export function makeTree() {
  const g = new THREE.Group();
  g.add(cyl(0.03, 0.05, 0.22, 0x5a4326, 0, 0.11, 0));
  g.add(cone(0.2, 0.42, 0x1d3a1a, 0, 0.42, 0));
  g.add(cone(0.14, 0.3, 0x2c5b27, 0, 0.62, 0));
  return g;
}
// 阔叶树：圆冠，与松树混种增加自然感
export function makeTree2() {
  const g = new THREE.Group();
  g.add(cyl(0.035, 0.055, 0.24, 0x6a5030, 0, 0.12, 0));
  g.add(sph(0.17, 0x2e5a28, 0, 0.36, 0, { seg: 8 }));
  g.add(sph(0.12, 0x3c6e33, 0.08, 0.48, 0.05, { seg: 8 }));
  g.add(sph(0.1, 0x27501f, -0.09, 0.44, -0.06, { seg: 8 }));
  return g;
}

// ================= 战场道具（纯装饰，不占格） =================

// 弹药木箱
export function makeCrate() {
  const g = new THREE.Group();
  g.add(box(0.34, 0.26, 0.28, 0xffffff, 0, 0.13, 0, { map: tex(skin('planks'), 1, 1) }));
  g.add(box(0.36, 0.03, 0.3, 0x6a4e2c, 0, 0.06, 0));             // 竖向加固条
  g.add(box(0.36, 0.03, 0.3, 0x6a4e2c, 0, 0.22, 0));
  return g;
}
// 军绿油桶
export function makeBarrel() {
  const g = new THREE.Group();
  g.add(cyl(0.1, 0.1, 0.28, 0x5a6b4a, 0, 0.14, 0, { seg: 12 }));
  g.add(cyl(0.105, 0.105, 0.02, 0x3c4432, 0, 0.08, 0, { seg: 12 }));
  g.add(cyl(0.105, 0.105, 0.02, 0x3c4432, 0, 0.2, 0, { seg: 12 }));
  g.add(cyl(0.03, 0.03, 0.02, 0x2c343e, 0.05, 0.29, 0.03));
  return g;
}
// 沙袋掩体（3+2 叠层）
export function makeSandbags() {
  const g = new THREE.Group();
  const bag = (x, y, z) => {
    const b = sph(0.085, 0x9a8a62, x, y, z, { seg: 8 });
    b.scale.set(1.2, 0.5, 0.75);
    b.rotation.y = (Math.random() - 0.5) * 0.3;
    return b;
  };
  for (let i = 0; i < 3; i++) g.add(bag(-0.14 + i * 0.15, 0.05, 0));
  for (let i = 0; i < 2; i++) g.add(bag(-0.07 + i * 0.15, 0.13, 0.01));
  g.add(bag(0, 0.2, -0.01));
  return g;
}
export function makeRock() {
  const g = new THREE.Group();
  const r = new THREE.Mesh(new THREE.DodecahedronGeometry(0.2), mat(0x6a6a72, { rough: 0.95, metal: 0.05 }));
  r.position.y = 0.12; r.castShadow = true;
  g.add(r);
  return g;
}
export function makeOre() {
  const g = new THREE.Group();
  g.add(oct(0.13, 0xd4af37, 0, 0.12, 0, { em: 0xd4af37, emi: 0.5 }));
  g.add(oct(0.09, 0xe8c458, 0.12, 0.08, 0.06, { em: 0xe8c458, emi: 0.5 }));
  g.add(oct(0.08, 0xd4af37, -0.1, 0.07, 0.09, { em: 0xd4af37, emi: 0.5 }));
  return g;
}

// ================= 入口 =================

const UNIT_BUILDERS = { cheetah, tyrant, hunter, mlrs, longsword, aurora, reaper, harvester, mcv, ghost };

// 飞行单位悬停高度
const FLY_Y = { ghost: 1.05, reaper: 1.45 };
const INFANTRY = new Set(['rifle', 'rocket', 'sniper', 'engineer']);

export function buildUnitModel(type, side) {
  const g = (UNIT_BUILDERS[type] || (() => infantry(type, side)))(side);
  if (FLY_Y[type]) g.position.y = FLY_Y[type];
  if (!INFANTRY.has(type)) g.scale.setScalar(1.16); // 载具放大，剪影更有存在感
  return g;
}

export function buildBuildingModel(type, side) {
  const g = BUILDING_BUILDERS[type](side);
  // 建筑坐标对齐：模型中心在 footprint 中心
  return g;
}
