// Three.js 3D 渲染器：透视相机 + 光影 + 低多边形装备模型
// 地表/迷雾用 Canvas 贴图（与 sim 的瓦片数据同步），实体为真实 3D 网格

import * as THREE from '../../vendor/three.module.min.js';
import { T, UNITS, BUILDINGS } from '../config.js';
import { buildUnitModel, buildBuildingModel, makeTree, makeRock, makeOre, SIDE_COLORS } from './models.js';

export { SIDE_COLORS };

const TERRAIN_COLORS = {
  [T.GRASS]: ['#3d5c46', '#3a5844'],
  [T.ORE]: '#7d6836',
  [T.WATER]: '#234a70',
  [T.ROCK]: '#4a4a55',
  [T.TREE]: '#3d5c46',
};
const TOP_Y = { yard: 1.5, power: 1.2, npower: 1.35, refinery: 1.1, barracks: 1.0, factory: 1.2, radar: 1.4, laser: 1.0, sam: 1.0, railgun: 1.0 };

export class Renderer {
  constructor(canvas, world, camera, game) {
    this.cv = canvas;
    this.world = world;
    this.cam = camera;      // {x, y(目标点瓦片), dist, yaw}
    this.game = game;
    this.meshMap = new Map(); // id → {group, bar, ring, topY, kind}
    this.projPool = [];
    this.boomLights = [];
    this.iconCache = new Map();
    this.lastFogTick = -1;
    this.lastT = performance.now();

    // ?lowfx：低负载模式（弱机/无头验证），关阴影降分辨率
    const lowfx = new URLSearchParams(location.search).has('lowfx');
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: !lowfx });
    this.renderer.setPixelRatio(lowfx ? 1 : (window.devicePixelRatio || 1));
    this.renderer.shadowMap.enabled = !lowfx;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x0d1117);
    this.scene.fog = new THREE.FogExp2(0x0d1117, 0.007);

    this.cam3 = new THREE.PerspectiveCamera(45, 1, 0.1, 300);
    this.ray = new THREE.Raycaster();

    // 灯光：半球环境 + 平行光（投影）+ 相机侧补光
    this.scene.add(new THREE.HemisphereLight(0x9fc4e0, 0x35402f, 1.2));
    this.scene.add(new THREE.AmbientLight(0x405060, 0.5));
    this.fill = new THREE.DirectionalLight(0xbfd4e8, 0.7);
    this.scene.add(this.fill);
    this.sun = new THREE.DirectionalLight(0xfff2dd, 2.0);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(2048, 2048);
    this.sun.shadow.camera.left = this.sun.shadow.camera.bottom = -32;
    this.sun.shadow.camera.right = this.sun.shadow.camera.top = 32;
    this.sun.shadow.camera.far = 120;
    this.sunTarget = new THREE.Object3D();
    this.scene.add(this.sun, this.sunTarget);
    this.sun.target = this.sunTarget;

    this.buildGround();
    this.buildFogPlane();
    this.buildDeco();
    this.buildGhost();

    this.resize();
  }

  // ---------- 地表与迷雾 ----------
  buildGround() {
    const w = this.world;
    const px = 16, size = w.w * px;
    const cv = document.createElement('canvas');
    cv.width = cv.height = size;
    const c = cv.getContext('2d');
    for (let ty = 0; ty < w.h; ty++) {
      for (let tx = 0; tx < w.w; tx++) {
        const t = w.tiles[w.idx(tx, ty)];
        const x = tx * px, y = ty * px;
        if (t === T.ORE) {
          c.fillStyle = TERRAIN_COLORS[T.ORE];
          c.fillRect(x, y, px, px);
          c.fillStyle = '#e8c458';
          for (let k = 0; k < 3; k++) c.fillRect(x + ((tx * 7 + k * 5) % 12) + 2, y + ((ty * 5 + k * 7) % 12) + 2, 3, 3);
        } else if (t === T.WATER) {
          c.fillStyle = TERRAIN_COLORS[T.WATER];
          c.fillRect(x, y, px, px);
          c.fillStyle = '#2a557f';
          c.fillRect(x + 2, y + 7, 12, 2);
        } else if (t === T.ROCK) {
          c.fillStyle = TERRAIN_COLORS[T.GRASS][0]; c.fillRect(x, y, px, px);
          c.fillStyle = TERRAIN_COLORS[T.ROCK]; c.fillRect(x + 2, y + 2, 12, 12);
        } else {
          c.fillStyle = TERRAIN_COLORS[T.GRASS][(tx + ty) & 1];
          c.fillRect(x, y, px, px);
        }
      }
    }
    const tex = new THREE.CanvasTexture(cv);
    tex.colorSpace = THREE.SRGBColorSpace;
    const geo = new THREE.PlaneGeometry(w.w, w.h);
    const ground = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ map: tex, roughness: 0.95, metalness: 0 }));
    ground.rotation.x = -Math.PI / 2;
    ground.position.set(w.w / 2, 0, w.h / 2);
    ground.receiveShadow = true;
    this.scene.add(ground);
  }

  buildFogPlane() {
    const w = this.world;
    this.fogCv = document.createElement('canvas');
    this.fogCv.width = this.fogCv.height = w.w; // 1px/瓦片，线性放大即可
    this.fogTex = new THREE.CanvasTexture(this.fogCv);
    const mat = new THREE.MeshBasicMaterial({ map: this.fogTex, transparent: true, depthWrite: false });
    const plane = new THREE.Mesh(new THREE.PlaneGeometry(w.w, w.h), mat);
    plane.rotation.x = -Math.PI / 2;
    plane.position.set(w.w / 2, 0.03, w.h / 2);
    this.scene.add(plane);
  }

  updateFogTexture() {
    const w = this.world;
    const c = this.fogCv.getContext('2d');
    const img = c.createImageData(w.w, w.h);
    for (let i = 0; i < w.fog.length; i++) {
      const f = w.fog[i];
      img.data[i * 4 + 3] = f === 2 ? 0 : f === 1 ? 118 : 245;
    }
    c.putImageData(img, 0, 0);
    this.fogTex.needsUpdate = true;
  }

  // ---------- 地表装饰（实例化） ----------
  buildDeco() {
    const w = this.world;
    const trees = [], rocks = [], ores = [];
    for (let ty = 0; ty < w.h; ty++)
      for (let tx = 0; tx < w.w; tx++) {
        const t = w.tiles[w.idx(tx, ty)];
        const seed = (tx * 131 + ty * 197) % 100 / 100;
        if (t === T.TREE) trees.push({ x: tx + 0.5, z: ty + 0.5, s: 0.8 + seed * 0.5, r: seed * 6.28 });
        else if (t === T.ROCK) rocks.push({ x: tx + 0.5, z: ty + 0.5, s: 0.7 + seed * 0.7, r: seed * 6.28 });
        else if (t === T.ORE && seed > 0.4) ores.push({ x: tx + 0.3 + seed * 0.4, z: ty + 0.3 + ((seed * 53) % 1) * 0.4, s: 0.7 + seed * 0.6, r: seed * 6.28 });
      }
    const dummy = new THREE.Object3D();
    const inst = (model, list) => {
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
    inst(makeRock(), rocks);
    inst(makeOre(), ores);
  }

  // ---------- 放置幽灵 ----------
  buildGhost() {
    this.ghostBox = new THREE.Mesh(
      new THREE.BoxGeometry(1, 0.5, 1),
      new THREE.MeshBasicMaterial({ color: 0x50ff78, transparent: true, opacity: 0.3, depthWrite: false }),
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
    const seen = new Set();
    for (const e of w.entities.values()) {
      seen.add(e.id);
      let rec = this.meshMap.get(e.id);
      if (!rec) {
        const group = e.kind === 'unit' ? buildUnitModel(e.type, e.side) : buildBuildingModel(e.type, e.side);
        group.position.set(e.x, 0, e.y);
        this.scene.add(group);
        rec = {
          group, kind: e.kind,
          topY: e.kind === 'building' ? (TOP_Y[e.type] ?? 1) : (e.type === 'ghost' ? 1.6 : 0.65),
          bar: null, ring: null, lastHp: -1,
          r: e.kind === 'building' ? Math.max(e.w, e.h) * 0.62 : 0.5,
        };
        this.meshMap.set(e.id, rec);
      }
      rec.group.position.set(e.x, 0, e.y);
      if (e.kind === 'unit') rec.group.rotation.y = -e.dir;

      // 动画部件
      const ud = rec.group.userData;
      const dt = this.frameDt;
      if (ud.rotors) for (const r of ud.rotors) r.rotation.y += dt * 30;
      if (ud.spin) ud.spin.obj.rotation.y += dt * ud.spin.speed;
      if (ud.bob) { ud.bob.obj.position.y = ud.bob.y + Math.sin(w.tickCount * 0.08) * 0.04; ud.bob.obj.rotation.y += dt; }
      if (ud.prism) ud.prism.rotation.y += dt * 2;
      if (ud.oreFill) ud.oreFill.visible = (e.load || 0) > 10;
      if (ud.turret && e.kind === 'unit' && e.weapon) ud.turret.rotation.y = 0; // 车体已随 dir 转向

      // 血条
      const sel = this.game.selection.has(e.id);
      if (e.hp < e.maxHp || sel) {
        if (!rec.bar) {
          const cv = document.createElement('canvas');
          cv.width = 64; cv.height = 10;
          const tex = new THREE.CanvasTexture(cv);
          const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthTest: false }));
          sp.scale.set(0.95, 0.15, 1);
          rec.bar = sp; rec.barCv = cv; rec.barTex = tex;
          rec.group.add(sp);
        }
        if (rec.lastHp !== Math.ceil(e.hp)) {
          rec.lastHp = Math.ceil(e.hp);
          const c = rec.barCv.getContext('2d');
          c.clearRect(0, 0, 64, 10);
          c.fillStyle = 'rgba(0,0,0,0.7)'; c.fillRect(0, 0, 64, 10);
          const ratio = Math.max(0, e.hp / e.maxHp);
          c.fillStyle = ratio > 0.5 ? '#7ee787' : ratio > 0.25 ? '#ffd866' : '#ff7b72';
          c.fillRect(1, 1, 62 * ratio, 8);
          c.fillStyle = SIDE_COLORS[e.side]; c.fillRect(0, 0, 3, 10);
          rec.barTex.needsUpdate = true;
        }
        rec.bar.position.y = rec.topY + 0.3;
        rec.bar.visible = true;
      } else if (rec.bar) rec.bar.visible = false;

      // 选中环
      if (sel && e.side === 'player') {
        if (!rec.ring) {
          const ring = new THREE.Mesh(
            new THREE.RingGeometry(0.85, 1, 32),
            new THREE.MeshBasicMaterial({ color: 0x7ee787, side: THREE.DoubleSide, depthWrite: false }),
          );
          ring.rotation.x = -Math.PI / 2;
          rec.ring = ring;
          this.scene.add(ring);
        }
        rec.ring.scale.setScalar(rec.r);
        rec.ring.position.set(e.x, 0.04, e.y);
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

  // ---------- 弹道 ----------
  syncProjectiles() {
    const list = this.world.projectiles;
    while (this.projPool.length < list.length) {
      const m = new THREE.Mesh(
        new THREE.SphereGeometry(0.05, 8, 6),
        new THREE.MeshBasicMaterial({ color: 0xffd0a0 }),
      );
      this.scene.add(m);
      this.projPool.push(m);
    }
    this.projPool.forEach((m, i) => {
      if (i < list.length) {
        m.visible = true;
        m.position.set(list[i].x, 0.35, list[i].y);
      } else m.visible = false;
    });
  }

  // ---------- 特效 ----------
  syncFx() {
    const w = this.world;
    const alive = new Set();
    for (const f of w.fx) {
      f.ttl -= 1;
      if (f.ttl <= 0) continue;
      alive.add(f);
      const a = f.ttl / f.max;
      if (f.type === 'beam' || f.type === 'tracer') {
        if (!f._mesh) {
          const beam = f.type === 'beam';
          f._mesh = new THREE.Mesh(
            new THREE.CylinderGeometry(beam ? 0.035 : 0.012, beam ? 0.035 : 0.012, 1, 6, 1, true),
            new THREE.MeshBasicMaterial({ color: f.color, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }),
          );
          this.scene.add(f._mesh);
          const p1 = new THREE.Vector3(f.x1, 0.35, f.y1), p2 = new THREE.Vector3(f.x2, 0.3, f.y2);
          this.stretchBetween(f._mesh, p1, p2);
        }
        f._mesh.material.opacity = a;
      } else if (f.type === 'boom') {
        if (!f._mesh) {
          f._mesh = new THREE.Mesh(
            new THREE.SphereGeometry(1, 14, 10),
            new THREE.MeshBasicMaterial({ color: 0xff9a3c, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }),
          );
          f._mesh.position.set(f.x, 0.3, f.y);
          this.scene.add(f._mesh);
          // 爆炸闪光
          const light = this.boomLights.find(l => !l.visible);
          if (light) {
            light.position.set(f.x, 1.2, f.y);
            light.intensity = 6 * f.r;
            light.visible = true;
            light.userData.ttl = f.max;
          }
        }
        const s = f.r * (1.5 - a * 0.8);
        f._mesh.scale.setScalar(Math.max(0.05, s));
        f._mesh.material.opacity = a * 0.9;
        f._mesh.material.color.setHSL(0.08, 1, 0.5 + a * 0.3);
      }
    }
    // 清理已结束的特效
    for (let i = w.fx.length - 1; i >= 0; i--) {
      const f = w.fx[i];
      if (f.ttl <= 0) {
        if (f._mesh) { this.scene.remove(f._mesh); f._mesh.geometry.dispose(); f._mesh.material.dispose(); f._mesh = null; }
        w.fx.splice(i, 1);
      }
    }
    // 爆炸灯衰减
    for (const l of this.boomLights) {
      if (!l.visible) continue;
      if ((l.userData.ttl -= 1) <= 0) l.visible = false;
      else l.intensity *= 0.85;
    }
  }

  stretchBetween(mesh, p1, p2) {
    const mid = p1.clone().add(p2).multiplyScalar(0.5);
    mesh.position.copy(mid);
    mesh.scale.y = p1.distanceTo(p2);
    mesh.lookAt(p2);
    mesh.rotateX(Math.PI / 2);
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
        m._mesh.position.set(m.x, 0.05, m.y);
        this.scene.add(m._mesh);
      }
      const a = m.ttl / m.max;
      m._mesh.scale.setScalar(0.5 + (1 - a) * 1.6);
      m._mesh.material.opacity = a;
    }

    // 放置幽灵
    const item = w.sides.player.placing;
    if (item && game.mouseTile) {
      const def = BUILDINGS[item];
      const ok = w.canPlace('player', item, game.mouseTile.tx, game.mouseTile.ty);
      const color = ok ? 0x50ff78 : 0xff5050;
      this.ghostBox.material.color.setHex(color);
      this.ghostEdge.material.color.setHex(color);
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
    // 阳光跟随目标，保证阴影范围覆盖视野
    this.sun.position.set(x + 18, 30, y + 8);
    this.sunTarget.position.set(x, 0, y);
    // 补光从相机侧打过来，避免背光面死黑
    this.fill.position.set(px, 20, pz);
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
    if (this.world.tickCount !== this.lastFogTick && this.world.tickCount % 6 === 0) {
      this.lastFogTick = this.world.tickCount;
      this.updateFogTexture();
    }
    this.updateCamera();
    this.renderer.render(this.scene, this.cam3);
  }

  resize() {
    const w = this.cv.clientWidth, h = this.cv.clientHeight;
    this.vw = w; this.vh = h;
    this.renderer.setSize(w, h, false);
    this.cam3.aspect = w / h;
    this.cam3.updateProjectionMatrix();
  }
}
