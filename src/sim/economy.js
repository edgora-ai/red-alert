// 采矿经济（矿车状态机）与电力结算

import { T, ECON } from '../config.js';
import { nearestOpen } from './pathfind.js';

// 矿车状态：idle → toOre → loading → toRefinery → idle …
export function updateHarvester(world, u) {
  const h = (u.harvest ??= { state: 'idle', timer: 0 });

  switch (h.state) {
    case 'idle': {
      // 全图无矿待命时限频重扫（96×96 全图扫描不是每 tick 都该做的）
      if ((h.scanCd ?? 0) > 0) { h.scanCd--; return; }
      const ore = findNearestOre(world, u.x, u.y);
      if (!ore) { h.scanCd = 15; return; } // 半秒后再找
      h.oreTx = ore.x; h.oreTy = ore.y;
      world.setPath(u, ore.x + 0.5, ore.y + 0.5);
      h.state = 'toOre';
      break;
    }
    case 'toOre': {
      const i = world.idx(h.oreTx, h.oreTy);
      if (world.ore[i] <= 0) { h.state = 'idle'; u.path = null; break; } // 矿被抢完，重找
      if (!u.path) { // 到达
        h.state = 'loading';
        h.timer = ECON.harvestTicks;
      }
      break;
    }
    case 'loading': {
      // 被推挤离矿格就重找（修复隔空采矿：位置不校验会贴着矿边远程装货）
      if (Math.floor(u.x) !== h.oreTx || Math.floor(u.y) !== h.oreTy) { h.state = 'idle'; u.path = null; break; }
      const i = world.idx(h.oreTx, h.oreTy);
      const perTick = (ECON.loadAmount * (world.upgrades?.[u.side]?.mine || 1)) / ECON.harvestTicks;
      const take = Math.min(perTick, world.ore[i]);
      world.ore[i] -= take;
      u.load = (u.load || 0) + take;
      if (world.ore[i] <= 0) world.tiles[i] = T.GRASS; // 矿格枯竭
      if (--h.timer <= 0 || world.ore[i] <= 0) {
        if (u.load >= ECON.loadAmount * 0.5) {
          const ref = findRefinery(world, u);
          if (!ref) { h.state = 'idle'; break; } // 没有精炼厂，抱着矿待命
          h.refId = ref.id;
          world.setPath(u, ref.x, ref.y);
          h.state = 'toRefinery';
        } else {
          h.state = 'idle'; // 没采够半车，找下一块矿
        }
      }
      break;
    }
    case 'toRefinery': {
      const ref = world.entities.get(h.refId);
      if (!ref || ref.side !== u.side) { // 精炼厂没了
        const alt = findRefinery(world, u);
        if (!alt) {
          h.state = 'idle'; u.path = null;
          // 精炼厂不可达全基地广播（限频）：否则矿车抱着矿待命，玩家全程无感知
          if (u.side === 'player' && world.tickCount - (world.noRefAlertTick ?? -9999) > 900) {
            world.noRefAlertTick = world.tickCount;
            world.messages.push({ side: 'player', text: '⚠ 精炼厂全部被摧毁！矿车无法卸货，重建精炼厂恢复经济', ttl: 200 });
            world.events.push({ type: 'lowPower' });
          }
          break;
        }
        h.refId = alt.id;
        world.setPath(u, alt.x, alt.y);
        h.stallN = 0; h.stallX = u.x; h.stallY = u.y;
        break;
      }
      // 靠近精炼厂边缘即卸货
      if (world.distToBuilding(u, ref) < 1.2) {
        const gain = Math.round(u.load || 0);
        world.credits[u.side] += gain;
        if (world.stats[u.side]) world.stats[u.side].mined += gain; // 采矿总量战报
        world.lastMineTick ??= {}; world.lastMineTick[u.side] = world.tickCount; // 经济告警心跳
        world.fx.push({ type: 'text', text: `+$${gain}`, color: '#ffd866', x: ref.x, y: ref.y - 0.8, ttl: 80, max: 80 }); // 飘字入账
        u.load = 0;
        u.path = null;
        h.state = 'idle';
        h.stallN = 0;
        world.events.push({ type: 'deposit', side: u.side, x: ref.x, y: ref.y }); // 带坐标：金币音按精炼厂位置空间化
      } else if (!u.path) {
        world.setPath(u, ref.x, ref.y); // 被挡停，重新寻路
      }
      // 物流超时自愈：toRefinery 位移 < ε 达 ~600 tick → 重寻路；
      // 再 600 tick 仍卡死 → 传送最近开放格并告警（绝不永久死锁）
      {
        const moved = Math.hypot(u.x - (h.stallX ?? u.x), u.y - (h.stallY ?? u.y));
        if (h.stallX === undefined) { h.stallX = u.x; h.stallY = u.y; h.stallN = 0; }
        else if (moved < 0.05) {
          h.stallN = (h.stallN ?? 0) + 1;
          if (h.stallN === 600) {
            world.setPath(u, ref.x, ref.y);
            if (u.side === 'player') world.messages.push({ side: 'player', text: '矿车受阻，正在重新规划卸货路线', ttl: 120 });
          } else if (h.stallN >= 1200) {
            const alt = nearestOpen(world, Math.floor(ref.x), Math.floor(ref.y), 6);
            if (alt) { u.x = alt.x + 0.5; u.y = alt.y + 0.5; u.path = null; }
            h.stallN = 0;
            if (u.side === 'player') {
              world.messages.push({ side: 'player', text: '⚠ 矿车严重受阻，已就近调度并标记检查路线', ttl: 180 });
              world.events.push({ type: 'error' });
            }
          }
        } else { h.stallN = 0; h.stallX = u.x; h.stallY = u.y; }
      }
      break;
    }
  }
}

export function findNearestOre(world, x, y) {
  let best = null, bestD = Infinity;
  for (let ty = 0; ty < world.h; ty++) {
    for (let tx = 0; tx < world.w; tx++) {
      const i = ty * world.w + tx;
      if (world.tiles[i] !== T.ORE || world.ore[i] <= 0) continue;
      const d = (tx + 0.5 - x) ** 2 + (ty + 0.5 - y) ** 2;
      if (d < bestD) { bestD = d; best = { x: tx, y: ty }; }
    }
  }
  return best;
}

export function findRefinery(world, u) {
  let best = null, bestD = Infinity;
  for (const b of world.entities.values()) {
    if (b.kind !== 'building' || b.side !== u.side || b.dead) continue;
    if (!world.buildingDef(b).refinery) continue;
    const d = (b.x - u.x) ** 2 + (b.y - u.y) ** 2;
    if (d < bestD) { bestD = d; best = b; }
  }
  return best;
}

// 电力结算：供 < 需 时低电（生产减速、防御塔停摆）
export function updatePower(world) {
  for (const side of ['player', 'enemy']) {
    let supply = 0, demand = 0;
    for (const b of world.entities.values()) {
      if (b.kind !== 'building' || b.side !== side || b.dead) continue;
      const p = world.buildingDef(b).power || 0;
      if (p > 0) supply += p; else demand += -p;
    }
    const was = world.power[side]?.low;
    world.power[side] = { supply, demand, low: demand > supply };
    if (side === 'player') {
      if (world.power[side].low && !was) {
        // P1-7 低电明细：缺口数值 + 耗电大头（原提示不说明原因）
        let hog = null, hogP = 0;
        for (const b of world.entities.values()) {
          if (b.kind !== 'building' || b.side !== side || b.dead) continue;
          const p = world.buildingDef(b).power || 0;
          if (p < hogP) { hogP = p; hog = b; }
        }
        const gap = demand - supply;
        world.messages.push({
          side,
          text: hog
            ? `电力不足！缺口 ${gap}（需求${demand}/供应${supply}），耗电大头：${world.buildingDef(hog).name}（-${-hogP}）——补电厂恢复`
            : `电力不足！缺口 ${gap}（需求${demand}/供应${supply}）——补电厂恢复`,
          ttl: 200,
        });
        world.events.push({ type: 'lowPower' }); // 闷警报（比通用错误音更有辨识度）
      } else if (!world.power[side].low && was) {
        world.messages.push({ side, text: '电力供应已恢复', ttl: 120 }); // 恢复提示：防御塔重新上线
        world.events.push({ type: 'ready' });
      }
    }
  }
}
