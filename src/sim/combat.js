// 武器、弹道与伤害结算（含开火来源追踪 → 老兵经验/战报统计）

import { WEAPONS, DAMAGE_MULT, ECON } from '../config.js';
import { dist } from './util.js';

// 单个武装实体（单位/防御塔）的索敌与开火
export function updateCombat(world, e) {
  const w = WEAPONS[e.weapon];
  if (!w) return;
  if (e.cooldown > 0) e.cooldown--;
  if (e.cloak > 0) e.cloak--; // 迷彩现形倒计时（狙击手开火/受击后短暂显形）

  // 防御塔低电停摆
  if (e.kind === 'building' && world.power[e.side]?.low) return;

  // 火箭炮齐射进行中：按 burstCd 逐发发射，期间不索敌
  if (e.burst) {
    const t = world.entities.get(e.burst.targetId);
    if (!t || t.dead) { e.burst = null; }
    else if ((e.burst.cd--) <= 0) {
      e.burst.cd = w.burstCd;
      e.dir = Math.atan2(t.y - e.y, t.x - e.x);
      fireOne(world, e, w, t, (Math.random() - 0.5) * 0.3);
      if (--e.burst.left <= 0) e.burst = null;
    }
    return;
  }

  // 校验当前目标
  let target = e.targetId != null ? world.entities.get(e.targetId) : null;
  if (target && (target.dead || !canEngage(world, e, w, target, 1.4))) {
    target = null; e.targetId = null;
  }

  // 索敌：防御塔扫武器射程，单位扫射程（攻击移动时扫视野）
  if (!target && --e.scanCd <= 0) {
    e.scanCd = 10;
    const r = (e.order?.type === 'attackmove' && e.sight) ? Math.max(e.sight, w.range) : w.range;
    target = acquireTarget(world, e, w, r);
    if (target) e.targetId = target.id;
  }

  if (!target) return;

  const d = dist(e.x, e.y, target.x, target.y);
  if (d > w.range) {
    // 单位主动追击（防御塔不动）；idle 单位不追击，只打进入射程的敌人
    if (e.kind === 'unit' && (e.order?.type === 'attack' || e.order?.type === 'attackmove')) {
      if ((e.repathCd = (e.repathCd || 0) - 1) <= 0) {
        e.repathCd = 15;
        world.setPath(e, target.x, target.y);
      }
    }
    return;
  }
  if (w.minRange && d < w.minRange) return; // 巡航导弹最小射程，贴脸打不了

  e.dir = Math.atan2(target.y - e.y, target.x - e.x);
  if (e.cooldown > 0) return;
  e.cooldown = w.cooldown;
  fire(world, e, w, target);
}

function canEngage(world, e, w, target, slack = 1) {
  if (target.side === e.side) return false;
  const isAir = !!world.unitDef(target)?.fly;
  if (isAir && !w.canAir) return false;
  if (!isAir && w.airOnly) return false;
  return dist(e.x, e.y, target.x, target.y) <= w.range * slack;
}

function acquireTarget(world, e, w, range) {
  let best = null, bestD = Infinity;
  for (const t of world.entities.values()) {
    if (t.dead || t.side === e.side) continue;
    const def = world.unitDef(t);
    const isAir = !!def?.fly;
    if (isAir && !w.canAir) continue;
    if (!isAir && w.airOnly) continue;
    // 光学迷彩：隐形单位只有近身（或现形倒计时中）才能被索敌
    if (def?.stealth && !(t.cloak > 0) && dist(e.x, e.y, t.x, t.y) > ECON.cloak.near) continue;
    const d = dist(e.x, e.y, t.x, t.y);
    if (d <= range && d < bestD) { bestD = d; best = t; }
  }
  return best;
}

function fire(world, e, w, target) {
  world.events.push({ type: 'shot', w: e.weapon, side: e.side, x: e.x, y: e.y });
  // 齐射武器：先发第一枚，剩余进入连发队列
  if (w.burst) {
    e.burst = { left: w.burst - 1, targetId: target.id, cd: w.burstCd };
    fireOne(world, e, w, target, 0);
    return;
  }
  fireOne(world, e, w, target, 0);
}

function fireOne(world, e, w, target, off = 0) {
  if (w.projSpeed > 0) e.recoil = 5; // 炮管后坐（渲染动画用）
  if (world.unitDef(e)?.stealth) e.cloak = ECON.cloak.reveal; // 开火即现形
  // 枪口焰（渲染层粒子 + 点光源）
  world.fx.push({
    type: 'muzzle',
    x: e.x + Math.cos(e.dir) * 0.55, y: e.y + Math.sin(e.dir) * 0.55,
    dir: e.dir, big: w.dmg >= 60, ttl: 4, max: 4,
  });
  const ups = world.upgrades?.[e.side];
  const dmg = w.dmg * (e.dmgMul || 1) * (ups?.fire || 1); // 老兵 + 科技火力加成
  if (w.projSpeed <= 0) {
    // 即时命中：激光/粒子光束/子弹
    const energy = w.dtype === 'energy';
    world.fx.push({
      type: energy ? 'beam' : 'tracer',
      x1: e.x, y1: e.y, x2: target.x, y2: target.y,
      color: energy ? (e.side === 'player' ? '#7df9ff' : '#ffb347') : '#ffe9a8',
      ttl: energy ? 9 : 4, max: energy ? 9 : 4,
    });
    applyDamage(world, target, dmg, w.dtype, e);
  } else {
    world.projectiles.push({
      x: e.x, y: e.y + off, targetId: target.id, tx: target.x, ty: target.y,
      speed: w.projSpeed, weapon: e.weapon, side: e.side, srcId: e.id,
      dmgMul: (e.dmgMul || 1) * (ups?.fire || 1),
      homing: w.dtype === 'missile',
    });
  }
}

export function updateProjectiles(world) {
  const list = world.projectiles;
  for (let i = list.length - 1; i >= 0; i--) {
    const p = list[i];
    const w = WEAPONS[p.weapon];
    const target = p.targetId != null ? world.entities.get(p.targetId) : null;
    if (p.homing && target && !target.dead) { p.tx = target.x; p.ty = target.y; }

    const d = dist(p.x, p.y, p.tx, p.ty);
    if (d <= Math.max(p.speed, 0.35)) {
      // 命中
      const src = p.srcId != null ? world.entities.get(p.srcId) : null;
      if (p.homing && target && !target.dead) {
        applyDamage(world, target, w.dmg * p.dmgMul, w.dtype, src);
      }
      if (w.splash > 0) splashDamage(world, p.tx, p.ty, w, src);
      world.fx.push({ type: 'boom', x: p.tx, y: p.ty, r: w.splash > 0 ? w.splash : 0.5, ttl: 12, max: 12 });
      world.events.push({ type: 'boom', big: w.splash >= 1, x: p.tx, y: p.ty });
      list.splice(i, 1);
      continue;
    }
    p.x += ((p.tx - p.x) / d) * p.speed;
    p.y += ((p.ty - p.y) / d) * p.speed;
  }
}

export function splashDamage(world, x, y, w, src = null) {
  for (const t of [...world.entities.values()]) {
    if (t.dead) continue;
    const d = dist(x, y, t.x, t.y);
    if (d > w.splash) continue;
    const falloff = d < w.splash * 0.5 ? 1 : 0.5;
    applyDamage(world, t, w.dmg * falloff, w.dtype, src);
  }
}

export function applyDamage(world, target, raw, dtype, src = null) {
  if (target.dead) return;
  const armor = target.kind === 'building' ? 'building' : world.unitDef(target).armor;
  const mult = DAMAGE_MULT[dtype][armor] ?? 1;
  if (mult <= 0) return;
  const ups = world.upgrades?.[target.side];
  target.hp -= (raw * mult) / (ups?.armor || 1); // 复合装甲减伤
  target.flash = 4; // 受击闪白（渲染用）
  if (world.unitDef(target)?.stealth) target.cloak = Math.max(target.cloak || 0, 45); // 受击显形 1.5s
  world.onDamaged(target, src);
  if (target.hp <= 0) world.killEntity(target, src);
}
