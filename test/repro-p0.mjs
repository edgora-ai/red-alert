// 长程推演复现 P0：跨图推进停摆 + 采矿死锁
import { createSkirmish } from '../src/sim/world.js';
import { Commander } from '../src/sim/ai.js';
import { T } from '../src/config.js';

const world = createSkirmish(42, 'standard');
const ai = new Commander(world, 'enemy', 'normal');
world.credits.player = 30000;

// 玩家快速起 12 辆坦克编队
for (let i = 0; i < 12; i++) {
  const u = world.addUnit('player', 'cheetah', 10 + (i % 4), 80 + Math.floor(i / 4));
  u.order = { type: 'idle' };
}
const army = world.unitsOf('player').filter(u => u.type === 'cheetah');
const eyard = world.buildingsOf('enemy').find(b => b.type === 'yard');
console.log(`army=${army.length} enemyYard at ${eyard.x.toFixed(1)},${eyard.y.toFixed(1)}`);
world.issueCommand('player', { type: 'attackmove', ids: army.map(u => u.id), x: eyard.x, y: eyard.y });

// 跑 24000 tick (13+游戏分钟)，每 1500 tick 采样
let lastPos = new Map(army.map(u => [u.id, { x: u.x, y: u.y }]));
let stallTicks = new Map(army.map(u => [u.id, 0]));
for (let t = 0; t < 24000 && !world.winner; t++) {
  world.tick(); ai.tick();
  if (t % 1500 === 1499) {
    const tick = world.tickCount;
    let stalled = 0, dead = 0, arrived = 0;
    for (const u of army) {
      const e = world.entities.get(u.id);
      if (!e || e.dead) { dead++; continue; }
      const lp = lastPos.get(u.id);
      const moved = Math.hypot(e.x - lp.x, e.y - lp.y);
      if (moved < 0.5) {
        stallTicks.set(u.id, (stallTicks.get(u.id) || 0) + 1500);
      } else {
        stallTicks.set(u.id, 0);
      }
      lastPos.set(u.id, { x: e.x, y: e.y });
      const st = stallTicks.get(u.id);
      const d = Math.hypot(e.x - eyard.x, e.y - eyard.y);
      if (st >= 1500) {
        stalled++;
        if (stalled <= 4) console.log(`  t=${tick} STALL id=${e.id} at ${e.x.toFixed(1)},${e.y.toFixed(1)} order=${e.order?.type} target=${e.targetId} path=${e.path ? e.path.length + ':' + e.pathi : e.path} distGoal=${d.toFixed(1)} stall=${st}`);
      }
      if (d < 8) arrived++;
    }
    const mined = world.stats.player.mined;
    const harvs = world.unitsOf('player').filter(u => u.type === 'harvester');
    const hinfo = harvs.map(h => `${h.id}@${h.x.toFixed(0)},${h.y.toFixed(0)}:${h.harvest?.state}:load${Math.round(h.load || 0)}:path${h.path ? h.path.length : h.path}`).join(' ');
    console.log(`t=${tick} stalled=${stalled} dead=${dead} arrived=${arrived} kills=${world.stats.player.kills} mined=${mined} harvs[${harvs.length}]=${hinfo}`);
  }
}
console.log(`done tick=${world.tickCount} winner=${world.winner} kills=${world.stats.player.kills} mined=${world.stats.player.mined}`);
