// 通用单局 runner：node test/e2e-one.mjs [map] [diff] [mode] [seed] [strat]
// strat: rush(6坦克快攻) | turtle(运营+10辆推进) | air(空军) | arty(炮兵)
import { createSkirmish } from '../src/sim/world.js';
import { Commander } from '../src/sim/ai.js';
import { GAME_MODES } from '../src/config.js';
import { applyEliteStart } from '../src/sim/world.js';

const map = process.argv[2] || 'standard';
const diff = process.argv[3] || 'normal';
const modeKey = process.argv[4] || 'classic';
const seed = parseInt(process.argv[5] || '42', 10);
const strat = process.argv[6] || 'turtle';

const world = createSkirmish(seed, map);
world.mode = GAME_MODES[modeKey] ?? GAME_MODES.classic;
world.credits.player = 8000;
world.credits.enemy = 8000;
if (world.mode.eliteStart) applyEliteStart(world);
const ai = new Commander(world, 'enemy', diff);

const COST = { power: 600, barracks: 500, factory: 1800, refinery: 1800, radar: 1200, laser: 800, npower: 1200, sam: 700 };
function findPlace(btype) {
  const yard = world.buildingsOf('player').find(b => b.type === 'yard');
  if (!yard) return null;
  for (let r = 2; r <= 14; r++) for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
    if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
    if (world.canPlace('player', btype, yard.tx + dx, yard.ty + dy)) return { tx: yard.tx + dx, ty: yard.ty + dy };
  }
  return null;
}
const defend = (unit = 'cheetah') => {
  const fac = world.buildingsOf('player').find(b => b.type === 'factory');
  if (fac && fac.queue.length < 2 && world.credits.player > 950) {
    const harvs = world.unitsOf('player').filter(u => u.type === 'harvester').length;
    world.issueCommand('player', { type: 'produce', item: harvs < 2 ? 'harvester' : unit });
  }
};
const afford = (c) => { let n = 0; while (world.credits.player < c && n++ < 15000 && !world.winner) { world.tick(); ai.tick(); defend(); } return true; };
const buildLine = (it) => {
  afford(COST[it]);
  world.issueCommand('player', { type: 'produce', item: it });
  let n = 0;
  while (world.sides.player.placing !== it && n++ < 6000 && !world.winner) { world.tick(); ai.tick(); defend(); }
  if (world.sides.player.placing !== it) return false;
  const s = findPlace(it);
  return s ? world.issueCommand('player', { type: 'build', tx: s.tx, ty: s.ty }) : false;
};

const buildOrder = strat === 'rush'
  ? ['power', 'barracks', 'factory']
  : ['power', 'barracks', 'factory', 'laser', 'refinery', 'radar', 'laser', 'npower'];
let fail = null;
for (const b of buildOrder) { if (world.winner || !buildLine(b)) { fail = 'build-' + b; break; } }

// rush：6坦克直接A；turtle：攒10辆A；air：出4幽灵+猎手；arty：雷霆火箭炮
let waves = 0;
const pushSize = strat === 'rush' ? 6 : 10;
const unitType = strat === 'air' ? 'ghost' : strat === 'arty' ? 'mlrs' : 'cheetah';
let maxStall = 0;
const posMap = new Map();
for (let t = 0; t < 60000 && !world.winner; t++) {
  world.tick(); ai.tick();
  if (t % 300 === 0) {
    defend(unitType);
    const army = world.unitsOf('player').filter(u => u.weapon && u.type !== 'harvester' && u.order?.type !== 'attackmove');
    if (army.length >= pushSize) {
      const ey = world.buildingsOf('enemy').find(b => b.type === 'yard') || world.buildingsOf('enemy')[0];
      if (ey) { world.issueCommand('player', { type: 'attackmove', ids: army.map(u => u.id), x: ey.x, y: ey.y }); waves++; }
    }
  }
  if (t % 500 === 0) {
    for (const u of world.unitsOf('player')) {
      if (u.type === 'harvester') continue;
      const prev = posMap.get(u.id);
      if (!prev) { posMap.set(u.id, { x: u.x, y: u.y, n: 0 }); continue; }
      const moved = Math.hypot(u.x - prev.x, u.y - prev.y);
      if (moved < 0.3 && !u.path && !u.targetId && (u.order?.type === 'attackmove' || u.order?.type === 'move')) {
        prev.n += 500;
        if (prev.n > maxStall) maxStall = prev.n;
      } else { prev.n = 0; prev.x = u.x; prev.y = u.y; }
    }
  }
}
console.log(`GAME ${map}/${diff}/${modeKey}/s${seed}/${strat} winner=${world.winner ?? '-'}${fail ? ' FAIL:' + fail : ''} time=${(world.tickCount / 30 / 60).toFixed(1)}min k=${world.stats.player.kills}/${world.stats.player.lost} mined=${world.stats.player.mined} waves=${waves} stall=${maxStall} eB=${world.buildingsOf('enemy').length} pB=${world.buildingsOf('player').length}`);
if (maxStall >= 2000) console.log('STALL-ISSUE maxStall=' + maxStall);
