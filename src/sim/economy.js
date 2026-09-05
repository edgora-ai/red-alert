// 采矿经济（矿车状态机）与电力结算

import { T, ECON } from '../config.js';

// 矿车状态：idle → toOre → loading → toRefinery → idle …
export function updateHarvester(world, u) {
  const h = (u.harvest ??= { state: 'idle', timer: 0 });

  switch (h.state) {
    case 'idle': {
      const ore = findNearestOre(world, u.x, u.y);
      if (!ore) return; // 全图无矿，原地待命
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
        if (!alt) { h.state = 'idle'; u.path = null; break; }
        h.refId = alt.id;
        world.setPath(u, alt.x, alt.y);
        break;
      }
      // 靠近精炼厂边缘即卸货
      if (world.distToBuilding(u, ref) < 1.2) {
        world.credits[u.side] += Math.round(u.load || 0);
        u.load = 0;
        u.path = null;
        h.state = 'idle';
        world.events.push({ type: 'deposit', side: u.side });
      } else if (!u.path) {
        world.setPath(u, ref.x, ref.y); // 被挡停，重新寻路
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
    if (world.power[side].low && !was && side === 'player') {
      world.messages.push({ side, text: '电力不足！防御塔停摆，生产减速', ttl: 150 });
      world.events.push({ type: 'error' });
    }
  }
}
