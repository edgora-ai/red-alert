// 启动与主循环：固定步长 tick + 每帧渲染；开始界面选难度、P 暂停、+/- 变速

import { TICK_RATE } from './config.js';
import { createSkirmish } from './sim/world.js';
import { Commander } from './sim/ai.js';
import { Renderer } from './render/renderer.js';
import { Minimap } from './render/minimap.js';
import { Input } from './render/input.js';
import { UI } from './render/ui.js';
import { Sound } from './audio.js';

const params = new URLSearchParams(location.search);
const isDemo = params.has('demo');
const isHeadless = params.has('ff') || params.has('lowfx');

const canvas = document.getElementById('game');
const world = createSkirmish((Date.now() % 90000) + 10000); // 每局随机地图
const diff = params.get('diff') || 'normal';
const ai = new Commander(world, 'enemy', diff);

// 相机对准玩家基地（3D 轨道相机：目标点 + 距离 + 方位角）
const yard = world.buildingsOf('player').find(b => b.type === 'yard');
const camera = { x: yard.x + 4, y: yard.y + 3, dist: 24, yaw: 0.45 };

const game = {
  world, selection: new Set(), markers: [], selectBox: null, mouseTile: null,
  started: false, paused: false,
  SPEEDS: [0.5, 1, 2, 4], speedIdx: 1,
  diff,
  userCam: false, // 用户手动操作过相机（演示模式据此停止自动跟随）
  userPlay: false, // 用户亲自下过命令（演示模式据此停止接管玩家侧）
  alertTtl: 0, vignette: 0,
};
const renderer = new Renderer(canvas, world, camera, game);
const minimap = new Minimap(document.getElementById('minimap'), world, camera, game);
const sound = new Sound();
const input = new Input(game, canvas, world, camera, sound, renderer);
const ui = new UI(game, world, sound, renderer);

window.addEventListener('resize', () => renderer.resize());

// 演示/自测模式：?demo=1 时自动建造并发起进攻
if (isDemo) {
  game.started = true;
  document.getElementById('start')?.classList.add('hidden');
  import('./demo.js').then(m => m.startDemo({ world, game, camera, ai }));
} else {
  // 开始界面：选难度 → 开战（同时解锁 WebAudio）
  const startEl = document.getElementById('start');
  const startBtn = document.getElementById('startBtn');
  document.querySelectorAll('.diff-btn').forEach(btn => {
    btn.onclick = () => {
      document.querySelectorAll('.diff-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
    };
  });
  startBtn.onclick = () => {
    sound.unlock();
    // 难度在开局前选定：重建 Commander 应用难度参数
    const diffSel = document.querySelector('.diff-btn.active')?.dataset.diff || 'normal';
    if (diffSel !== diff) Object.assign(ai, new Commander(world, 'enemy', diffSel));
    game.diff = diffSel;
    ui.el.diffBadge.textContent = `AI · ${ai.diff.name}`;
    startEl.classList.add('hidden');
    game.started = true;
  };
  // 无交互环境（自动化）直接开战
  if (isHeadless) startBtn.click();
}

let last = performance.now();
let acc = 0;

function frame(now) {
  requestAnimationFrame(frame);
  let dt = (now - last) / 1000;
  last = now;
  if (dt > 0.25) dt = 0.25; // 切后台回来不暴冲

  if (game.started && !game.paused) {
    acc += dt * game.SPEEDS[game.speedIdx];
    const step = 1 / TICK_RATE;
    let n = 0;
    while (acc >= step && n++ < 12) { world.tick(); ai.tick(); acc -= step; }
    if (acc > step * 12) acc = 0;
  }

  input.updateCamera(dt);

  // 清理已阵亡的选中实体
  for (const id of game.selection) {
    if (!world.entities.has(id)) game.selection.delete(id);
  }

  renderer.render();
  minimap.update(renderer);
  ui.update();

  // 音频：消费事件（空间化）+ 每帧烈度/配乐驱动
  sound.drain(world.events, camera);
  sound.update(dt);
  for (const e of world.events) {
    if (e.type === 'underAttack') {
      game.alertTtl = 2.2;
      game.vignette = Math.min(1, game.vignette + 0.55);
    }
  }
  world.events.length = 0;

  // 受击红晕 + 警报横幅衰减
  if (game.alertTtl > 0) game.alertTtl -= dt;
  if (game.vignette > 0) game.vignette = Math.max(0, game.vignette - dt * 1.6);
  const vigEl = document.getElementById('vignette');
  if (vigEl) vigEl.style.opacity = game.vignette.toFixed(2);
}

renderer.resize();
requestAnimationFrame(frame);

// 调试句柄（自动化测试/排查用）
window.__dbg = { world, game, camera, renderer, input, sound, ui, ai };
