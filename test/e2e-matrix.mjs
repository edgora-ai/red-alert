// 50轮矩阵：4图×3难度×多种子，快速自动对局扫荡问题
import { createSkirmish } from '../src/sim/world.js';
import { Commander } from '../src/sim/ai.js';

const MAPS = ['standard', 'river', 'maze', 'plains'];
const DIFFS = ['easy', 'normal', 'hard'];
const SEEDS = [42, 7, 99, 1234, 777];

let round = 43;
const results = [];
const issues = [];

for (const map of MAPS) {
  for (const diff of DIFFS) {
    for (const seed of SEEDS) {
      if (results.length >= 50) break;
      try {
        const world = createSkirmish(seed, map);
        const ai = new Commander(world, 'enemy', diff);
        // 简化自动玩家：开局dual矿车+坦克海A过去，检测系统稳定性
        world.credits.player = 8000;
        // 快速下3坦克
        for (let i = 0; i < 6; i++) {
          const u = world.addUnit('player', 'cheetah', 10 + (i % 3), 78 + Math.floor(i / 3));
          u.order = { type: 'idle' };
        }
        const army = world.unitsOf('player').filter(u => u.type === 'cheetah');
        const ey = world.buildingsOf('enemy').find(b => b.type === 'yard');
        if (ey) world.issueCommand('player', { type: 'attackmove', ids: army.map(u => u.id), x: ey.x, y: ey.y });

        let maxStall = 0;
        let stallSample = null;
        const posMap = new Map(army.map(u => [u.id, { x: u.x, y: u.y, n: 0 }]));
        let err = null;
        let ticks = 0;
        const MAXT = 12000;
        for (let t = 0; t < MAXT && !world.winner; t++) {
          world.tick(); ai.tick(); ticks = t;
          if (t % 500 === 0) {
            for (const u of army) {
              const e = world.entities.get(u.id);
              if (!e || e.dead) continue;
              const prev = posMap.get(u.id);
              if (!prev) continue;
              const moved = Math.hypot(e.x - prev.x, e.y - prev.y);
              if (moved < 0.3 && !e.path && !e.targetId && (e.order?.type === 'attackmove' || e.order?.type === 'move')) {
                prev.n += 500;
                if (prev.n > maxStall) { maxStall = prev.n; stallSample = `id=${e.id}@${e.x.toFixed(1)},${e.y.toFixed(1)} order=${e.order?.type} tgt=${e.targetId} path=${e.path}`; }
              } else { prev.n = 0; prev.x = e.x; prev.y = e.y; }
            }
          }
          if (world.__errors) {}
        }
        // 收集JS错误
        const r = {
          round: round++, map, diff, seed,
          winner: world.winner, ticks,
          kills: world.stats.player.kills, lost: world.stats.player.lost,
          mined: world.stats.player.mined,
          maxStall, stallSample,
          enemyB: world.buildingsOf('enemy').length,
          playerB: world.buildingsOf('player').length,
        };
        results.push(r);
        if (maxStall >= 2000) issues.push(`R${r.round} ${map}/${diff}/s${seed} 停摆${maxStall}tick ${stallSample}`);
        if (!world.winner && ticks >= MAXT - 1) issues.push(`R${r.round} ${map}/${diff}/s${seed} 未终局 kills=${r.kills} mined=${r.mined}`);
        console.log(`R${r.round} ${map}/${diff}/s${seed} winner=${r.winner ?? '-'} t=${ticks} k=${r.kills}/${r.lost} mined=${r.mined} stall=${maxStall}`);
      } catch (e) {
        console.log(`R${round} ${map}/${diff}/s${seed} ERROR ${e.message}`);
        issues.push(`R${round} ${map}/${diff}/s${seed} 异常: ${e.message}`);
        round++;
      }
    }
  }
}

console.log(`\n=== 矩阵完成 ${results.length} 局 ===`);
console.log(`终局率: ${results.filter(r => r.winner).length}/${results.length}`);
console.log(`player胜: ${results.filter(r => r.winner === 'player').length} enemy胜: ${results.filter(r => r.winner === 'enemy').length}`);
console.log(`平均击毁: ${(results.reduce((s, r) => s + r.kills, 0) / results.length).toFixed(1)} 平均采矿: ${(results.reduce((s, r) => s + r.mined, 0) / results.length).toFixed(0)}`);
console.log(`问题数: ${issues.length}`);
for (const i of issues) console.log('ISSUE: ' + i);
