// 演示/自测模式：仅当 URL 带 ?demo=1 时加载，自动执行一套建造+进攻流程
// 用途：无头截图验证全链路，或给玩家展示对战效果

export function startDemo({ world, game, camera, ai }) {
  const w = world;

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

  const queue = ['power', 'barracks', 'factory'];
  const produceUnits = ['cheetah', 'cheetah', 'cheetah', 'hunter'];
  let attacked = false;

  // 演示决策：每调用一次推进一步（由 interval 或快进循环驱动）
  function step() {
    if (w.winner) return;

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

    // 载具：排队生产
    const factory = w.buildingsOf('player').find(b => b.type === 'factory');
    if (factory && produceUnits.length) {
      if (factory.queue.length < 2) {
        const item = produceUnits[0];
        if (w.issueCommand('player', { type: 'produce', item })) produceUnits.shift();
      }
      return;
    }

    // 攒齐 5 辆战车：全选并 A 向敌方建造厂
    if (!attacked) {
      const army = w.unitsOf('player').filter(u => u.weapon && u.type !== 'harvester');
      if (army.length >= 5) {
        const ey = w.buildingsOf('enemy').find(b => b.type === 'yard') || w.buildingsOf('enemy')[0];
        if (ey) {
          w.issueCommand('player', { type: 'attackmove', ids: army.map(u => u.id), x: ey.x, y: ey.y });
          game.selection = new Set(army.map(u => u.id));
          attacked = true;
        }
      }
    } else {
      // 镜头跟着大军走
      const army = w.unitsOf('player').filter(u => u.weapon);
      if (army.length) {
        const cx = army.reduce((s, u) => s + u.x, 0) / army.length;
        const cy = army.reduce((s, u) => s + u.y, 0) / army.length;
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
