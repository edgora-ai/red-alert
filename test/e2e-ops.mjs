// 运营型矩阵脚本：建造→补兵→分段推进→超武，全流程运营玩家
import { createSkirmish } from '../src/sim/world.js';
import { Commander } from '../src/sim/ai.js';

const MAPS = ['standard', 'river', 'maze', 'plains'];
const DIFFS = ['easy', 'normal', 'hard'];
const SEEDS = [42, 7, 99, 1234, 777];
const COST = { power: 600, barracks: 500, factory: 1800, refinery: 1800, radar: 1200, laser: 800, npower: 1200 };

let round = 44;
let done = 0, playerWin = 0, enemyWin = 0, stalls = 0;
const issues = [];

function findPlace(w, btype) {
  const yard = w.buildingsOf('player').find(b => b.type === 'yard');
  if (!yard) return null;
  for (let r = 2; r <= 14; r++) for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
    if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
    if (w.canPlace('player', btype, yard.tx + dx, yard.ty + dy)) return { tx: yard.tx + dx, ty: yard.ty + dy };
  }
  return null;
}

for (const map of MAPS) {
  for (const diff of DIFFS) {
    for (const seed of SEEDS) {
      if (done >= 50) break;
      const R = round++;
      try {
        const w = createSkirmish(seed, map);
        const ai = new Commander(w, 'enemy', diff);
        const defend = () => {
          const fac = w.buildingsOf('player').find(b => b.type === 'factory');
          if (fac && fac.queue.length < 2 && w.credits.player > 900) w.issueCommand('player', { type: 'produce', item: 'cheetah' });
          const idle = w.unitsOf('player').filter(u => u.type === 'cheetah' && (!u.order || u.order.type === 'idle'));
          if (idle.length >= 2) w.issueCommand('player', { type: 'hold', ids: idle.map(u => u.id) });
        };
        const afford = (c) => { let n = 0; while (w.credits.player < c && n++ < 15000 && !w.winner) { w.tick(); ai.tick(); defend(); } return w.credits.player >= c; };
        const buildLine = (it) => {
          if (!afford(COST[it])) return false;
          w.issueCommand('player', { type: 'produce', item: it });
          let n = 0;
          while (w.sides.player.placing !== it && n++ < 6000 && !w.winner) { w.tick(); ai.tick(); defend(); }
          if (w.sides.player.placing !== it) return false;
          const s = findPlace(w, it);
          return s ? w.issueCommand('player', { type: 'build', tx: s.tx, ty: s.ty }) : false;
        };
        let fail = null;
        // 轮47：4分钟防线门槛——激光塔提前到精炼厂前（首波4分钟到，塔比矿重要）；
        // 步兵先出2枪（便宜即战力），工厂一好坦克不停
        for (const b of ['power', 'barracks', 'factory', 'laser', 'refinery', 'radar', 'laser', 'npower']) {
          if (w.winner) { fail = 'died-building'; break; }
          if (!buildLine(b === 'laser' ? 'laser' : b)) { fail = 'build-' + b; break; }
          if (b === 'barracks') {
            // 兵营一好立刻出2步兵协防（不占用建造队列等待）
            for (let k = 0; k < 2; k++) w.issueCommand('player', { type: 'produce', item: 'rifle' });
          }
        }
        if (!fail && !w.winner) {
          if (!afford(1500)) fail = 'afford-ap';
          else {
            w.issueCommand('player', { type: 'produce', item: 'ap' });
            for (let i = 0; i < 3600 && !w.upgrades.player.owned.has('ap') && !w.winner; i++) { w.tick(); ai.tick(); defend(); }
          }
        }
        let waves = 0;
        const posMap = new Map();
        let maxStall = 0;
        for (let t = 0; t < 60000 && !w.winner; t++) {
          w.tick(); ai.tick();
          if (t % 300 === 0) {
            defend();
            const fac2 = w.buildingsOf('player').find(b => b.type === 'factory');
            if (fac2 && fac2.queue.length < 2) {
              const harvs = w.unitsOf('player').filter(u => u.type === 'harvester').length;
              w.issueCommand('player', { type: 'produce', item: harvs < 2 ? 'harvester' : 'cheetah' });
            }
            // 护矿：2辆 guard 拴矿车（轮45：无护矿矿车被偷是脚本连败主因）
            const harvsE = w.unitsOf('player').filter(u => u.type === 'harvester');
            const tanks = w.unitsOf('player').filter(u => u.type === 'cheetah' && (!u.order || u.order.type === 'idle' || u.order.type === 'hold'));
            if (harvsE.length && tanks.length >= 4) {
              for (const g of tanks.slice(0, 2)) { g.order = { type: 'guard', x: harvsE[0].x, y: harvsE[0].y }; g.path = null; g.targetId = null; }
            }
            const army = w.unitsOf('player').filter(u => u.weapon && u.type !== 'harvester' && u.order?.type !== 'attackmove' && u.order?.type !== 'guard');
            if (army.length >= 10) {
              const ey = w.buildingsOf('enemy').find(b => b.type === 'yard') || w.buildingsOf('enemy')[0];
              if (ey) { w.issueCommand('player', { type: 'attackmove', ids: army.map(u => u.id), x: ey.x, y: ey.y }); waves++; }
            }
          }
          if (t % 500 === 0) {
            for (const u of w.unitsOf('player')) {
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
        done++;
        if (w.winner === 'player') playerWin++;
        if (w.winner === 'enemy') enemyWin++;
        if (maxStall >= 2000) { stalls++; issues.push(`R${R} ${map}/${diff}/s${seed} 停摆${maxStall}`); }
        if (!w.winner) issues.push(`R${R} ${map}/${diff}/s${seed} 未终局${fail ? '(' + fail + ')' : ''} k=${w.stats.player.kills}/${w.stats.player.lost}`);
        console.log(`R${R} ${map}/${diff}/s${seed} winner=${w.winner ?? '-'}${fail ? ' FAIL:' + fail : ''} k=${w.stats.player.kills}/${w.stats.player.lost} mined=${w.stats.player.mined} waves=${waves} stall=${maxStall}`);
      } catch (e) {
        done++;
        issues.push(`R${R} ${map}/${diff}/s${seed} 异常: ${e.message}`);
        console.log(`R${R} ${map}/${diff}/s${seed} ERROR ${e.message}`);
      }
    }
  }
}
console.log(`\n=== 运营矩阵 ${done} 局：终局 ${playerWin + enemyWin}/${done}（player ${playerWin} / enemy ${enemyWin}）停摆局 ${stalls} ===`);
console.log(`问题数: ${issues.length}`);
for (const i of issues) console.log('ISSUE: ' + i);
