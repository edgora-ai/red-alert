// A* 寻路：瓦片网格、8 方向；飞行单位返回直线

import { PASSABLE } from '../config.js';

// 小二叉堆
class Heap {
  constructor() { this.a = []; }
  get size() { return this.a.length; }
  push(item, pri) {
    const a = this.a;
    a.push({ item, pri });
    let i = a.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (a[p].pri <= a[i].pri) break;
      [a[p], a[i]] = [a[i], a[p]]; i = p;
    }
  }
  pop() {
    const a = this.a;
    const top = a[0];
    const last = a.pop();
    if (a.length) {
      a[0] = last;
      let i = 0;
      for (;;) {
        const l = i * 2 + 1, r = l + 1;
        let m = i;
        if (l < a.length && a[l].pri < a[m].pri) m = l;
        if (r < a.length && a[r].pri < a[m].pri) m = r;
        if (m === i) break;
        [a[m], a[i]] = [a[i], a[m]]; i = m;
      }
    }
    return top.item;
  }
}

const DIRS = [
  [1, 0, 1], [-1, 0, 1], [0, 1, 1], [0, -1, 1],
  [1, 1, 1.4142], [1, -1, 1.4142], [-1, 1, 1.4142], [-1, -1, 1.4142],
];

// world 需暴露：w, h, idx(tx,ty), tiles, isBlocked(tx,ty)
// maxExpand：单次搜索展开上限（大兵团跨帧摊销用，默认全图；繁忙时调小防卡顿）
export function findPath(world, sx, sy, tx, ty, fly, maxExpand = Infinity) {
  sx = Math.floor(sx); sy = Math.floor(sy); tx = Math.floor(tx); ty = Math.floor(ty);
  if (fly) return [{ x: tx + 0.5, y: ty + 0.5 }];
  if (!world.inBounds(tx, ty)) return null;

  // 起点被挡（单位恰在建筑 footprint 内等）：吸附最近可达格再搜——否则 A* 全邻居被挡返回 null
  if (world.isBlocked(sx, sy)) {
    const salt = nearestOpen(world, sx, sy, 3);
    if (salt) { sx = salt.x; sy = salt.y; }
  }

  // 目标被挡时吸附最近可达格
  if (world.isBlocked(tx, ty)) {
    const alt = nearestOpen(world, tx, ty, 3);
    if (!alt) return null;
    tx = alt.x; ty = alt.y;
  }
  if (sx === tx && sy === ty) return [];

  const W = world.w, H = world.h;
  const start = sy * W + sx, goal = ty * W + tx;
  const gScore = new Map([[start, 0]]);
  const came = new Map();
  const open = new Heap();
  open.push(start, 0);
  const closed = new Uint8Array(W * H);
  let found = false;
  let guard = Math.min(W * H * 4, maxExpand); // 防爆保护 + 跨帧预算熔断
  let expanded = 0;

  // 短距直连近道：8 格内直线无遮挡直接走（省掉 A* 开销，大兵团常用）
  if (Math.abs(tx - sx) <= 8 && Math.abs(ty - sy) <= 8 && lineClear(world, sx, sy, tx, ty)) {
    return [{ x: tx + 0.5, y: ty + 0.5 }];
  }

  while (open.size && guard-- > 0) {
    const cur = open.pop();
    if (cur === goal) { found = true; break; }
    if (closed[cur]) continue;
    closed[cur] = 1;
    if (++expanded >= maxExpand) break; // 预算用尽：降级直线逼近而非罚站
    const cx = cur % W, cy = (cur / W) | 0;
    const cg = gScore.get(cur);

    for (const [dx, dy, cost] of DIRS) {
      const nx = cx + dx, ny = cy + dy;
      if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
      const ni = ny * W + nx;
      if (closed[ni]) continue;
      if (ni !== goal && world.isBlocked(nx, ny)) continue;
      // 禁止穿墙角
      if (dx && dy && (world.isBlocked(cx + dx, cy) || world.isBlocked(cx, cy + dy))) continue;
      const ng = cg + cost;
      if (ng < (gScore.get(ni) ?? Infinity)) {
        gScore.set(ni, ng);
        came.set(ni, cur);
        const h = Math.hypot(tx - nx, ty - ny);
        open.push(ni, ng + h);
      }
    }
  }
  if (!found) {
    // 预算熔断/不可达：能往目标方向蹭就蹭（取 open 中 h 最小的已见点），绝不罚站
    let bestCur = null, bestH = Infinity;
    for (const k of gScore.keys()) {
      const h = Math.hypot(tx - (k % W), ty - ((k / W) | 0));
      if (h < bestH) { bestH = h; bestCur = k; }
    }
    if (bestCur == null) return null;
    const bx = (bestCur % W) + 0.5, by = ((bestCur / W) | 0) + 0.5;
    if (Math.hypot(bx - (sx + 0.5), by - (sy + 0.5)) < 0.6) return null;
    return [{ x: bx, y: by }];
  }

  // 回溯路径（瓦片中心点），去掉起点
  const rev = [];
  let cur = goal;
  while (cur !== start && cur !== undefined) {
    rev.push({ x: (cur % W) + 0.5, y: ((cur / W) | 0) + 0.5 });
    cur = came.get(cur);
  }
  rev.reverse();
  // 路径拉直：视线可达的中间点直接跳过（减少折线抖动 + 移动更快）
  return smoothPath(world, sx + 0.5, sy + 0.5, rev);
}

// Bresenham 视线检测（瓦片中心连线无阻挡）
function lineClear(world, x0, y0, x1, y1) {
  let dx = Math.abs(x1 - x0), dy = Math.abs(y1 - y0);
  const sx = x0 < x1 ? 1 : -1, sy = y0 < y1 ? 1 : -1;
  let err = dx - dy, x = x0, y = y0;
  for (let i = 0; i < 64; i++) {
    if (world.isBlocked(x, y)) return false;
    if (x === x1 && y === y1) return true;
    const e2 = err * 2;
    if (e2 > -dy) { err -= dy; x += sx; }
    if (e2 < dx) { err += dx; y += sy; }
  }
  return false;
}

function smoothPath(world, sx, sy, path) {
  if (path.length < 3) return path;
  const out = [];
  let ax = sx, ay = sy;
  let i = 0;
  const LOOKAHEAD = 24; // 前看窗口：全程前看是 O(n²) 视线检测，长路径峰值可到几十万次阻挡查询
  while (i < path.length) {
    let j = Math.min(path.length - 1, i + LOOKAHEAD);
    for (; j > i; j--) {
      const bx = Math.floor(path[j].x), by = Math.floor(path[j].y);
      if (lineClear(world, Math.floor(ax), Math.floor(ay), bx, by)) break;
    }
    out.push(path[j]);
    ax = path[j].x; ay = path[j].y;
    i = j + 1;
  }
  return out;
}

export function nearestOpen(world, tx, ty, radius) {
  for (let r = 1; r <= radius; r++) {
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
        const nx = tx + dx, ny = ty + dy;
        if (world.inBounds(nx, ny) && !world.isBlocked(nx, ny) && PASSABLE[world.tiles[world.idx(nx, ny)]]) {
          return { x: nx, y: ny };
        }
      }
    }
  }
  return null;
}
