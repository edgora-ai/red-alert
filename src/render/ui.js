// 侧边建造栏、资源/电力 HUD、消息、选中信息、警报横幅、结算面板、音频设置

import { UNITS, BUILDINGS, UPGRADES, WEAPONS, buildTicks, DIFFS } from '../config.js';
import { SIDE_COLORS } from './renderer.js';

// 队列项/实体查定义：科技研发项不在 UNITS/BUILDINGS 里，必须兜底 UPGRADES（否则选中信息崩）
function defOfItem(item) { return UNITS[item] || BUILDINGS[item] || UPGRADES[item]; }

const TABS = {
  buildings: () => BUILDINGS.yard.produces.filter(t => !BUILDINGS[t].side || BUILDINGS[t].side === 'player'),
  infantry: () => BUILDINGS.barracks.produces,
  vehicles: () => BUILDINGS.factory.produces.filter(t => UNITS[t].side !== 'enemy'),
  tech: () => Object.keys(UPGRADES),
};
const ARMOR_NAMES = { light: '轻甲', heavy: '重甲', air: '空中' };

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
    this.alertTtl = 0;
    this.overlayShown = false;

    this.el = {
      credits: document.getElementById('credits'),
      powerWrap: document.getElementById('powerWrap'),
      powerFill: document.getElementById('powerFill'),
      power: document.getElementById('power'),
      msg: document.getElementById('msg'),
      grid: document.getElementById('buildgrid'),
      selinfo: document.getElementById('selinfo'),
      overlay: document.getElementById('overlay'),
      overlayText: document.getElementById('overlayText'),
      statsGrid: document.getElementById('statsGrid'),
      tooltip: document.getElementById('tooltip'),
      alertBanner: document.getElementById('alertBanner'),
      gameState: document.getElementById('gameState'),
      diffBadge: document.getElementById('diffBadge'),
      settings: document.getElementById('settings'),
      superWrap: document.getElementById('superWrap'),
      superBtn: document.getElementById('superBtn'),
      superCd: document.getElementById('superCd'),
    };

    // 超级武器按钮（旧缓存页面可能没有该元素：缺失时跳过，不影响其他功能）
    if (this.el.superBtn) {
      this.el.superBtn.onclick = () => {
        if ((this.world.superCd.player ?? 0) > 0) return;
        this.game.userPlay = true;
        this.superCb?.();
      };
    }

    document.querySelectorAll('.tab').forEach(btn => {
      btn.onclick = () => this.setTab(btn.dataset.tab);
    });
    document.getElementById('restartBtn').onclick = () => location.reload();

    // 设置面板
    const gear = document.getElementById('gearBtn');
    gear.onclick = () => this.el.settings.classList.toggle('hidden');
    const sfx = document.getElementById('sfxVol');
    const mus = document.getElementById('musVol');
    const mute = document.getElementById('muteChk');
    sfx.value = Math.round(sound.settings.sfx * 100);
    mus.value = Math.round(sound.settings.music * 100);
    mute.checked = sound.settings.muted;
    sfx.oninput = () => sound.setSetting('sfx', sfx.value / 100);
    mus.oninput = () => sound.setSetting('music', mus.value / 100);
    mute.onchange = () => sound.setSetting('muted', mute.checked);

    // 难度徽章
    const diff = DIFFS[game.diff] || DIFFS.normal;
    this.el.diffBadge.textContent = `AI · ${diff.name}`;
    this.el.diffBadge.classList.add('show');

    this.rebuildGrid();
  }

  setTab(tab) {
    this.tab = tab;
    document.querySelectorAll('.tab').forEach(b => b.classList.toggle('active', b.dataset.tab === tab));
    this.rebuildGrid();
  }

  // main 注入：点击超武按钮 → 进入瞄准模式
  bindSuper(cb) { this.superCb = cb; }

  rebuildGrid() {
    this.el.grid.innerHTML = '';
    this.buttons.clear();
    for (const item of TABS[this.tab]()) {
      const def = UNITS[item] || BUILDINGS[item] || UPGRADES[item];
      const btn = document.createElement('button');
      btn.className = 'bbtn';
      const img = document.createElement('img');
      img.src = this.renderer.getItemIcon(item);
      img.width = 64; img.height = 48;
      img.alt = def.name;
      btn.appendChild(img);
      btn.insertAdjacentHTML('beforeend',
        `<span class="bname">${def.name}</span><span class="bcost">$${def.cost}</span>` +
        `<span class="bcount" style="display:none"></span><span class="block"></span><span class="bprog"></span>`);
      // 左键下单（Shift=×5），右键取消一个
      btn.onclick = (e) => { this.game.userPlay = true; this.world.issueCommand('player', { type: 'produce', item, n: e.shiftKey ? 5 : 1 }); };
      btn.oncontextmenu = e => { e.preventDefault(); this.game.userPlay = true; this.world.issueCommand('player', { type: 'cancelProduce', item }); };
      // 工具提示
      btn.onmouseenter = e => this.showTip(item, e);
      btn.onmousemove = e => this.moveTip(e);
      btn.onmouseleave = () => this.el.tooltip.classList.add('hidden');
      this.el.grid.appendChild(btn);
      this.buttons.set(item, btn);
    }
  }

  showTip(item, e) {
    const def = UNITS[item] || BUILDINGS[item] || UPGRADES[item];
    const w = UNITS[item]?.weapon ? WEAPONS[UNITS[item].weapon] : (BUILDINGS[item]?.weapon ? WEAPONS[BUILDINGS[item].weapon] : null);
    const rows = [];
    rows.push(`<span class="tt-cost">造价 $${def.cost} · 建造 ${def.buildTime}s</span>`);
    if (UPGRADES[item]) {
      rows.push(def.desc);
      rows.push('研发后全军永久生效');
    } else if (UNITS[item]) {
      rows.push(`耐久 ${def.hp} · ${ARMOR_NAMES[def.armor] || def.armor} · 速度 ${def.speed}`);
      if (w) {
        let fire = `火力 ${w.dmg}${w.burst ? `×${w.burst} 齐射` : ''} / ${(w.cooldown / 30).toFixed(0)}s · 射程 ${w.range}${w.canAir ? ' · 可对空' : ''}`;
        if (w.chain) fire += ` · 链式跳跃×${w.chain + 1}`;
        if (w.stun) fire += ' · 麻痹';
        rows.push(fire);
      }
      if (def.stealth) rows.push('光学迷彩：静止时隐形/伪装，开火现形');
      if (def.capture) rows.push('可占领受损敌方建筑（<50%）');
      if (def.harvester) rows.push('自动采矿运输');
      if (def.deploys) rows.push('按 D 展开为建造厂');
      if (def.fly) rows.push('飞行单位，无视地形');
    } else {
      rows.push(`耐久 ${def.hp}`);
      if (def.power) rows.push(def.power > 0 ? `供电 +${def.power}` : `耗电 ${-def.power}`);
      if (w) rows.push(`火力 ${w.dmg} / ${w.cooldown / 30}s · 射程 ${w.range}${w.canAir ? ' · 可对空' : ''}`);
      if (def.repair) rows.push('自动维修范围内载具（按耐久扣费）');
      // 阵营限定项（如红军磁暴线圈）不进玩家侧生产列表
      if (def.produces) rows.push('生产：' + def.produces.filter(t => BUILDINGS[t] && BUILDINGS[t].side !== 'enemy').map(t => BUILDINGS[t].name).join('、'));
    }
    if (def.prereq) rows.push(`<span class="tt-sub">前置：${def.prereq.map(t => BUILDINGS[t].name).join('/')}</span>`);
    this.el.tooltip.innerHTML = `<div class="tt-name">${def.name}</div>` + rows.map(r => `<div>${r}</div>`).join('');
    this.el.tooltip.classList.remove('hidden');
    this.moveTip(e);
  }

  moveTip(e) {
    const tip = this.el.tooltip;
    const x = Math.min(e.clientX + 14, window.innerWidth - 240);
    const y = Math.min(e.clientY + 10, window.innerHeight - tip.offsetHeight - 12);
    tip.style.left = x + 'px';
    tip.style.top = y + 'px';
  }

  update() {
    if (++this.timer % 6 !== 0 && !this.world.winner) return; // 100ms 节流
    const w = this.world;

    // 顶部栏：资金 + 电力条
    this.el.credits.textContent = `${Math.floor(w.credits.player)}`;
    const p = w.power.player;
    const pct = p.supply > 0 ? Math.min(100, (p.demand / p.supply) * 100) : 100;
    this.el.powerFill.style.width = pct + '%';
    this.el.power.textContent = `${p.demand}/${p.supply}`;
    this.el.powerWrap.classList.toggle('low', p.low);

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

    // 受击警报横幅（game.alertTtl 由 main 驱动衰减；敌方超武预警期间强制显示）
    const strikeIncoming = (w.strikeAlarm?.ttl ?? 0) > 0;
    if (this.game.alertTtl > 0 || strikeIncoming) {
      this.el.alertBanner.style.display = 'block';
      this.el.alertBanner.textContent = strikeIncoming ? '⚠ 轨道打击来袭 — 疏散！' : '⚠ 遭到攻击';
    } else {
      this.el.alertBanner.style.display = 'none';
    }

    // 暂停/变速徽章
    const gs = this.el.gameState;
    if (this.game.paused) { gs.textContent = '⏸ 已暂停（P 继续）'; gs.className = 'badge warn show'; }
    else if (this.game.SPEEDS[this.game.speedIdx] !== 1) {
      gs.textContent = `⏩ ${this.game.SPEEDS[this.game.speedIdx]}x`;
      gs.className = 'badge show';
    } else gs.className = 'badge';

    // 超级武器按钮：研发授权后显示，冷却倒数（元素缺失时静默跳过）
    if (this.el.superWrap && this.el.superBtn && this.el.superCd) {
      const supReady = w.upgrades.player.owned.has('super');
      this.el.superWrap.classList.toggle('hidden', !supReady);
      if (supReady) {
        const cd = w.superCd.player ?? 0;
        this.el.superCd.textContent = cd > 0 ? `${Math.ceil(cd / 30)}s` : '就绪 · V';
        this.el.superBtn.classList.toggle('ready', cd <= 0);
      }
    }

    // 建造按钮状态
    const owned = new Set(w.buildingsOf('player').map(b => b.type));
    const producers = w.buildingsOf('player').filter(b => b.queue !== undefined);
    for (const [item, btn] of this.buttons) {
      const def = UNITS[item] || BUILDINGS[item] || UPGRADES[item];
      const isUp = !!UPGRADES[item];
      const producerType = UNITS[item] ? UNITS[item].producer : (isUp ? 'radar' : 'yard');
      const hasProducer = owned.has(producerType);
      const prereqOk = w.hasPrereq('player', def);
      const ownedAlready = isUp && w.upgrades.player.owned.has(item);
      const locked = (!hasProducer && !ownedAlready) || !prereqOk;
      btn.classList.toggle('disabled', locked || ownedAlready);
      btn.classList.toggle('placing', w.sides.player.placing === item);
      btn.querySelector('.block').textContent = ownedAlready ? '✓ 已装备全军'
        : locked
          ? (!hasProducer ? `需要${BUILDINGS[producerType].name}` : `需要${def.prereq.map(t => BUILDINGS[t].name).join('/')}`)
          : '';
      btn.querySelector('.bcost').style.color = w.credits.player < def.cost ? 'var(--red)' : '';

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

    // 胜负结算（附战报统计）
    if (w.winner && !this.overlayShown) {
      this.overlayShown = true;
      this.el.overlay.classList.remove('hidden');
      this.el.overlayText.textContent = w.winner === 'player' ? '任 务 完 成' : '基 地 陷 落';
      this.el.overlayText.className = w.winner === 'player' ? 'win' : 'lose';
      const s = w.stats, c = w.credits;
      this.el.statsGrid.innerHTML = [
        '<span class="h"></span><span class="h pl">蓝军（你）</span><span class="h en">红军（AI）</span><span class="h"></span>',
        `<span class="h">击毁</span><span class="pl">${s.player.kills}</span><span class="en">${s.enemy.kills}</span><span class="h"></span>`,
        `<span class="h">损失</span><span class="pl">${s.player.lost}</span><span class="en">${s.enemy.lost}</span><span class="h"></span>`,
        `<span class="h">建造</span><span class="pl">${s.player.built}</span><span class="en">${s.enemy.built}</span><span class="h"></span>`,
        `<span class="h">军费开支</span><span class="pl">$${s.player.spent}</span><span class="en">$${s.enemy.spent}</span><span class="h"></span>`,
        `<span class="h">剩余资金</span><span class="pl">$${Math.floor(c.player)}</span><span class="en">$${Math.floor(c.enemy)}</span><span class="h"></span>`,
      ].join('');
    }
  }

  updateSelInfo() {
    const sel = [...this.game.selection].map(id => this.world.entities.get(id)).filter(Boolean);
    if (!sel.length) { this.el.selinfo.innerHTML = '<span style="color:var(--dim)">点击单位查看详情</span>'; return; }
    const STANCE = { hold: '固守', guard: '警戒', patrol: '巡逻', attackmove: '攻击移动', attack: '攻击', move: '移动', harvest: '采矿', capture: '占领' };
    if (sel.length === 1) {
      const e = sel[0];
      const def = this.world.defOf(e);
      let html = `<b style="color:${SIDE_COLORS[e.side]}">${def.name}</b>　HP ${Math.ceil(e.hp)}/${Math.ceil(e.maxHp)}`;
      if ((e.level || 0) > 0) html += `　<span class="vet">★ 老兵 Lv${e.level + 1}</span>`;
      if (e.kind === 'unit' && e.order?.type && e.order.type !== 'idle') html += `　${STANCE[e.order.type] || e.order.type}`;
      if (e.kind === 'unit' && e.oq?.length) html += `　队列×${e.oq.length}（Shift 追加）`;
      if (e.kind === 'building' && e.queue?.length) html += `<br>${UPGRADES[e.queue[0]] ? '研发中' : '生产中'}：${defOfItem(e.queue[0]).name} ×${e.queue.length}`;
      if (e.type === 'harvester') html += `<br>载矿：${Math.round(e.load || 0)}`;
      if (e.type === 'mcv') html += '<br>按 D 展开为建造厂';
      if (e.kind === 'building' && BUILDINGS[e.type].produces) html += '<br>右键地图设集结点';
      this.el.selinfo.innerHTML = html;
      return;
    }
    const counts = {};
    let vet = 0;
    for (const e of sel) {
      const n = this.world.defOf(e).name;
      counts[n] = (counts[n] || 0) + 1;
      if ((e.level || 0) > 0) vet++;
    }
    this.el.selinfo.innerHTML = Object.entries(counts).map(([n, c]) => `${n}×${c}`).join('　') +
      (vet ? `<br><span class="vet">★ 含 ${vet} 名老兵</span>` : '');
  }
}
