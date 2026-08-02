// 低多边形军事装备模型库：用基础几何体拼装，军迷一眼能认
// 所有模型以原点为中心、y=0 落地、车头朝 +x；1 单位 = 1 瓦片

import * as THREE from '../../vendor/three.module.min.js';

// 阵营涂装：玩家藏青钢 / 红军锈红钢，炮塔顶部与细节用阵营亮色
export const SIDE_COLORS = { player: '#4da3ff', enemy: '#ff5545' };
const HULL = { player: 0x3a5f82, enemy: 0x7d3d33 };
const ACCENT = { player: 0x4da3ff, enemy: 0xff5545 };
const DARK = 0x22262b;   // 履带/轮胎
const METAL = 0x3a4048;  // 炮管等深色金属

function mat(color, o = {}) {
  return new THREE.MeshStandardMaterial({
    color, roughness: o.rough ?? 0.55, metalness: o.metal ?? 0.15,
    emissive: o.em ?? 0x000000, emissiveIntensity: o.emi ?? 1,
    transparent: o.alpha !== undefined, opacity: o.alpha ?? 1,
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
// 沿 +x 的炮管
function barrel(len, r, x, y, z) {
  const g = new THREE.Group();
  g.add(cyl(r * 0.85, r, len, METAL, 0, 0, 0, { rz: -Math.PI / 2 }));
  g.add(cyl(r * 1.4, r * 1.4, len * 0.14, DARK, len * 0.46, 0, 0, { rz: -Math.PI / 2 })); // 炮口制退器
  g.position.set(x, y, z);
  return g;
}
function wheels(n, r, width, xs, z) {
  const g = new THREE.Group();
  for (const x of xs) for (const s of [-1, 1])
    g.add(cyl(r, r, width, DARK, x, r, s * z, { rx: Math.PI / 2, seg: 10 }));
  return g;
}

// ================= 车辆 =================

// 猎豹II 主战坦克：斜首装甲 + 单人炮塔 + 长滑膛炮
function cheetah(side) {
  const h = HULL[side], a = ACCENT[side];
  const g = new THREE.Group();
  for (const s of [-1, 1]) {
    g.add(box(0.78, 0.15, 0.15, DARK, 0, 0.09, s * 0.25));       // 履带
    g.add(box(0.72, 0.09, 0.02, h, -0.02, 0.2, s * 0.33));       // 侧裙板
  }
  g.add(box(0.72, 0.13, 0.38, h, 0, 0.2, 0));                    // 车车体
  const glacis = box(0.18, 0.12, 0.36, h, 0.38, 0.19, 0);        // 首上斜甲
  glacis.rotation.z = -0.55; g.add(glacis);
  const tur = new THREE.Group(); tur.position.set(-0.04, 0.3, 0);
  tur.add(box(0.36, 0.11, 0.3, h, 0, 0.02, 0));
  tur.add(box(0.2, 0.03, 0.2, a, -0.03, 0.09, 0, { em: a, emi: 0.25 })); // 阵营识别板
  tur.add(barrel(0.58, 0.028, 0.2, 0.04, 0));                    // 125mm 滑膛炮
  tur.add(box(0.06, 0.05, 0.06, METAL, -0.16, 0.08, 0));         // 车长周视镜
  g.add(tur);
  g.userData.turret = tur;
  return g;
}

// 暴君重型坦克：加宽车体 + 双联 152mm 重炮
function tyrant(side) {
  const h = HULL[side], a = ACCENT[side];
  const g = new THREE.Group();
  for (const s of [-1, 1]) {
    g.add(box(0.92, 0.17, 0.18, DARK, 0, 0.1, s * 0.3));
    g.add(box(0.86, 0.1, 0.02, h, -0.02, 0.23, s * 0.4));
  }
  g.add(box(0.86, 0.16, 0.46, h, 0, 0.23, 0));
  const glacis = box(0.2, 0.15, 0.44, h, 0.44, 0.22, 0);
  glacis.rotation.z = -0.5; g.add(glacis);
  const tur = new THREE.Group(); tur.position.set(-0.06, 0.35, 0);
  tur.add(box(0.44, 0.13, 0.36, h, 0, 0.02, 0));
  tur.add(box(0.24, 0.03, 0.24, a, -0.05, 0.1, 0, { em: a, emi: 0.25 }));
  tur.add(barrel(0.62, 0.032, 0.24, 0.05, -0.08));               // 双联重炮
  tur.add(barrel(0.62, 0.032, 0.24, 0.05, 0.08));
  g.add(tur);
  g.userData.turret = tur;
  return g;
}

// 猎手弹炮合一：六轮装甲车 + 双肩导弹箱
function hunter(side) {
  const h = HULL[side], a = ACCENT[side];
  const g = new THREE.Group();
  g.add(box(0.66, 0.2, 0.4, h, 0, 0.22, 0));
  const nose = box(0.14, 0.14, 0.36, h, 0.38, 0.2, 0);
  nose.rotation.z = -0.45; g.add(nose);
  g.add(wheels(6, 0.09, 0.06, [-0.24, 0, 0.24], 0.23));
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

// ================= 步兵 =================

function infantry(type, side) {
  const h = HULL[side];
  const g = new THREE.Group();
  g.add(box(0.1, 0.12, 0.09, DARK, 0, 0.06, 0));                  // 腿
  g.add(cyl(0.06, 0.075, 0.14, h, 0, 0.18, 0));                   // 作战服
  g.add(sph(0.055, type === 'engineer' ? 0xffd866 : h, 0, 0.3, 0)); // 头盔（工程师黄色）
  const yaw = new THREE.Group(); yaw.position.y = 0.2;
  if (type === 'rocket') yaw.add(cyl(0.03, 0.03, 0.26, 0x555f6a, 0.06, 0.06, 0, { rz: -Math.PI / 2.4 })); // 肩扛火箭筒
  else if (type === 'rifle') yaw.add(box(0.2, 0.025, 0.025, METAL, 0.1, 0.02, 0)); // 步枪
  else yaw.add(box(0.08, 0.06, 0.05, 0xffd866, 0.08, -0.04, 0));  // 工程师工具箱
  g.add(yaw);
  g.userData.turret = yaw;
  return g;
}

// ================= 建筑 =================

function slab(w, h, side) {
  const g = new THREE.Group();
  g.add(box(w * 0.94, 0.07, h * 0.94, 0x2a2f36, 0, 0.035, 0));
  g.add(box(w * 0.94, 0.075, 0.1, ACCENT[side], 0, 0.036, h * 0.44, { em: ACCENT[side], emi: 0.35 }));
  return g;
}

const BUILDING_BUILDERS = {
  yard(side) {
    const g = slab(3, 3, side), h = HULL[side];
    g.add(box(1.7, 0.5, 1.7, h, -0.3, 0.32, -0.3));               // 主厂房
    g.add(box(1.2, 0.2, 1.2, 0x3c444e, -0.3, 0.66, -0.3));
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
    g.add(box(1.1, 0.42, 1.3, h, 0, 0.28, 0.1));                  // 汽轮机厂房
    for (const x of [-0.3, 0.3]) {
      g.add(cyl(0.13, 0.16, 0.85, 0x8a4a3a, x, 0.5, -0.5));       // 红砖烟囱
      g.add(cyl(0.14, 0.14, 0.05, 0x1a1e24, x, 0.94, -0.5));
    }
    return g;
  },
  npower(side) {
    const g = slab(3, 3, side), h = HULL[side];
    g.add(cyl(0.48, 0.62, 1.0, 0xb8bfc6, -0.5, 0.57, -0.5));      // 冷却塔
    g.add(cyl(0.5, 0.5, 0.06, 0x8a939c, -0.5, 1.08, -0.5));
    g.add(box(1.2, 0.5, 1.2, h, 0.6, 0.32, 0.6));                 // 反应堆厂房
    g.add(sph(0.3, 0xdde2e8, 0.6, 0.62, 0.6));                    // 安全壳穹顶
    return g;
  },
  refinery(side) {
    const g = slab(3, 2, side), h = HULL[side];
    for (const x of [-0.8, 0, 0.8]) g.add(cyl(0.18, 0.18, 0.75, 0x9aa2ab, x, 0.45, -0.45)); // 储料罐
    const hopper = cone(0.35, 0.5, 0xc8a03c, -0.6, 0.5, 0.45);    // 卸矿斗
    hopper.rotation.x = Math.PI; g.add(hopper);
    g.add(box(1.6, 0.24, 0.6, h, 0.2, 0.19, 0.45));
    return g;
  },
  barracks(side) {
    const g = slab(2, 2, side), h = HULL[side];
    g.add(box(1.3, 0.42, 1.3, h, 0, 0.28, 0));                    // 营房
    g.add(box(0.3, 0.3, 0.06, 0x1a1e24, 0, 0.22, 0.66));          // 大门
    g.add(cyl(0.02, 0.02, 0.7, 0x8a939c, 0.5, 0.42, 0.5));        // 旗杆
    g.add(box(0.22, 0.14, 0.01, ACCENT[side], 0.62, 0.68, 0.5, { em: ACCENT[side], emi: 0.4 }));
    return g;
  },
  factory(side) {
    const g = slab(3, 3, side), h = HULL[side];
    g.add(box(2.3, 0.5, 1.9, h, 0, 0.32, 0));                     // 主厂房
    for (const x of [-0.75, 0, 0.75]) {                           // 锯齿屋顶
      const tooth = box(0.55, 0.28, 1.9, 0x3c444e, x, 0.68, 0);
      tooth.rotation.z = 0.5; g.add(tooth);
    }
    g.add(box(0.8, 0.4, 0.06, 0x1a1e24, 0, 0.28, 0.96));          // 出厂大门
    return g;
  },
  radar(side) {
    const g = slab(2, 2, side), h = HULL[side];
    g.add(box(1.0, 0.3, 1.0, h, 0, 0.22, 0));
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
    g.add(cyl(0.3, 0.38, 0.28, 0x3c444e, 0, 0.2, 0));             // 装甲基座
    const crystal = oct(0.17, 0x7df9ff, 0, 0.55, 0, { em: 0x7df9ff, emi: 1.8 }); // 激光棱镜
    g.add(crystal);
    g.userData.bob = { obj: crystal, y: 0.55 };
    return g;
  },
  sam(side) {
    const g = slab(1, 1, side);
    g.add(box(0.7, 0.18, 0.7, 0x3c444e, 0, 0.16, 0));
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
    g.add(box(0.7, 0.22, 0.7, 0x3c444e, 0, 0.18, 0));
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

const UNIT_BUILDERS = { cheetah, tyrant, hunter, longsword, aurora, harvester, mcv, ghost };

export function buildUnitModel(type, side) {
  const g = (UNIT_BUILDERS[type] || (() => infantry(type, side)))(side);
  if (type === 'ghost') g.position.y = 1.05; // 无人机悬停高度
  return g;
}

export function buildBuildingModel(type, side) {
  const g = BUILDING_BUILDERS[type](side);
  // 建筑坐标对齐：模型中心在 footprint 中心
  return g;
}
