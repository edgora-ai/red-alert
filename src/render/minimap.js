// 小地图：地形预渲染 + 实体点 + 迷雾 + 视口框，点击跳转

import { T } from '../config.js';
import { SIDE_COLORS } from './renderer.js';

const MCOLORS = {
  [T.GRASS]: '#2f4a2b', [T.TREE]: '#1d3a1a', [T.ROCK]: '#484852',
  [T.WATER]: '#16324f', [T.ORE]: '#a8863a',
};

export class Minimap {
  constructor(canvas, world, camera) {
    this.cv = canvas;
    this.ctx = canvas.getContext('2d');
    this.world = world;
    this.cam = camera;
    this.scale = canvas.width / world.w; // 像素/瓦片
    this.frame = 0;
    this.prerender();
    const jump = (e) => {
      const r = canvas.getBoundingClientRect();
      this.cam.x = (e.clientX - r.left) / this.scale;
      this.cam.y = (e.clientY - r.top) / this.scale;
    };
    canvas.addEventListener('mousedown', e => { jump(e); this.dragging = true; });
    canvas.addEventListener('mousemove', e => { if (this.dragging) jump(e); });
    window.addEventListener('mouseup', () => { this.dragging = false; });
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
    if (++this.frame % 15 !== 0) return; // 节流：每 0.5s
    const { ctx, world: w, scale: s } = this;
    ctx.drawImage(this.terrain, 0, 0);

    // 实体点
    for (const e of w.entities.values()) {
      const fogged = e.side !== 'player' && w.fog[w.idx(Math.floor(e.x), Math.floor(e.y))] < (e.kind === 'unit' ? 2 : 1);
      if (fogged) continue;
      ctx.fillStyle = SIDE_COLORS[e.side];
      const sz = e.kind === 'building' ? 3 : 2;
      ctx.fillRect(e.x * s - sz / 2, e.y * s - sz / 2, sz, sz);
    }

    // 迷雾
    for (let ty = 0; ty < w.h; ty++)
      for (let tx = 0; tx < w.w; tx++) {
        const f = w.fog[w.idx(tx, ty)];
        if (f === 2) continue;
        ctx.fillStyle = f === 1 ? 'rgba(0,0,0,0.45)' : 'rgba(0,0,0,0.9)';
        ctx.fillRect(tx * s, ty * s, s + 0.5, s + 0.5);
      }

    // 视口范围：屏幕四角反投影到地面，画四边形（支持旋转视角）
    const pts = [[0, 0], [renderer.vw, 0], [renderer.vw, renderer.vh], [0, renderer.vh]]
      .map(([px, py]) => renderer.screenToTile(px, py));
    ctx.strokeStyle = '#fff';
    ctx.lineWidth = 1;
    ctx.beginPath();
    pts.forEach((p, i) => (i ? ctx.lineTo(p.x * s, p.y * s) : ctx.moveTo(p.x * s, p.y * s)));
    ctx.closePath();
    ctx.stroke();
  }
}
