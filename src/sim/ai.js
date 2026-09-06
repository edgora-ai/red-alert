// AI 指挥官：难度分级、建造序列、爆兵、分波次进攻、基地防守反应、争夺中立建筑、超级武器

import { UNITS, UPGRADES, DIFFS, ECON } from '../config.js';

const BUILD_ORDER = [
  'power', 'refinery', 'barracks', 'factory', 'repair', 'power',
  'radar', 'laser', 'sam', 'npower', 'railgun', 'tesla', 'power', 'laser',
];

export class Commander {
  constructor(world, side = 'enemy', diff = 'normal') {
    this.world = world;
    this.side = side;
    this.diff = DIFFS[diff] || DIFFS.normal;
    this.timer = 0;
    this.bi = 0;          // 建造序列进度
    this.armyCounter = 0; // 兵种轮换计数
    this.waveNo = 0;
    this.waveCd = this.diff.waveCd0 ?? 500; // 首波缓冲（world tick，见 DIFFS 节奏曲线）
    this.trickle = 0;
    this.defendCd = 0;
  }

  tick() {
    if (++this.timer < 15) return; // 每 0.5s 决策一次（15 world tick）
    this.timer = 0;
    const w = this.world;
    if (w.winner) return;
    // 难度运营补贴：每 2s 结算一次（= 每 4 次决策）
    if (++this.trickle >= 4) {
      this.trickle = 0;
      w.credits[this.side] += Math.round(this.diff.trickle * this.diff.incomeMul);
    }
    this.macro();
    this.produceArmy();
    this.launchWaves();
    this.defendBase();
    this.dodgeSuper();
    this.tryCapture();
    this.research();
    this.fireSuper();
  }

  // 玩家轨道打击预警期：落点附近的我方部队立即疏散（预警 1.7s，站着吃一发 950 伤害太亏）
  dodgeSuper() {
    if (this.dodgeCd > 0) { this.dodgeCd--; return; }
    const w = this.world, s = this.side;
    for (const st of w.strikes) {
      if (st.side === s) continue;
      const doomed = w.unitsOf(s).filter(u => u.weapon && u.order?.type !== 'attack'
        && Math.hypot(u.x - st.x, u.y - st.y) < ECON.super.radius + 2);
      if (!doomed.length) continue;
      for (const u of doomed) {
        // 恰好站在落点正中心时方向向量退化为零——随机选个方向逃
        let dx = u.x - st.x, dy = u.y - st.y;
        let len = Math.hypot(dx, dy);
        if (len < 0.1) { const a = Math.random() * Math.PI * 2; dx = Math.cos(a); dy = Math.sin(a); len = 1; }
        w.issueCommand(s, { type: 'move', ids: [u.id], x: u.x + (dx / len) * 6, y: u.y + (dy / len) * 6 });
      }
      this.dodgeCd = 2; // 两次决策（1s）内不再重复疏散
      return;
    }
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
      if ((t === 'laser' || t === 'sam' || t === 'railgun' || t === 'tesla') && owned.filter(x => x === t).length >= 2) continue;
      if (t === 'refinery' && owned.includes('refinery')) continue;
      if (t === 'barracks' && owned.includes('barracks')) continue;
      if (t === 'factory' && owned.includes('factory')) continue;
      if (t === 'radar' && owned.includes('radar')) continue;
      return t;
    }
    // 序列走完后：钱多先扩生产线（多兵营/战车工厂并行加速 +35%/座），再补防御
    if (w.credits[s] > 4500 && owned.filter(x => x === 'factory').length < 2) return 'factory';
    if (w.credits[s] > 3500 && owned.filter(x => x === 'barracks').length < 2) return 'barracks';
    if (w.credits[s] > 3000 && owned.filter(x => x === 'refinery').length < 2) return 'refinery';
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

  // 部队生产：保持矿车数量；玩家出空军时补对空；其余按轮换爆兵
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
        const playerAir = w.unitsOf('player').some(u => UNITS[u.type]?.fly);
        const hasRadar = buildings.some(b => b.type === 'radar');
        const hasNPower = buildings.some(b => b.type === 'npower');
        // 困难：重坦海 + 雷达后补火箭炮；核电站后掺阵营专属（天启/基洛夫）与泰坦机甲；玩家出空军：掺弹炮车
        let cycle = this.diff.incomeMul > 1.2
          ? ['tyrant', 'tyrant', 'tyrant', 'hunter', 'tyrant']
          : ['tyrant', 'tyrant', 'hunter', 'tyrant'];
        if (hasRadar) cycle = [...cycle, 'mlrs', 'mlrs'];
        if (hasRadar && hasNPower) {
          if (this.diff.incomeMul > 1.2) cycle = [...cycle, 'apoc', 'kirov', 'apoc'];
          else cycle = [...cycle, 'apoc'];
        }
        if (hasRadar && hasNPower && this.diff.incomeMul > 1.2) cycle = [...cycle, 'titan'];
        if (playerAir) {
          // 对空应急编队：天启需核电站前置，没解锁时别把产能浪费在必然失败的下单上
          cycle = hasRadar && hasNPower ? ['tyrant', 'hunter', 'hunter', 'tyrant', 'apoc'] : ['tyrant', 'hunter', 'hunter', 'tyrant'];
        }
        item = cycle[this.armyCounter++ % cycle.length];
      }
      w.issueCommand(s, { type: 'produce', item });
    }
    if (barracks && barracks.queue.length < 1 && this.armyCounter % 2 === 0) {
      w.issueCommand(s, { type: 'produce', item: this.armyCounter % 5 === 0 ? 'rocket' : 'rifle' });
    }
    // 场上有无主补给站且己方未占：补工程师
    const wantOutpost = this.neutralOutposts().length && !this.neutralOutposts().some(b => b.side === s);
    if (wantOutpost && barracks && !barracks.queue.length
      && !w.unitsOf(s).some(u => UNITS[u.type]?.capture)) {
      w.issueCommand(s, { type: 'produce', item: 'engineer' });
    }
  }

  neutralOutposts() {
    return [...this.world.entities.values()].filter(e => e.kind === 'building' && !e.dead && e.type === 'outpost');
  }

  // 派遣空闲工程师占领最近的中立补给站
  tryCapture() {
    const w = this.world, s = this.side;
    const outposts = this.neutralOutposts();
    if (!outposts.length || outposts.some(b => b.side === s)) return;
    const engs = w.unitsOf(s).filter(u => UNITS[u.type]?.capture && u.order?.type !== 'capture');
    for (const u of engs) {
      const tgt = outposts
        .map(b => ({ b, d: Math.hypot(b.x - u.x, b.y - u.y) }))
        .sort((a, c) => a.d - c.d)[0]?.b;
      if (tgt) w.issueCommand(s, { type: 'capture', ids: [u.id], targetId: tgt.id });
    }
  }

  // 超级武器：授权就绪且冷却归零时，砸玩家最值钱的建筑
  fireSuper() {
    const w = this.world, s = this.side;
    if (!w.upgrades[s].owned.has('super') || (w.superCd[s] ?? 0) > 0) return;
    const targets = w.buildingsOf('player');
    if (!targets.length) return;
    const t = targets.find(b => b.type === 'yard')
      || targets.slice().sort((a, b) => b.maxHp - a.maxHp)[0];
    w.issueCommand(s, { type: 'superstrike', x: t.x + (Math.random() - 0.5) * 1.2, y: t.y + (Math.random() - 0.5) * 1.2 });
  }

  // 科技研发：钱有余裕就升级（困难全序研发，普通优先经济）
  research() {
    const w = this.world, s = this.side;
    const radar = w.buildingsOf(s).find(b => b.type === 'radar');
    if (!radar || radar.queue.length) return;
    const owned = w.upgrades[s].owned;
    const order = this.diff.incomeMul > 1.2
      ? ['ap', 'mining', 'super', 'composite', 'engine', 'overload']
      : ['mining', 'ap'];
    for (const id of order) {
      if (owned.has(id)) continue;
      const up = UPGRADES[id];
      if (!w.hasPrereq(s, up)) continue;
      if (w.credits[s] > up.cost + 700) {
        w.issueCommand(s, { type: 'produce', item: id });
      }
      return;
    }
  }

  // 进攻波次：攒够一拨、间隔冷却过后就 A 过去（规模随难度与波次增长）
  // 注意：tick() 每 15 world tick 才调一次 launchWaves，waveCd/waveGap 按决策次数口径
  // 固守/警戒是守备姿态：绝不被波次调走（否则防守塔后的驻军被一波带空）
  launchWaves() {
    const w = this.world, s = this.side;
    if (this.waveCd > 0) { this.waveCd -= 15; return; }
    const army = w.unitsOf(s).filter(u => u.weapon && !u.path
      && u.order?.type !== 'attackmove' && u.order?.type !== 'attack'
      && u.order?.type !== 'hold' && u.order?.type !== 'guard');
    const need = Math.min(this.diff.waveBase + this.waveNo * this.diff.waveStep, this.diff.maxWave);
    if (army.length < need) return;
    // 目标：优先玩家建造厂，其次任意玩家建筑
    const targets = w.buildingsOf('player');
    if (!targets.length) return;
    const yard = targets.find(b => b.type === 'yard') || targets[0];
    const ids = army.map(u => u.id);
    w.issueCommand(s, { type: 'attackmove', ids, x: yard.x, y: yard.y });
    this.waveNo++;
    this.waveCd = this.diff.waveGap;
  }

  // 基地防守：警报点在自家附近时，空闲部队回防（限频，防抽风）
  defendBase() {
    if (this.defendCd > 0) { this.defendCd -= 15; return; }
    const w = this.world, s = this.side;
    const threat = w.alerts.find(a => a.side === s && a.ttl > 30);
    if (!threat) return;
    const base = w.buildingsOf(s)[0];
    if (!base) return;
    if (Math.hypot(threat.x - base.x, threat.y - base.y) > 18) return;
    const defenders = w.unitsOf(s).filter(u =>
      u.weapon && !u.path && u.order?.type !== 'attackmove' && u.order?.type !== 'attack').slice(0, 8);
    if (!defenders.length) return;
    w.issueCommand(s, { type: 'attackmove', ids: defenders.map(u => u.id), x: threat.x, y: threat.y });
    this.defendCd = 90; // 90 world tick = 3 秒内不再重复调动
  }
}
