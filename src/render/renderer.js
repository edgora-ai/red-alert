// Three.js 3D 渲染器：透视相机 + HDR 后处理（Bloom/ACES/晕影/颗粒）+ 粒子特效 + 程序化环境
// 地表/迷雾为 Canvas 贴图（与 sim 瓦片同步），水面/天空为程序着色器，实体为真实 3D 网格

import * as THREE from '../../vendor/three.module.min.js';
import { T, UNITS, BUILDINGS } from '../config.js';
import { buildUnitModel, buildBuildingModel, makeTree, makeTree2, makeRock, makeOre, makeCrate, makeBarrel, makeSandbags, SIDE_COLORS } from './models.js';
import { PostFX } from './postfx.js';
import { Particles } from './particles.js';

export { SIDE_COLORS };

const TERRAIN = {
  grass: ['#41603f', '#3d5c3b', '#456644', '#3a5638'],
  ore: '#5f4d2e',
  rock: '#55565f',
  water: '#10283e',
};
const TOP_Y = { yard: 1.5, power: 1.2, npower: 1.35, refinery: 1.1, barracks: 1.0, factory: 1.2, radar: 1.4, laser: 1.0, sam: 1.0, railgun: 1.0 };
const FLY_Y = { ghost: 1.05, reaper: 1.45 }; // 与 models.js 保持一致

// 确定性哈希（地形纹理需要可复现的噪声）
function hash2(x, y, k = 0) {
  let h = (x * 374761393 + y * 668265263 + k * 1442695041) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}
// 双线性插值 value noise（平滑宏观色调，消除方块感）
function vnoise(x, y, k = 0) {
  const x0 = Math.floor(x), y0 = Math.floor(y);
  const s = t => t * t * (3 - 2 * t);
  const fx = s(x - x0), fy = s(y - y0);
  const a = hash2(x0, y0, k), b = hash2(x0 + 1, y0, k);
  const c = hash2(x0, y0 + 1, k), d = hash2(x0 + 1, y0 + 1, k);
  return a + (b - a) * fx + (c - a) * fy + (a - b - c + d) * fx * fy;
}

export class Renderer {
  constructor(canvas, world, camera, game) {
    this.cv = canvas;
    this.world = world;
    this.cam = camera;      // {x, y(目标点瓦片), dist, yaw}
    this.game = game;
    this.meshMap = new Map(); // id → {group, bar, ring, topY, kind, ...}
    this.boomLights = [];
    this.iconCache = new Map();
    this.lastFogTick = -1;
    this.lastT = performance.now();
    this.trauma = 0;        // 相机震动能量
    this.trailMap = new Map(); // 弹道对象 → 上一帧位置（烟迹用）

    // ?lowfx：低负载模式（弱机/无头验证），关阴影/后处理降分辨率
    const lowfx = new URLSearchParams(location.search).has('lowfx');
    this.lowfx = lowfx;
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: !lowfx });
    this.renderer.setPixelRatio(lowfx ? 1 : Math.min(window.devicePixelRatio || 1, 2));
    this.renderer.shadowMap.enabled = !lowfx;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.toneMapping = THREE.NoToneMapping; // 色调映射在后处理里做 ACES

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x0d1117);
    this.scene.fog = new THREE.FogExp2(0x93a8bc, 0.0042);

    this.cam3 = new THREE.PerspectiveCamera(45, 1, 0.1, 400);
    this.ray = new THREE.Raycaster();

    // 灯光：天空半球 + 平行光（投影）+ 相机侧补光
    this.scene.add(new THREE.HemisphereLight(0xbcd3ea, 0x3a4531, 0.9));
    this.scene.add(new THREE.AmbientLight(0x46525e, 0.32));
    this.fill = new THREE.DirectionalLight(0xbfd4e8, 0.45);
    this.scene.add(this.fill);
    this.sun = new THREE.DirectionalLight(0xfff0d8, 2.6);
    this.sun.castShadow = !lowfx;
    this.sun.shadow.mapSize.set(2048, 2048);
    this.sun.shadow.camera.left = this.sun.shadow.camera.bottom = -34;
    this.sun.shadow.camera.right = this.sun.shadow.camera.top = 34;
    this.sun.shadow.camera.far = 140;
    this.sun.shadow.camera.updateProjectionMatrix();
    this.sun.shadow.bias = -0.0006;
    this.sun.shadow.normalBias = 0.02;
    this.sunTarget = new THREE.Object3D();
    this.scene.add(this.sun, this.sunTarget);
    this.sun.target = this.sunTarget;

    this.buildSky();
    this.buildEnvironment();
    this.buildGround();
    this.buildWater();
    this.buildFogPlane();
    this.buildDeco();
    this.buildGhost();

    this.particles = new Particles(this.scene);
    this.particles.setCamera(this.cam3);
    this.postfx = new PostFX(this.renderer, lowfx);

    for (let i = 0; i < 6; i++) {
      const l = new THREE.PointLight(0xffaa55, 0, 14, 1.8);
      l.visible = false;
      this.scene.add(l);
      this.boomLights.push(l);
    }

    this.resize();
  }

  // ---------- 天空穹顶 ----------
  buildSky() {
    const mat = new THREE.ShaderMaterial({
      side: THREE.BackSide,
      depthWrite: false,
      fog: false,
      uniforms: { uSun: { value: new THREE.Vector3(0.45, 0.72, 0.2).normalize() } },
      vertexShader: /* glsl */`
        varying vec3 vDir;
        void main() {
          vDir = position;
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          gl_Position = projectionMatrix * mv;
        }`,
      fragmentShader: /* glsl */`
        uniform vec3 uSun;
        varying vec3 vDir;
        void main() {
          vec3 d = normalize(vDir);
          vec3 horizon = vec3(0.64, 0.74, 0.83);
          vec3 zenith = vec3(0.18, 0.32, 0.53);
          vec3 col = mix(horizon, zenith, pow(clamp(d.y, 0.0, 1.0), 0.6));
          // 地平线以下压暗成深灰蓝，避免地图边缘出现刺眼亮洞
          col = mix(vec3(0.09, 0.13, 0.18), col, smoothstep(-0.25, 0.02, d.y));
          float sd = max(dot(d, normalize(uSun)), 0.0);
          col += vec3(1.0, 0.85, 0.55) * (pow(sd, 400.0) * 1.6 + pow(sd, 10.0) * 0.22) * smoothstep(-0.1, 0.05, d.y);
          gl_FragColor = vec4(col, 1.0);
        }`,
    });
    this.sky = new THREE.Mesh(new THREE.SphereGeometry(260, 24, 14), mat);
    this.sky.frustumCulled = false;
    this.sky.renderOrder = -10;
    this.scene.add(this.sky);
  }

  // ---------- 环境反射（渐变天光 PMREM，赋予金属/漆面真实光泽） ----------
  buildEnvironment() {
    if (this.lowfx) return;
    try {
      const pmrem = new THREE.PMREMGenerator(this.renderer);
      const envScene = new THREE.Scene();
      const geo = new THREE.SphereGeometry(50, 20, 14);
      const pos = geo.attributes.position;
      const colors = new Float32Array(pos.count * 3);
      const zenith = new THREE.Color(0.2, 0.34, 0.56);
      const horizon = new THREE.Color(0.68, 0.77, 0.85);
      const ground = new THREE.Color(0.16, 0.18, 0.16);
      const c = new THREE.Color();
      for (let i = 0; i < pos.count; i++) {
        const y = pos.getY(i) / 50;
        if (y >= 0) c.copy(horizon).lerp(zenith, Math.pow(y, 0.7));
        else c.copy(horizon).lerp(ground, Math.min(1, -y * 2.5));
        colors[i * 3] = c.r; colors[i * 3 + 1] = c.g; colors[i * 3 + 2] = c.b;
      }
      geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
      envScene.add(new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.BackSide })));
      this.scene.environment = pmrem.fromScene(envScene, 0.04).texture;
      pmrem.dispose();
    } catch { /* 环境反射失败不影响渲染 */ }
  }

  // ---------- 地表（程序化军事地形贴图 v2） ----------
  buildGround() {
    const w = this.world;
    const px = 16, size = w.w * px;
    const cv = document.createElement('canvas');
    cv.width = cv.height = size;
    const c = cv.getContext('2d');
    const at = (tx, ty) => w.inBounds(tx, ty) ? w.tiles[w.idx(tx, ty)] : T.ROCK;

    for (let ty = 0; ty < w.h; ty++) {
      for (let tx = 0; tx < w.w; tx++) {
        const t = w.tiles[w.idx(tx, ty)];
        const x = tx * px, y = ty * px;
        const h0 = hash2(tx, ty), h1 = hash2(tx, ty, 7), h2 = hash2(tx, ty, 13);
        // 宏观色调起伏：双尺度平滑 value noise（无方块边缘）
        const macro = (vnoise(tx / 6.5, ty / 6.5, 3) - 0.5) * 0.13
          + (vnoise(tx / 2.6, ty / 2.6, 5) - 0.5) * 0.07;

        if (t === T.WATER) {
          c.fillStyle = TERRAIN.water;
          c.fillRect(x, y, px, px);
          continue;
        }
        if (t === T.ROCK) {
          c.fillStyle = TERRAIN.grass[0];
          c.fillRect(x, y, px, px);
          const g = 0.30 + h0 * 0.14 + macro;
          c.fillStyle = `rgb(${Math.floor(84 * g * 3.2)},${Math.floor(85 * g * 3.2)},${Math.floor(94 * g * 3.2)})`;
          c.fillRect(x, y, px, px);
          // 岩石裂纹与高光边
          c.strokeStyle = 'rgba(30,30,36,0.55)';
          c.lineWidth = 1;
          c.beginPath();
          c.moveTo(x + h1 * px, y);
          c.lineTo(x + ((h1 * 7) % 1) * px, y + px);
          c.stroke();
          c.fillStyle = 'rgba(200,205,215,0.16)';
          c.fillRect(x, y, px, 2);
        } else if (t === T.ORE) {
          c.fillStyle = TERRAIN.ore;
          c.fillRect(x, y, px, px);
          c.fillStyle = 'rgba(0,0,0,0.18)';
          if (h1 > 0.5) c.fillRect(x, y, px, px);
          // 金矿晶簇
          for (let k = 0; k < 4; k++) {
            const ox = hash2(tx, ty, 21 + k) * (px - 3), oy = hash2(tx, ty, 31 + k) * (px - 3);
            c.fillStyle = k % 2 ? '#d4af37' : '#e8c458';
            c.fillRect(x + ox, y + oy, 3, 3);
            c.fillStyle = 'rgba(255,224,138,0.9)';
            c.fillRect(x + ox + 1, y + oy + 1, 1, 1);
          }
        } else if (t === T.TREE) {
          c.fillStyle = TERRAIN.grass[(tx + ty) & 1];
          c.fillRect(x, y, px, px);
          c.fillStyle = 'rgba(20,34,16,0.5)';
          c.beginPath();
          c.arc(x + px / 2, y + px / 2, px * 0.44, 0, 7);
          c.fill();
        } else {
          // 草地：连续 value noise 调和双色（无瓦片棋盘感）+ 草叶纹理 + 尘斑
          const gn = Math.min(1, Math.max(0, vnoise(tx / 3.8, ty / 3.8, 9) + macro * 2));
          c.fillStyle = `rgb(${Math.round(56 + gn * 12)},${Math.round(84 + gn * 12)},${Math.round(52 + gn * 10)})`;
          c.fillRect(x, y, px, px);
          for (let k = 0; k < 5; k++) {
            const gx = x + hash2(tx, ty, 41 + k) * (px - 1);
            const gy = y + hash2(tx, ty, 51 + k) * (px - 1);
            c.fillStyle = k % 2 ? 'rgba(96,130,72,0.45)' : 'rgba(48,72,40,0.4)';
            c.fillRect(gx, gy, 1, 2);
          }
          if (h2 > 0.88) { // 干土斑
            c.fillStyle = 'rgba(122,102,66,0.3)';
            c.beginPath();
            c.arc(x + h1 * px, y + h0 * px, 2.5 + h2 * 2.4, 0, 7);
            c.fill();
          }
        }

        // 水岸沙边 / 岩脚土边（贴图融合，消除瓦片硬切感）
        if (t !== T.WATER) {
          const nearW = at(tx - 1, ty) === T.WATER || at(tx + 1, ty) === T.WATER || at(tx, ty - 1) === T.WATER || at(tx, ty + 1) === T.WATER;
          if (nearW) {
            c.fillStyle = 'rgba(148,128,86,0.4)';
            if (at(tx - 1, ty) === T.WATER) c.fillRect(x, y, 3, px);
            if (at(tx + 1, ty) === T.WATER) c.fillRect(x + px - 3, y, 3, px);
            if (at(tx, ty - 1) === T.WATER) c.fillRect(x, y, px, 3);
            if (at(tx, ty + 1) === T.WATER) c.fillRect(x, y + px - 3, px, 3);
          }
        }
      }
    }
    // 地图边缘压暗，聚焦战场
    const vg = c.createRadialGradient(size / 2, size / 2, size * 0.42, size / 2, size / 2, size * 0.74);
    vg.addColorStop(0, 'rgba(0,0,0,0)');
    vg.addColorStop(1, 'rgba(6,10,14,0.5)');
    c.fillStyle = vg;
    c.fillRect(0, 0, size, size);

    const tex = new THREE.CanvasTexture(cv);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = 4;
    const geo = new THREE.PlaneGeometry(w.w, w.h);
    const ground = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ map: tex, roughness: 0.96, metalness: 0 }));
    ground.rotation.x = -Math.PI / 2;
    ground.position.set(w.w / 2, 0, w.h / 2);
    ground.receiveShadow = true;
    this.scene.add(ground);
    // 地图外圈暗色海洋/虚空，避免边缘露出生硬底色
    const surround = new THREE.Mesh(
      new THREE.PlaneGeometry(900, 900),
      new THREE.MeshStandardMaterial({ color: 0x1a2830, roughness: 1 }),
    );
    surround.rotation.x = -Math.PI / 2;
    surround.position.set(w.w / 2, -0.08, w.h / 2);
    this.scene.add(surround);
  }

  // ---------- 动态水面（程序波光着色器） ----------
  buildWater() {
    const w = this.world;
    const pos = [], idx = [];
    let n = 0;
    for (let ty = 0; ty < w.h; ty++) {
      for (let tx = 0; tx < w.w; tx++) {
        if (w.tiles[w.idx(tx, ty)] !== T.WATER) continue;
        const x0 = tx, z0 = ty, x1 = tx + 1, z1 = ty + 1;
        pos.push(x0, 0.03, z0, x1, 0.03, z0, x1, 0.03, z1, x0, 0.03, z1);
        idx.push(n, n + 2, n + 1, n, n + 3, n + 2);
        n += 4;
      }
    }
    if (!n) return;
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.setIndex(idx);
    const mat = new THREE.ShaderMaterial({
      fog: true,
      uniforms: THREE.UniformsUtils.merge([THREE.UniformsLib.fog, { uTime: { value: 0 } }]),
      vertexShader: /* glsl */`
        varying vec2 vP;
        #include <fog_pars_vertex>
        void main() {
          vP = position.xz;
          vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
          gl_Position = projectionMatrix * mvPosition;
          #include <fog_vertex>
        }`,
      fragmentShader: /* glsl */`
        uniform float uTime;
        varying vec2 vP;
        #include <fog_pars_fragment>
        void main() {
          float n = sin(vP.x * 1.9 + uTime * 1.2) * sin(vP.y * 1.6 - uTime * 0.9);
          n += 0.55 * sin(vP.x * 4.1 - uTime * 1.7) * sin(vP.y * 3.3 + uTime * 1.4);
          n += 0.30 * sin((vP.x + vP.y) * 6.0 + uTime * 2.2);
          vec3 col = mix(vec3(0.045, 0.115, 0.20), vec3(0.115, 0.26, 0.38), smoothstep(-0.9, 1.4, n));
          col += smoothstep(0.95, 1.3, n) * vec3(0.28, 0.40, 0.48) * 0.55; // 波尖高光
          gl_FragColor = vec4(col, 1.0);
          #include <fog_fragment>
        }`,
    });
    const water = new THREE.Mesh(geo, mat);
    water.renderOrder = 1;
    this.waterMat = mat;
    this.scene.add(water);
  }

  buildFogPlane() {
    const w = this.world;
    this.fogCv = document.createElement('canvas');
    this.fogCv.width = this.fogCv.height = w.w; // 1px/瓦片，线性放大即可
    this.fogTex = new THREE.CanvasTexture(this.fogCv);
    const mat = new THREE.MeshBasicMaterial({ map: this.fogTex, transparent: true, depthWrite: false });
    const plane = new THREE.Mesh(new THREE.PlaneGeometry(w.w, w.h), mat);
    plane.rotation.x = -Math.PI / 2;
    plane.position.set(w.w / 2, 0.05, w.h / 2);
    plane.renderOrder = 4;
    this.scene.add(plane);
  }

  updateFogTexture() {
    const w = this.world;
    const c = this.fogCv.getContext('2d');
    const img = c.createImageData(w.w, w.h);
    for (let i = 0; i < w.fog.length; i++) {
      const f = w.fog[i];
      img.data[i * 4 + 3] = f === 2 ? 0 : f === 1 ? 118 : 246;
    }
    c.putImageData(img, 0, 0);
    this.fogTex.needsUpdate = true;
  }

  // ---------- 地表装饰（实例化，两类树增加自然感） ----------
  buildDeco() {
    const w = this.world;
    const trees = [], trees2 = [], rocks = [], ores = [];
    for (let ty = 0; ty < w.h; ty++)
      for (let tx = 0; tx < w.w; tx++) {
        const t = w.tiles[w.idx(tx, ty)];
        const seed = (tx * 131 + ty * 197) % 100 / 100;
        if (t === T.TREE) {
          (seed > 0.45 ? trees2 : trees).push({ x: tx + 0.3 + seed * 0.4, z: ty + 0.3 + ((seed * 53) % 1) * 0.4, s: 0.8 + seed * 0.5, r: seed * 6.28 });
        }
        else if (t === T.ROCK) rocks.push({ x: tx + 0.5, z: ty + 0.5, s: 0.7 + seed * 0.7, r: seed * 6.28 });
        else if (t === T.ORE && seed > 0.4) ores.push({ x: tx + 0.3 + seed * 0.4, z: ty + 0.3 + ((seed * 53) % 1) * 0.4, s: 0.7 + seed * 0.6, r: seed * 6.28 });
      }
    const dummy = new THREE.Object3D();
    const inst = (model, list) => {
      if (!list.length) return;
      const meshes = [];
      model.traverse(m => { if (m.isMesh) meshes.push(m); });
      for (const src of meshes) {
        const im = new THREE.InstancedMesh(src.geometry, src.material, list.length);
        im.castShadow = true;
        list.forEach((p, i) => {
          dummy.position.set(p.x, 0, p.z);
          dummy.scale.setScalar(p.s);
          dummy.rotation.set(0, p.r, 0);
          dummy.updateMatrix();
          // 保留部件在模型内的相对位置
          const local = new THREE.Matrix4().compose(src.position, src.quaternion, src.scale);
          im.setMatrixAt(i, dummy.matrix.clone().multiply(local));
        });
        this.scene.add(im);
      }
    };
    inst(makeTree(), trees);
    inst(makeTree2(), trees2);
    inst(makeRock(), rocks);
    inst(makeOre(), ores);
    // 战场道具：弹药箱/油桶/沙袋点缀开阔地（纯装饰）
    const props = [[], [], []];
    for (let ty = 2; ty < w.h - 2; ty++)
      for (let tx = 2; tx < w.w - 2; tx++) {
        if (w.tiles[w.idx(tx, ty)] !== T.GRASS) continue;
        if (tx < 26 && ty > 70) continue;   // 玩家出生区
        if (tx > 70 && ty < 26) continue;   // 敌方出生区
        const seed = hash2(tx, ty, 99);
        if (seed > 0.99 && seed <= 0.994) props[0].push({ x: tx + 0.3 + seed * 0.4, z: ty + 0.3 + ((seed * 53) % 1) * 0.4, s: 1, r: seed * 6.28 });
        else if (seed > 0.994 && seed <= 0.997) props[1].push({ x: tx + 0.35 + (seed * 7 % 1) * 0.3, z: ty + 0.35 + ((seed * 71) % 1) * 0.3, s: 1, r: seed * 6.28 });
        else if (seed > 0.985 && seed <= 0.99) props[2].push({ x: tx + 0.5, z: ty + 0.5, s: 1, r: (seed * 100) % 6.28 });
      }
    inst(makeCrate(), props[0]);
    inst(makeBarrel(), props[1]);
    inst(makeSandbags(), props[2]);
  }

  // ---------- 放置幽灵 ----------
  buildGhost() {
    this.ghostBox = new THREE.Mesh(
      new THREE.BoxGeometry(1, 0.5, 1),
      new THREE.MeshBasicMaterial({ color: 0x50ff78, transparent: true, opacity: 0.26, depthWrite: false }),
    );
    this.ghostEdge = new THREE.LineSegments(
      new THREE.EdgesGeometry(new THREE.BoxGeometry(1, 0.5, 1)),
      new THREE.LineBasicMaterial({ color: 0x50ff78 }),
    );
    this.ghostBox.visible = this.ghostEdge.visible = false;
    this.scene.add(this.ghostBox, this.ghostEdge);
  }

  // ---------- 实体同步 ----------
  syncEntities() {
    const w = this.world;
    const now = performance.now();
    const seen = new Set();
    for (const e of w.entities.values()) {
      seen.add(e.id);
      let rec = this.meshMap.get(e.id);
      if (!rec) {
        const group = e.kind === 'unit' ? buildUnitModel(e.type, e.side) : buildBuildingModel(e.type, e.side);
        rec = {
          group, kind: e.kind,
          topY: e.kind === 'building' ? (TOP_Y[e.type] ?? 1) : (e.type === 'ghost' ? 1.6 : 0.65),
          bar: null, chev: null, ring: null, lastHp: -1, lastLevel: -1,
          r: e.kind === 'building' ? Math.max(e.w, e.h) * 0.62 : 0.5,
          baseY: FLY_Y[e.type] || 0,
          born: now, dustT: 0, smokeT: 0,
        };
        group.position.set(e.x, rec.baseY, e.y);
        this.scene.add(group);
        this.meshMap.set(e.id, rec);
        if (e.kind === 'building') {
          group.scale.y = 0.05; // 出生起立动画
          this.particles.buildDust(e.x, e.y, Math.max(e.w, e.h) * 0.55);
        }
      }
      const ud = rec.group.userData;
      const dt = this.frameDt;

      // 建筑落成动画（0.5s 从地面立起）
      if (rec.kind === 'building' && rec.group.scale.y < 1) {
        rec.group.scale.y = Math.min(1, rec.group.scale.y + dt * 2.1);
      }
      const gy = FLY_Y[e.type] ? rec.baseY + Math.sin(now / 480 + e.id) * 0.09 : rec.baseY;
      rec.group.position.set(e.x, gy, e.y);
      if (e.kind === 'unit') rec.group.rotation.y = -e.dir;

      // 动画部件
      if (ud.rotors) for (const r of ud.rotors) r.rotation.y += dt * 34;
      if (ud.spin) ud.spin.obj.rotation.y += dt * ud.spin.speed;
      if (ud.bob) { ud.bob.obj.position.y = ud.bob.y + Math.sin(w.tickCount * 0.08) * 0.04; ud.bob.obj.rotation.y += dt; }
      if (ud.prism) ud.prism.rotation.y += dt * 2;
      if (ud.oreFill) ud.oreFill.visible = (e.load || 0) > 10;
      // 炮管后坐动画
      const barrels = ud.turret?.userData?.barrels;
      if (barrels) {
        const k = (e.recoil || 0) / 5;
        for (const b of barrels) b.position.x = (b.userData.baseX ?? 0) - k * 0.07;
      }
      // 建筑炮塔瞄准（轨道炮塔）
      if (ud.turret && e.kind === 'building' && e.weapon && e.dir !== undefined) {
        ud.turret.rotation.y = -e.dir;
      }

      // 移动扬尘
      if (e.kind === 'unit' && !UNITS[e.type]?.fly && e.path && (rec.dustT -= dt) <= 0) {
        rec.dustT = 0.12 + Math.random() * 0.1;
        this.particles.dust(e.x - Math.cos(e.dir) * 0.4, e.y - Math.sin(e.dir) * 0.4);
      }
      // 建筑烟囱
      if (ud.smokeStacks && (rec.smokeT -= dt) <= 0) {
        rec.smokeT = 0.28 + Math.random() * 0.2;
        for (const s of ud.smokeStacks) {
          const p = rec.group.localToWorld(new THREE.Vector3(s.x, s.y, s.z));
          this.particles.chimney(p.x, p.y, p.z);
        }
      }
      // 重伤建筑冒烟
      if (e.kind === 'building' && e.hp < e.maxHp * 0.45 && (rec.dmgSmokeT ??= 0) <= 0) {
        rec.dmgSmokeT = 0.18 + Math.random() * 0.2;
        this.particles.spawn({
          layer: 'smoke', x: e.x + (Math.random() - 0.5) * e.w * 0.6, y: rec.topY * 0.8, z: e.y + (Math.random() - 0.5) * e.h * 0.6,
          vy: 0.8, life: 1.1, size: 0.25, sizeEnd: 0.8, col0: 0x3c3a38, col1: 0x151312, alpha: 0.42, grav: -0.4,
        });
      }
      if (rec.dmgSmokeT !== undefined) rec.dmgSmokeT -= dt;

      // 受击闪白
      if (e.flash > 0) {
        this.flashEntity(rec, 0.5);
      } else if (rec.flashed) {
        this.flashEntity(rec, 0);
      }

      // 血条
      const sel = this.game.selection.has(e.id);
      if (e.hp < e.maxHp - 0.5 || sel) {
        if (!rec.bar) {
          const cv = document.createElement('canvas');
          cv.width = 64; cv.height = 10;
          const tex = new THREE.CanvasTexture(cv);
          const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthTest: false }));
          sp.scale.set(0.95, 0.15, 1);
          sp.renderOrder = 20;
          rec.bar = sp; rec.barCv = cv; rec.barTex = tex;
          rec.group.add(sp);
        }
        if (rec.lastHp !== Math.ceil(e.hp)) {
          rec.lastHp = Math.ceil(e.hp);
          const c = rec.barCv.getContext('2d');
          c.clearRect(0, 0, 64, 10);
          c.fillStyle = 'rgba(0,0,0,0.72)'; c.fillRect(0, 0, 64, 10);
          const ratio = Math.max(0, e.hp / e.maxHp);
          c.fillStyle = ratio > 0.5 ? '#7ee787' : ratio > 0.25 ? '#ffd866' : '#ff7b72';
          c.fillRect(1, 1, 62 * ratio, 8);
          c.fillStyle = SIDE_COLORS[e.side]; c.fillRect(0, 0, 3, 10);
          rec.barTex.needsUpdate = true;
        }
        rec.bar.position.y = rec.topY + 0.3;
        rec.bar.visible = true;
      } else if (rec.bar) rec.bar.visible = false;

      // 老兵军衔标志（金袖标）
      const lvl = e.level || 0;
      if (lvl > 0 && e.kind === 'unit') {
        if (rec.lastLevel !== lvl) {
          rec.lastLevel = lvl;
          if (!rec.chev) {
            const cv = document.createElement('canvas');
            cv.width = 30; cv.height = 16;
            rec.chevCv = cv;
            rec.chevTex = new THREE.CanvasTexture(cv);
            rec.chev = new THREE.Sprite(new THREE.SpriteMaterial({ map: rec.chevTex, depthTest: false }));
            rec.chev.scale.set(0.42, 0.22, 1);
            rec.chev.renderOrder = 20;
            rec.group.add(rec.chev);
          }
          const c = rec.chevCv.getContext('2d');
          c.clearRect(0, 0, 30, 16);
          c.fillStyle = 'rgba(8,10,12,0.66)';
          c.fillRect(1, 1, 28, 14);
          c.strokeStyle = '#ffc94d';
          c.lineWidth = 2;
          for (let i = 0; i < Math.min(3, lvl); i++) {
            const cx = 8 + i * 7;
            c.beginPath();
            c.moveTo(cx - 3, 10);
            c.lineTo(cx, 5);
            c.lineTo(cx + 3, 10);
            c.stroke();
          }
          rec.chevTex.needsUpdate = true;
        }
        rec.chev.position.y = rec.topY + 0.52;
        rec.chev.visible = true;
      } else if (rec.chev) rec.chev.visible = false;

      // 选中环（脉冲呼吸）
      if (sel && e.side === 'player') {
        if (!rec.ring) {
          const ring = new THREE.Mesh(
            new THREE.RingGeometry(0.85, 1, 32),
            new THREE.MeshBasicMaterial({ color: 0x7ee787, side: THREE.DoubleSide, transparent: true, depthWrite: false }),
          );
          ring.rotation.x = -Math.PI / 2;
          ring.renderOrder = 6;
          rec.ring = ring;
          this.scene.add(ring);
        }
        const pulse = 1 + Math.sin(now / 180 + e.id) * 0.05;
        rec.ring.scale.setScalar(rec.r * pulse);
        rec.ring.position.set(e.x, 0.06, e.y);
        rec.ring.material.opacity = 0.75 + Math.sin(now / 180 + e.id) * 0.2;
        rec.ring.visible = true;
      } else if (rec.ring) rec.ring.visible = false;
    }

    // 移除死亡实体
    for (const [id, rec] of this.meshMap) {
      if (seen.has(id)) continue;
      this.scene.remove(rec.group);
      if (rec.ring) this.scene.remove(rec.ring);
      rec.group.traverse(m => { if (m.isMesh) { m.geometry.dispose(); m.material.dispose?.(); } });
      this.meshMap.delete(id);
    }
  }

  flashEntity(rec, intensity) {
    rec.flashed = intensity > 0;
    rec.group.traverse(m => {
      if (!m.isMesh || !m.material || !m.material.emissive) return;
      if (m.userData._emi === undefined) {
        m.userData._emi = m.material.emissive.getHex();
        m.userData._emiI = m.material.emissiveIntensity ?? 1;
      }
      if (intensity > 0) {
        m.material.emissive.setHex(0xffffff);
        m.material.emissiveIntensity = intensity;
      } else {
        m.material.emissive.setHex(m.userData._emi);
        m.material.emissiveIntensity = m.userData._emiI;
      }
    });
  }

  // ---------- 弹道 ----------
  syncProjectiles() {
    const list = this.world.projectiles;
    // 弹体 mesh 池（炮弹亮球；导弹有烟迹跟随）
    if (!this.projPool) {
      this.projPool = [];
      const geo = new THREE.SphereGeometry(0.09, 8, 6);
      for (let i = 0; i < 80; i++) {
        const m = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color: 0xffd8a0 }));
        m.visible = false;
        this.scene.add(m);
        this.projPool.push(m);
      }
    }
    this.projPool.forEach((m, i) => {
      if (i < list.length) {
        const p = list[i];
        m.visible = true;
        m.position.set(p.x, 0.35, p.y);
      } else m.visible = false;
    });

    // 导弹烟迹：按位移补插粒子
    const live = new Set();
    for (const p of list) {
      live.add(p);
      const last = this.trailMap.get(p);
      if (last && this.frameDt > 0) {
        const d = Math.hypot(p.x - last.x, p.y - last.z);
        if (d > 0.28) {
          this.particles.trail((p.x + last.x) / 2, (p.y + last.z) / 2);
          this.particles.trail(p.x, p.y);
          this.trailMap.set(p, { x: p.x, z: p.y });
        }
      } else {
        this.trailMap.set(p, { x: p.x, z: p.y });
      }
    }
    for (const k of this.trailMap.keys()) if (!live.has(k)) this.trailMap.delete(k);
  }

  // ---------- 特效（sim fx → 粒子/光束网格/灯光/震屏） ----------
  syncFx() {
    const w = this.world;
    for (const f of w.fx) {
      f.ttl -= 1;
      const a = Math.max(0, f.ttl / f.max);
      if (f.type === 'boom') {
        if (!f._done) {
          f._done = true;
          this.particles.explosion(f.x, f.y, f.r);
          const light = this.boomLights.find(l => !l.visible);
          if (light) {
            light.position.set(f.x, 1.4, f.y);
            light.intensity = 14 * f.r;
            light.distance = 10 + f.r * 5;
            light.visible = true;
            light.userData.ttl = 0.3;
          }
          this.addShake(Math.min(0.55, f.r * 0.3));
        }
      } else if (f.type === 'muzzle') {
        if (!f._done) {
          f._done = true;
          this.particles.muzzle(f.x, f.y, f.dir, f.big);
          if (f.big) {
            const light = this.boomLights.find(l => !l.visible);
            if (light) {
              light.position.set(f.x, 0.6, f.y);
              light.intensity = 5;
              light.distance = 6;
              light.visible = true;
              light.userData.ttl = 0.09;
            }
          }
        }
      } else if (f.type === 'beam' || f.type === 'tracer') {
        if (!f._mesh) {
          const beam = f.type === 'beam';
          const col = new THREE.Color(f.color);
          const g = new THREE.Group();
          const core = new THREE.Mesh(
            new THREE.CylinderGeometry(beam ? 0.045 : 0.02, beam ? 0.045 : 0.02, 1, 6, 1, true),
            new THREE.MeshBasicMaterial({ color: f.color, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }),
          );
          core.userData.baseO = 1;
          g.add(core);
          if (beam) {
            const glow = new THREE.Mesh(
              new THREE.CylinderGeometry(0.13, 0.13, 1, 6, 1, true),
              new THREE.MeshBasicMaterial({ color: f.color, transparent: true, opacity: 0.3, blending: THREE.AdditiveBlending, depthWrite: false }),
            );
            glow.userData.baseO = 0.3;
            g.add(glow);
          }
          f._mesh = g;
          this.scene.add(g);
          const p1 = new THREE.Vector3(f.x1, 0.42, f.y1), p2 = new THREE.Vector3(f.x2, beam ? 0.5 : 0.35, f.y2);
          for (const child of g.children) this.stretchBetween(child, p1, p2);
          this.particles.impact(f.x2, f.y2, col.getHex());
        }
        for (const child of f._mesh.children) child.material.opacity = child.userData.baseO * a;
      }
    }
    // 清理已结束的特效
    for (let i = w.fx.length - 1; i >= 0; i--) {
      const f = w.fx[i];
      if (f.ttl <= 0) {
        if (f._mesh) {
          this.scene.remove(f._mesh);
          for (const child of f._mesh.children) { child.geometry.dispose(); child.material.dispose(); }
          f._mesh = null;
        }
        w.fx.splice(i, 1);
      }
    }
    // 爆炸灯衰减（秒级）
    for (const l of this.boomLights) {
      if (!l.visible) continue;
      if ((l.userData.ttl -= this.frameDt) <= 0) { l.visible = false; l.intensity = 0; }
      else l.intensity *= Math.pow(0.02, this.frameDt);
    }
  }

  stretchBetween(mesh, p1, p2) {
    const mid = p1.clone().add(p2).multiplyScalar(0.5);
    mesh.position.copy(mid);
    mesh.scale.y = p1.distanceTo(p2);
    mesh.lookAt(p2);
    mesh.rotateX(Math.PI / 2);
  }

  addShake(a) {
    if (!this.lowfx) this.trauma = Math.min(1, this.trauma + a);
  }

  // ---------- 标记/幽灵/集结 ----------
  syncHelpers() {
    const { game, world: w } = this;

    // 点击标记
    for (let i = game.markers.length - 1; i >= 0; i--) {
      const m = game.markers[i];
      if ((m.ttl -= 1) <= 0) {
        if (m._mesh) { this.scene.remove(m._mesh); m._mesh = null; }
        game.markers.splice(i, 1);
        continue;
      }
      if (!m._mesh) {
        m._mesh = new THREE.Mesh(
          new THREE.RingGeometry(0.2, 0.28, 24),
          new THREE.MeshBasicMaterial({ color: m.type === 'attack' ? 0xff7b72 : 0x7ee787, side: THREE.DoubleSide, transparent: true, depthWrite: false }),
        );
        m._mesh.rotation.x = -Math.PI / 2;
        m._mesh.position.set(m.x, 0.07, m.y);
        m._mesh.renderOrder = 6;
        this.scene.add(m._mesh);
      }
      const a = m.ttl / m.max;
      m._mesh.scale.setScalar(0.5 + (1 - a) * 1.6);
      m._mesh.material.opacity = a;
    }

    // 集结点航线（选中生产建筑时显示虚线航向 + 落点旗帜）
    const selProd = [...game.selection].map(id => w.entities.get(id))
      .find(e => e?.kind === 'building' && e.side === 'player' && e.rally);
    if (selProd) {
      if (!this.rallyLine) {
        const geo = new THREE.BufferGeometry();
        geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(6), 3));
        this.rallyLine = new THREE.Line(geo, new THREE.LineBasicMaterial({ color: 0x7ee787, transparent: true, opacity: 0.5 }));
        this.rallyLine.frustumCulled = false;
        this.rallyFlag = new THREE.Mesh(
          new THREE.ConeGeometry(0.14, 0.34, 4),
          new THREE.MeshBasicMaterial({ color: 0x7ee787, transparent: true, opacity: 0.9 }),
        );
        this.scene.add(this.rallyLine, this.rallyFlag);
      }
      const p = this.rallyLine.geometry.attributes.position;
      p.setXYZ(0, selProd.x, 0.12, selProd.y);
      p.setXYZ(1, selProd.rally.x, 0.12, selProd.rally.y);
      p.needsUpdate = true;
      this.rallyLine.visible = this.rallyFlag.visible = true;
      this.rallyFlag.position.set(selProd.rally.x, 0.28 + Math.sin(performance.now() / 260) * 0.05, selProd.rally.y);
      this.rallyFlag.rotation.y = performance.now() / 600;
    } else if (this.rallyLine) {
      this.rallyLine.visible = this.rallyFlag.visible = false;
    }

    // 放置幽灵（呼吸闪烁）
    const item = w.sides.player.placing;
    if (item && game.mouseTile) {
      const def = BUILDINGS[item];
      const ok = w.canPlace('player', item, game.mouseTile.tx, game.mouseTile.ty);
      const color = ok ? 0x50ff78 : 0xff5050;
      const blink = 0.22 + Math.sin(performance.now() / 160) * 0.08;
      this.ghostBox.material.color.setHex(color);
      this.ghostEdge.material.color.setHex(color);
      this.ghostBox.material.opacity = blink;
      this.ghostBox.scale.set(def.w, 1, def.h);
      this.ghostEdge.scale.set(def.w, 1, def.h);
      const cx = game.mouseTile.tx + def.w / 2, cy = game.mouseTile.ty + def.h / 2;
      this.ghostBox.position.set(cx, 0.25, cy);
      this.ghostEdge.position.set(cx, 0.25, cy);
      this.ghostBox.visible = this.ghostEdge.visible = true;
    } else {
      this.ghostBox.visible = this.ghostEdge.visible = false;
    }
  }

  // ---------- 相机 ----------
  updateCamera() {
    const { x, y, dist, yaw } = this.cam;
    const px = x + Math.sin(yaw) * dist * 0.62;
    const pz = y + Math.cos(yaw) * dist * 0.62;
    this.cam3.position.set(px, dist * 0.8, pz);
    this.cam3.lookAt(x, 0, y);
    // 震动：衰减的噪声偏移 + 滚转
    this.trauma = Math.max(0, this.trauma - this.frameDt * 1.7);
    if (this.trauma > 0) {
      const sh = this.trauma * this.trauma;
      const t = performance.now() / 1000;
      this.cam3.position.x += (Math.sin(t * 61) * 0.6 + Math.sin(t * 47.3) * 0.4) * sh * 0.55;
      this.cam3.position.z += (Math.sin(t * 53.7 + 2) * 0.6 + Math.sin(t * 39.1) * 0.4) * sh * 0.55;
      this.cam3.position.y += Math.sin(t * 71.3) * sh * 0.3;
      this.cam3.rotateZ(Math.sin(t * 44.6) * sh * 0.018);
    }
    // 阳光跟随目标，保证阴影范围覆盖视野
    this.sun.position.set(x + 18, 30, y + 8);
    this.sunTarget.position.set(x, 0, y);
    // 补光从相机侧打过来，避免背光面死黑
    this.fill.position.set(px, 20, pz);
    // 天空穹顶跟随相机
    this.sky.position.copy(this.cam3.position);
    if (this.waterMat) this.waterMat.uniforms.uTime.value += this.frameDt;
  }

  screenToTile(px, py) {
    const ndc = new THREE.Vector2((px / this.vw) * 2 - 1, -(py / this.vh) * 2 + 1);
    this.ray.setFromCamera(ndc, this.cam3);
    const o = this.ray.ray.origin, d = this.ray.ray.direction;
    if (Math.abs(d.y) < 1e-6) return { x: 0, y: 0 };
    const t = -o.y / d.y;
    return { x: o.x + d.x * t, y: o.z + d.z * t };
  }

  // ---------- 3D 图标快照（建造栏用） ----------
  getItemIcon(item) {
    if (this.iconCache.has(item)) return this.iconCache.get(item);
    if (!this.iconR) {
      this.iconR = new THREE.WebGLRenderer({ antialias: true, alpha: true });
      this.iconR.setSize(128, 96);
      this.iconScene = new THREE.Scene();
      this.iconScene.add(new THREE.HemisphereLight(0x8fb8d8, 0x2a3328, 1.1));
      const key = new THREE.DirectionalLight(0xfff2dd, 2.2);
      key.position.set(2, 3, 1.5);
      this.iconScene.add(key);
      const rim = new THREE.DirectionalLight(0x7fb8ff, 1.1);
      rim.position.set(-2, 1, -2);
      this.iconScene.add(rim);
      this.iconCam = new THREE.PerspectiveCamera(40, 128 / 96, 0.1, 50);
    }
    const def = UNITS[item] || BUILDINGS[item];
    const model = UNITS[item] ? buildUnitModel(item, 'player') : buildBuildingModel(item, 'player');
    const span = UNITS[item] ? 1.1 : Math.max(def.w, def.h) * 0.85 + 0.4;
    const d = span * 2.1;
    this.iconCam.position.set(d * 0.75, d * 0.62, d * 0.75);
    this.iconCam.lookAt(0, span * 0.2, 0);
    this.iconScene.add(model);
    this.iconR.render(this.iconScene, this.iconCam);
    const url = this.iconR.domElement.toDataURL();
    this.iconScene.remove(model);
    model.traverse(m => { if (m.isMesh) { m.geometry.dispose(); m.material.dispose?.(); } });
    this.iconCache.set(item, url);
    return url;
  }

  // ---------- 主渲染 ----------
  render() {
    const now = performance.now();
    this.frameDt = Math.min(0.1, (now - this.lastT) / 1000);
    this.lastT = now;

    this.syncEntities();
    this.syncProjectiles();
    this.syncFx();
    this.syncHelpers();
    this.particles.update(this.frameDt);
    if (this.world.tickCount !== this.lastFogTick && this.world.tickCount % 6 === 0) {
      this.lastFogTick = this.world.tickCount;
      this.updateFogTexture();
    }
    this.updateCamera();
    // 场景渲入离屏 HDR 目标，后处理链合成到屏幕（lowfx 时直接上屏）
    const rt = this.postfx.begin();
    this.renderer.setRenderTarget(rt);
    this.renderer.render(this.scene, this.cam3);
    this.renderer.setRenderTarget(null);
    this.postfx.end(now / 1000);
  }

  resize() {
    const w = this.cv.clientWidth, h = this.cv.clientHeight;
    this.vw = w; this.vh = h;
    this.renderer.setSize(w, h, false);
    this.cam3.aspect = w / h;
    this.cam3.updateProjectionMatrix();
    this.postfx?.resize(w * this.renderer.getPixelRatio(), h * this.renderer.getPixelRatio());
    this.particles?.setViewScale(h * this.renderer.getPixelRatio(), 45);
  }
}
