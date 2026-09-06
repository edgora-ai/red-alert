// 启动与主循环：固定步长 tick + 每帧渲染；开始界面选难度、P 暂停、+/- 变速
// 健壮性：开始按钮最先接线；子系统/帧循环异常全部可见化，绝不静默冻结

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

// 开始界面最先接线：即使后续子系统初始化失败，入口也永远可点
function showFatal(msg) {
  const tip = document.getElementById('fatalTip');
  if (tip) { tip.textContent = `⚠ 脚本异常：${msg}（已拦截，游戏继续运行）`; tip.style.display = 'block'; }
}
let renderer = null, input = null, ui = null, sound = null, minimap = null;
try {
  renderer = new Renderer(canvas, world, camera, game);
} catch (e) { showFatal(e.message); console.error(e); }

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
  try {
    sound?.unlock();
    // 难度在开局前选定：重建 Commander 应用难度参数
    const diffSel = document.querySelector('.diff-btn.active')?.dataset.diff || 'normal';
    if (diffSel !== diff) Object.assign(ai, new Commander(world, 'enemy', diffSel));
    game.diff = diffSel;
    if (ui) ui.el.diffBadge.textContent = `AI · ${ai.diff.name}`;
    startEl.classList.add('hidden');
    game.started = true;
    // 开局引导（只播一次）：电厂→兵营→采矿三步走
    world.messages.push({ side: 'player', text: '指挥官：建造发电厂，再建兵营与矿车，扩张采矿线！（B/N/C/K 切换建造页）', ttl: 420 });
    // 开局编组：初始坦克编 1 队、步兵编 2 队（双击数字键跳视角）
    try {
      const tanks = world.unitsOf('player').filter(u => u.type === 'cheetah' || u.type === 'tyrant').map(u => u.id);
      const infs = world.unitsOf('player').filter(u => u.type === 'rifle' || u.type === 'rocket').map(u => u.id);
      if (input) {
        if (tanks.length) input.groups['1'] = tanks;
        if (infs.length) input.groups['2'] = infs;
      }
    } catch { /* 编组失败不挡开局 */ }
  } catch (e) { showFatal(e.message); console.error(e); }
};
// 无交互环境（自动化）直接开战
if (isHeadless) startBtn.click();

try {
  minimap = new Minimap(document.getElementById('minimap'), world, camera, game);
  sound = new Sound();
  input = new Input(game, canvas, world, camera, sound, renderer);
  ui = new UI(game, world, sound, renderer);
  ui.bindSuper(() => input.startSuperTarget());
  // 小地图右键 = 同主画布右键语义（移动/攻击/排队，rightCommand 内已打点），左键仍是跳视角
  minimap.bindCmd((x, y, queued) => {
    game.userPlay = true;
    input.rightCommand(x, y, queued);
  });
  window.addEventListener('resize', () => renderer?.resize());
} catch (e) {
  showFatal(e.message);
  console.error(e);
}
boot();

function boot() {
  // 演示/自测模式：?demo=1 时自动建造并发起进攻
  if (isDemo) {
    game.started = true;
    startEl?.classList.add('hidden');
    import('./demo.js').then(m => m.startDemo({ world, game, camera, ai })).catch(e => showFatal(e.message));
  }

  let last = performance.now();
  let acc = 0;
  let lastFrame = last;
  let autoPaused = false;

  function frame(now) {
    requestAnimationFrame(frame);
    lastFrame = now;
    try {
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

      input?.updateCamera(dt);

      // 清理已阵亡的选中实体
      for (const id of game.selection) {
        if (!world.entities.has(id)) game.selection.delete(id);
      }

      renderer?.render();
      if (renderer) minimap?.update(renderer); // 渲染器初始化失败时小地图视口框无依赖可算，跳过
      ui?.update();

      // 音频：消费事件（空间化）+ 每帧烈度/配乐驱动
      if (sound) {
        if (world.winner) sound.musicPaused = true; // 胜负已分：战斗配乐淡出，把舞台留给胜负 jingle
        sound.drain(world.events, camera);
        sound.update(dt);
      }
      for (const e of world.events) {
        if (e.type === 'underAttack') {
          game.alertTtl = 2.2;
          game.vignette = Math.min(1, game.vignette + 0.55);
        }
        if (e.type === 'superHit') {
          // 轨道打击落地：全屏白闪冲击（0.4s CSS 淡出）。
          // 恢复用 setTimeout 而非嵌套 rAF——rAF 被节流时（遮挡/后台）闪光会卡在峰值
          const flashEl = document.getElementById('superFlash');
          if (flashEl) {
            flashEl.style.transition = 'none';
            flashEl.style.opacity = 0.85;
            setTimeout(() => { flashEl.style.transition = ''; flashEl.style.opacity = 0; }, 60);
          }
        }
      }
      world.events.length = 0;

      // 受击红晕 + 警报横幅衰减
      if (game.alertTtl > 0) game.alertTtl -= dt;
      if (game.vignette > 0) game.vignette = Math.max(0, game.vignette - dt * 1.6);
      const vigEl = document.getElementById('vignette');
      if (vigEl) vigEl.style.opacity = game.vignette.toFixed(2);

      // 全屏氛围：敌方超武充能红脉冲（伴随警报声浪）/ 低电力琥珀呼吸
      const alarmEl = document.getElementById('alarmGlow');
      if (alarmEl) {
        const on = world.strikeAlarm && game.started && !world.winner;
        alarmEl.style.opacity = on ? (0.38 + 0.24 * Math.sin(now / 85)).toFixed(2) : 0;
      }
      const powerGlowEl = document.getElementById('lowPowerGlow');
      if (powerGlowEl) {
        const low = world.power.player.low && game.started && !world.winner;
        powerGlowEl.style.opacity = low ? (0.3 + 0.18 * Math.sin(now / 240)).toFixed(2) : 0;
      }
    } catch (e) {
      // 帧循环永不静默冻结：拦截异常、可见提示、下一帧继续
      showFatal(e.message);
      console.error(e);
    }
  }

  renderer?.resize();
  requestAnimationFrame(frame);

  // rAF 饥饿兜底：窗口被其他窗口完全遮挡（visibilityState 仍为 visible）时，
  // Chromium 停发 requestAnimationFrame，游戏会整体假死（点按钮扣钱但一切无响应）。
  // 此时用定时器接力驱动同一帧函数，保证遮挡状态下也持续运行。
  setInterval(() => {
    if (document.visibilityState !== 'visible') return;
    if (performance.now() - lastFrame < 400) return;
    frame(performance.now());
  }, 80);

  // 切到后台标签自动暂停（避免回来时基地被 AI 偷家），回来自动恢复
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') {
      if (game.started && !game.paused) { game.paused = true; autoPaused = true; }
    } else if (autoPaused) {
      game.paused = false;
      autoPaused = false;
    }
  });
}

// 调试句柄（自动化测试/排查用）
window.__dbg = { world, game, camera, renderer, input, sound, ui, ai };
