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

// —— 阶段3.5：老兵/战报/警报系统 ——
const vetUnit = world.unitsOf('player').find(u => u.weapon && u.type !== 'harvester');
if (vetUnit) {
  world.addXp(vetUnit, 300);
  check('老兵晋升（经验→等级/火力加成）', vetUnit.level >= 1 && vetUnit.dmgMul > 1,
    `level=${vetUnit.level} dmgMul=${vetUnit.dmgMul.toFixed(2)}`);
}
const victim = world.unitsOf('enemy')[1] || world.unitsOf('enemy')[0];
if (vetUnit && victim) {
  const killsBefore = world.stats.player.kills;
  victim.hp = 1;
  victim.x = vetUnit.x + 1; victim.y = vetUnit.y;
  const { applyDamage } = await import('../src/sim/combat.js');
  applyDamage(world, victim, 10, 'shell', vetUnit);
  check('击杀计入战报并积累经验', world.stats.player.kills === killsBefore + 1 && vetUnit.xp > 0,
    `kills=${world.stats.player.kills} xp=${vetUnit.xp}`);
}
const playerUnit = world.unitsOf('player')[0];
const alertsBefore = world.alerts.length;
if (playerUnit) {
  const { applyDamage } = await import('../src/sim/combat.js');
  applyDamage(world, playerUnit, 5, 'bullet', null);
}
check('受击产生警报点（小地图/AI 防守用）', world.alerts.length > alertsBefore,
  `alerts ${alertsBefore} -> ${world.alerts.length}`);

// —— 阶段4：长跑 6000 tick，验证 AI 建造与系统稳定 ——
const enemyBuildingsBefore = world.buildingsOf('enemy').length;
for (let i = 0; i < 6000 && !world.winner; i++) { world.tick(); ai.tick(); }
const enemyBuildingsAfter = world.buildingsOf('enemy').length;
check('AI 持续扩张建筑', enemyBuildingsAfter >= enemyBuildingsBefore, `enemy buildings ${enemyBuildingsBefore} -> ${enemyBuildingsAfter}`);
check('模拟长跑无异常结束', true, `tick=${world.tickCount} winner=${world.winner ?? '未分胜负'}`);

// —— 阶段5：科技研发（AI 交战可能已推平基地：重建建造厂保证后续生产线） ——
if (!world.buildingsOf('player').some(b => b.type === 'yard')) world.addBuilding('player', 'yard', 7, 79);
world.credits.player = 9000;
function findPlace(btype) {
  const yard = world.buildingsOf('player').find(b => b.type === 'yard');
  for (let r = 2; r <= 12; r++) {
    for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
      if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
      if (world.canPlace('player', btype, yard.tx + dx, yard.ty + dy)) return { tx: yard.tx + dx, ty: yard.ty + dy };
    }
  }
  return null;
}
check('雷达站建造并放置成功', produceAndPlace('radar', (() => { const p = findPlace('radar'); return p.tx; })(), (() => { const p = findPlace('radar'); return p.ty; })()) === true);
const fireBefore = world.upgrades.player.fire;
world.issueCommand('player', { type: 'produce', item: 'ap' });
let apQueued = false;
for (const b of world.buildingsOf('player')) if (b.queue?.includes('ap')) apQueued = true;
check('科技进入研发队列（雷达站）', apQueued);
for (let i = 0; i < 1200 && !world.upgrades.player.owned.has('ap'); i++) world.tick();
check('精准弹药研发完成（全军火力+20%）', world.upgrades.player.fire === 1.2 && world.upgrades.player.owned.has('ap'),
  `fire=${world.upgrades.player.fire}`);
check('重复研发被拒绝', world.issueCommand('player', { type: 'produce', item: 'ap' }) === false);

// —— 阶段6：火箭炮齐射 ——
const target6 = world.unitsOf('enemy')[0];
const mlrs = target6 ? world.addUnit('player', 'mlrs', target6.x - 6, target6.y) : null;
let maxProj = 0;
if (target6 && mlrs) {
  mlrs.order = { type: 'attack', x: target6.x, y: target6.y };
  mlrs.targetId = target6.id;
  for (let i = 0; i < 120; i++) { world.tick(); maxProj = Math.max(maxProj, world.projectiles.length); }
}
check('火箭炮 6 连发齐射', maxProj >= 3, `maxProjectiles=${maxProj}`);

// —— 阶段7：命令响应（不可达目标也必须动起来） ——
const { T: TT } = await import('../src/config.js');
const px0 = 50, py0 = 50;
for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) world.tiles[world.idx(px0 + dx, py0 + dy)] = TT.GRASS;
for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) {
  if (Math.abs(dx) !== 2 && Math.abs(dy) !== 2) continue;
  world.tiles[world.idx(px0 + dx, py0 + dy)] = TT.ROCK; // 全封闭岩石口袋
}
const pocket = world.addUnit('player', 'rifle', px0 + 0.5, py0 + 0.5);
world.issueCommand('player', { type: 'move', ids: [pocket.id], x: px0 + 12, y: py0 + 12 });
for (let i = 0; i < 90; i++) world.tick();
check('不可达目标仍响应移动命令（直线逼近）', Math.hypot(pocket.x - px0 - 0.5, pocket.y - py0 - 0.5) > 0.8,
  `moved to ${pocket.x.toFixed(2)},${pocket.y.toFixed(2)}`);
const harv = world.unitsOf('player').find(u => u.type === 'harvester');
if (harv) {
  world.issueCommand('player', { type: 'attackmove', ids: [harv.id], x: 10, y: 10 });
  check('采矿车无视攻击移动（继续采矿）', harv.order.type !== 'attackmove', `order=${harv.order.type}`);
}

// —— 阶段8：中立补给站（工程师占领 + 持续收入） ——
// 找一块 2x2 无建筑占用的空地，铺成草地并留出工程师落位圈
function freeSpot2x2(tx0, ty0) {
  for (let r = 0; r < 20; r++) {
    for (let ty = ty0 - r; ty <= ty0 + r; ty++) {
      for (let tx = tx0 - r; tx <= tx0 + r; tx++) {
        let ok = true;
        for (let dy = -1; dy <= 2 && ok; dy++)
          for (let dx = -1; dx <= 2 && ok; dx++)
            if (!world.inBounds(tx + dx, ty + dy) || world.bgrid[world.idx(tx + dx, ty + dy)] !== -1) ok = false;
        if (!ok) continue;
        for (let dy = -1; dy <= 2; dy++)
          for (let dx = -1; dx <= 2; dx++) {
            world.tiles[world.idx(tx + dx, ty + dy)] = TT.GRASS;
            world.ore[world.idx(tx + dx, ty + dy)] = 0;
          }
        return { tx, ty };
      }
    }
  }
  return null;
}
const opSpot = freeSpot2x2(50, 30);
const op = world.addBuilding('neutral', 'outpost', opSpot.tx, opSpot.ty);
const eng = world.addUnit('player', 'engineer', opSpot.tx + 1.5, opSpot.ty + 2.5);
world.issueCommand('player', { type: 'capture', ids: [eng.id], targetId: op.id });
for (let i = 0; i < 240 && world.entities.get(op.id)?.side !== 'player'; i++) world.tick();
check('工程师占领中立补给站', world.entities.get(op.id)?.side === 'player', `side=${world.entities.get(op.id)?.side}`);
const cNeutral = world.credits.player;
for (let i = 0; i < 160; i++) world.tick();
check('中立补给站持续产出资金', world.credits.player - cNeutral >= 100, `+$${world.credits.player - cNeutral}`);

// —— 阶段9：修理厂（范围内载具自动维修 + 按耐久扣费） ——
// 临时移走采矿车与已占领补给站，隔离采矿/中立收入对资金断言的干扰
const harvsAway = world.unitsOf('player').filter(u => u.type === 'harvester');
harvsAway.forEach(h => world.entities.delete(h.id));
world.entities.delete(op.id);
world.credits.player = 12000;
const rp = findPlace('repair');
check('修理厂建造并放置成功', produceAndPlace('repair', rp.tx, rp.ty) === true);
const repB = world.buildingsOf('player').find(b => b.type === 'repair');
const repTank = world.addUnit('player', 'cheetah', repB.x + 0.5, repB.y + 0.5);
repTank.hp = repTank.maxHp * 0.3;
const cRepair = world.credits.player;
for (let i = 0; i < 300; i++) world.tick();
check('修理厂修复载具并扣费', repTank.hp > repTank.maxHp * 0.3 && world.credits.player < cRepair,
  `hp=${Math.round(repTank.hp)}/${Math.round(repTank.maxHp)} $${cRepair}->${Math.round(world.credits.player)}`);
harvsAway.forEach(h => world.entities.set(h.id, h)); // 归还采矿车与补给站
world.entities.set(op.id, op);

// —— 阶段10：狙击手光学迷彩（闭火隔离“开火现形”） ——
const sn = world.addUnit('player', 'sniper', 40.5, 40.5);
sn.cooldown = 5000; // 全程闭火：排除开火现形干扰
const foeTank = world.addUnit('enemy', 'tyrant', 44.5, 40.5);
foeTank.order = { type: 'idle' }; foeTank.path = null;
for (let i = 0; i < 100; i++) world.tick();
check('迷彩生效：远处敌人无法索敌狙击手', foeTank.targetId !== sn.id, `target=${foeTank.targetId}`);
sn.cloak = 45; // 强制现形（等效开火后显形窗口内）
for (let i = 0; i < 40 && foeTank.targetId !== sn.id; i++) world.tick();
check('现形后被正常索敌', foeTank.targetId === sn.id, `target=${foeTank.targetId}`);

// —— 阶段11：超级武器「轨道动能炮」（研发→锁定→落地→冷却） ——
world.credits.player = 20000;
const np = findPlace('npower');
check('核电站建造并放置成功', produceAndPlace('npower', np.tx, np.ty) === true);
world.issueCommand('player', { type: 'produce', item: 'super' });
for (let i = 0; i < 2200 && !world.upgrades.player.owned.has('super'); i++) world.tick();
check('轨道打击授权研发完成', world.upgrades.player.owned.has('super'));
check('泰坦机甲可进入战车工厂生产队列', (() => {
  world.credits.player = Math.max(world.credits.player, 5000);
  return world.issueCommand('player', { type: 'produce', item: 'titan' }) === true;
})());
const tSpot = freeSpot2x2(45, 70);
const tgt = world.addBuilding('enemy', 'power', tSpot.tx, tSpot.ty);
const hp0 = tgt.hp;
check('超武发射并进入冷却', world.issueCommand('player', { type: 'superstrike', x: tSpot.tx + 1, y: tSpot.ty + 1 }) === true);
check('冷却期间无法二次发射', world.issueCommand('player', { type: 'superstrike', x: tSpot.tx + 1, y: tSpot.ty + 1 }) === false);
for (let i = 0; i < 120; i++) world.tick();
check('轨道炮落地造成毁灭伤害', tgt.dead || tgt.hp < hp0 * 0.5,
  `hp ${Math.round(hp0)} -> ${tgt.dead ? '已摧毁' : Math.round(tgt.hp)}`);

// —— 收尾：迷雾与消息机制 ——
check('战争迷雾已刷新', world.fog.some(v => v >= 1));

// —— 阶段11.5：Shift×5 连点生产 + 编队分离 ——
world.credits.player = 20000;
const fac5 = world.buildingsOf('player').find(b => b.type === 'factory');
if (fac5) {
  fac5.queue.length = 0;
  const q0 = fac5.queue.length;
  world.issueCommand('player', { type: 'produce', item: 'rifle', n: 1 });
  const q1 = fac5.queue.length;
  // 步兵走兵营：工厂不应收单；找兵营测 ×5
  const bar5 = world.buildingsOf('player').find(b => b.type === 'barracks');
  if (bar5) {
    bar5.queue.length = 0;
    world.issueCommand('player', { type: 'produce', item: 'rifle', n: 5 });
    check('Shift×5 连点生产（一次排 5 个步兵）', bar5.queue.length === 5, `queue=${bar5.queue.length}`);
    bar5.queue.length = 0;
  } else {
    check('Shift×5 连点生产（无兵营跳过）', q1 === q0, `factory queue=${q1}`);
  }
}
const sepA = world.addUnit('player', 'cheetah', 25.5, 25.5);
const sepB = world.addUnit('player', 'cheetah', 25.55, 25.55);
const sepD0 = Math.hypot(sepA.x - sepB.x, sepA.y - sepB.y);
for (let i = 0; i < 30; i++) world.tick();
const sepD1 = Math.hypot(sepA.x - sepB.x, sepA.y - sepB.y);
check('重叠单位被分离推开（防叠罗汉）', sepD1 >= sepD0, `${sepD0.toFixed(3)} -> ${sepD1.toFixed(3)}`);

// —— 难度分级（读 DIFFS 配置，不写死数值，不随平衡调整误报） ——
const { Commander: C2 } = await import('../src/sim/ai.js');
const { DIFFS } = await import('../src/config.js');
const w2 = (await import('../src/sim/world.js')).createSkirmish(999);
const hardAI = new C2(w2, 'enemy', 'hard');
const easyAI = new C2(w2, 'enemy', 'easy');
check('难度分级生效（困难节奏全面快于简单）',
  hardAI.diff.trickle > easyAI.diff.trickle && hardAI.diff.waveGap < easyAI.diff.waveGap && hardAI.diff.waveCd0 < easyAI.diff.waveCd0,
  `trickle ${easyAI.diff.trickle}->${hardAI.diff.trickle}, gap ${easyAI.diff.waveGap}->${hardAI.diff.waveGap}`);
check('难度节奏口径一致（首波缓冲>波次间隔>0）',
  DIFFS.normal.waveCd0 > DIFFS.normal.waveGap && DIFFS.normal.waveGap > 0,
  `cd0=${DIFFS.normal.waveCd0} gap=${DIFFS.normal.waveGap}`);

// —— 阶段12：职业操控（排队/巡逻/固守/停止清队列） ——
const qTank = world.addUnit('player', 'cheetah', 30.5, 60.5);
world.issueCommand('player', { type: 'move', ids: [qTank.id], x: 35, y: 60 });
world.issueCommand('player', { type: 'move', ids: [qTank.id], x: 40, y: 60, queued: true });
check('Shift 排队移动（队列长度 1）', (qTank.oq?.length ?? 0) === 1, `oq=${qTank.oq?.length ?? 0}`);
world.issueCommand('player', { type: 'stop', ids: [qTank.id] });
check('停止清空移动队列', (qTank.oq?.length ?? 0) === 0 && qTank.order.type === 'idle', `order=${qTank.order.type}`);
const pTank = world.addUnit('player', 'cheetah', 30.5, 62.5);
world.issueCommand('player', { type: 'patrol', ids: [pTank.id], x: 36, y: 62 });
check('巡逻指令下发（两点往返）', pTank.order.type === 'patrol' && pTank.order.x2 === 36, `order=${pTank.order.type}`);
world.issueCommand('player', { type: 'hold', ids: [pTank.id] });
check('固守指令下发（原地开火）', pTank.order.type === 'hold', `order=${pTank.order.type}`);
world.issueCommand('player', { type: 'hold', ids: [pTank.id] });
check('再按固守切警戒（小范围追击）', pTank.order.type === 'guard', `order=${pTank.order.type}`);
// 巡逻往返：腿终点折返
const pp = world.addUnit('player', 'cheetah', 20.5, 20.5);
world.issueCommand('player', { type: 'patrol', ids: [pp.id], x: 21, y: 20 });
for (let i = 0; i < 240; i++) world.tick();
check('巡逻单位来回走动（往返腿切换）', Math.hypot(pp.x - 20.5, pp.y - 20.5) > 0.2, `at ${pp.x.toFixed(1)},${pp.y.toFixed(1)} leg=${pp.order.leg}`);
// 固守不追击：射程外敌人路过不追
const holder = world.unitsOf('player').find(u => u.type === 'cheetah' && u.order?.type !== 'patrol') || qTank;
world.issueCommand('player', { type: 'hold', ids: [holder.id] });
const hx = holder.x, hy = holder.y;
const passer = world.addUnit('enemy', 'rifle', hx + 7, hy);
passer.order = { type: 'move', x: hx + 12, y: hy };
world.setPath(passer, hx + 12, hy);
for (let i = 0; i < 90; i++) world.tick();
check('固守单位不追击（原地不动）', Math.hypot(holder.x - hx, holder.y - hy) < 0.5 && holder.order.type === 'hold',
  `moved ${Math.hypot(holder.x - hx, holder.y - hy).toFixed(2)}`);

console.log(`\n${failures === 0 ? '全部通过 ✔' : failures + ' 项失败 ✘'}`);
process.exit(failures === 0 ? 0 : 1);
