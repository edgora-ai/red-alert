// 演示/自测模式：仅当 URL 带 ?demo=1 时加载，自动执行一套建造+进攻流程
// 用途：无头截图验证全链路，或给玩家展示对战效果

import { DIFFS } from './config.js';

export function startDemo({ world, game, camera, ai }) {
  const w = world;
  const diff = new URLSearchParams(location.search).get('diff');
  if (diff && DIFFS[diff]) ai.diff = DIFFS[diff];

  // ?scene=battle：摆一场遭遇战用于特效验证/截图
  if (new URLSearchParams(location.search).get('scene') === 'battle') {
    const cx = 43, cy = 48;
    const blues = [], reds = [];
    for (let i = 0; i < 4; i++) {
      blues.push(w.addUnit('player', i < 2 ? 'cheetah' : 'aurora', cx - 5, cy - 1.5 + i * 1.2));
      reds.push(w.addUnit('enemy', 'tyrant', cx + 5, cy - 1.5 + i * 1.2));
    }
    blues.push(w.addUnit('player', 'ghost', cx - 4, cy + 3));
    w.issueCommand('player', { type: 'attackmove', ids: blues.map(u => u.id), x: cx + 6, y: cy });
    w.issueCommand('enemy', { type: 'attackmove', ids: reds.map(u => u.id), x: cx - 6, y: cy });
    game.selection = new Set(blues.map(u => u.id));
    camera.x = cx; camera.y = cy; camera.dist = 16; camera.yaw = 0.2;
    // 照亮战场
    for (let i = 0; i < 30; i++) { w.updateFog(); }
    return;
  }


  // 找可放置点（围绕建造厂螺旋搜索）
  function findPlace(btype) {
    const yard = w.buildingsOf('player').find(b => b.type === 'yard') || w.buildingsOf('player')[0];
    if (!yard) return null;
    for (let r = 2; r <= 12; r++) {
      for (let dy = -r; dy <= r; dy++) {
        for (let dx = -r; dx <= r; dx++) {
          if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
          const tx = yard.tx + dx, ty = yard.ty + dy;
          if (w.canPlace('player', btype, tx, ty)) return { tx, ty };
        }
      }
    }
    return null;
  }

  const queue = ['power', 'refinery', 'barracks', 'factory', 'radar', 'npower']; // 精炼厂第二：展示完整采矿经济循环
  const cycle = ['cheetah', 'prism', 'hunter', 'mlrs', 'titan', 'mirage', 'sniper'];
  let attacked = false;
  let waveCd = 0;

  // 演示决策：每调用一次推进一步（由 interval 或快进循环驱动）
  // 玩家一旦亲自操作（下达命令/框选/生产），演示立即停止接管玩家侧，变成玩家 vs AI
  function step() {
    if (w.winner || game.userPlay) return;
    if (window.__dbg?.world !== w) return; // 重开换世界后旧 interval 空转守卫

    // 建筑：逐个生产并放置
    const placing = w.sides.player.placing;
    if (placing) {
      const spot = findPlace(placing);
      if (spot) w.issueCommand('player', { type: 'build', tx: spot.tx, ty: spot.ty });
      return;
    }
    if (queue.length) {
      const yard = w.buildingsOf('player').find(b => b.type === 'yard');
      if (yard && !yard.queue.length) {
        const item = queue[0];
        if (w.issueCommand('player', { type: 'produce', item })) queue.shift();
      }
      return;
    }

    // 载具：持续按循环补兵
    const factory = w.buildingsOf('player').find(b => b.type === 'factory');
    if (factory && factory.queue.length < 2) {
      const item = cycle[waveCd++ % cycle.length];
      w.issueCommand('player', { type: 'produce', item });
    }

    // 攒够一波就 A 向敌方建造厂，打完继续攒
    const army = w.unitsOf('player').filter(u => u.weapon && u.type !== 'harvester' && u.order?.type !== 'attackmove');
    if (army.length >= 6) {
      const ey = w.buildingsOf('enemy').find(b => b.type === 'yard') || w.buildingsOf('enemy')[0];
      if (ey) {
        w.issueCommand('player', { type: 'attackmove', ids: army.map(u => u.id), x: ey.x, y: ey.y });
        game.selection = new Set(army.map(u => u.id));
        attacked = true;
      }
    }
    // 镜头跟军走；用户一旦手动操控相机（边缘滚动/滚轮/小地图）就交还控制权
    if (attacked && !game.userCam) {
      const all = w.unitsOf('player').filter(u => u.weapon);
      if (all.length) {
        const cx = all.reduce((s, u) => s + u.x, 0) / all.length;
        const cy = all.reduce((s, u) => s + u.y, 0) / all.length;
        camera.x += (cx - camera.x) * 0.05;
        camera.y += (cy - camera.y) * 0.05;
      }
    }
  }

  // ?ff=N：加载后同步快进 N tick（无头验证用，绕过真实时钟）
  const ff = parseInt(new URLSearchParams(location.search).get('ff') || '0', 10);
  for (let i = 0; i < ff; i++) {
    w.tick();
    ai.tick();
    if (i % 10 === 0) step();
  }

  setInterval(step, 1000 / 3);
}
