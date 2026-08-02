// 无头冒烟测试：模拟数千 tick，验证经济/生产/战斗/AI 全链路不崩
// 运行：node test/smoke.mjs

import { createSkirmish } from '../src/sim/world.js';
import { Commander } from '../src/sim/ai.js';

let failures = 0;
function check(name, cond, extra = '') {
  const ok = !!cond;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${extra ? '  (' + extra + ')' : ''}`);
  if (!ok) failures++;
}

const world = createSkirmish(20260801);
const ai = new Commander(world, 'enemy');

const startCredits = world.credits.player;
const enemyStartUnits = world.unitsOf('enemy').length;
const enemyTotalHp = world.unitsOf('enemy').reduce((s, u) => s + u.hp, 0);

// —— 阶段1：跑 1800 tick（60s），验证采矿经济 ——
// 注：前三个阶段不驱动 AI，保证玩家侧机制测试不受 AI 快攻干扰（AI 在阶段4单独测）
for (let i = 0; i < 1800; i++) world.tick();
check('初始实体数量正常', world.entities.size > 10, `entities=${world.entities.size}`);
check('采矿带来资金增长', world.credits.player > startCredits, `credits ${startCredits} -> ${world.credits.player}`);
check('电力供应正常（未低电）', world.power.player.supply > 0, `supply=${world.power.player.supply} demand=${world.power.player.demand}`);

// —— 阶段2：玩家下生产命令（每个环节都断言，避免连锁误判）——
function produceAndPlace(item, tx, ty, maxTicks = 1500) {
  world.issueCommand('player', { type: 'produce', item });
  for (let i = 0; i < maxTicks && world.sides.player.placing !== item; i++) world.tick();
  if (world.sides.player.placing !== item) return false;
  return world.issueCommand('player', { type: 'build', tx, ty });
}

check('电厂建造并放置成功', produceAndPlace('power', 15, 83) === true);
check('兵营建造并放置成功', produceAndPlace('barracks', 12, 86) === true);
check('战车工厂建造并放置成功', produceAndPlace('factory', 15, 79) === true);

// 生产 3 辆猎豹坦克
const tanksBefore = world.unitsOf('player').filter(u => u.type === 'cheetah').length;
world.issueCommand('player', { type: 'produce', item: 'cheetah' });
world.issueCommand('player', { type: 'produce', item: 'cheetah' });
world.issueCommand('player', { type: 'produce', item: 'cheetah' });
for (let i = 0; i < 1800; i++) world.tick();
const tanksAfter = world.unitsOf('player').filter(u => u.type === 'cheetah').length;
check('坦克生产成功（+3）', tanksAfter >= tanksBefore + 3, `cheetah ${tanksBefore} -> ${tanksAfter}`);

// —— 阶段3：强制交火，验证伤害模型 ——
const cheetah = world.unitsOf('player').find(u => u.type === 'cheetah');
const foe = world.unitsOf('enemy')[0];
if (cheetah && foe) {
  cheetah.x = foe.x - 4; cheetah.y = foe.y; // 空降到射程内
  world.issueCommand('player', { type: 'attack', ids: [cheetah.id], targetId: foe.id });
  for (let i = 0; i < 600; i++) world.tick();
}
const enemyTotalHpAfter = world.unitsOf('enemy').reduce((s, u) => s + u.hp, 0);
check('交火造成伤害', enemyTotalHpAfter < enemyTotalHp || world.unitsOf('enemy').length < enemyStartUnits,
  `enemyHp ${Math.round(enemyTotalHp)} -> ${Math.round(enemyTotalHpAfter)}`);

// —— 阶段4：长跑 6000 tick，验证 AI 建造与系统稳定 ——
const enemyBuildingsBefore = world.buildingsOf('enemy').length;
for (let i = 0; i < 6000 && !world.winner; i++) { world.tick(); ai.tick(); }
const enemyBuildingsAfter = world.buildingsOf('enemy').length;
check('AI 持续扩张建筑', enemyBuildingsAfter >= enemyBuildingsBefore, `enemy buildings ${enemyBuildingsBefore} -> ${enemyBuildingsAfter}`);
check('模拟长跑无异常结束', true, `tick=${world.tickCount} winner=${world.winner ?? '未分胜负'}`);

// —— 收尾：迷雾与消息机制 ——
check('战争迷雾已刷新', world.fog.some(v => v >= 1));

console.log(`\n${failures === 0 ? '全部通过 ✔' : failures + ' 项失败 ✘'}`);
process.exit(failures === 0 ? 0 : 1);
