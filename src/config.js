// 全部平衡数据：瓦片/地形/武器/单位/建筑/经济（纯数据，无逻辑）

export const TILE = 32;        // 每瓦片逻辑像素
export const TICK_RATE = 30;   // 逻辑帧率
export const MAP_W = 96;
export const MAP_H = 96;

// 地形类型
export const T = { GRASS: 0, TREE: 1, ROCK: 2, WATER: 3, ORE: 4 };
export const PASSABLE = { [T.GRASS]: true, [T.TREE]: false, [T.ROCK]: false, [T.WATER]: false, [T.ORE]: true };

// 伤害类型 → 护甲类型 克制倍率
export const DAMAGE_MULT = {
  bullet:  { light: 1.0, heavy: 0.4, building: 0.5, air: 0.8 },
  shell:   { light: 0.6, heavy: 1.0, building: 1.0, air: 0.0 },
  missile: { light: 0.9, heavy: 0.9, building: 0.9, air: 1.3 },
  energy:  { light: 1.2, heavy: 1.0, building: 0.8, air: 1.0 },
};

// 武器：cooldown 单位为 tick（30/s）；projSpeed 为瓦片/tick，0 = 即时命中
export const WEAPONS = {
  mg:        { name: '突击步枪',     dmg: 12,  dtype: 'bullet',  range: 4.5, cooldown: 18,  projSpeed: 0,    canAir: false, splash: 0 },
  rpg:       { name: '火箭筒',       dmg: 42,  dtype: 'missile', range: 5.5, cooldown: 36,  projSpeed: 0.35, canAir: true,  splash: 0.6 },
  cannon:    { name: '125mm滑膛炮',  dmg: 45,  dtype: 'shell',   range: 5.5, cooldown: 30,  projSpeed: 0.6,  canAir: false, splash: 0.5 },
  hcannon:   { name: '152mm重炮',    dmg: 68,  dtype: 'shell',   range: 5.5, cooldown: 40,  projSpeed: 0.6,  canAir: false, splash: 0.8 },
  aamissile: { name: '弹炮合一系统', dmg: 30,  dtype: 'missile', range: 6.5, cooldown: 24,  projSpeed: 0.45, canAir: true,  splash: 0 },
  cruise:    { name: '长剑巡航导弹', dmg: 140, dtype: 'missile', range: 11,  minRange: 4, cooldown: 105, projSpeed: 0.3, canAir: false, splash: 1.6 },
  beam:      { name: '粒子光束',     dmg: 95,  dtype: 'energy',  range: 7,   cooldown: 66,  projSpeed: 0,    canAir: false, splash: 0 },
  pods:      { name: '机载火箭巢',   dmg: 30,  dtype: 'missile', range: 5,   cooldown: 27,  projSpeed: 0.45, canAir: false, splash: 0.5 },
  laserT:    { name: '激光炮',       dmg: 38,  dtype: 'energy',  range: 6.5, cooldown: 27,  projSpeed: 0,    canAir: false, splash: 0 },
  samW:      { name: '防空导弹',     dmg: 60,  dtype: 'missile', range: 8.5, cooldown: 30,  projSpeed: 0.5,  canAir: true,  airOnly: true, splash: 0 },
  railW:     { name: '电磁轨道炮',   dmg: 130, dtype: 'shell',   range: 8,   cooldown: 60,  projSpeed: 1.2,  canAir: false, splash: 0 },
  mlrsW:     { name: '远程火箭弹',   dmg: 55,  dtype: 'missile', range: 10.5, minRange: 4, cooldown: 150, projSpeed: 0.32, canAir: false, splash: 1.2, burst: 6, burstCd: 5 },
  reaperW:   { name: '空地导弹',     dmg: 75,  dtype: 'missile', range: 7,   cooldown: 50,  projSpeed: 0.5,  canAir: false, splash: 0.4 },
  sniperW:   { name: '反器材狙击枪', dmg: 70,  dtype: 'bullet',  range: 8.5, cooldown: 55,  projSpeed: 0,    canAir: false, splash: 0 },
  titanW:    { name: '双联电磁轨道炮', dmg: 115, dtype: 'shell',   range: 8.5, cooldown: 85,  projSpeed: 1.1,  canAir: false, splash: 0.5, burst: 2, burstCd: 9 },
  // —— 超级进化：阵营专属武器（chain=链式跳跃目标数，chainFall=衰减系数，stun=瘫痪 tick）——
  teslaW:    { name: '磁暴电弧',     dmg: 85,  dtype: 'energy',  range: 6.5, cooldown: 75,  projSpeed: 0,    canAir: false, splash: 0, chain: 2, chainFall: 0.6, stun: 45, color: '#8fd4ff', jag: true },
  prismW:    { name: '光棱折射束',   dmg: 62,  dtype: 'energy',  range: 7.5, cooldown: 55,  projSpeed: 0,    canAir: false, splash: 0, chain: 2, chainFall: 0.75, color: '#bfff9f' },
  mirageW:   { name: '光束狙击炮',   dmg: 85,  dtype: 'energy',  range: 6.5, cooldown: 55,  projSpeed: 0,    canAir: false, splash: 0, color: '#c9f2ff' },
  kirovW:    { name: '重型航空炸弹', dmg: 80,  dtype: 'shell',   range: 4.5, cooldown: 45,  projSpeed: 0.45, canAir: false, splash: 1.1 },
  apocW:     { name: '双联反坦克导弹', dmg: 52, dtype: 'missile', range: 6,   cooldown: 55,  projSpeed: 0.55, canAir: true,  splash: 0.35, burst: 2, burstCd: 8 },
};

// 单位：speed 瓦片/s，sight 瓦片，buildTime 秒
// producer：生产建筑；prereq：前置建筑；side：阵营限定（缺省双方可用）
export const UNITS = {
  rifle:    { name: '突击兵',         cost: 150,  buildTime: 5,  hp: 120, armor: 'light', speed: 1.6, sight: 5, weapon: 'mg',  producer: 'barracks', inf: true },
  rocket:   { name: '火箭兵',         cost: 300,  buildTime: 8,  hp: 100, armor: 'light', speed: 1.4, sight: 6, weapon: 'rpg', producer: 'barracks', inf: true },
  sniper:   { name: '幽灵狙击手',     cost: 450,  buildTime: 10, hp: 90,  armor: 'light', speed: 1.4, sight: 9, weapon: 'sniperW', producer: 'barracks', inf: true, side: 'player', stealth: true },
  engineer: { name: '工程师',         cost: 500,  buildTime: 12, hp: 80,  armor: 'light', speed: 1.5, sight: 4, capture: true, producer: 'barracks', inf: true },
  harvester:{ name: '驮马采矿车',     cost: 900,  buildTime: 18, hp: 550, armor: 'heavy', speed: 1.8, sight: 4, harvester: true, producer: 'factory' },
  cheetah:  { name: '猎豹II主战坦克', cost: 800,  buildTime: 16, hp: 420, armor: 'heavy', speed: 2.2, sight: 6, weapon: 'cannon', producer: 'factory', side: 'player' },
  tyrant:   { name: '暴君重型坦克',   cost: 1100, buildTime: 22, hp: 620, armor: 'heavy', speed: 1.8, sight: 6, weapon: 'hcannon', producer: 'factory', side: 'enemy' },
  hunter:   { name: '猎手弹炮合一',   cost: 700,  buildTime: 14, hp: 320, armor: 'light', speed: 2.6, sight: 7, weapon: 'aamissile', producer: 'factory' },
  mlrs:     { name: '雷霆远程火箭炮', cost: 1600, buildTime: 26, hp: 300, armor: 'light', speed: 1.5, sight: 9, weapon: 'mlrsW', producer: 'factory', prereq: ['radar'] },
  longsword:{ name: '长剑巡航导弹车', cost: 1400, buildTime: 28, hp: 260, armor: 'light', speed: 1.6, sight: 8, weapon: 'cruise', producer: 'factory', prereq: ['radar'], side: 'player' },
  aurora:   { name: '极光粒子束坦克', cost: 1500, buildTime: 30, hp: 400, armor: 'heavy', speed: 1.9, sight: 7, weapon: 'beam', producer: 'factory', prereq: ['radar'], side: 'player' },
  reaper:   { name: '死神察打无人机', cost: 1800, buildTime: 32, hp: 260, armor: 'air',   speed: 2.8, sight: 9, weapon: 'reaperW', producer: 'factory', prereq: ['radar'], fly: true, side: 'player' },
  ghost:    { name: '幽灵武装无人机', cost: 900,  buildTime: 18, hp: 230, armor: 'air',   speed: 3.2, sight: 8, weapon: 'pods', producer: 'factory', fly: true, prereq: ['radar'], side: 'player' },
  mcv:      { name: '基地车',         cost: 2000, buildTime: 40, hp: 650, armor: 'heavy', speed: 1.5, sight: 5, deploys: 'yard', producer: 'factory' },
  titan:    { name: '泰坦重型机甲',   cost: 3200, buildTime: 45, hp: 950, armor: 'heavy', speed: 1.5, sight: 8, weapon: 'titanW', producer: 'factory', prereq: ['radar', 'npower'] },
  // —— 超级进化：阵营专属兵种 ——
  prism:    { name: '光棱坦克',       cost: 1800, buildTime: 26, hp: 360, armor: 'heavy', speed: 1.7, sight: 8, weapon: 'prismW', producer: 'factory', prereq: ['radar'], side: 'player' },
  mirage:   { name: '幻影坦克',       cost: 1600, buildTime: 24, hp: 380, armor: 'heavy', speed: 1.9, sight: 7, weapon: 'mirageW', producer: 'factory', prereq: ['radar'], side: 'player', stealth: true },
  kirov:    { name: '基洛夫重型飞艇', cost: 2400, buildTime: 30, hp: 1400, armor: 'air',  speed: 0.9, sight: 7, weapon: 'kirovW', producer: 'factory', prereq: ['radar', 'npower'], fly: true, side: 'enemy' },
  apoc:     { name: '天启突击坦克',   cost: 2800, buildTime: 40, hp: 1150, armor: 'heavy', speed: 1.1, sight: 6.5, weapon: 'apocW', producer: 'factory', prereq: ['radar', 'npower'], side: 'enemy' },
};

// 建筑：power 正=供电 负=耗电；produces 指可生产的单位/建筑列表
export const BUILDINGS = {
  yard:     { name: '建造厂',       cost: 2000, buildTime: 40, w: 3, h: 3, hp: 1200, power: -20, sight: 6, produces: ['power', 'refinery', 'barracks', 'factory', 'radar', 'npower', 'laser', 'sam', 'railgun', 'repair', 'tesla'] },
  power:    { name: '燃气电厂',     cost: 600,  buildTime: 12, w: 2, h: 2, hp: 600,  power: 100,  sight: 4 },
  npower:   { name: '核电站',       cost: 1200, buildTime: 24, w: 3, h: 3, hp: 750,  power: 250,  sight: 4, prereq: ['radar'] },
  refinery: { name: '矿石精炼厂',   cost: 1800, buildTime: 30, w: 3, h: 2, hp: 1000, power: -40,  sight: 5, grants: 'harvester', refinery: true },
  barracks: { name: '兵营',         cost: 500,  buildTime: 10, w: 2, h: 2, hp: 750,  power: -20,  sight: 5, produces: ['rifle', 'rocket', 'engineer'] },
  factory:  { name: '战车工厂',     cost: 1800, buildTime: 32, w: 3, h: 3, hp: 1100, power: -30,  sight: 5, prereq: ['barracks'], produces: ['harvester', 'cheetah', 'tyrant', 'hunter', 'longsword', 'aurora', 'ghost', 'mcv', 'titan', 'prism', 'mirage', 'kirov', 'apoc'] },
  radar:    { name: '雷达站',       cost: 1200, buildTime: 20, w: 2, h: 2, hp: 850,  power: -50,  sight: 10, prereq: ['factory'], produces: ['ap', 'composite', 'engine', 'mining', 'super', 'lens', 'overload'] },
  laser:    { name: '激光防御塔',   cost: 800,  buildTime: 14, w: 1, h: 1, hp: 550,  power: -30,  sight: 7, weapon: 'laserT', defense: true },
  sam:      { name: '防空导弹阵地', cost: 700,  buildTime: 12, w: 1, h: 1, hp: 500,  power: -20,  sight: 9, weapon: 'samW', defense: true },
  railgun:  { name: '电磁轨道炮塔', cost: 1400, buildTime: 24, w: 1, h: 1, hp: 650,  power: -60,  sight: 8, weapon: 'railW', defense: true, prereq: ['radar'] },
  repair:   { name: '无人修理厂',   cost: 900,  buildTime: 16, w: 2, h: 2, hp: 800,  power: -25,  sight: 5, prereq: ['factory'], repair: true },
  tesla:    { name: '磁暴线圈',     cost: 1100, buildTime: 20, w: 1, h: 1, hp: 700,  power: -60,  sight: 7.5, weapon: 'teslaW', defense: true, prereq: ['radar'], side: 'enemy' },
  outpost:  { name: '中立补给站',   cost: 0,    buildTime: 0,  w: 2, h: 2, hp: 1100, power: 0,    sight: 6, neutral: true },
};

// 全局科技升级：雷达站研发，一次购买全军永久生效（fire=火力倍率 armor=承伤倍率 speed=机动倍率 mine=采矿倍率）
// wfire=武器专属火力（affects 列出生效武器）；side=阵营限定科技
export const UPGRADES = {
  ap:        { name: '精准弹药',   cost: 1500, buildTime: 30, producer: 'radar', effect: 'fire',  value: 1.2,  desc: '全军火力 +20%' },
  composite: { name: '复合装甲',   cost: 1800, buildTime: 35, producer: 'radar', prereq: ['ap'], effect: 'armor', value: 1 / 1.2, desc: '全军承受伤害 -17%' },
  engine:    { name: '引擎强化',   cost: 1200, buildTime: 25, producer: 'radar', effect: 'speed', value: 1.25, desc: '全军机动 +25%' },
  mining:    { name: '采矿优化',   cost: 1500, buildTime: 30, producer: 'radar', prereq: ['refinery'], effect: 'mine', value: 1.3, desc: '采矿效率 +30%' },
  super:     { name: '轨道打击授权', cost: 2500, buildTime: 45, producer: 'radar', prereq: ['npower'], effect: 'super', desc: '解锁超级武器「轨道动能炮」（V 键 / 侧栏按钮，180s 冷却）' },
  // —— 阵营专属科技（对称克制的打法深度）——
  lens:      { name: '聚焦透镜',   cost: 900,  buildTime: 30, producer: 'radar', prereq: ['npower'], side: 'player', effect: 'wfire', value: 1.25, affects: ['prismW', 'beam', 'mirageW'], desc: '光棱/粒子束/幻影武器伤害 +25%' },
  overload:  { name: '磁暴过载',   cost: 900,  buildTime: 30, producer: 'radar', prereq: ['npower'], side: 'enemy', effect: 'wfire', value: 1.25, affects: ['teslaW'], desc: '磁暴线圈伤害 +25%' },
};

export const ECON = {
  startCredits: 5000,
  orePerTile: 4000,     // 单格矿量
  loadAmount: 700,      // 每车矿入账
  harvestTicks: 90,     // 装满一车所需 tick
  placeMargin: 2,       // 建筑须邻近己方建筑的格距
  super: { dmg: 950, radius: 3.4, delay: 50, cooldown: 5400 }, // 轨道炮：预警 1.7s，冷却 180s
  repair: { radius: 3.2, rate: 10, costPerHp: 0.5 },           // 修理厂：10 HP/s，$0.5/HP
  neutral: { period: 150, income: 100 },                       // 中立补给站：每 5s +$100
  cloak: { reveal: 90, near: 2.6 },                            // 狙击手迷彩：开火后现形 3s，近身 2.6 格内现形
  prodSpeed: { bonus: 0.35, cap: 1.7 },                        // 多兵营/多战车工厂并行加速：+35%/座，上限 170%
};

// 老兵等级：击杀积攒经验，晋升提升火力与耐久（chevrons 渲染见 renderer）
export const VET = { thresholds: [240, 640], dmgPerLevel: 0.15, hpPerLevel: 0.2 };

// AI 难度：trickle = 每 2 秒被动资金（模拟更优运营）；waveCd0 = 首波缓冲，waveGap = 波次间隔（均为 world tick，30/s）
// 节奏曲线（职业 RTS 标准）：简单 6min 首波/5min 间隔·小波次；普通 3.5min/2.3min；困难 2min/70s 坦克海
export const DIFFS = {
  easy:   { name: '简单', trickle: 4,  waveBase: 4, waveStep: 1, maxWave: 8,  incomeMul: 0.7, waveCd0: 10800, waveGap: 9000 },
  normal: { name: '普通', trickle: 10, waveBase: 6, waveStep: 2, maxWave: 13, incomeMul: 1.0, waveCd0: 6300,  waveGap: 4200 },
  hard:   { name: '困难', trickle: 20, waveBase: 8, waveStep: 3, maxWave: 16, incomeMul: 1.3, waveCd0: 3600,  waveGap: 2100 },
};

// 单位建造时间换算（秒 → tick）
export function buildTicks(def) {
  return Math.max(1, Math.round(def.buildTime * TICK_RATE));
}
