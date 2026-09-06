// 小地图：地形预渲染 + 实体点 + 迷雾 + 视口框 + 雷达扫描 + 受击警报 ping，点击/拖动跳转视角

import { T } from '../config.js';
import { SIDE_COLORS } from './renderer.js';

const MCOLORS = {
  [T.GRASS]: '#31492c', [T.TREE]: '#1e3619', [T.ROCK]: '#474750',
  [T.WATER]: '#152c44', [T.ORE]: '#a8863a',
};

export class Minimap {
  constructor(canvas, world, camera, game = null) {
    this.cv = canvas;
    this.ctx = canvas.getContext('2d');
    this.world = world;
    this.cam = camera;
    this.game = game;
    this.scale = canvas.width / world.w; // 像素/瓦片
    this.frame = 0;
    this.prerender();
    const toWorld = (e) => {
      const r = canvas.getBoundingClientRect();
      return { x: (e.clientX - r.left) / r.width * world.w, y: (e.clientY - r.top) / r.height * world.h };
    };
    const jump = (e) => {
      const p = toWorld(e);
      this.cam.x = p.x;
      this.cam.y = p.y;
      if (this.game) this.game.userCam = true; // 小地图跳转 = 用户接管相机
    };
    canvas.addEventListener('contextmenu', e => e.preventDefault());
    canvas.addEventListener('mousedown', e => {
      if (e.button === 2) {
        // 右键小地图 = 直接下命令（移动/攻击），Shift=排队
        const p = toWorld(e);
        if (this.cmdCb) this.cmdCb(p.x, p.y, e.shiftKey);
        else jump(e);
        return;
      }
      if (e.button !== 0) return;
      jump(e); this.dragging = true;
    });
    canvas.addEventListener('mousemove', e => { if (this.dragging) jump(e); });
    window.addEventListener('mouseup', () => { this.dragging = false; });
  }

  // main 注入：右键小地图命令回调 (x, y, queued)
  bindCmd(cb) { this.cmdCb = cb; }

  // 开局重开换绑新世界（地形预渲染重建）
  setWorld(world) {
    this.world = world;
    this.prerender();
  }

  prerender() {
    const t = document.createElement('canvas');
    t.width = t.height = this.cv.width;
    const c = t.getContext('2d');
    const s = this.scale, w = this.world;
    for (let ty = 0; ty < w.h; ty++)
      for (let tx = 0; tx < w.w; tx++) {
        c.fillStyle = MCOLORS[w.tiles[w.idx(tx, ty)]];
        c.fillRect(tx * s, ty * s, s + 0.5, s + 0.5);
      }
    this.terrain = t;
  }

  update(renderer) {
    this.frame++;
    if (this.frame % 150 === 0) this.prerender(); // 每 5s 重绘地形：矿区枯竭后不再残留金色矿点
    if (this.frame % 10 !== 0) return; // 节流：每 1/3s
    const { ctx, world: w, scale: s } = this;
    ctx.drawImage(this.terrain, 0, 0);

    // 雷达扫描线（建有雷达站后启用）
    if (w.buildingsOf('player').some(b => b.type === 'radar')) {
      const a = (performance.now() / 1200) % (Math.PI * 2);
      const cx = this.cv.width / 2, cy = this.cv.height / 2;
      const grad = ctx.createLinearGradient(cx, cy, cx + Math.cos(a) * cx, cy + Math.sin(a) * cy);
      grad.addColorStop(0, 'rgba(126,231,135,0.28)');
      grad.addColorStop(1, 'rgba(126,231,135,0)');
      ctx.strokeStyle = grad;
      ctx.lineWidth = 2.5;
      ctx.beginPath();
      ctx.moveTo(cx, cy);
      ctx.lineTo(cx + Math.cos(a) * cx, cy + Math.sin(a) * cy);
      ctx.stroke();
    }

    // 实体点（建筑带外框，单位实心）
    for (const e of w.entities.values()) {
      const fogged = e.side !== 'player' && w.fog[w.idx(Math.floor(e.x), Math.floor(e.y))] < (e.kind === 'unit' ? 2 : 1);
      if (fogged) continue;
      ctx.fillStyle = SIDE_COLORS[e.side];
      if (e.kind === 'building') {
        ctx.fillRect(e.x * s - 2.2, e.y * s - 2.2, 4.4, 4.4);
        ctx.strokeStyle = 'rgba(255,255,255,0.55)';
        ctx.lineWidth = 0.8;
        ctx.strokeRect(e.x * s - 2.2, e.y * s - 2.2, 4.4, 4.4);
      } else if (e.type === 'harvester') {
        // 矿车画方块：经济单位一眼与战斗单位（圆点）区分
        ctx.fillRect(e.x * s - 1.5, e.y * s - 1.5, 3, 3);
      } else {
        ctx.beginPath();
        ctx.arc(e.x * s, e.y * s, 1.6, 0, 7);
        ctx.fill();
      }
    }

    // 迷雾
    for (let ty = 0; ty < w.h; ty++)
      for (let tx = 0; tx < w.w; tx++) {
        const f = w.fog[w.idx(tx, ty)];
        if (f === 2) continue;
        ctx.fillStyle = f === 1 ? 'rgba(0,0,0,0.45)' : 'rgba(0,0,0,0.9)';
        ctx.fillRect(tx * s, ty * s, s + 0.5, s + 0.5);
      }

    // 受击警报 ping（红色扩散圈）
    for (const a of w.alerts) {
      if (a.side !== 'player') continue;
      const k = 1 - a.ttl / a.max;
      ctx.strokeStyle = `rgba(255,90,80,${(1 - k) * 0.9})`;
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.arc(a.x * s, a.y * s, 2 + k * 9, 0, 7);
      ctx.stroke();
    }

    // 视口范围：屏幕四角反投影到地面，画四边形（支持旋转视角）
    const pts = [[0, 0], [renderer.vw, 0], [renderer.vw, renderer.vh], [0, renderer.vh]]
      .map(([px, py]) => renderer.screenToTile(px, py));
    ctx.strokeStyle = 'rgba(255,255,255,0.85)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    pts.forEach((p, i) => (i ? ctx.lineTo(p.x * s, p.y * s) : ctx.moveTo(p.x * s, p.y * s)));
    ctx.closePath();
    ctx.stroke();
  }
}
