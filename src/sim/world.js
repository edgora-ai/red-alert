// 世界：地图、实体、tick 主逻辑（移动/生产/建造/采集/战斗/迷雾/胜负）

import {
  T, PASSABLE, MAP_W, MAP_H, UNITS, BUILDINGS, UPGRADES, ECON, VET, buildTicks, TICK_RATE,
} from '../config.js';
import { mulberry32, dist, clamp } from './util.js';
import { findPath, nearestOpen } from './pathfind.js';
import { updateHarvester, updatePower } from './economy.js';
import { updateCombat, updateProjectiles, splashDamage } from './combat.js';

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
    this.alerts = [];   // 受击警报点（小地图红点ping + AI 防守），UI 消费
    this.stats = {      // 战报统计（结算面板用）
      player: { kills: 0, lost: 0, built: 0, spent: 0, mined: 0, superFired: 0, killsValue: 0 },
      enemy: { kills: 0, lost: 0, built: 0, spent: 0, mined: 0, superFired: 0, killsValue: 0 },
    };
    // 全局科技加成（fire/armor/speed/mine 倍率，owned=已研发集合，wf=武器专属火力）
    this.upgrades = {
      player: { fire: 1, armor: 1, speed: 1, mine: 1, owned: new Set(), wf: {} },
      enemy: { fire: 1, armor: 1, speed: 1, mine: 1, owned: new Set(), wf: {} },
    };
    this.tickCount = 0;
    this.winner = null;
    this.rng = mulberry32(seed);
    this.superCd = { player: 0, enemy: 0 }; // 超级武器冷却（tick）
    this.strikes = [];                      // 进行中的轨道打击 {x, y, t}
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
      level: 0, xp: 0, dmgMul: 1, // 老兵等级（0=新兵 Lv1）
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
    if (this.stats[side]) this.stats[side].built++;
    return b;
  }

  // 击杀奖励：来源单位积攒经验并晋升（火力 +15%/级，耐久 +20%/级）
  addXp(u, gain) {
    if (!u || u.dead || u.kind !== 'unit' || !u.weapon) return;
    if (u.type === 'harvester' || u.type === 'mcv') return;
    u.xp += gain;
    while (u.level < VET.thresholds.length && u.xp >= VET.thresholds[u.level]) {
      u.level++;
      u.dmgMul = 1 + u.level * VET.dmgPerLevel;
      const bonus = u.maxHp * VET.hpPerLevel;
      u.maxHp += bonus;
      u.hp += bonus;
      u.flash = 10; // 晋升瞬间模型闪白（渲染层复用受击闪白，更长的窗口）
      this.events.push({ type: 'promote', x: u.x, y: u.y });
      if (u.side === 'player') {
        this.messages.push({ side: 'player', text: `${UNITS[u.type].name} 晋升为老兵（Lv${u.level + 1}）`, ttl: 120 });
      }
    }
  }

  // 受击警报：玩家侧弹警报消息/小地图红点；双方都记录供 AI 防守判读
  // 矿车被打：丢下矿石逃向最近精炼厂（经典 RTS 保矿车行为）
  onDamaged(target, src) {
    if (src && src.side === target.side) return;
    if (target.kind === 'unit' && target.type === 'harvester' && src && !target.dead) {
      if ((target.fleeCd ?? 0) <= this.tickCount) {
        target.fleeCd = this.tickCount + 60;
        let best = null, bestD = Infinity;
        for (const b of this.entities.values()) {
          if (b.kind !== 'building' || b.side !== target.side || b.dead) continue;
          if (!this.buildingDef(b).refinery) continue;
          const d = dist(target.x, target.y, b.x, b.y);
          if (d < bestD) { bestD = d; best = b; }
        }
        if (best) {
          // 逃向精炼厂先卸货再干活：直接进卸货流程（修复前带着满载去采矿，
          // 下一车卸货 load 叠加到 1400——一车双倍入账的经济漏洞）
          if ((target.load || 0) > 0) {
            target.harvest = { state: 'toRefinery', refId: best.id, oreTx: 0, oreTy: 0, timer: 0 };
            target.order = { type: 'harvest' };
            this.setPath(target, best.x, best.y);
          } else {
            target.oq = [];
            target.harvest = { state: 'idle', timer: 0 };
            target.order = { type: 'move', x: best.x, y: best.y };
            this.setPath(target, best.x, best.y);
          }
          target.targetId = null;
        }
      }
    }
    this.alerts.push({ x: target.x, y: target.y, ttl: 75, max: 75, side: target.side });
    if (target.side !== 'player') return;
    if (this.tickCount - (this.lastAlarmTick ?? -999) < 110) return;
    this.lastAlarmTick = this.tickCount;
    const isBase = target.kind === 'building';
    this.messages.push({ side: 'player', text: isBase ? '警告：基地遭到攻击！' : '警告：我方部队遭到攻击！', ttl: 120 });
    this.events.push({ type: 'underAttack', x: target.x, y: target.y });
  }

  killEntity(e, killer = null) {
    if (e.dead) return;
    e.dead = true;
    if (e.kind === 'building') {
      for (let dy = 0; dy < e.h; dy++)
        for (let dx = 0; dx < e.w; dx++)
          this.bgrid[this.idx(e.tx + dx, e.ty + dy)] = -1;
    }
    this.entities.delete(e.id);
    const fly = e.kind === 'unit' && UNITS[e.type]?.fly;
    const isNuke = e.kind === 'building' && e.type === 'npower'; // 核电站殉爆：核爆级特效
    const r = e.kind === 'building' ? Math.max(e.w, e.h) * (isNuke ? 1.5 : 0.8) : fly ? 1.1 : 0.6;
    this.fx.push({ type: 'boom', x: e.x, y: e.y, r, ttl: 16, max: 16, alt: fly ? (e.alt ?? 2.2) : 0, nuke: isNuke, shake: isNuke ? 1.2 : undefined });
    this.events.push({ type: 'boom', big: e.kind === 'building' || fly, x: e.x, y: e.y });
    // 地面载具留下燃烧残骸；空中单位（基洛夫）坠落爆燃（渲染层消费 alt）
    if (e.kind === 'unit' && !fly && !UNITS[e.type]?.inf) {
      this.fx.push({
        type: 'wreck', x: e.x, y: e.y, ttl: 600, max: 600,
        heavy: e.type === 'cheetah' || e.type === 'tyrant' || e.type === 'titan',
      });
    }
    // 战报与经验
    if (e.kind === 'unit') this.stats[e.side].lost++;
    if (killer && !killer.dead && killer.side !== e.side) {
      this.stats[killer.side].kills++;
      this.stats[killer.side].killsValue += this.defOf(e).cost || 0; // 击毁价值：战果质量维度
      if (killer.side === 'player') this.events.push({ type: 'killConfirm' }); // 击杀确认音（音频层限频）
      const def = this.defOf(e);
      this.addXp(killer, Math.round((def.cost || 300) * 0.3 + (e.maxHp || 100) * 0.35));
    }
  }

  // 事件音色提示：队伍里含载具 → 低音确认（听声辨部队）
  idsHeavy(ids) {
    for (const id of ids) {
      const u = this.entities.get(id);
      if (u?.kind === 'unit' && !UNITS[u.type]?.inf) return true;
    }
    return false;
  }

  // ---------- 命令 ----------
  issueCommand(side, cmd) {
    switch (cmd.type) {
      case 'produce': return this.cmdProduce(side, cmd.item, cmd.n);
      case 'cancelProduce': return this.cmdCancel(side, cmd.item);
      case 'build': return this.cmdPlace(side, cmd.tx, cmd.ty);
      case 'cancelPlace': return this.cmdCancelPlace(side);
      case 'move': return this.cmdMove(side, cmd.ids, cmd.x, cmd.y, 'move', cmd.queued);
      case 'attackmove': return this.cmdMove(side, cmd.ids, cmd.x, cmd.y, 'attackmove', cmd.queued);
      case 'attack': return this.cmdAttack(side, cmd.ids, cmd.targetId, cmd.queued);
      case 'harvest': return this.cmdHarvest(side, cmd.ids, cmd.x, cmd.y, cmd.queued);
      case 'capture': return this.cmdCapture(side, cmd.ids, cmd.targetId, cmd.queued);
      case 'patrol': return this.cmdPatrol(side, cmd.ids, cmd.x, cmd.y, cmd.queued);
      case 'hold': return this.cmdHold(side, cmd.ids, cmd.queued);
      case 'deploy': return this.cmdDeploy(side, cmd.ids);
      case 'stop': return this.cmdStop(side, cmd.ids);
      case 'rally': return this.cmdRally(side, cmd.id, cmd.x, cmd.y);
      case 'sell': return this.cmdSell(side, cmd.id);
      case 'repairBuilding': return this.cmdRepairBuilding(side, cmd.id);
      case 'superstrike': return this.cmdSuper(side, cmd.x, cmd.y);
    }
  }

  hasPrereq(side, def) {
    if (!def.prereq) return true;
    const owned = new Set(this.buildingsOf(side).map(b => b.type));
    return def.prereq.every(t => owned.has(t));
  }

  canProduce(side, item) {
    const def = UNITS[item] || BUILDINGS[item] || UPGRADES[item];
    if (!def) return { ok: false, reason: '未知项目' };
    if (UPGRADES[item] && this.upgrades[side].owned.has(item)) return { ok: false, reason: '已研发' };
    if (def.side && def.side !== side) return { ok: false, reason: '阵营限定' };
    const producerType = UNITS[item] ? UNITS[item].producer : (UPGRADES[item]?.producer || 'yard');
    const producer = this.buildingsOf(side).find(b => b.type === producerType && BUILDINGS[b.type].produces?.includes(item));
    if (!producer) return { ok: false, reason: '缺少生产建筑' };
    if (!this.hasPrereq(side, def)) return { ok: false, reason: '前置科技未解锁' };
    if (this.credits[side] < def.cost) return { ok: false, reason: '资金不足' };
    return { ok: true, producer };
  }

  cmdProduce(side, item, n = 1) {
    const def = UNITS[item] || BUILDINGS[item] || UPGRADES[item];
    if (!def) return false;
    // Shift×5：按 Shift 连点一次排 5 个（钱不够排到空为止）
    n = UPGRADES[item] ? 1 : Math.max(1, Math.min(5, n | 0));
    let made = 0;
    for (let i = 0; i < n; i++) {
      const chk = this.canProduce(side, item);
      if (!chk.ok) {
        if (side === 'player' && made === 0) { this.messages.push({ side, text: chk.reason, ttl: 90 }); this.events.push({ type: 'error' }); }
        break;
      }
      this.credits[side] -= def.cost;
      this.stats[side].spent += def.cost;
      chk.producer.queue.push(item);
      made++;
    }
    if (made) this.events.push({ type: 'select' });
    return made > 0;
  }

  cmdCancel(side, item) {
    const producers = this.buildingsOf(side).filter(b => b.queue.includes(item));
    if (!producers.length) return false;
    const b = producers[0];
    const i = b.queue.lastIndexOf(item);
    b.queue.splice(i, 1);
    if (i === 0) b.progress = 0;
    // 若该建筑已就绪等待放置，取消订单必须同时撤掉放置状态——否则退款后还能免费放置
    if (this.sides[side].placing === item) this.sides[side].placing = null;
    const def = UNITS[item] || BUILDINGS[item] || UPGRADES[item];
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
    // 落点里的单位推开到旁边（经典红警行为）。
    // 先用哨兵占位锁住脚印再推人：否则 nearestOpen 可能把单位推进同一脚印的相邻格，
    // 建筑落成照样罩住它（-2 占位对 isBlocked 生效，addBuilding 会覆写成正式 id）
    const def = BUILDINGS[item];
    for (let dy = 0; dy < def.h; dy++)
      for (let dx = 0; dx < def.w; dx++)
        this.bgrid[this.idx(tx + dx, ty + dy)] = -2;
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

  cmdMove(side, ids, x, y, mode, queued = false) {
    const offs = groupOffsets(ids.length);
    const heavy = this.idsHeavy(ids);
    ids.forEach((id, i) => {
      const u = this.entities.get(id);
      if (!u || u.kind !== 'unit' || u.side !== side || u.dead) return;
      if (u.type === 'harvester' && mode === 'attackmove') return; // 采矿车不理会攻击移动，继续干活
      const order = { type: mode, x: x + offs[i].x, y: y + offs[i].y };
      if (queued && u.order && u.order.type !== 'idle') { u.oq ??= []; u.oq.push(order); this.events.push({ type: 'move', heavy }); return; }
      if (u.type === 'harvester' && mode === 'move') u.harvest = { state: 'idle', timer: 0 }; // 手动打断采矿
      u.oq = []; // 新指令清空旧队列（Shift 追加走 queued 分支）
      u.order = order;
      u.targetId = null;
      this.setPath(u, x + offs[i].x, y + offs[i].y, mode === 'move');
    });
    this.events.push({ type: 'move', heavy });
  }

  // 排队指令：Shift+右键追加，不打断当前任务
  queueOrder(u, order) {
    u.oq ??= [];
    if (u.oq.length > 12) u.oq.shift(); // 队列上限，防刷屏卡死
    u.oq.push(order);
    this.events.push({ type: 'move', heavy: this.idsHeavy([u.id]) });
  }

  // 从队列取下一条指令并执行；返回 false 表示队列已空
  popQueued(u) {
    const oq = u.oq;
    if (!oq || !oq.length) return false;
    const nx = oq.shift();
    if (nx.type === 'move' || nx.type === 'attackmove') {
      if (u.type === 'harvester' && nx.type === 'attackmove') return this.popQueued(u);
      u.order = nx; u.targetId = nx.targetId ?? null;
      this.setPath(u, nx.x, nx.y, nx.type === 'move');
      return true;
    }
    if (nx.type === 'attack' || nx.type === 'capture') {
      const t = this.entities.get(nx.targetId);
      if (!t || t.dead) return this.popQueued(u); // 目标已没，跳过
      u.order = nx; u.targetId = nx.targetId;
      return true;
    }
    if (nx.type === 'patrol') { u.order = nx; u.targetId = null; this.setPath(u, nx.x2, nx.y2); return true; }
    if (nx.type === 'guard' || nx.type === 'hold') { u.order = nx; u.path = null; u.targetId = null; return true; }
    if (nx.type === 'harvest') { u.harvest = { state: 'idle', timer: 0 }; u.order = { type: 'harvest' }; return true; }
    return false;
  }

  cmdPatrol(side, ids, x, y, queued = false) {
    for (const id of ids) {
      const u = this.entities.get(id);
      if (!u || u.kind !== 'unit' || u.side !== side || u.dead) continue;
      if (u.type === 'harvester') continue;
      const order = { type: 'patrol', x1: u.x, y1: u.y, x2: x, y2: y, leg: 1 };
      if (queued && u.order && u.order.type !== 'idle') { this.queueOrder(u, order); continue; }
      u.oq = [];
      u.order = order; u.targetId = null;
      this.setPath(u, x, y);
    }
    this.events.push({ type: 'move', heavy: this.idsHeavy(ids) });
  }

  cmdHold(side, ids, queued = false) {
    for (const id of ids) {
      const u = this.entities.get(id);
      if (!u || u.kind !== 'unit' || u.side !== side || u.dead) continue;
      const order = { type: u.order?.type === 'hold' ? 'guard' : 'hold', x: u.x, y: u.y };
      // hold = 原地坚守（只打射程内）；再按一次 = guard = 小范围追击后返回
      if (queued && u.order && u.order.type !== 'idle') { this.queueOrder(u, order); continue; }
      u.oq = [];
      u.order = order; u.path = null; u.targetId = null;
    }
    this.events.push({ type: 'move', heavy: this.idsHeavy(ids) });
  }

  cmdAttack(side, ids, targetId, queued = false) {
    const t = this.entities.get(targetId);
    if (!t) return;
    for (const id of ids) {
      const u = this.entities.get(id);
      if (!u || u.kind !== 'unit' || u.side !== side || u.dead) continue;
      const def = UNITS[u.type];
      if (def.capture && t.kind === 'building' && t.side !== side) { this.cmdCapture(side, [id], targetId, queued); continue; }
      if (queued && u.order && u.order.type !== 'idle') { this.queueOrder(u, { type: 'attack', targetId }); continue; }
      u.oq = [];
      u.order = { type: 'attack' };
      u.targetId = targetId;
      // 立刻向目标寻路：远距离点名也要马上动身（ combat 层 chase 分支负责后续重寻路）
      this.setPath(u, t.x, t.y);
    }
    this.events.push({ type: 'move', heavy: this.idsHeavy(ids) });
  }

  cmdHarvest(side, ids, x, y, queued = false) {
    for (const id of ids) {
      const u = this.entities.get(id);
      if (!u || u.type !== 'harvester' || u.side !== side || u.dead) continue;
      if (queued && u.order && u.order.type !== 'idle' && u.order.type !== 'harvest') { this.queueOrder(u, { type: 'harvest' }); continue; }
      u.oq = [];
      u.harvest = { state: 'idle', timer: 0 };
      u.order = { type: 'harvest' };
    }
    this.events.push({ type: 'move', heavy: this.idsHeavy(ids) });
  }

  cmdCapture(side, ids, targetId, queued = false) {
    for (const id of ids) {
      const u = this.entities.get(id);
      if (!u || u.side !== side || u.dead || !UNITS[u.type].capture) continue;
      if (queued && u.order && u.order.type !== 'idle') { this.queueOrder(u, { type: 'capture', targetId }); continue; }
      u.oq = [];
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
      // 脚印内的单位先推出去（与 cmdPlace 一致）：哨兵先占位，防止被推进同脚印相邻格
      for (let dy = 0; dy < def.h; dy++)
        for (let dx = 0; dx < def.w; dx++)
          this.bgrid[this.idx(tx + dx, ty + dy)] = -2;
      for (const v of this.unitsInFootprint(tx, ty, def.w, def.h)) {
        const alt = nearestOpen(this, Math.floor(v.x), Math.floor(v.y), 6);
        if (alt) { v.x = alt.x + 0.5; v.y = alt.y + 0.5; v.path = null; }
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
      u.oq = []; // 停止=清空队列
      u.order = { type: 'idle' };
      u.path = null; u.targetId = null;
      if (u.type === 'harvester') u.order = { type: 'harvest' };
    }
  }

  cmdRally(side, id, x, y) {
    const b = this.entities.get(id);
    if (b && b.kind === 'building' && b.side === side) b.rally = { x, y };
  }

  // 建筑挂机维修开关：按修理厂同价自修（$0.5/HP），R 键切换
  cmdRepairBuilding(side, id) {
    const b = this.entities.get(id);
    if (!b || b.kind !== 'building' || b.side !== side || b.dead) return false;
    if (b.hp >= b.maxHp && !b.repairSelf) return false;
    b.repairSelf = !b.repairSelf;
    return true;
  }

  cmdSell(side, id) {
    const b = this.entities.get(id);
    if (!b || b.kind !== 'building' || b.side !== side) return false;
    this.credits[side] += Math.floor(BUILDINGS[b.type].cost / 2);
    if (side === 'player') {
      this.fx.push({ type: 'text', text: `+$${Math.floor(BUILDINGS[b.type].cost / 2)}`, color: '#ffd866', x: b.x, y: b.y - 0.9, ttl: 80, max: 80 });
      this.events.push({ type: 'deposit', x: b.x, y: b.y }); // 变卖回款金币音
    }
    this.killEntity(b);
    return true;
  }

  // 超级武器「轨道动能炮」：研发授权后可全图打击，预警后落地毁灭伤害
  cmdSuper(side, x, y) {
    if (!this.upgrades[side]?.owned.has('super')) return false;
    if ((this.superCd[side] ?? 0) > 0) {
      if (side === 'player') { this.messages.push({ side, text: '轨道炮充能中', ttl: 60 }); this.events.push({ type: 'error' }); }
      return false;
    }
    x = clamp(x, 1, this.w - 1); y = clamp(y, 1, this.h - 1);
    this.superCd[side] = ECON.super.cooldown;
    if (this.stats[side]) this.stats[side].superFired++; // 超武发射次数战报
    this.fx.push({ type: 'superAim', x, y, ttl: ECON.super.delay * 2, max: ECON.super.delay * 2, side });
    this.strikes.push({ x, y, t: ECON.super.delay, side });
    this.events.push({ type: 'superLaunch', x, y });
    if (side === 'player') this.messages.push({ side, text: '轨道动能炮已锁定目标', ttl: 90 });
    else {
      // 敌方超武预警：给玩家 1.7s 拉开部队的公平机会（职业级标配）
      this.messages.push({ side: 'player', text: '⚠ 侦测到敌方轨道打击充能！立即疏散部队！', ttl: 150 });
      this.events.push({ type: 'underAttack', x, y });
      this.strikeAlarm = { x, y, ttl: ECON.super.delay };
    }
    return true;
  }

  updateStrikes() {
    for (let i = this.strikes.length - 1; i >= 0; i--) {
      const s = this.strikes[i];
      // 敌方打击预警期：周期性警报声浪（配合全屏红脉冲）
      if (s.side === 'enemy' && s.t > 0 && s.t % 12 === 0) this.events.push({ type: 'siren', x: s.x, y: s.y });
      if (--s.t > 0) continue;
      this.strikes.splice(i, 1);
      // 伪击杀方携带阵营：轨道炮击杀计入战报击毁数并触发击杀确认音（经验不给——不是具体单位的战功）
      splashDamage(this, s.x, s.y, { dmg: ECON.super.dmg, dtype: 'shell', splash: ECON.super.radius }, { side: s.side, dead: false, id: -1 });
      this.fx.push({ type: 'boom', x: s.x, y: s.y, r: ECON.super.radius, ttl: 20, max: 20, shake: 1 });
      this.events.push({ type: 'superHit', x: s.x, y: s.y });
    }
  }

  // 修理厂：范围内友军地面载具持续维修（按耐久扣费）
  updateRepairPads() {
    for (const b of this.entities.values()) {
      if (b.kind !== 'building' || b.dead || !BUILDINGS[b.type].repair) continue;
      for (const u of this.entities.values()) {
        if (u.kind !== 'unit' || u.dead || u.side !== b.side || u.hp >= u.maxHp) continue;
        const def = UNITS[u.type];
        if (def.fly || def.inf) continue;
        if (dist(u.x, u.y, b.x, b.y) > ECON.repair.radius) continue;
        const heal = Math.min(ECON.repair.rate / TICK_RATE, u.maxHp - u.hp, this.credits[b.side] / ECON.repair.costPerHp);
        if (heal <= 0) continue;
        u.hp += heal;
        this.credits[b.side] -= heal * ECON.repair.costPerHp;
        if (this.tickCount % 8 === 0) this.fx.push({ type: 'repair', x: u.x, y: u.y, ttl: 6, max: 6 });
      }
    }
  }

  // 中立补给站持续产出资金
  updateNeutralIncome() {
    for (const b of this.entities.values()) {
      if (b.kind !== 'building' || b.dead || b.type !== 'outpost') continue;
      if (b.side !== 'player' && b.side !== 'enemy') continue;
      this.credits[b.side] += ECON.neutral.income;
      if (b.side === 'player') this.fx.push({ type: 'text', text: `+$${ECON.neutral.income}`, color: '#ffd866', x: b.x, y: b.y - 0.9, ttl: 80, max: 80 });
      this.events.push({ type: 'deposit', x: b.x, y: b.y });
    }
  }

  // 编队分离：同高度层单位半径互斥，避免大兵团叠罗汉（空间哈希 O(n)）
  // 检查 3×3 邻域格：只查本格会漏掉骑在格线两侧的重叠对（格宽 0.5 < 分离直径 0.84）
  separateUnits() {
    const grid = new Map();
    for (const u of this.entities.values()) {
      if (u.kind !== 'unit' || u.dead) continue;
      const k = (Math.floor(u.x * 2) * 1000 + Math.floor(u.y * 2));
      let cell = grid.get(k);
      if (!cell) grid.set(k, (cell = []));
      cell.push(u);
    }
    const R = 0.42, R2 = R * R;
    for (const [k, cell] of grid) {
      const cx = Math.floor(k / 1000), cy = k % 1000;
      for (let i = 0; i < cell.length; i++) {
        const a = cell[i];
        const aFly = !!UNITS[a.type]?.fly;
        // 本格 + 右/下方向邻格（方向去重保证每对只算一次，避免双向重复推挤加倍）
        for (let gy = 0; gy <= 1; gy++) {
          for (let gx = -1; gx <= 1; gx++) {
            if (gy === 0 && gx < 0) continue; // 左/上邻格由对方格子处理
            const nk = (cx + gx) * 1000 + (cy + gy);
            const other = nk === k ? cell : grid.get(nk);
            if (!other) continue;
            for (let j = nk === k ? i + 1 : 0; j < other.length; j++) {
              const b = other[j];
              if (b.id === a.id || !!UNITS[b.type]?.fly !== aFly) continue; // 空地分层
              const dx = b.x - a.x, dy = b.y - a.y;
              const d2 = dx * dx + dy * dy;
              if (d2 >= R2 || d2 < 1e-8) continue;
              const d = Math.sqrt(d2);
              const push = ((R - d) / d) * 0.06;
              const px = dx * push, py = dy * push;
              // 前向阻挡检查：分离不许把单位推进建筑/岩石（否则会卡在 footprint 里）
              const nax = a.x - px, nay = a.y - py;
              if (aFly || !this.isBlocked(Math.floor(nax), Math.floor(nay))) { a.x = nax; a.y = nay; }
              const nbx = b.x + px, nby = b.y + py;
              if (!aFly || !this.isBlocked(Math.floor(nbx), Math.floor(nby))) { b.x = nbx; b.y = nby; }
            }
          }
        }
      }
    }
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
    if (path === null) {
      // 不可达（封闭区域等）：直线逼近，保证部队对命令有响应而不是罚站
      u.path = [{ x: tx + 0.5, y: ty + 0.5 }];
      u.pathi = 0;
      return true;
    }
    u.path = path; u.pathi = 0;
    return true;
  }

  // 巡逻：两点往返，接敌停火（combat 开火不追击），战后继续走当前腿——
  // 只有真正抵达腿终点才翻腿，被战斗打断只重寻同一腿，避免来回抽风
  updatePatrol(u) {
    if (u.targetId) { u.path = null; return; }
    if (u.path) return;
    const tx = u.order.leg ? u.order.x2 : u.order.x1;
    const ty = u.order.leg ? u.order.y2 : u.order.y1;
    if (dist(u.x, u.y, tx, ty) > 1.2) { this.setPath(u, tx, ty); return; }
    u.order.leg = u.order.leg === 1 ? 0 : 1;
    const nx = u.order.leg ? u.order.x2 : u.order.x1;
    const ny = u.order.leg ? u.order.y2 : u.order.y1;
    this.setPath(u, nx, ny);
  }

  // 固守(hold)：原地开火绝不移动；警戒(guard)：锚点 8 格内追击，超出即回位
  updateStance(u) {
    const o = u.order;
    if (o.type === 'hold') { u.path = null; return; }
    const ax = o.x, ay = o.y;
    const t = u.targetId != null ? this.entities.get(u.targetId) : null;
    if (t && !t.dead) {
      if (dist(t.x, t.y, ax, ay) > 8) u.targetId = null; // 牵引绳：放掉跑远的
      else if (!u.path && (u.repathCd = (u.repathCd || 0) - 1) <= 0) {
        u.repathCd = 15;
        this.setPath(u, t.x, t.y);
      }
      return;
    }
    if (dist(u.x, u.y, ax, ay) > 0.8 && !u.path) this.setPath(u, ax, ay);
  }

  // 抵达后推进队列；返回 true 表示还有后续/循环指令
  arriveAdvance(u) {
    if (this.popQueued(u)) return true;
    u.order = u.type === 'harvester' ? { type: 'harvest' } : { type: 'idle' };
    return false;
  }

  updateMovement(u) {
    if (!u.path) return;
    const wp = u.path[u.pathi];
    if (!wp) { // 空路径（同格下单）：直接推进队列而非罚站
      u.path = null;
      if (u.order?.type === 'move' || u.order?.type === 'attackmove') this.arriveAdvance(u);
      return;
    }
    const step = (u.speed * (this.upgrades[u.side]?.speed || 1)) / TICK_RATE;
    const d = dist(u.x, u.y, wp.x, wp.y);
    if (d <= step) {
      u.x = wp.x; u.y = wp.y;
      if (++u.pathi >= u.path.length) {
        u.path = null;
        if (u.order?.type === 'move') this.arriveAdvance(u);
        else if (u.order?.type === 'attackmove') {
          if (dist(u.x, u.y, u.order.x, u.order.y) <= 1.5) this.arriveAdvance(u);
          else this.setPath(u, u.order.x, u.order.y); // 被挡停就地重寻
        }
      }
      return;
    }
    u.dir = Math.atan2(wp.y - u.y, wp.x - u.x);
    u.x += Math.cos(u.dir) * step;
    u.y += Math.sin(u.dir) * step;
    // 边界钳制：后撤寻路失败/直线逼近可能把单位引出地图，绝不允许走出战场
    u.x = clamp(u.x, 0.5, this.w - 0.5);
    u.y = clamp(u.y, 0.5, this.h - 0.5);
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
          this.stats[side].built++;
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
    const def = UNITS[item] || BUILDINGS[item] || UPGRADES[item];
    const total = buildTicks(def);
    // 建筑完成但等待放置槽空闲时，停在 100%
    if (BUILDINGS[item] && this.sides[b.side].placing && b.progress >= total) return;
    // 多兵营/多战车工厂并行加速：+35%/座（上限 170%），经济扩张的建造深度
    let rate = this.power[b.side]?.low ? 0.5 : 1;
    if (b.type === 'barracks' || b.type === 'factory') {
      const same = this.buildingsOf(b.side).filter(x => x.type === b.type).length;
      rate *= Math.min(ECON.prodSpeed.cap, 1 + (same - 1) * ECON.prodSpeed.bonus);
    }
    b.progress += rate;
    if (b.progress < total) return;

    if (UPGRADES[item]) {
      // 科技研发完成：全局加成生效（超武授权走 owned 集合，wfire 按武器键入 wf 表）
      const up = UPGRADES[item];
      if (up.effect === 'wfire') {
        const wf = this.upgrades[b.side].wf;
        for (const wk of up.affects) wf[wk] = up.value;
      } else if (up.effect !== 'super') {
        this.upgrades[b.side][up.effect] = up.value;
      }
      this.upgrades[b.side].owned.add(item);
      b.queue.shift(); b.progress = 0;
      if (b.side === 'player') {
        this.messages.push({ side: b.side, text: `${up.name} 研发完成：${up.desc}`, ttl: 180 });
        this.events.push({ type: 'techDone' });
      }
    } else if (BUILDINGS[item]) {
      this.sides[b.side].placing = item;
      if (b.side === 'player') {
        this.messages.push({ side: b.side, text: `${def.name} 已就绪，点击地图放置`, ttl: 180 });
        this.events.push({ type: 'ready' });
      }
    } else {
      const u = this.spawnUnitNear(b.side, item, b);
      if (!u) { b.progress = total; return; } // 出口被堵，等待
      b.queue.shift(); b.progress = 0;
      this.fx.push({ type: 'spawn', x: u.x, y: u.y, ttl: 6, max: 6 }); // 出兵扬尘（渲染层）
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
    // 中立建筑可直接占领；敌方建筑需先打残（<50%）
    if (t.side === 'neutral' || t.hp < t.maxHp * 0.5) {
      const wasNeutral = t.side === 'neutral';
      t.side = u.side;
      t.queue = []; t.progress = 0;
      const label = BUILDINGS[t.type].name;
      if (u.side === 'player') this.fx.push({ type: 'text', text: wasNeutral ? '占领！' : '夺占！', color: '#7ee787', x: t.x, y: t.y - 1, ttl: 90, max: 90 });
      this.messages.push({ side: u.side, text: `${wasNeutral ? '已占领中立' : '已占领敌方'}${label}！`, ttl: 150 });
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
    // 敌方飞行单位首次进入视野：一次性防空预警（RA 式威胁播报，整个单位只报一次）
    for (const e of this.entities.values()) {
      if (e.side === 'player' || e.dead || e.kind !== 'unit' || !UNITS[e.type]?.fly) continue;
      if (this.announcedFly?.has(e.id)) continue;
      if (fog[this.idx(Math.floor(e.x), Math.floor(e.y))] !== 2) continue;
      (this.announcedFly ??= new Set()).add(e.id);
      this.messages.push({ side: 'player', text: `⚠ 侦测到敌方${UNITS[e.type].name}！部署防空火力！`, ttl: 180 });
      this.events.push({ type: 'siren', x: e.x, y: e.y });
      this.alerts.push({ x: e.x, y: e.y, ttl: 75, max: 75, side: 'player' });
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
      if (e.dead) continue; // 同 tick 内被击杀的实体立即停摆：死者不再移动/开火/生产
      if (e.flash > 0) e.flash--;
      if (e.recoil > 0) e.recoil--; // 炮管后坐恢复（渲染用）
      if (e.kind === 'unit') {
        // 磁暴瘫痪：原地僵直，不能移动不能开火（渲染层冒电火花）
        if (e.stun > 0) { e.stun--; continue; }
        this.updateMovement(e);
        if (e.order?.type === 'harvest') updateHarvester(this, e);
        else if (e.order?.type === 'capture') this.updateCapture(e);
        else if (e.order?.type === 'attackmove' && !e.targetId && !e.path && dist(e.x, e.y, e.order.x, e.order.y) > 1.5) {
          this.setPath(e, e.order.x, e.order.y);
        }
        else if (e.order?.type === 'patrol') this.updatePatrol(e);
        // hold/guard 每 tick 都要跑姿态判定：guard 的 8 格拴绳必须在追击路径存在时也生效，
        // 否则目标跑远后 path 挂着，警戒变成无限追击
        else if ((e.order?.type === 'hold' || e.order?.type === 'guard') && e.weapon) this.updateStance(e);
        if (e.weapon) updateCombat(this, e);
        else if (!e.path && (e.order?.type === 'move' || e.order?.type === 'attackmove')) this.arriveAdvance(e);
      } else {
        this.updateProduction(e);
        if (e.weapon) updateCombat(this, e);
        // 挂机维修：按修理厂同价自修（每 tick 10HP/s ÷ 30，钱不够自动停）
        if (e.repairSelf && e.hp < e.maxHp) {
          const heal = Math.min(ECON.repair.rate / TICK_RATE, e.maxHp - e.hp, this.credits[e.side] / ECON.repair.costPerHp);
          if (heal > 0) {
            e.hp += heal;
            this.credits[e.side] -= heal * ECON.repair.costPerHp;
            if (this.tickCount % 8 === 0) this.fx.push({ type: 'repair', x: e.x + (Math.random() - 0.5) * e.w, y: e.y + (Math.random() - 0.5) * e.h, ttl: 6, max: 6 });
          }
        }
      }
    }

    this.separateUnits();
    updateProjectiles(this);
    this.updateStrikes();
    if (this.strikeAlarm && --this.strikeAlarm.ttl <= 0) this.strikeAlarm = null;
    this.updateRepairPads();
    if (this.tickCount % ECON.neutral.period === 0) this.updateNeutralIncome();
    for (const s of ['player', 'enemy']) {
      if (this.superCd[s] > 0) {
        this.superCd[s]--;
        if (this.superCd[s] === 0 && s === 'player' && this.upgrades.player.owned.has('super')) {
          // 充能完毕：以往只能盯着按钮倒数，现在有明确的声音+文字提示
          this.messages.push({ side: 'player', text: '轨道动能炮充能完毕（V 键发射）', ttl: 150 });
          this.events.push({ type: 'ready' });
        }
      }
    }

    // 后台标签/无头快进时渲染层不消费 fx，限制容量防堆积
    if (this.fx.length > 500) this.fx.splice(0, this.fx.length - 500);
    if (this.alerts.length && this.tickCount % 5 === 0) {
      this.alerts = this.alerts.filter(a => (a.ttl -= 5) > 0);
    }
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

  // 基地位置：左下候选点 seed 抽取，敌方取中心对称点（180° 旋转对称保证公平）
  const CANDIDATES = [[7, 79], [10, 74], [6, 71]];
  const [px, py] = CANDIDATES[Math.floor(rng() * CANDIDATES.length)];
  const ex = 93 - px, ey = 93 - py;

  // 出生区域清场（覆盖基地+精炼厂+矿区外沿）——先清场后铺矿，矿不被清掉
  clearRect(w, px - 3, py - 14, 21, 21);
  clearRect(w, ex - 16, ey - 6, 21, 21);

  // 矿区：双方近矿随基地相对布置，中场两片沿中线微抖动（保持中心对称）
  const mj = Math.floor(rng() * 5) - 2; // -2..2
  orePatch(w, px + 17, py - 9, 4); orePatch(w, ex - 17, ey + 9, 4);
  orePatch(w, 36 + mj, 48, 3); orePatch(w, 60 - mj, 48, 3);

  // 初始基地
  base(w, 'player', px, py);
  base(w, 'enemy', ex, ey);
  // 中场护卫（让玩家前期有仗可打）
  w.addUnit('enemy', 'tyrant', 60 - mj + 0.5, 44.5);
  w.addUnit('enemy', 'tyrant', 36 + mj + 0.5, 51.5);
  // 中立补给站：双方工程师争夺的经济要点（紧邻中场矿区，随矿位布置）
  clearRect(w, 36 + mj, 42, 3, 3);
  clearRect(w, 58 - mj, 41, 3, 3);
  w.addBuilding('neutral', 'outpost', 37 + mj, 43);
  w.addBuilding('neutral', 'outpost', 59 - mj, 42);

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
