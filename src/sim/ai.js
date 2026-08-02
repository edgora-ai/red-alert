// AI 指挥官：建造序列、爆兵、分波次进攻

const BUILD_ORDER = [
  'power', 'refinery', 'barracks', 'factory', 'power',
  'radar', 'laser', 'sam', 'npower', 'railgun', 'power', 'laser',
];

export class Commander {
  constructor(world, side = 'enemy') {
    this.world = world;
    this.side = side;
    this.timer = 0;
    this.bi = 0;          // 建造序列进度
    this.armyCounter = 0; // 兵种轮换计数
    this.waveNo = 0;
  }

  tick() {
    if (++this.timer < 15) return; // 每 0.5s 决策一次
    this.timer = 0;
    const w = this.world;
    if (w.winner) return;
    this.macro();
    this.produceArmy();
    this.launchWaves();
  }

  // 建筑序列 + 放置
  macro() {
    const w = this.world, s = this.side;
    const placing = w.sides[s].placing;
    if (placing) { this.tryPlace(placing); return; }
    const yard = w.buildingsOf(s).find(b => b.type === 'yard');
    if (!yard || yard.queue.length) return;
    const next = this.nextBuilding();
    if (next) w.issueCommand(s, { type: 'produce', item: next });
  }

  nextBuilding() {
    const w = this.world, s = this.side;
    const owned = w.buildingsOf(s).map(b => b.type);
    // 序列外的动态需求：缺电优先补电厂
    if (w.power[s] && w.power[s].supply - w.power[s].demand < 30) return 'power';
    while (this.bi < BUILD_ORDER.length) {
      const t = BUILD_ORDER[this.bi++];
      // 防御塔最多各两座，多了跳过
      if ((t === 'laser' || t === 'sam' || t === 'railgun') && owned.filter(x => x === t).length >= 2) continue;
      if (t === 'refinery' && owned.includes('refinery')) continue;
      if (t === 'barracks' && owned.includes('barracks')) continue;
      if (t === 'factory' && owned.includes('factory')) continue;
      if (t === 'radar' && owned.includes('radar')) continue;
      return t;
    }
    // 序列走完后：钱多想花就补防御
    if (this.world.credits[s] > 3000) return 'laser';
    return null;
  }

  tryPlace(btype) {
    const w = this.world, s = this.side;
    const yard = w.buildingsOf(s).find(b => b.type === 'yard') || w.buildingsOf(s)[0];
    if (!yard) return;
    // 围绕建造厂螺旋搜索可放置点
    for (let r = 2; r <= 14; r++) {
      for (let dy = -r; dy <= r; dy++) {
        for (let dx = -r; dx <= r; dx++) {
          if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
          const tx = yard.tx + dx, ty = yard.ty + dy;
          if (w.canPlace(s, btype, tx, ty)) {
            w.issueCommand(s, { type: 'build', tx, ty });
            return;
          }
        }
      }
    }
  }

  // 部队生产：保持矿车数量，其余按轮换爆兵
  produceArmy() {
    const w = this.world, s = this.side;
    const buildings = w.buildingsOf(s);
    const factory = buildings.find(b => b.type === 'factory');
    const barracks = buildings.find(b => b.type === 'barracks');

    if (factory && factory.queue.length < 2) {
      const refs = buildings.filter(b => b.type === 'refinery').length;
      const harvs = w.unitsOf(s).filter(u => u.type === 'harvester').length;
      let item;
      if (harvs < refs) item = 'harvester';
      else {
        const cycle = ['tyrant', 'tyrant', 'hunter', 'tyrant'];
        item = cycle[this.armyCounter++ % cycle.length];
      }
      w.issueCommand(s, { type: 'produce', item });
    }
    if (barracks && barracks.queue.length < 1 && this.armyCounter % 2 === 0) {
      w.issueCommand(s, { type: 'produce', item: this.armyCounter % 4 === 0 ? 'rocket' : 'rifle' });
    }
  }

  // 进攻波次：攒够一拨就 A 过去
  launchWaves() {
    const w = this.world, s = this.side;
    const army = w.unitsOf(s).filter(u => u.weapon && !u.path && u.order?.type !== 'attackmove' && u.order?.type !== 'attack');
    const need = Math.min(6 + this.waveNo * 2, 12);
    if (army.length < need) return;
    // 目标：优先玩家建造厂，其次任意玩家建筑
    const targets = w.buildingsOf('player');
    if (!targets.length) return;
    const yard = targets.find(b => b.type === 'yard') || targets[0];
    const ids = army.map(u => u.id);
    w.issueCommand(s, { type: 'attackmove', ids, x: yard.x, y: yard.y });
    this.waveNo++;
  }
}
