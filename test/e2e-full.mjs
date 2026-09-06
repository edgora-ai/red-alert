// 全自动完整对局：模拟真实玩家 经济→防御→科技→超武→大军推进 全流程，必须自然终局
import { createSkirmish } from '../src/sim/world.js';
import { Commander } from '../src/sim/ai.js';

const world = createSkirmish(42, 'standard');
const ai = new Commander(world, 'enemy', 'normal');

function findPlace(btype) {
  const yard = world.buildingsOf('player').find(b => b.type === 'yard');
  if (!yard) return null;
  for (let r = 2; r <= 14; r++)
    for (let dy = -r; dy <= r; dy++)
      for (let dx = -r; dx <= r; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
        if (world.canPlace('player', btype, yard.tx + dx, yard.ty + dy)) return { tx: yard.tx + dx, ty: yard.ty + dy };
      }
  return null;
}
function buildLine(item) {
  // 下单→等就绪→放置，一条龙
  world.issueCommand('player', { type: 'produce', item });
  let waited = 0;
  while (world.sides.player.placing !== item && waited++ < 3000) { world.tick(); ai.tick(); }
  if (world.sides.player.placing !== item) return false;
  const spot = findPlace(item);
  if (!spot) return false;
  return world.issueCommand('player', { type: 'build', tx: spot.tx, ty: spot.ty });
}

const log = [];
// 防守钩子：建造等待期间工厂有空就补坦克（首波 3.5min 到，站着盖房子会被推平）
const defend = () => {
  const fac = world.buildingsOf('player').find(b => b.type === 'factory');
  if (fac && fac.queue.length < 2 && world.credits.player > 900) world.issueCommand('player', { type: 'produce', item: 'cheetah' });
  const idle = world.unitsOf('player').filter(u => u.type === 'cheetah' && (!u.order || u.order.type === 'idle'));
  if (idle.length >= 2) world.issueCommand('player', { type: 'hold', ids: idle.map(u => u.id) });
};
// 注资：等采矿回血到阈值再下单（脚本资金规划，非游戏机制）
function afford(cost) {
  let waited = 0;
  while (world.credits.player < cost && waited++ < 12000 && !world.winner) { world.tick(); ai.tick(); defend(); }
  return world.credits.player >= cost;
}
function buildLineWait(item) {
  if (!afford((() => { const d = { power: 600, barracks: 500, factory: 1800, refinery: 1800, radar: 1200, npower: 1200, laser: 800 }; return d[item] ?? 1000; })())) return false;
  world.issueCommand('player', { type: 'produce', item });
  let waited = 0;
  while (world.sides.player.placing !== item && waited++ < 6000 && !world.winner) { world.tick(); ai.tick(); defend(); }
  if (world.sides.player.placing !== item) return false;
  const spot = findPlace(item);
  if (!spot) return false;
  return world.issueCommand('player', { type: 'build', tx: spot.tx, ty: spot.ty });
}
// 阶段A 经济+防御线（含激光塔防首波）
for (const b of ['power', 'barracks', 'factory', 'refinery', 'radar', 'laser', 'npower']) {
  const ok = buildLineWait(b);
  log.push(`${b}:${ok ? 'ok' : 'FAIL'}`);
  if (!ok) { console.log('BUILD FAIL at', b, 'tick=' + world.tickCount); process.exit(1); }
}
log.push(`credits=${Math.round(world.credits.player)} mined=${world.stats.player.mined} tanks=${world.unitsOf('player').filter(u => u.type === 'cheetah').length}`);
// 阶段B 科技
if (!afford(1500)) { console.log('BUILD FAIL at afford-ap'); process.exit(1); }
world.issueCommand('player', { type: 'produce', item: 'ap' });
for (let i = 0; i < 3600 && !world.upgrades.player.owned.has('ap'); i++) { world.tick(); ai.tick(); defend(); }
log.push(`ap:${world.upgrades.player.owned.has('ap') ? 'ok' : 'FAIL'}`);
// 阶段C 爆兵+推进（分段接力：每攒6辆A一波，避免单队跨图掉队）
let waves = 0, reissues = 0;
const fac = () => world.buildingsOf('player').find(b => b.type === 'factory');
for (let i = 0; i < 8; i++) world.issueCommand('player', { type: 'produce', item: 'cheetah' });
let lastKills = 0, lastMove = 0, stallGuard = 0;
for (let t = 0; t < 60000 && !world.winner; t++) {
  world.tick(); ai.tick();
  if (t % 300 === 0) {
    const army = world.unitsOf('player').filter(u => u.weapon && u.type !== 'harvester' && u.order?.type !== 'attackmove');
    if (army.length >= 6) {
      const ey = world.buildingsOf('enemy').find(b => b.type === 'yard') || world.buildingsOf('enemy')[0];
      if (ey) { world.issueCommand('player', { type: 'attackmove', ids: army.map(u => u.id), x: ey.x, y: ey.y }); waves++; }
    }
    if (fac() && fac().queue.length < 2) world.issueCommand('player', { type: 'produce', item: 'cheetah' });
    // 停摆兜底：击毁冻结超5分钟且有存活attackmove部队 → 重发（统计重发次数，应趋近0）
    if (world.stats.player.kills === lastKills) { stallGuard++; } else { stallGuard = 0; lastKills = world.stats.player.kills; }
    if (stallGuard > 9000) {
      const stalled = world.unitsOf('player').filter(u => u.order?.type === 'attackmove' && !u.path && !u.targetId);
      if (stalled.length) {
        const ey = world.buildingsOf('enemy')[0];
        if (ey) world.issueCommand('player', { type: 'attackmove', ids: stalled.map(u => u.id), x: ey.x, y: ey.y });
        reissues++;
      }
      stallGuard = 0;
    }
  }
}
const mm = String(Math.floor(world.tickCount / 30 / 60)).padStart(2, '0');
const ss = String(Math.floor(world.tickCount / 30) % 60).padStart(2, '0');
console.log('build:', log.join(' '));
console.log(`winner=${world.winner} time=${mm}:${ss} kills=${world.stats.player.kills}/${world.stats.player.lost} mined=${world.stats.player.mined} waves=${waves} manualReissues=${reissues}`);
console.log(`enemyLeft: buildings=${world.buildingsOf('enemy').length} units=${world.unitsOf('enemy').length}`);
if (!world.winner) { console.log('E2E FAIL: 未能自然终局'); process.exit(1); }
if (reissues > 3) { console.log('E2E WARN: 仍需多次手动重发'); process.exit(1); }
console.log('E2E PASS: 全自动一局通关 ✔');
