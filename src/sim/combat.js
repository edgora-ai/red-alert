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
    else if (--e.burst.cd <= 0) {
      e.burst.cd = w.burstCd;
      e.dir = Math.atan2(t.y - e.y, t.x - e.x);
      fireOne(world, e, w, t, (Math.random() - 0.5) * 0.3);
      if (--e.burst.left <= 0) e.burst = null;
    }
    return;
  }

  // 校验当前目标；目标死亡/脱离后若有排队指令则推进（attack 队列逐个点名）
  // 注意：attack/guard 是"点名追杀"指令——目标只是暂时超出射程时绝不丢弃（chase 分支负责接近），
  // 否则右键点远处敌人会被射程校验吞掉指令，部队原地罚站。
  // 非追击姿态（hold/idle/patrol/attackmove）用 1.05 倍紧口径：目标一出射程立刻丢弃重扫，
  // 不在 1.4 倍的"打不着又不转火"死区里耗着
  let target = e.targetId != null ? world.entities.get(e.targetId) : null;
  // 残留目标清理：killEntity 会把实体从 map 删除（get→undefined），此前的校验只处理了
  // target 非空的情况——指向已消失实体的残留 id 永远不清零，attackmove 的重寻路分支
  // （world.tick 要求 !targetId）被 truthy 残留永久阻塞，部队在开阔地挂机（E2E 复现）
  if (e.targetId != null && (!target || target.dead)) {
    target = null; e.targetId = null;
    if (e.order?.type === 'attack' && e.kind === 'unit') {
      if (!world.popQueued(e)) { e.order = { type: 'idle' }; }
      else if (e.order?.type === 'move' || e.order?.type === 'attackmove') return;
    }
  }
  const chaseOrder = e.order?.type === 'attack' || e.order?.type === 'guard';
  if (target && (target.dead || !canEngage(world, e, w, target, chaseOrder ? Infinity : 1.05))) {
    target = null; e.targetId = null;
    if (e.order?.type === 'attack' && e.kind === 'unit') {
      if (!world.popQueued(e)) { e.order = { type: 'idle' }; }
      else if (e.order?.type === 'move' || e.order?.type === 'attackmove') return; // 切到移动指令：本帧先走路
    }
    // 巡逻/警戒被打断后恢复走路（由 updatePatrol/updateStance 接管）
    if ((e.order?.type === 'patrol' || e.order?.type === 'guard' || e.order?.type === 'attackmove') && !e.path) {
      target = null;
    }
  }

  // 索敌：防御塔扫武器射程；单位按姿态扫（攻击移动/巡逻用视野，固守只看射程，警戒看锚点 8 格）
  if (!target && --e.scanCd <= 0) {
    e.scanCd = 10;
    const o = e.order?.type;
    if (e.kind === 'unit' && (o === 'guard' || o === 'hold')) {
      target = acquireLeashed(world, e, w, o === 'hold' ? w.range : 8);
    } else {
      const r = ((o === 'attackmove' || o === 'patrol') && e.sight) ? Math.max(e.sight, w.range) : w.range;
      target = acquireTarget(world, e, w, r);
    }
    if (target) e.targetId = target.id;
  }

  if (!target) return;

  // 巡逻/攻击移动/警戒：停下来开火（经典 RTS 行为），打完继续走
  const o = e.order?.type;
  if ((o === 'patrol' || o === 'attackmove' || o === 'guard') && e.path) e.path = null;

  const d = dist(e.x, e.y, target.x, target.y);
  if (d > w.range) {
    // 固守(hold)/idle 绝不追击；只有 attack/attackmove/guard（拴绳内）追击
    const chase = o === 'attack' || o === 'attackmove' || o === 'guard';
    if (e.kind === 'unit' && chase) {
      if ((e.repathCd = (e.repathCd || 0) - 1) <= 0) {
        e.repathCd = 15;
        world.setPath(e, target.x, target.y);
      }
    }
    return;
  }
  // 长手风筝：有最小射程的火炮（巡航导弹/火箭炮）被贴脸时主动后撤拉开
  if (w.minRange && d < w.minRange && e.kind === 'unit' && (e.order?.type === 'attack' || e.order?.type === 'attackmove' || e.order?.type === 'guard')) {
    if ((e.repathCd = (e.repathCd || 0) - 1) <= 0) {
      e.repathCd = 20;
      const dx = e.x - target.x, dy = e.y - target.y;
      const len = Math.hypot(dx, dy) || 1;
      world.setPath(e, e.x + (dx / len) * (w.minRange + 1.5), e.y + (dy / len) * (w.minRange + 1.5));
    }
    return;
  }
  if (w.minRange && d < w.minRange) return; // 贴脸盲区内打不了

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

// 警戒索敌：以锚点为圆心 leash 格内找敌（hold 传射程=原地，guard 传 8=小范围）
function acquireLeashed(world, e, w, leash) {
  const ax = e.order?.x ?? e.x, ay = e.order?.y ?? e.y;
  let best = null, bestD = Infinity;
  for (const t of world.entities.values()) {
    if (t.dead || t.side === e.side) continue;
    const def = world.unitDef(t);
    const isAir = !!def?.fly;
    if (isAir && !w.canAir) continue;
    if (!isAir && w.airOnly) continue;
    if (def?.stealth && !(t.cloak > 0) && dist(e.x, e.y, t.x, t.y) > ECON.cloak.near) continue;
    if (dist(ax, ay, t.x, t.y) > leash) continue;
    const d = dist(e.x, e.y, t.x, t.y);
    // 集火微操：残血目标距离打 65 折——优先送走快死的
    const score = d * (t.hp < t.maxHp * 0.35 ? 0.65 : 1);
    if (d <= w.range && score < bestD) { bestD = score; best = t; }
  }
  return best;
}

function acquireTarget(world, e, w, range) {
  let best = null, bestD = Infinity;
  // 防空单位优先打空（距离打 5 折参与最近比较），避免被地面肉盾吸火力
  const aaBias = w.canAir && (e.type === 'hunter' || e.kind === 'building') ? 0.5 : 1;
  for (const t of world.entities.values()) {
    if (t.dead || t.side === e.side) continue;
    const def = world.unitDef(t);
    const isAir = !!def?.fly;
    if (isAir && !w.canAir) continue;
    if (!isAir && w.airOnly) continue;
    // 光学迷彩：隐形单位只有近身（或现形倒计时中）才能被索敌
    if (def?.stealth && !(t.cloak > 0) && dist(e.x, e.y, t.x, t.y) > ECON.cloak.near) continue;
    const d = dist(e.x, e.y, t.x, t.y);
    // 集火微操：残血目标（<35%）距离打 65 折——优先补刀，火力不浪费在满血肉盾上
    const dmgBias = t.hp < t.maxHp * 0.35 ? 0.65 : 1;
    const score = (isAir ? d * aaBias : d) * dmgBias;
    if (d <= range && score < bestD) { bestD = score; best = t; }
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
  // 枪口焰：磁暴线圈/激光塔等建筑即时能量武器从塔顶出弧，不再喷塔脚枪口焰；
  // 飞行单位（基洛夫/无人机）携带高度，枪口焰跟着挂载点走而不是喷在地面；
  // 步兵枪短，焰口贴身（0.3）而非按载具的 0.55 悬在半格外
  if (!(e.kind === 'building' && w.projSpeed <= 0)) {
    const mo = world.unitDef(e)?.inf ? 0.3 : 0.55;
    world.fx.push({
      type: 'muzzle',
      x: e.x + Math.cos(e.dir) * mo, y: e.y + Math.sin(e.dir) * mo,
      dir: e.dir, big: w.dmg >= 60, ttl: 4, max: 4,
      alt: world.unitDef(e)?.fly ? 2.2 : 0,
    });
  }
  const ups = world.upgrades?.[e.side];
  const dmg = w.dmg * (e.dmgMul || 1) * (ups?.fire || 1) * (ups?.wf?.[e.weapon] || 1); // 老兵 + 全军火力 + 武器专属火力
  if (w.projSpeed <= 0) {
    // 即时命中：激光/粒子光束/子弹
    const energy = w.dtype === 'energy';
    world.fx.push({
      type: energy ? 'beam' : 'tracer',
      x1: e.x, y1: e.y, x2: target.x, y2: target.y,
      alt1: e.kind === 'building' ? 1.0 : undefined, // 磁暴线圈从塔顶出弧
      alt2: target.kind === 'building' ? 0.9 : undefined, // 命中建筑打在体表而非贴地
      color: w.color ?? (energy ? (e.side === 'player' ? '#7df9ff' : '#ffb347') : '#ffe9a8'),
      ttl: energy ? 9 : 4, max: energy ? 9 : 4,
      jag: w.jag, // 磁暴锯齿电弧
    });
    if (w.stun && target.kind === 'unit') target.stun = w.stun; // 磁暴麻痹
    applyDamage(world, target, dmg, w.dtype, e);
    if (w.chain) chainArcs(world, e, w, target, dmg); // 链式跳跃（磁暴电弧/光棱折射）
  } else {
    world.projectiles.push({
      x: e.x, y: e.y + off, targetId: target.id, tx: target.x, ty: target.y,
      speed: w.projSpeed, weapon: e.weapon, side: e.side, srcId: e.id,
      dmgMul: (e.dmgMul || 1) * (ups?.fire || 1) * (ups?.wf?.[e.weapon] || 1),
      // 轮49：homing 与 dtype 解耦（此前只有导弹追踪；泰坦电磁炮弹末端制导，设定自洽，
      // 否则高速炮打移动靶全脱靶，$3200 终极被 $2800 碾压）
      homing: w.homing ?? w.dtype === 'missile',
      // 空投弹道（基洛夫）：从飞行高度抛下，渲染层按进度插值高度
      alt0: world.unitDef(e)?.fly ? 2.2 : 0.35,
      totalDist: Math.max(0.001, dist(e.x, e.y, target.x, target.y)),
    });
  }
}

// 链式跳跃伤害（磁暴线圈电弧 / 光棱坦克折射束）：
// 从主目标向 3.6 格内最近的敌方地面单位逐级跳，伤害按 chainFall 衰减
function chainArcs(world, e, w, first, dmg) {
  let from = first;
  const hit = new Set([first.id]);
  for (let i = 0; i < w.chain; i++) {
    let best = null, bd = Infinity;
    for (const t of world.entities.values()) {
      if (t.dead || t.side === e.side || hit.has(t.id) || t.kind !== 'unit') continue;
      const def = world.unitDef(t);
      if (def?.fly) continue; // 电弧/折射贴地跳跃，不打空中
      if (def?.stealth && !(t.cloak > 0) && dist(from.x, from.y, t.x, t.y) > ECON.cloak.near) continue;
      const d = dist(from.x, from.y, t.x, t.y);
      if (d < 3.6 && d < bd) { bd = d; best = t; }
    }
    if (!best) break;
    hit.add(best.id);
    world.fx.push({
      type: 'beam', x1: from.x, y1: from.y, x2: best.x, y2: best.y,
      alt1: e.kind === 'building' && i === 0 ? 1.0 : undefined,
      color: w.color ?? '#9fd8ff', ttl: 8, max: 8, jag: w.jag,
    });
    const d2 = dmg * Math.pow(w.chainFall ?? 0.6, i + 1);
    if (w.stun) best.stun = w.stun; // 链式磁暴同样带麻痹
    applyDamage(world, best, d2, w.dtype, e);
    from = best;
  }
}

export function updateProjectiles(world) {  const list = world.projectiles;
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
  // 复合装甲护单位、装甲工事护建筑（独立科技线）。
  // 承伤倍率按"乘法"生效（value=1/1.2 即 ×0.833=-17%）——写成除法会把减伤变成增伤
  const armorUp = target.kind === 'building' ? (ups?.barmor || 1) : (ups?.armor || 1);
  target.hp -= raw * mult * armorUp;
  target.flash = 4; // 受击闪白（渲染用）
  if (world.unitDef(target)?.stealth) target.cloak = Math.max(target.cloak || 0, 45); // 受击显形 1.5s
  world.onDamaged(target, src);
  if (target.hp <= 0) world.killEntity(target, src);
}
