// 启动与主循环：固定步长 tick + 每帧渲染

import { TICK_RATE } from './config.js';
import { createSkirmish } from './sim/world.js';
import { Commander } from './sim/ai.js';
import { Renderer } from './render/renderer.js';
import { Minimap } from './render/minimap.js';
import { Input } from './render/input.js';
import { UI } from './render/ui.js';
import { Sound } from './audio.js';

const canvas = document.getElementById('game');
const world = createSkirmish((Date.now() % 90000) + 10000); // 每局随机地图
const ai = new Commander(world, 'enemy');

// 相机对准玩家基地（3D 轨道相机：目标点 + 距离 + 方位角）
const yard = world.buildingsOf('player').find(b => b.type === 'yard');
const camera = { x: yard.x + 4, y: yard.y + 3, dist: 24, yaw: 0.45 };

const game = { world, selection: new Set(), markers: [], selectBox: null, mouseTile: null };
const renderer = new Renderer(canvas, world, camera, game);
const minimap = new Minimap(document.getElementById('minimap'), world, camera);
const sound = new Sound();
const input = new Input(game, canvas, world, camera, sound, renderer);
const ui = new UI(game, world, sound, renderer);

window.addEventListener('resize', () => renderer.resize());

// 演示/自测模式：?demo=1 时自动建造并发起进攻
if (new URLSearchParams(location.search).has('demo')) {
  import('./demo.js').then(m => m.startDemo({ world, game, camera, ai }));
}

let last = performance.now();
let acc = 0;

function frame(now) {
  requestAnimationFrame(frame);
  let dt = (now - last) / 1000;
  last = now;
  if (dt > 0.25) dt = 0.25; // 切后台回来不暴冲
  acc += dt;
  const step = 1 / TICK_RATE;
  let n = 0;
  while (acc >= step && n++ < 5) { world.tick(); ai.tick(); acc -= step; }
  if (acc > step * 5) acc = 0;

  input.updateCamera(dt);

  // 清理已阵亡的选中实体
  for (const id of game.selection) {
    if (!world.entities.has(id)) game.selection.delete(id);
  }

  renderer.render();
  minimap.update(renderer);
  ui.update();
  sound.drain(world.events);
  world.events.length = 0;
}

renderer.resize();
requestAnimationFrame(frame);

// 调试句柄（自动化测试/排查用）
window.__dbg = { world, game, camera, renderer, input };
