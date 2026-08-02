// 侧边建造栏、资源/电力 HUD、消息、选中信息、胜负结算

import { UNITS, BUILDINGS, buildTicks } from '../config.js';
import { SIDE_COLORS } from './renderer.js';

const TABS = {
  buildings: () => BUILDINGS.yard.produces,
  infantry: () => BUILDINGS.barracks.produces,
  vehicles: () => BUILDINGS.factory.produces.filter(t => UNITS[t].side !== 'enemy'),
};

export class UI {
  constructor(game, world, sound, renderer) {
    this.game = game;
    this.world = world;
    this.sound = sound;
    this.renderer = renderer;
    this.tab = 'buildings';
    this.buttons = new Map();
    this.timer = 0;
    this.msgTtl = 0;
    this.overlayShown = false;

    this.el = {
      credits: document.getElementById('credits'),
      power: document.getElementById('power'),
      msg: document.getElementById('msg'),
      grid: document.getElementById('buildgrid'),
      selinfo: document.getElementById('selinfo'),
      overlay: document.getElementById('overlay'),
      overlayText: document.getElementById('overlayText'),
    };
    document.querySelectorAll('.tab').forEach(btn => {
      btn.onclick = () => this.setTab(btn.dataset.tab);
    });
    document.getElementById('restartBtn').onclick = () => location.reload();
    this.rebuildGrid();
  }

  setTab(tab) {
    this.tab = tab;
    document.querySelectorAll('.tab').forEach(b => b.classList.toggle('active', b.dataset.tab === tab));
    this.rebuildGrid();
  }

  rebuildGrid() {
    this.el.grid.innerHTML = '';
    this.buttons.clear();
    for (const item of TABS[this.tab]()) {
      const def = UNITS[item] || BUILDINGS[item];
      const btn = document.createElement('button');
      btn.className = 'bbtn';
      // 图标：3D 模型快照
      const img = document.createElement('img');
      img.src = this.renderer.getItemIcon(item);
      img.width = 64; img.height = 48;
      img.alt = def.name;
      btn.appendChild(img);
      btn.insertAdjacentHTML('beforeend',
        `<span class="bname">${def.name}</span><span class="bcost">$${def.cost}</span>` +
        `<span class="bcount" style="display:none"></span><span class="block"></span><span class="bprog"></span>`);
      btn.onclick = () => this.world.issueCommand('player', { type: 'produce', item });
      btn.oncontextmenu = e => { e.preventDefault(); this.world.issueCommand('player', { type: 'cancelProduce', item }); };
      this.el.grid.appendChild(btn);
      this.buttons.set(item, btn);
    }
  }

  update() {
    if (++this.timer % 6 !== 0 && !this.world.winner) return; // 100ms 节流
    const w = this.world;

    // 顶部栏
    this.el.credits.textContent = `💰 ${Math.floor(w.credits.player)}`;
    const p = w.power.player;
    this.el.power.textContent = `⚡ ${p.demand}/${p.supply}`;
    this.el.power.className = 'stat ' + (p.low ? 'low' : 'ok');

    // 消息
    const msgs = w.messages.filter(m => m.side === 'player');
    if (msgs.length) {
      this.el.msg.textContent = msgs[msgs.length - 1].text;
      this.el.msg.style.opacity = 1;
      this.msgTtl = 36; // ~3.6s
      w.messages.length = 0;
    } else if (this.msgTtl > 0 && --this.msgTtl === 0) {
      this.el.msg.style.opacity = 0;
    }

    // 建造按钮状态
    const owned = new Set(w.buildingsOf('player').map(b => b.type));
    const producers = w.buildingsOf('player').filter(b => b.queue !== undefined);
    for (const [item, btn] of this.buttons) {
      const def = UNITS[item] || BUILDINGS[item];
      const producerType = UNITS[item] ? UNITS[item].producer : 'yard';
      const hasProducer = owned.has(producerType);
      const prereqOk = w.hasPrereq('player', def);
      const locked = !hasProducer || !prereqOk;
      btn.classList.toggle('disabled', locked);
      btn.classList.toggle('placing', w.sides.player.placing === item);
      btn.querySelector('.block').textContent = locked
        ? (!hasProducer ? `需要${BUILDINGS[producerType].name}` : `需要${def.prereq.map(t => BUILDINGS[t].name).join('/')}`)
        : '';
      btn.querySelector('.bcost').style.color = w.credits.player < def.cost ? '#ff7b72' : '';

      // 队列数量与队首进度
      let count = 0, pct = 0;
      for (const b of producers) {
        for (const q of b.queue) if (q === item) count++;
        if (b.queue[0] === item) pct = Math.min(100, (b.progress / buildTicks(def)) * 100);
      }
      const cnt = btn.querySelector('.bcount');
      cnt.style.display = count ? 'block' : 'none';
      cnt.textContent = count;
      btn.querySelector('.bprog').style.width = pct + '%';
    }

    // 选中信息
    this.updateSelInfo();

    // 胜负
    if (w.winner && !this.overlayShown) {
      this.overlayShown = true;
      this.el.overlay.classList.remove('hidden');
      this.el.overlayText.textContent = w.winner === 'player' ? '胜 利' : '败 北';
      this.el.overlayText.className = w.winner === 'player' ? 'win' : 'lose';
    }
  }

  updateSelInfo() {
    const sel = [...this.game.selection].map(id => this.world.entities.get(id)).filter(Boolean);
    if (!sel.length) { this.el.selinfo.innerHTML = ''; return; }
    if (sel.length === 1) {
      const e = sel[0];
      const def = this.world.defOf(e);
      let html = `<b style="color:${SIDE_COLORS[e.side]}">${def.name}</b>　HP ${Math.ceil(e.hp)}/${e.maxHp}`;
      if (e.kind === 'building' && e.queue?.length) html += `<br>生产中：${(UNITS[e.queue[0]] || BUILDINGS[e.queue[0]]).name} ×${e.queue.length}`;
      if (e.type === 'harvester') html += `<br>载矿：${Math.round(e.load || 0)}`;
      if (e.type === 'mcv') html += '<br>按 D 展开为建造厂';
      this.el.selinfo.innerHTML = html;
      return;
    }
    const counts = {};
    for (const e of sel) {
      const n = this.world.defOf(e).name;
      counts[n] = (counts[n] || 0) + 1;
    }
    this.el.selinfo.innerHTML = Object.entries(counts).map(([n, c]) => `${n}×${c}`).join('　');
  }
}
