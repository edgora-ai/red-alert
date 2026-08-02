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
};

// 单位：speed 瓦片/s，sight 瓦片，buildTime 秒
// producer：生产建筑；prereq：前置建筑；side：阵营限定（缺省双方可用）
export const UNITS = {
  rifle:    { name: '突击兵',         cost: 150,  buildTime: 5,  hp: 120, armor: 'light', speed: 1.6, sight: 5, weapon: 'mg',  producer: 'barracks', inf: true },
  rocket:   { name: '火箭兵',         cost: 300,  buildTime: 8,  hp: 100, armor: 'light', speed: 1.4, sight: 6, weapon: 'rpg', producer: 'barracks', inf: true },
  engineer: { name: '工程师',         cost: 500,  buildTime: 12, hp: 80,  armor: 'light', speed: 1.5, sight: 4, capture: true, producer: 'barracks', inf: true },
  harvester:{ name: '驮马采矿车',     cost: 900,  buildTime: 18, hp: 550, armor: 'heavy', speed: 1.8, sight: 4, harvester: true, producer: 'factory' },
  cheetah:  { name: '猎豹II主战坦克', cost: 800,  buildTime: 16, hp: 420, armor: 'heavy', speed: 2.2, sight: 6, weapon: 'cannon', producer: 'factory', side: 'player' },
  tyrant:   { name: '暴君重型坦克',   cost: 1100, buildTime: 22, hp: 620, armor: 'heavy', speed: 1.8, sight: 6, weapon: 'hcannon', producer: 'factory', side: 'enemy' },
  hunter:   { name: '猎手弹炮合一',   cost: 700,  buildTime: 14, hp: 320, armor: 'light', speed: 2.6, sight: 7, weapon: 'aamissile', producer: 'factory' },
  longsword:{ name: '长剑巡航导弹车', cost: 1400, buildTime: 28, hp: 260, armor: 'light', speed: 1.6, sight: 8, weapon: 'cruise', producer: 'factory', prereq: ['radar'], side: 'player' },
  aurora:   { name: '极光粒子束坦克', cost: 1500, buildTime: 30, hp: 400, armor: 'heavy', speed: 1.9, sight: 7, weapon: 'beam', producer: 'factory', prereq: ['radar'], side: 'player' },
  ghost:    { name: '幽灵武装无人机', cost: 900,  buildTime: 18, hp: 230, armor: 'air',   speed: 3.2, sight: 8, weapon: 'pods', producer: 'factory', fly: true, prereq: ['radar'], side: 'player' },
  mcv:      { name: '基地车',         cost: 2000, buildTime: 40, hp: 650, armor: 'heavy', speed: 1.5, sight: 5, deploys: 'yard', producer: 'factory' },
};

// 建筑：power 正=供电 负=耗电；produces 指可生产的单位/建筑列表
export const BUILDINGS = {
  yard:     { name: '建造厂',       cost: 2000, buildTime: 40, w: 3, h: 3, hp: 1200, power: -20, sight: 6, produces: ['power', 'refinery', 'barracks', 'factory', 'radar', 'npower', 'laser', 'sam', 'railgun'] },
  power:    { name: '燃气电厂',     cost: 600,  buildTime: 12, w: 2, h: 2, hp: 600,  power: 100,  sight: 4 },
  npower:   { name: '核电站',       cost: 1200, buildTime: 24, w: 3, h: 3, hp: 750,  power: 250,  sight: 4, prereq: ['radar'] },
  refinery: { name: '矿石精炼厂',   cost: 1800, buildTime: 30, w: 3, h: 2, hp: 1000, power: -40,  sight: 5, grants: 'harvester', refinery: true },
  barracks: { name: '兵营',         cost: 500,  buildTime: 10, w: 2, h: 2, hp: 750,  power: -20,  sight: 5, produces: ['rifle', 'rocket', 'engineer'] },
  factory:  { name: '战车工厂',     cost: 1800, buildTime: 32, w: 3, h: 3, hp: 1100, power: -30,  sight: 5, prereq: ['barracks'], produces: ['harvester', 'cheetah', 'tyrant', 'hunter', 'longsword', 'aurora', 'ghost', 'mcv'] },
  radar:    { name: '雷达站',       cost: 1200, buildTime: 20, w: 2, h: 2, hp: 850,  power: -50,  sight: 10, prereq: ['factory'] },
  laser:    { name: '激光防御塔',   cost: 800,  buildTime: 14, w: 1, h: 1, hp: 550,  power: -30,  sight: 7, weapon: 'laserT', defense: true },
  sam:      { name: '防空导弹阵地', cost: 700,  buildTime: 12, w: 1, h: 1, hp: 500,  power: -20,  sight: 9, weapon: 'samW', defense: true },
  railgun:  { name: '电磁轨道炮塔', cost: 1400, buildTime: 24, w: 1, h: 1, hp: 650,  power: -60,  sight: 8, weapon: 'railW', defense: true, prereq: ['radar'] },
};

export const ECON = {
  startCredits: 5000,
  orePerTile: 4000,     // 单格矿量
  loadAmount: 700,      // 每车矿入账
  harvestTicks: 90,     // 装满一车所需 tick
  placeMargin: 2,       // 建筑须邻近己方建筑的格距
};

// 单位建造时间换算（秒 → tick）
export function buildTicks(def) {
  return Math.max(1, Math.round(def.buildTime * TICK_RATE));
}
