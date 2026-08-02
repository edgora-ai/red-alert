// 世界：地图、实体、tick 主逻辑（移动/生产/建造/采集/战斗/迷雾/胜负）

import {
  T, PASSABLE, MAP_W, MAP_H, UNITS, BUILDINGS, ECON, buildTicks, TICK_RATE,
} from '../config.js';
import { mulberry32, dist, clamp } from './util.js';
import { findPath, nearestOpen } from './pathfind.js';
import { updateHarvester, updatePower } from './economy.js';
import { updateCombat, updateProjectiles } from './combat.js';

let nextId = 1;

export class World {
  constructor(seed = 12345) {
    this.w = MAP_W; this.h = MAP_H;
    this.tiles = new Uint8Array(MAP_W * MAP_H);
    this.ore = new Uint16Array(MAP_W * MAP_H);
    this.bgrid = new Int32Array(MAP_W * MAP_H).fill(-1); // 建筑占位
    this.entities = new Map();
    this.projectiles = [];
    this.fx = [];       // 渲染特效（渲染层消费后自行衰减）
    this.events = [];   // 音效事件（main 每帧清空）
    this.messages = []; // 文字提示（UI 消费）
    this.credits = { player: ECON.startCredits, enemy: ECON.startCredits };
    this.power = { player: { supply: 0, demand: 0, low: false }, enemy: { supply: 0, demand: 0, low: false } };
    this.sides = { player: { placing: null }, enemy: { placing: null } };
    this.fog = new Uint8Array(MAP_W * MAP_H); // 0 未见 1 探索 2 可见（玩家视角）
    this.tickCount = 0;
    this.winner = null;
    this.rng = mulberry32(seed);
  }

  // ---------- 基础查询 ----------
  idx(tx, ty) { return ty * this.w + tx; }
  inBounds(tx, ty) { return tx >= 0 && ty >= 0 && tx < this.w && ty < this.h; }
  tileAt(tx, ty) { return this.inBounds(tx, ty) ? this.tiles[this.idx(tx, ty)] : T.ROCK; }
  isBlocked(tx, ty) {
    if (!this.inBounds(tx, ty)) return true;
    const i = this.idx(tx, ty);
    return !PASSABLE[this.tiles[i]] || this.bgrid[i] !== -1;
  }
  buildingAt(tx, ty) {
    if (!this.inBounds(tx, ty)) return null;
    const id = this.bgrid[this.idx(tx, ty)];
    return id >= 0 ? this.entities.get(id) : null;
  }
  unitDef(e) { return UNITS[e.type]; }
  buildingDef(e) { return BUILDINGS[e.type]; }
  defOf(e) { return e.kind === 'unit' ? UNITS[e.type] : BUILDINGS[e.type]; }

  // 单位到建筑 footprint 边缘的距离
  distToBuilding(u, b) {
    const dx = Math.max(b.tx - u.x, u.x - (b.tx + b.w), 0);
    const dy = Math.max(b.ty - u.y, u.y - (b.ty + b.h), 0);
    return Math.hypot(dx, dy);
  }

  buildingsOf(side) {
    const out = [];
    for (const e of this.entities.values()) if (e.kind === 'building' && e.side === side && !e.dead) out.push(e);
    return out;
  }
  unitsOf(side) {
    const out = [];
    for (const e of this.entities.values()) if (e.kind === 'unit' && e.side === side && !e.dead) out.push(e);
    return out;
  }

  // ---------- 实体管理 ----------
  addUnit(side, type, x, y) {
    const def = UNITS[type];
    // 落点被挡时吸附到最近可通行格
    if (!def.fly && this.isBlocked(Math.floor(x), Math.floor(y))) {
      const alt = nearestOpen(this, Math.floor(x), Math.floor(y), 4);
      if (alt) { x = alt.x + 0.5; y = alt.y + 0.5; }
    }
    const u = {
      id: nextId++, side, kind: 'unit', type, x, y,
      hp: def.hp, maxHp: def.hp, dir: -Math.PI / 2,
      speed: def.speed, sight: def.sight, weapon: def.weapon,
      path: null, pathi: 0, order: { type: 'idle' },
      cooldown: 0, scanCd: (nextId * 7) % 10, repathCd: 0,
      targetId: null, load: 0, flash: 0,
    };
    if (def.harvester) u.order = { type: 'harvest' };
    this.entities.set(u.id, u);
    return u;
  }

  addBuilding(side, type, tx, ty) {
    const def = BUILDINGS[type];
    const b = {
      id: nextId++, side, kind: 'building', type, tx, ty, w: def.w, h: def.h,
      x: tx + def.w / 2, y: ty + def.h / 2,
      hp: def.hp, maxHp: def.hp, sight: def.sight, weapon: def.weapon,
      queue: [], progress: 0, rally: null, cooldown: 0, scanCd: 0, flash: 0,
    };
    this.entities.set(b.id, b);
    for (let dy = 0; dy < def.h; dy++)
      for (let dx = 0; dx < def.w; dx++)
        this.bgrid[this.idx(tx + dx, ty + dy)] = b.id;
    return b;
  }

  killEntity(e) {
    if (e.dead) return;
    e.dead = true;
    if (e.kind === 'building') {
      for (let dy = 0; dy < e.h; dy++)
        for (let dx = 0; dx < e.w; dx++)
          this.bgrid[this.idx(e.tx + dx, e.ty + dy)] = -1;
    }
    this.entities.delete(e.id);
    const r = e.kind === 'building' ? Math.max(e.w, e.h) * 0.8 : 0.6;
    this.fx.push({ type: 'boom', x: e.x, y: e.y, r, ttl: 16, max: 16 });
    this.events.push({ type: 'boom', big: e.kind === 'building' });
  }

  // ---------- 命令 ----------
  issueCommand(side, cmd) {
    switch (cmd.type) {
      case 'produce': return this.cmdProduce(side, cmd.item);
      case 'cancelProduce': return this.cmdCancel(side, cmd.item);
      case 'build': return this.cmdPlace(side, cmd.tx, cmd.ty);
      case 'cancelPlace': return this.cmdCancelPlace(side);
      case 'move': return this.cmdMove(side, cmd.ids, cmd.x, cmd.y, 'move');
      case 'attackmove': return this.cmdMove(side, cmd.ids, cmd.x, cmd.y, 'attackmove');
      case 'attack': return this.cmdAttack(side, cmd.ids, cmd.targetId);
      case 'harvest': return this.cmdHarvest(side, cmd.ids, cmd.x, cmd.y);
      case 'capture': return this.cmdCapture(side, cmd.ids, cmd.targetId);
      case 'deploy': return this.cmdDeploy(side, cmd.ids);
      case 'stop': return this.cmdStop(side, cmd.ids);
      case 'rally': return this.cmdRally(side, cmd.id, cmd.x, cmd.y);
      case 'sell': return this.cmdSell(side, cmd.id);
    }
  }

  hasPrereq(side, def) {
    if (!def.prereq) return true;
    const owned = new Set(this.buildingsOf(side).map(b => b.type));
    return def.prereq.every(t => owned.has(t));
  }

  canProduce(side, item) {
    const def = UNITS[item] || BUILDINGS[item];
    if (!def) return { ok: false, reason: '未知项目' };
    if (def.side && def.side !== side) return { ok: false, reason: '阵营限定' };
    const producerType = UNITS[item] ? UNITS[item].producer : 'yard';
    const producer = this.buildingsOf(side).find(b => b.type === producerType && (b.def?.produces ?? BUILDINGS[b.type].produces)?.includes(item));
    if (!producer) return { ok: false, reason: '缺少生产建筑' };
    if (!this.hasPrereq(side, def)) return { ok: false, reason: '前置科技未解锁' };
    if (this.credits[side] < def.cost) return { ok: false, reason: '资金不足' };
    return { ok: true, producer };
  }

  cmdProduce(side, item) {
    const chk = this.canProduce(side, item);
    if (!chk.ok) {
      if (side === 'player') { this.messages.push({ side, text: chk.reason, ttl: 90 }); this.events.push({ type: 'error' }); }
      return false;
    }
    const def = UNITS[item] || BUILDINGS[item];
    this.credits[side] -= def.cost;
    chk.producer.queue.push(item);
    this.events.push({ type: 'select' });
    return true;
  }

  cmdCancel(side, item) {
    const producers = this.buildingsOf(side).filter(b => b.queue.includes(item));
    if (!producers.length) return false;
    const b = producers[0];
    const i = b.queue.lastIndexOf(item);
    b.queue.splice(i, 1);
    if (i === 0) b.progress = 0;
    const def = UNITS[item] || BUILDINGS[item];
    this.credits[side] += def.cost;
    this.events.push({ type: 'select' });
    return true;
  }

  canPlace(side, btype, tx, ty) {
    const def = BUILDINGS[btype];
    if (!def) return false;
    for (let dy = 0; dy < def.h; dy++) {
      for (let dx = 0; dx < def.w; dx++) {
        const x = tx + dx, y = ty + dy;
        if (!this.inBounds(x, y)) return false;
        if (this.tiles[this.idx(x, y)] !== T.GRASS) return false; // 只能压草地（不压矿）
        if (this.bgrid[this.idx(x, y)] !== -1) return false;
      }
    }
    // 须邻近己方建筑
    for (const b of this.buildingsOf(side)) {
      const gapX = Math.max(0, Math.max(tx - (b.tx + b.w), b.tx - (tx + def.w)));
      const gapY = Math.max(0, Math.max(ty - (b.ty + b.h), b.ty - (ty + def.h)));
      if (Math.max(gapX, gapY) <= ECON.placeMargin) return true;
    }
    return false;
  }

  unitsInFootprint(tx, ty, w, h) {
    const out = [];
    for (const u of this.entities.values()) {
      if (u.kind !== 'unit' || u.dead) continue;
      if (u.x >= tx && u.x < tx + w && u.y >= ty && u.y < ty + h) out.push(u);
    }
    return out;
  }

  cmdPlace(side, tx, ty) {
    const item = this.sides[side].placing;
    if (!item) return false;
    tx = Math.floor(tx); ty = Math.floor(ty);
    if (!this.canPlace(side, item, tx, ty)) {
      if (side === 'player') { this.messages.push({ side, text: '无法在此建造', ttl: 60 }); this.events.push({ type: 'error' }); }
      return false;
    }
    // 落点里的单位推开到旁边（经典红警行为）
    const def = BUILDINGS[item];
    for (const u of this.unitsInFootprint(tx, ty, def.w, def.h)) {
      const alt = nearestOpen(this, Math.floor(u.x), Math.floor(u.y), 6);
      if (alt) { u.x = alt.x + 0.5; u.y = alt.y + 0.5; u.path = null; }
    }
    const b = this.addBuilding(side, item, tx, ty);
    this.sides[side].placing = null;
    // 从建造厂队列移除该项目
    const yard = this.buildingsOf(side).find(y => y.queue[0] === item);
    if (yard) { yard.queue.shift(); yard.progress = 0; }
    this.events.push({ type: 'place' });
    // 精炼厂附赠采矿车
    if (def.grants) this.spawnUnitNear(side, def.grants, b);
    return true;
  }

  // 取消待放置建筑：退款并清掉建造厂队首
  cmdCancelPlace(side) {
    const item = this.sides[side].placing;
    if (!item) return false;
    this.sides[side].placing = null;
    this.credits[side] += BUILDINGS[item].cost;
    const yard = this.buildingsOf(side).find(y => y.queue[0] === item);
    if (yard) { yard.queue.shift(); yard.progress = 0; }
    this.events.push({ type: 'select' });
    return true;
  }

  cmdMove(side, ids, x, y, mode) {
    const offs = groupOffsets(ids.length);
    ids.forEach((id, i) => {
      const u = this.entities.get(id);
      if (!u || u.kind !== 'unit' || u.side !== side || u.dead) return;
      if (u.type === 'harvester' && mode === 'move') u.harvest = { state: 'idle', timer: 0 }; // 手动打断采矿
      u.order = { type: mode, x, y };
      u.targetId = null;
      this.setPath(u, x + offs[i].x, y + offs[i].y, mode === 'move');
    });
    this.events.push({ type: 'move' });
  }

  cmdAttack(side, ids, targetId) {
    const t = this.entities.get(targetId);
    if (!t) return;
    for (const id of ids) {
      const u = this.entities.get(id);
      if (!u || u.kind !== 'unit' || u.side !== side || u.dead) continue;
      const def = UNITS[u.type];
      if (def.capture && t.kind === 'building' && t.side !== side) { this.cmdCapture(side, [id], targetId); continue; }
      u.order = { type: 'attack' };
      u.targetId = targetId;
    }
    this.events.push({ type: 'move' });
  }

  cmdHarvest(side, ids, x, y) {
    for (const id of ids) {
      const u = this.entities.get(id);
      if (!u || u.type !== 'harvester' || u.side !== side || u.dead) continue;
      u.harvest = { state: 'idle', timer: 0 };
      u.order = { type: 'harvest' };
    }
    this.events.push({ type: 'move' });
  }

  cmdCapture(side, ids, targetId) {
    for (const id of ids) {
      const u = this.entities.get(id);
      if (!u || u.side !== side || u.dead || !UNITS[u.type].capture) continue;
      u.order = { type: 'capture', targetId };
    }
  }

  cmdDeploy(side, ids) {
    for (const id of ids) {
      const u = this.entities.get(id);
      if (!u || u.side !== side || u.dead) continue;
      const deploys = UNITS[u.type]?.deploys;
      if (!deploys) continue;
      const tx = Math.floor(u.x) - 1, ty = Math.floor(u.y) - 1;
      const def = BUILDINGS[deploys];
      let ok = true;
      for (let dy = 0; dy < def.h && ok; dy++)
        for (let dx = 0; dx < def.w && ok; dx++)
          if (this.isBlocked(tx + dx, ty + dy)) ok = false;
      if (!ok) {
        if (side === 'player') { this.messages.push({ side, text: '此处无法展开', ttl: 60 }); this.events.push({ type: 'error' }); }
        continue;
      }
      this.entities.delete(u.id);
      this.addBuilding(side, deploys, tx, ty);
      this.events.push({ type: 'place' });
    }
  }

  cmdStop(side, ids) {
    for (const id of ids) {
      const u = this.entities.get(id);
      if (!u || u.kind !== 'unit' || u.side !== side || u.dead) continue;
      u.order = { type: 'idle' };
      u.path = null; u.targetId = null;
      if (u.type === 'harvester') u.order = { type: 'harvest' };
    }
  }

  cmdRally(side, id, x, y) {
    const b = this.entities.get(id);
    if (b && b.kind === 'building' && b.side === side) b.rally = { x, y };
  }

  cmdSell(side, id) {
    const b = this.entities.get(id);
    if (!b || b.kind !== 'building' || b.side !== side) return false;
    this.credits[side] += Math.floor(BUILDINGS[b.type].cost / 2);
    this.killEntity(b);
    return true;
  }

  // ---------- 寻路/移动 ----------
  setPath(u, x, y, snap = true) {
    const def = UNITS[u.type];
    let tx = Math.floor(x), ty = Math.floor(y);
    if (!def.fly && snap && this.isBlocked(tx, ty)) {
      const alt = nearestOpen(this, tx, ty, 4);
      if (alt) { tx = alt.x; ty = alt.y; }
    }
    const path = findPath(this, u.x, u.y, tx, ty, def.fly);
    if (path === null) { u.path = null; return false; }
    u.path = path; u.pathi = 0;
    return true;
  }

  updateMovement(u) {
    if (!u.path) return;
    const wp = u.path[u.pathi];
    if (!wp) { u.path = null; return; }
    const step = u.speed / TICK_RATE;
    const d = dist(u.x, u.y, wp.x, wp.y);
    if (d <= step) {
      u.x = wp.x; u.y = wp.y;
      if (++u.pathi >= u.path.length) {
        u.path = null;
        if (u.order?.type === 'move') {
          // 矿车被手动移动到位后，恢复自动采矿
          u.order = u.type === 'harvester' ? { type: 'harvest' } : { type: 'idle' };
        }
      }
      return;
    }
    u.dir = Math.atan2(wp.y - u.y, wp.x - u.x);
    u.x += Math.cos(u.dir) * step;
    u.y += Math.sin(u.dir) * step;
  }

  // ---------- 生产 ----------
  spawnUnitNear(side, type, building) {
    for (let r = 1; r <= 5; r++) {
      for (let dy = -r; dy < building.h + r; dy++) {
        for (let dx = -r; dx < building.w + r; dx++) {
          if (Math.max(0, -dx, dx - building.w + 1) + Math.max(0, -dy, dy - building.h + 1) > r) continue;
          const tx = building.tx + dx, ty = building.ty + dy;
          if (!this.inBounds(tx, ty) || this.isBlocked(tx, ty)) continue;
          if (this.unitAtTile(tx, ty)) continue; // 不和别的单位叠罗汉
          const u = this.addUnit(side, type, tx + 0.5, ty + 0.5);
          if (building.rally && u.type !== 'harvester') {
            u.order = { type: 'move', x: building.rally.x, y: building.rally.y };
            this.setPath(u, building.rally.x, building.rally.y);
          }
          return u;
        }
      }
    }
    return null;
  }

  unitAtTile(tx, ty) {
    for (const u of this.entities.values()) {
      if (u.kind === 'unit' && !u.dead && Math.floor(u.x) === tx && Math.floor(u.y) === ty) return u;
    }
    return null;
  }

  updateProduction(b) {
    if (!b.queue.length) return;
    const item = b.queue[0];
    const def = UNITS[item] || BUILDINGS[item];
    const total = buildTicks(def);
    // 建筑完成但等待放置槽空闲时，停在 100%
    if (BUILDINGS[item] && this.sides[b.side].placing && b.progress >= total) return;
    const rate = this.power[b.side]?.low ? 0.5 : 1;
    b.progress += rate;
    if (b.progress < total) return;

    if (BUILDINGS[item]) {
      this.sides[b.side].placing = item;
      if (b.side === 'player') {
        this.messages.push({ side: b.side, text: `${def.name} 已就绪，点击地图放置`, ttl: 180 });
        this.events.push({ type: 'ready' });
      }
    } else {
      const u = this.spawnUnitNear(b.side, item, b);
      if (!u) { b.progress = total; return; } // 出口被堵，等待
      b.queue.shift(); b.progress = 0;
      if (b.side === 'player') {
        this.messages.push({ side: b.side, text: `${def.name} 训练完成`, ttl: 90 });
        this.events.push({ type: 'ready' });
      }
    }
  }

  // ---------- 工程师占领 ----------
  updateCapture(u) {
    const t = this.entities.get(u.order.targetId);
    if (!t || t.dead || t.side === u.side) { u.order = { type: 'idle' }; return; }
    if (this.distToBuilding(u, t) > 0.6) {
      if ((u.repathCd = (u.repathCd || 0) - 1) <= 0) {
        u.repathCd = 15;
        this.setPath(u, t.x, t.y);
      }
      return;
    }
    u.path = null;
    if (t.hp < t.maxHp * 0.5) {
      t.side = u.side;
      t.queue = []; t.progress = 0;
      this.messages.push({ side: u.side, text: `已占领敌方${BUILDINGS[t.type].name}！`, ttl: 150 });
      this.events.push({ type: 'capture' });
      this.entities.delete(u.id);
    } else {
      if (u.side === 'player') this.messages.push({ side: u.side, text: '目标血量过高，无法占领（需低于50%）', ttl: 120 });
      u.order = { type: 'idle' };
    }
  }

  // ---------- 战争迷雾 ----------
  updateFog() {
    const fog = this.fog;
    for (let i = 0; i < fog.length; i++) if (fog[i] === 2) fog[i] = 1;
    for (const e of this.entities.values()) {
      if (e.side !== 'player' || e.dead) continue;
      const r = e.sight || 5;
      const cx = Math.floor(e.x), cy = Math.floor(e.y);
      for (let dy = -r; dy <= r; dy++) {
        for (let dx = -r; dx <= r; dx++) {
          if (dx * dx + dy * dy > r * r) continue;
          const x = cx + dx, y = cy + dy;
          if (this.inBounds(x, y)) fog[this.idx(x, y)] = 2;
        }
      }
    }
  }

  // ---------- 胜负 ----------
  checkWinner() {
    for (const side of ['player', 'enemy']) {
      let alive = false;
      for (const e of this.entities.values()) {
        if (e.side === side && !e.dead) { alive = true; break; }
      }
      if (!alive) {
        this.winner = side === 'player' ? 'enemy' : 'player';
        this.events.push({ type: this.winner === 'player' ? 'win' : 'lose' });
        return;
      }
    }
  }

  // ---------- 主 tick ----------
  tick() {
    if (this.winner) return;
    this.tickCount++;

    updatePower(this);

    for (const e of [...this.entities.values()]) {
      if (e.flash > 0) e.flash--;
      if (e.kind === 'unit') {
        this.updateMovement(e);
        if (e.order?.type === 'harvest') updateHarvester(this, e);
        else if (e.order?.type === 'capture') this.updateCapture(e);
        else if (e.order?.type === 'attackmove' && !e.targetId && !e.path && dist(e.x, e.y, e.order.x, e.order.y) > 1.5) {
          this.setPath(e, e.order.x, e.order.y);
        }
        if (e.weapon) updateCombat(this, e);
      } else {
        this.updateProduction(e);
        if (e.weapon) updateCombat(this, e);
      }
    }

    updateProjectiles(this);

    if (this.tickCount % 6 === 0) this.updateFog();
    if (this.tickCount % 30 === 0) this.checkWinner();
  }
}

// 群体移动的分散落点
const OFFSETS = (() => {
  const out = [{ x: 0, y: 0 }];
  for (let r = 1; r <= 4; r++)
    for (let dy = -r; dy <= r; dy++)
      for (let dx = -r; dx <= r; dx++)
        if (Math.max(Math.abs(dx), Math.abs(dy)) === r) out.push({ x: dx * 0.9, y: dy * 0.9 });
  return out;
})();
function groupOffsets(n) {
  return Array.from({ length: n }, (_, i) => OFFSETS[i % OFFSETS.length]);
}

// ---------- 遭遇战地图生成 ----------
export function createSkirmish(seed = 20260801) {
  const w = new World(seed);
  const rng = w.rng;

  // 装饰：水域/岩石/树林
  for (let i = 0; i < 3; i++) blob(w, rng, 24 + rng() * 48, 24 + rng() * 48, 3 + rng() * 3, T.WATER);
  for (let i = 0; i < 5; i++) blob(w, rng, rng() * MAP_W, rng() * MAP_H, 2 + rng() * 2, T.ROCK);
  for (let i = 0; i < 8; i++) blob(w, rng, rng() * MAP_W, rng() * MAP_H, 2 + rng() * 2.5, T.TREE);

  // 矿区：双方近矿 + 中场两片
  orePatch(w, 24, 70, 4); orePatch(w, 72, 26, 4);
  orePatch(w, 36, 48, 3); orePatch(w, 60, 48, 3);

  // 出生区域清场（左下玩家 / 右上电脑）
  clearRect(w, 4, 72, 20, 20);
  clearRect(w, 72, 4, 22, 20);

  // 初始基地
  base(w, 'player', 7, 79);
  base(w, 'enemy', 86, 14);
  // 中场护卫（让玩家前期有仗可打）
  w.addUnit('enemy', 'tyrant', 60.5, 44.5);
  w.addUnit('enemy', 'tyrant', 36.5, 51.5);

  w.updateFog();
  return w;
}

function blob(w, rng, cx, cy, r, tile) {
  for (let dy = -r; dy <= r; dy++)
    for (let dx = -r; dx <= r; dx++) {
      if (dx * dx + dy * dy > r * r * (0.6 + rng() * 0.6)) continue;
      const x = Math.floor(cx + dx), y = Math.floor(cy + dy);
      if (w.inBounds(x, y)) w.tiles[w.idx(x, y)] = tile;
    }
}

function orePatch(w, cx, cy, r) {
  for (let dy = -r; dy <= r; dy++) {
    for (let dx = -r; dx <= r; dx++) {
      if (dx * dx + dy * dy > r * r) continue;
      const x = cx + dx, y = cy + dy;
      if (!w.inBounds(x, y)) continue;
      const i = w.idx(x, y);
      w.tiles[i] = T.ORE;
      w.ore[i] = ECON.orePerTile;
    }
  }
}

function clearRect(w, tx, ty, ww, hh) {
  for (let y = ty; y < ty + hh; y++)
    for (let x = tx; x < tx + ww; x++)
      if (w.inBounds(x, y)) { w.tiles[w.idx(x, y)] = T.GRASS; w.ore[w.idx(x, y)] = 0; }
}

function base(w, side, tx, ty) {
  // yard 3x3；power 2x2；refinery 3x2；附带初始部队
  const yard = w.addBuilding(side, 'yard', tx, ty);
  w.addBuilding(side, 'power', tx + 4, ty);
  w.addBuilding(side, 'refinery', tx, ty - 3);
  w.addUnit(side, 'harvester', tx + 4.5, ty - 1.5);
  const tankType = side === 'player' ? 'cheetah' : 'tyrant';
  w.addUnit(side, tankType, tx + 6.5, ty + 1.5);
  w.addUnit(side, tankType, tx + 7.5, ty + 3.5);
  w.addUnit(side, 'rifle', tx + 5.5, ty + 5.5);
  w.addUnit(side, 'rifle', tx + 7.5, ty + 5.5);
  return yard;
}
