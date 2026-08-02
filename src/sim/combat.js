// 武器、弹道与伤害结算

import { WEAPONS, DAMAGE_MULT } from '../config.js';
import { dist } from './util.js';

// 单个武装实体（单位/防御塔）的索敌与开火
export function updateCombat(world, e) {
  const w = WEAPONS[e.weapon];
  if (!w) return;
  if (e.cooldown > 0) e.cooldown--;

  // 防御塔低电停摆
  if (e.kind === 'building' && world.power[e.side]?.low) return;

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
    const isAir = !!world.unitDef(t)?.fly;
    if (isAir && !w.canAir) continue;
    if (!isAir && w.airOnly) continue;
    const d = dist(e.x, e.y, t.x, t.y);
    if (d <= range && d < bestD) { bestD = d; best = t; }
  }
  return best;
}

function fire(world, e, w, target) {
  world.events.push({ type: 'shot', w: e.weapon, side: e.side, x: e.x, y: e.y });
  if (w.projSpeed <= 0) {
    // 即时命中：激光/粒子光束/子弹
    const energy = w.dtype === 'energy';
    world.fx.push({
      type: energy ? 'beam' : 'tracer',
      x1: e.x, y1: e.y, x2: target.x, y2: target.y,
      color: energy ? (e.side === 'player' ? '#7df9ff' : '#ffb347') : '#ffe9a8',
      ttl: energy ? 9 : 4, max: energy ? 9 : 4,
    });
    applyDamage(world, target, w.dmg, w.dtype);
  } else {
    world.projectiles.push({
      x: e.x, y: e.y, targetId: target.id, tx: target.x, ty: target.y,
      speed: w.projSpeed, weapon: e.weapon, side: e.side,
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
      if (p.homing && target && !target.dead) {
        applyDamage(world, target, w.dmg, w.dtype);
      }
      if (w.splash > 0) splashDamage(world, p.tx, p.ty, w);
      world.fx.push({ type: 'boom', x: p.tx, y: p.ty, r: w.splash > 0 ? w.splash : 0.5, ttl: 12, max: 12 });
      world.events.push({ type: 'boom', big: w.splash >= 1, x: p.tx, y: p.ty });
      list.splice(i, 1);
      continue;
    }
    p.x += ((p.tx - p.x) / d) * p.speed;
    p.y += ((p.ty - p.y) / d) * p.speed;
  }
}

export function splashDamage(world, x, y, w) {
  for (const t of [...world.entities.values()]) {
    if (t.dead) continue;
    const d = dist(x, y, t.x, t.y);
    if (d > w.splash) continue;
    const falloff = d < w.splash * 0.5 ? 1 : 0.5;
    applyDamage(world, t, w.dmg * falloff, w.dtype);
  }
}

export function applyDamage(world, target, raw, dtype) {
  if (target.dead) return;
  const armor = target.kind === 'building' ? 'building' : world.unitDef(target).armor;
  const mult = DAMAGE_MULT[dtype][armor] ?? 1;
  if (mult <= 0) return;
  target.hp -= raw * mult;
  target.flash = 4; // 受击闪白（渲染用）
  if (target.hp <= 0) world.killEntity(target);
}
