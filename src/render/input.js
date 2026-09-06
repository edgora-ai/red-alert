// 输入：框选、命令下发、相机控制（平移/旋转/缩放）、快捷键、编队

import { T, BUILDINGS } from '../config.js';

export class Input {
  constructor(game, canvas, world, camera, sound, renderer) {
    this.game = game;
    this.cv = canvas;
    this.world = world;
    this.cam = camera;      // {x, y, dist, yaw}
    this.sound = sound;
    this.renderer = renderer;
    this.keys = new Set();
    this.attackMove = false;
    this.groups = {};
    this.dragStart = null;
    this.mouse = { x: 0, y: 0, inside: false };
    this.selboxEl = document.getElementById('selbox');

    canvas.addEventListener('contextmenu', this._ctxMenu = e => e.preventDefault());
    // 中键拖拽平移视角（经典 RTS 右键拖屏的替代，右键已用于命令）
    canvas.addEventListener('mousedown', this._onMd = e => {
      if (e.button === 1) {
        e.preventDefault();
        this.panDrag = { x: e.clientX, y: e.clientY, cx: this.cam.x, cy: this.cam.y };
        this.game.userCam = true;
        return;
      }
      this.onDown(e);
    });
    window.addEventListener('mousemove', this._onPanMove = e => {
      if (this.panDrag) {
        const dx = (e.clientX - this.panDrag.x) / Math.max(1, this.renderer.vw) * this.cam.dist * 1.1;
        const dy = (e.clientY - this.panDrag.y) / Math.max(1, this.renderer.vw) * this.cam.dist * 1.1;
        const fx = -Math.sin(this.cam.yaw), fy = -Math.cos(this.cam.yaw);
        const rx = -fy, ry = fx;
        this.cam.x = Math.min(this.world.w, Math.max(0, this.panDrag.cx - (rx * dx + fx * dy)));
        this.cam.y = Math.min(this.world.h, Math.max(0, this.panDrag.cy - (ry * dx + fy * dy)));
      }
    });
    window.addEventListener('mouseup', this._onPanUp = e => { if (e.button === 1) this.panDrag = null; });
    // 拖拽跟踪挂 window：拖出画布也能继续/完成框选
    window.addEventListener('mousemove', this._onMove = e => this.onMove(e));
    window.addEventListener('mouseup', this._onUp = e => this.onUp(e));
    canvas.addEventListener('mouseleave', this._onMl = () => { this.mouse.inside = false; if (!this.dragStart) this.game.mouseTile = null; });
    canvas.addEventListener('wheel', this._onWh = e => this.onWheel(e), { passive: false });
    // —— 触控最小可用链路：点选=左键 / 拖拽=框选 / 长按=右键命令 / 双指=缩放+拖屏 ——
    canvas.addEventListener('touchstart', this._onTs = e => this.onTouchStart(e), { passive: false });
    canvas.addEventListener('touchmove', this._onTm = e => this.onTouchMove(e), { passive: false });
    canvas.addEventListener('touchend', this._onTe = e => this.onTouchEnd(e), { passive: false });
    canvas.addEventListener('touchcancel', this._onTc = e => this.onTouchEnd(e), { passive: false });
    window.addEventListener('keydown', this._onKeyDn = e => this.onKey(e, true));
    window.addEventListener('keyup', this._onKeyUp = e => this.onKey(e, false));
  }

  // 开局重开：移除全部监听（否则旧 Input 幽灵命令作用于旧世界）
  destroy() {
    this.cv.removeEventListener('contextmenu', this._ctxMenu);
    this.cv.removeEventListener('mousedown', this._onMd);
    this.cv.removeEventListener('mouseleave', this._onMl);
    this.cv.removeEventListener('wheel', this._onWh);
    this.cv.removeEventListener('touchstart', this._onTs);
    this.cv.removeEventListener('touchmove', this._onTm);
    this.cv.removeEventListener('touchend', this._onTe);
    this.cv.removeEventListener('touchcancel', this._onTc);
    if (this.longTimer) { clearTimeout(this.longTimer); this.longTimer = null; }
    window.removeEventListener('mousemove', this._onPanMove);
    window.removeEventListener('mouseup', this._onPanUp);
    window.removeEventListener('mousemove', this._onMove);
    window.removeEventListener('mouseup', this._onUp);
    window.removeEventListener('keydown', this._onKeyDn);
    window.removeEventListener('keyup', this._onKeyUp);
  }

  // 画布内坐标（钳制到画布范围）
  canvasPos(e) {
    const rect = this.cv.getBoundingClientRect();
    const px = e.clientX - rect.left, py = e.clientY - rect.top;
    return {
      px, py,
      inside: px >= 0 && py >= 0 && px <= rect.width && py <= rect.height,
      cx: Math.max(0, Math.min(rect.width, px)),
      cy: Math.max(0, Math.min(rect.height, py)),
    };
  }

  s2t(px, py) {
    // 真机兜底：渲染器缺失时返回零点（输入层不崩；有 GL 时正常反投影）
    if (!this.renderer) return { x: 0, y: 0 };
    return this.renderer.screenToTile(px, py);
  }

  selectedUnits() {
    return [...this.game.selection]
      .map(id => this.world.entities.get(id))
      .filter(e => e && e.kind === 'unit' && e.side === 'player' && !e.dead);
  }
  selectedBuildings() {
    return [...this.game.selection]
      .map(id => this.world.entities.get(id))
      .filter(e => e && e.kind === 'building' && e.side === 'player' && !e.dead);
  }

  // 拾取：优先最近的单位，其次建筑
  pickAt(wx, wy) {
    let unit = null, bestD = 0.65;
    for (const u of this.world.entities.values()) {
      if (u.kind !== 'unit' || u.dead) continue;
      const d = Math.hypot(u.x - wx, u.y - wy);
      if (d < bestD) { bestD = d; unit = u; }
    }
    if (unit) return unit;
    return this.world.buildingAt(Math.floor(wx), Math.floor(wy));
  }

  onDown(e) {
    this.sound.unlock();
    this.game.userPlay = true; // 玩家任何指令 = 接管玩家侧（演示模式停止自动化）
    const rect = this.cv.getBoundingClientRect();
    const px = e.clientX - rect.left, py = e.clientY - rect.top;
    const t = this.s2t(px, py);
    const w = this.world;

    if (e.button === 0) {
      // 超级武器落点瞄准
      if (this.superTarget) {
        const ok = w.issueCommand('player', { type: 'superstrike', x: t.x, y: t.y });
        if (ok) this.game.markers.push({ x: t.x, y: t.y, type: 'attack', ttl: 30, max: 30 });
        this._clearSuperTarget();
        this.updateCursorState();
        return;
      }
      // 建筑放置模式
      if (w.sides.player.placing) {
        w.issueCommand('player', { type: 'build', tx: t.x, ty: t.y });
        return;
      }
      // A 攻击移动模式（Shift=排队追加，不退出模式）；点到具体敌人=点名攻击（经典 RTS 手感）
      if (this.attackMove) {
        const ids = this.selectedUnits().map(u => u.id);
        if (ids.length) {
          const foe = this.pickAt(t.x, t.y);
          if (foe && foe.side !== 'player') {
            w.issueCommand('player', { type: 'attack', ids, targetId: foe.id, queued: e.shiftKey });
          } else {
            w.issueCommand('player', { type: 'attackmove', ids, x: t.x, y: t.y, queued: e.shiftKey });
          }
          this.game.markers.push({ x: t.x, y: t.y, type: 'attack', ttl: 30, max: 30 });
        }
        if (!e.shiftKey) { this.attackMove = false; this.updateCursorState(); }
        return;
      }
      // R 巡逻模式：左键定第二点（Shift=排队追加）
      if (this.patrolMode) {
        const ids = this.selectedUnits().filter(u => u.type !== 'harvester').map(u => u.id);
        if (ids.length) {
          w.issueCommand('player', { type: 'patrol', ids, x: t.x, y: t.y, queued: e.shiftKey });
          this.game.markers.push({ x: t.x, y: t.y, type: 'move', ttl: 30, max: 30 });
        }
        if (!e.shiftKey) { this.patrolMode = false; this.updateCursorState(); }
        return;
      }
      this.dragStart = { x: px, y: py, shift: e.shiftKey };
    } else if (e.button === 2) {
      if (this.superTarget) { this._clearSuperTarget(); this.updateCursorState(); return; }
      if (w.sides.player.placing) { w.issueCommand('player', { type: 'cancelPlace' }); return; }
      if (this.attackMove && !e.shiftKey) { this.attackMove = false; this.updateCursorState(); return; }
      if (this.patrolMode && !e.shiftKey) { this.patrolMode = false; this.updateCursorState(); return; }
      this.rightCommand(t.x, t.y, e.shiftKey);
    }
  }

  // 超级武器瞄准模式（侧栏按钮 / V 键进入，左键落点，右键/ESC 取消）
  startSuperTarget() {
    const w = this.world;
    if (!w.upgrades.player.owned.has('super')) return;
    if ((w.superCd.player ?? 0) > 0) {
      w.messages.push({ side: 'player', text: `轨道炮充能中（${Math.ceil(w.superCd.player / 30)}s）`, ttl: 70 });
      this.sound.play({ type: 'error' });
      return;
    }
    this.superTarget = true;
    this.game.superTargeting = true; // 渲染层画落点预览圈
    this.attackMove = false;
    w.messages.push({ side: 'player', text: '选择轨道打击落点（右键取消）', ttl: 110 });
    this.updateCursorState();
  }

  _clearSuperTarget() {
    this.superTarget = false;
    this.game.superTargeting = false;
  }

  rightCommand(wx, wy, queued = false) {
    const w = this.world;
    const units = this.selectedUnits();
    const buildings = this.selectedBuildings();
    if (!units.length && !buildings.length) return;

    // 只选中生产建筑：右键批量设集结点（多选工厂/兵营一次全部改集结）
    if (!units.length && buildings.length) {
      let set = 0;
      for (const b of buildings) {
        if (BUILDINGS[b.type]?.produces) { w.issueCommand('player', { type: 'rally', id: b.id, x: wx, y: wy }); set++; }
      }
      if (set) {
        this.game.markers.push({ x: wx, y: wy, type: 'move', ttl: 30, max: 30 });
        return;
      }
    }
    if (!units.length) return;
    const ids = units.map(u => u.id);
    const target = this.pickAt(wx, wy);

    // 巡逻模式：右键定第二点
    if (this.patrolMode && units.some(u => u.type !== 'harvester')) {
      const cids = units.filter(u => u.type !== 'harvester').map(u => u.id);
      w.issueCommand('player', { type: 'patrol', ids: cids, x: wx, y: wy, queued });
      this.game.markers.push({ x: wx, y: wy, type: 'move', ttl: 30, max: 30 });
      if (!queued) { this.patrolMode = false; this.updateCursorState(); }
      return;
    }

    if (target && target.side !== 'player') {
      w.issueCommand('player', { type: 'attack', ids, targetId: target.id, queued });
      this.game.markers.push({ x: wx, y: wy, type: 'attack', ttl: 30, max: 30 });
      return;
    }
    const tile = w.tileAt(Math.floor(wx), Math.floor(wy));
    if (tile === T.ORE && units.some(u => u.type === 'harvester')) {
      // 点到矿区：矿车去采矿，其余选中单位移动到同一点（经典红警行为）
      const harvIds = units.filter(u => u.type === 'harvester').map(u => u.id);
      const otherIds = ids.filter(id => !harvIds.includes(id));
      w.issueCommand('player', { type: 'harvest', ids: harvIds, queued });
      if (otherIds.length) w.issueCommand('player', { type: 'move', ids: otherIds, x: wx, y: wy, queued });
      this.game.markers.push({ x: wx, y: wy, type: 'move', ttl: 30, max: 30 });
      return;
    }
    const am = this.attackMove ? 'attackmove' : 'move';
    w.issueCommand('player', { type: am, ids, x: wx, y: wy, queued });
    this.game.markers.push({ x: wx, y: wy, type: am === 'attackmove' ? 'attack' : 'move', ttl: 30, max: 30 });
    if (!queued && this.attackMove) { this.attackMove = false; this.updateCursorState(); }
  }

  onMove(e) {
    const { px, py, inside, cx, cy } = this.canvasPos(e);
    this.mouse = { x: px, y: py, inside };
    const t = this.s2t(cx, cy);
    this.game.mouseTile = { tx: Math.floor(t.x), ty: Math.floor(t.y) };

    // 悬停敌人检测（节流）：有武装部队选中时切换攻击光标
    if ((this.hoverCd = (this.hoverCd || 0) - 1) <= 0) {
      this.hoverCd = 6;
      const armed = this.selectedUnits().some(u => u.weapon);
      const picked = inside ? this.pickAt(t.x, t.y) : null;
      this.hoverEnemy = !!(armed && picked?.side && picked.side !== 'player');
      this.updateCursorState();
    }

    if (this.dragStart) {
      const dx = cx - this.dragStart.x, dy = cy - this.dragStart.y;
      if (Math.abs(dx) + Math.abs(dy) > 6) {
        this.game.selectBox = { x0: this.dragStart.x, y0: this.dragStart.y, x1: cx, y1: cy };
        // 显示框选矩形（HTML 覆盖层，屏幕坐标）
        const el = this.selboxEl;
        if (el) {
          el.style.display = 'block';
          el.style.left = Math.min(this.dragStart.x, cx) + 'px';
          el.style.top = Math.min(this.dragStart.y, cy) + 'px';
          el.style.width = Math.abs(dx) + 'px';
          el.style.height = Math.abs(dy) + 'px';
        }
      }
    }
  }

  onUp(e) {
    if (e.button !== 0 || !this.dragStart) { this.dragStart = null; return; }
    const { cx, cy } = this.canvasPos(e);
    const shift = this.dragStart.shift;
    const box = this.game.selectBox;
    this.game.selectBox = null;
    this.dragStart = null;
    if (this.selboxEl) this.selboxEl.style.display = 'none';

    if (box) { // 框选玩家单位（屏幕四角反投影到地面）
      const a = this.s2t(Math.min(box.x0, box.x1), Math.min(box.y0, box.y1));
      const b = this.s2t(Math.max(box.x0, box.x1), Math.max(box.y0, box.y1));
      const x0 = Math.min(a.x, b.x), x1 = Math.max(a.x, b.x);
      const y0 = Math.min(a.y, b.y), y1 = Math.max(a.y, b.y);
      let units = this.world.unitsOf('player')
        .filter(u => u.x >= x0 && u.x <= x1 && u.y >= y0 && u.y <= y1);
      // 框到混合部队：只留战斗单位（矿车/MCV 不参战，避免一波 A 把经济送掉）
      const combat = units.filter(u => u.weapon);
      if (combat.length && combat.length < units.length) units = combat;
      const ids = units.map(u => u.id);
      if (!shift) this.game.selection.clear();
      ids.forEach(id => this.game.selection.add(id));
      if (ids.length) { this.sound.play({ type: 'select', heavy: units.some(u => !this.world.unitDef(u)?.inf) }); this.game.userPlay = true; }
      return;
    }

    // 点选（双击同类 = 全选屏内该型单位；Ctrl+点 = 全选屏内同类追加）
    const t = this.s2t(cx, cy);
    const picked = this.pickAt(t.x, t.y);
    const ctrl = e.ctrlKey || e.metaKey;
    if (picked && picked.side === 'player' && ctrl && picked.kind === 'unit') {
      const ids = this.world.unitsOf('player')
        .filter(u => u.type === picked.type && this.onScreen(u)).map(u => u.id);
      if (!shift) this.game.selection.clear();
      ids.forEach(id => this.game.selection.add(id));
      this.game.userPlay = true;
      this.sound.play({ type: 'select' });
      return;
    }
    if (!shift) this.game.selection.clear();
    if (picked && picked.side === 'player') {
      this.game.selection.add(picked.id);
      this.game.userPlay = true;
      this.sound.play({ type: 'select', heavy: picked.kind === 'unit' && !this.world.unitDef(picked)?.inf });
      const now = performance.now();
      if (this.lastClick && now - this.lastClick.t < 350 && this.lastClick.type === picked.type) {
        const ids = this.world.unitsOf('player')
          .filter(u => u.type === picked.type && this.onScreen(u)).map(u => u.id);
        ids.forEach(id => this.game.selection.add(id));
        this.lastClick = null;
      } else {
        this.lastClick = { t: now, type: picked.type };
      }
    }
  }

  // 单位是否在当前视口内（世界坐标包围盒近似）
  onScreen(u) {
    const a = this.s2t(0, 0), b = this.s2t(this.renderer.vw, this.renderer.vh);
    if (!this._viewBox || this._viewBoxT !== performance.now()) {
      this._viewBox = { x0: Math.min(a.x, b.x) - 1, x1: Math.max(a.x, b.x) + 1, y0: Math.min(a.y, b.y) - 1, y1: Math.max(a.y, b.y) + 1 };
      this._viewBoxT = performance.now();
    }
    const v = this._viewBox;
    return u.x >= v.x0 && u.x <= v.x1 && u.y >= v.y0 && u.y <= v.y1;
  }

  // ---------- 触控：点选=左键 / 拖拽=框选 / 长按=右键命令 / 双指=缩放+拖屏 ----------
  _touchPos(t) {
    const rect = this.cv.getBoundingClientRect();
    return { x: t.clientX, y: t.clientY, rect };
  }

  onTouchStart(e) {
    e.preventDefault();
    this.sound.unlock();
    this.game.userPlay = true;
    const ts = e.touches;
    if (ts.length >= 2) {
      // 双指：进入缩放+拖屏模式，取消点选/长按状态
      if (this.longTimer) { clearTimeout(this.longTimer); this.longTimer = null; }
      this.dragStart = null;
      this.game.selectBox = null;
      if (this.selboxEl) this.selboxEl.style.display = 'none';
      const a = this._touchPos(ts[0]), b = this._touchPos(ts[1]);
      this.pinch = {
        d0: Math.hypot(a.x - b.x, a.y - b.y),
        dist0: this.cam.dist,
        mx: (a.x + b.x) / 2, my: (a.y + b.y) / 2,
        cx: this.cam.x, cy: this.cam.y,
        rect: a.rect,
      };
      this.touchTap = null;
      return;
    }
    if (this.pinch) return; // 双指中忽略新手指
    const p = this._touchPos(ts[0]);
    this.touchTap = { x: p.x, y: p.y, t: performance.now(), moved: false, longFired: false };
    // 长按 500ms 不动 = 右键命令（移动/攻击/放置确认）
    this.longTimer = setTimeout(() => {
      this.longTimer = null;
      const tap = this.touchTap;
      if (!tap || tap.moved) return;
      const t = this.s2t(p.x - p.rect.left, p.y - p.rect.top);
      tap.longFired = true;
      this.dragStart = null;
      this.game.selectBox = null;
      if (this.selboxEl) this.selboxEl.style.display = 'none';
      // 复用左键模式进入逻辑：超武落点 / 建筑放置直接落子，否则走右键命令
      const w = this.world;
      if (this.superTarget) {
        const ok = w.issueCommand('player', { type: 'superstrike', x: t.x, y: t.y });
        if (ok) this.game.markers.push({ x: t.x, y: t.y, type: 'attack', ttl: 30, max: 30 });
        this._clearSuperTarget();
        this.updateCursorState();
        return;
      }
      if (w.sides.player.placing) {
        w.issueCommand('player', { type: 'build', tx: t.x, ty: t.y });
        return;
      }
      this.rightCommand(t.x, t.y, false);
      this.game.markers.push({ x: t.x, y: t.y, type: 'move', ttl: 30, max: 30 });
    }, 500);
    // 点选起点：先走左键按下（框选逻辑挂 dragStart；纯点选在抬起时落子）
    this.onDown({ button: 0, clientX: p.x, clientY: p.y, shiftKey: false });
  }

  onTouchMove(e) {
    e.preventDefault();
    const ts = e.touches;
    if (this.pinch && ts.length >= 2) {
      // 双指缩放（以中点为锚）+ 中点位移拖屏
      const a = this._touchPos(ts[0]), b = this._touchPos(ts[1]);
      const d = Math.hypot(a.x - b.x, a.y - b.y);
      const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
      if (this.pinch.d0 > 0) {
        const newDist = Math.min(70, Math.max(10, this.pinch.dist0 * (d / this.pinch.d0)));
        const before = this.s2t(mx - this.pinch.rect.left, my - this.pinch.rect.top);
        const k = 1 - newDist / this.pinch.dist0;
        this.cam.x = Math.min(this.world.w, Math.max(0, this.cam.x + (before.x - this.cam.x) * k));
        this.cam.y = Math.min(this.world.h, Math.max(0, this.cam.y + (before.y - this.cam.y) * k));
        this.cam.dist = newDist;
      }
      // 中点位移 → 拖屏（相对 pinch 起点）
      const dxPx = mx - this.pinch.mx, dyPx = my - this.pinch.my;
      if (Math.abs(dxPx) + Math.abs(dyPx) > 2 && this.renderer) {
        const scale = this.cam.dist * 1.1 / Math.max(1, this.renderer.vw);
        const fx = -Math.sin(this.cam.yaw), fy = -Math.cos(this.cam.yaw);
        const rx = -fy, ry = fx;
        this.cam.x = Math.min(this.world.w, Math.max(0, this.pinch.cx - (rx * dxPx + fx * dyPx) * scale));
        this.cam.y = Math.min(this.world.h, Math.max(0, this.pinch.cy - (ry * dxPx + fy * dyPx) * scale));
        this.game.userCam = true;
      }
      return;
    }
    if (ts.length !== 1 || !this.touchTap) return;
    const p = this._touchPos(ts[0]);
    const tap = this.touchTap;
    if (Math.abs(p.x - tap.x) + Math.abs(p.y - tap.y) > 10) {
      tap.moved = true;
      if (this.longTimer) { clearTimeout(this.longTimer); this.longTimer = null; }
      // 拖拽=框选：复用鼠标移动路径
      this.onMove({ clientX: p.x, clientY: p.y });
    }
  }

  onTouchEnd(e) {
    e.preventDefault();
    if (this.longTimer) { clearTimeout(this.longTimer); this.longTimer = null; }
    if (this.pinch) {
      // 双指结束：整体重置（残留手指需抬起重触，避免半截手势误触发点选）
      this.pinch = null;
      this.touchTap = null;
      this.dragStart = null;
      this.game.selectBox = null;
      if (this.selboxEl) this.selboxEl.style.display = 'none';
      return;
    }
    const tap = this.touchTap;
    this.touchTap = null;
    if (!tap) return;
    if (tap.longFired) return; // 长按已下命令，不再落点选
    const t = e.changedTouches[0];
    const x = t ? t.clientX : tap.x, y = t ? t.clientY : tap.y;
    // 抬起=左键单击落子（点选 / 放置确认 / 模式落点）
    this.onUp({ button: 0, clientX: x, clientY: y, shiftKey: false });
  }

  onWheel(e) {
    e.preventDefault();
    this.game.userCam = true;
    const oldDist = this.cam.dist;
    const newDist = Math.min(70, Math.max(10, oldDist * (e.deltaY > 0 ? 1.12 : 0.9)));
    if (newDist === oldDist) return;
    // 缩放向光标聚拢：本相机全部参数随 dist 线性缩放，光标下地面点 = 视心 + 屏偏移×dist，
    // 视心按 (1 - 新旧比) 朝光标地面点平移即可让光标下的世界点保持不动
    const rect = this.cv.getBoundingClientRect();
    const before = this.s2t(e.clientX - rect.left, e.clientY - rect.top);
    this.cam.dist = newDist;
    const k = 1 - newDist / oldDist;
    this.cam.x = Math.min(this.world.w, Math.max(0, this.cam.x + (before.x - this.cam.x) * k));
    this.cam.y = Math.min(this.world.h, Math.max(0, this.cam.y + (before.y - this.cam.y) * k));
  }

  onKey(e, down) {
    const k = e.key.toLowerCase();
    if (down) {
      if (e.repeat) return; // 按住不松的 keydown repeat 一律忽略：否则 G 疯狂切换固守/警戒、P 抖动暂停
      this.sound.unlock();
      if (['arrowup', 'arrowdown', 'arrowleft', 'arrowright', 'q', 'e'].includes(k)) { this.keys.add(k); if (k.startsWith('arrow')) e.preventDefault(); }
      const w = this.world;
      const ids = this.selectedUnits().map(u => u.id);
      switch (k) {
        case 'a': if (ids.length) this.attackMove = true; break;
        case 'r': // 巡逻模式：再左键/右键定第二点（Shift=排队追加，右键/Esc退出）
          if (this.selectedUnits().some(u => u.type !== 'harvester')) { this.patrolMode = true; this.attackMove = false; break; }
          { // 选中建筑：R = 挂机维修开关（按修理厂同价自修 $0.5/HP）
            const bs = this.selectedBuildings().filter(b => b.hp < b.maxHp || b.repairSelf);
            if (bs.length) {
              const turningOn = bs.some(b => !b.repairSelf);
              for (const b of bs) w.issueCommand('player', { type: 'repairBuilding', id: b.id });
              w.messages.push({ side: 'player', text: turningOn ? '建筑开始挂机维修（$0.5/HP）' : '已停止维修', ttl: 90 });
              this.sound.play({ type: turningOn ? 'ready' : 'select' });
              this.game.userPlay = true;
            }
          }
          break;
        case 'g': // 固守/警戒切换：HOLD 原地开火 → GUARD 小范围追击，来回切
          if (ids.length) w.issueCommand('player', { type: 'hold', ids }); break;
        case 'f': { // 选中空闲战斗单位（再按轮切下一个，Shift=追加选中）
          const idle = w.unitsOf('player').filter(u => u.weapon && (!u.order || u.order.type === 'idle') && (!u.oq || !u.oq.length));
          if (idle.length) {
            this.idleIdx = ((this.idleIdx ?? -1) + 1) % idle.length;
            const pick = idle[this.idleIdx % idle.length];
            if (e.shiftKey) this.game.selection.add(pick.id);
            else this.game.selection = new Set([pick.id]);
            this.cam.x = pick.x; this.cam.y = pick.y; this.game.userCam = true;
            this.sound.play({ type: 'select' });
          }
          break;
        }
        case 'i': { // 选中空闲采矿车
          const harvs = w.unitsOf('player').filter(u => u.type === 'harvester' && u.harvest?.state === 'idle' && !u.path);
          if (harvs.length) {
            if (e.shiftKey) harvs.forEach(u => this.game.selection.add(u.id));
            else this.game.selection = new Set(harvs.map(u => u.id));
            this.sound.play({ type: 'select' });
          }
          break;
        }
        case 'v': this.startSuperTarget(); break;
        case 's': w.issueCommand('player', { type: 'stop', ids }); break;
        case 'd': w.issueCommand('player', { type: 'deploy', ids }); break;
        case 't': { // 全选屏内战斗单位
          const ids2 = w.unitsOf('player').filter(u => u.weapon && this.onScreen(u)).map(u => u.id);
          if (ids2.length) {
            this.game.selection = new Set(ids2);
            this.sound.play({ type: 'select' });
          }
          break;
        }
        case 'y': { // 全选所有战斗单位（跨屏，经典 Ctrl+T 变体）
          const ids2 = w.unitsOf('player').filter(u => u.weapon).map(u => u.id);
          if (ids2.length) {
            this.game.selection = new Set(ids2);
            this.sound.play({ type: 'select' });
          }
          break;
        }
        case 'b': document.querySelector('.tab[data-tab="buildings"]')?.click(); break; // 建筑页
        case 'n': document.querySelector('.tab[data-tab="infantry"]')?.click(); break;  // 步兵页
        case 'c': document.querySelector('.tab[data-tab="vehicles"]')?.click(); break;  // 载具页
        case 'k': document.querySelector('.tab[data-tab="tech"]')?.click(); break;       // 科技页
        case 'x': {
          const b = this.selectedBuildings()[0];
          if (b) { w.issueCommand('player', { type: 'sell', id: b.id }); this.game.selection.delete(b.id); }
          break;
        }
        case 'p': this.game.paused = !this.game.paused; break;
        case 'm': this.sound.setSetting('muted', !this.sound.settings.muted); break;
        case 'h': {
          const yard = w.buildingsOf('player').find(b => b.type === 'yard') || w.buildingsOf('player')[0];
          if (yard) { this.cam.x = yard.x; this.cam.y = yard.y; this.game.userCam = true; }
          break;
        }
        case '=': case '+': this.game.speedIdx = Math.min(this.game.SPEEDS.length - 1, this.game.speedIdx + 1); break;
        case '-': case '_': this.game.speedIdx = Math.max(0, this.game.speedIdx - 1); break;
        case 'f1': // P2-10 游戏内帮助面板（进阶操作教学常驻游戏内）
          document.getElementById('helpPanel')?.classList.toggle('hidden');
          e.preventDefault();
          break;
        case 'escape':
          if (!document.getElementById('helpPanel')?.classList.contains('hidden')) {
            document.getElementById('helpPanel')?.classList.add('hidden');
            break;
          }
          if (w.sides.player.placing) w.issueCommand('player', { type: 'cancelPlace' });
          this.attackMove = false;
          this._clearSuperTarget();
          this.patrolMode = false;
          document.getElementById('settings')?.classList.add('hidden'); // 顺手收起设置面板
          break;
        case ' ': { // 空格：循环跳转警报点（多线作战逐个巡检，再按下一个）
          const al = w.alerts.filter(a => a.side === 'player');
          if (al.length) {
            this.alertCycle = (this.alertCycle ?? -1) + 1;
            const a = al[this.alertCycle % al.length];
            this.cam.x = a.x; this.cam.y = a.y;
            this.game.userCam = true;
          }
          e.preventDefault();
          break;
        }
        default:
          if (/^[1-9]$/.test(k)) {
            if (e.ctrlKey || e.metaKey) { this.groups[k] = ids; e.preventDefault(); }
            else if (this.groups[k]?.length) {
              // 召回即剔除死亡/失散 id 并持久化，编组不会越用越"虚"
              this.groups[k] = this.groups[k].filter(id => w.entities.has(id));
              this.game.selection = new Set(this.groups[k]);
              this.sound.play({ type: 'select' });
              // 双击编组键：视角跳到编组中心
              const now2 = performance.now();
              if (this.lastGroup === k && now2 - this.lastGroupT < 350) {
                const sel2 = [...this.game.selection].map(id => w.entities.get(id)).filter(Boolean);
                if (sel2.length) {
                  this.cam.x = sel2.reduce((s, u) => s + u.x, 0) / sel2.length;
                  this.cam.y = sel2.reduce((s, u) => s + u.y, 0) / sel2.length;
                  this.game.userCam = true;
                }
              }
              this.lastGroup = k; this.lastGroupT = now2;
            }
          }
      }
      this.updateCursorState();
      // 命令类按键 = 玩家接管（演示模式停止自动化）
      if (['a', 'r', 'g', 'f', 'i', 's', 'd', 'x', 't', 'y', 'v'].includes(k) || /^[1-9]$/.test(k)) this.game.userPlay = true;
    } else {
      this.keys.delete(k);
    }
  }

  // 光标状态：攻击移动/巡逻/指向敌人时用红色攻击光标；超武瞄准用十字光标
  updateCursorState() {
    const armed = this.selectedUnits().some(u => u.weapon);
    const attacking = this.superTarget || this.attackMove || this.patrolMode || (armed && this.hoverEnemy);
    this.cv.classList.toggle('cursor-attack', !!attacking);
    this.cv.classList.toggle('cursor-super', !!this.superTarget);
  }

  updateCamera(dt) {
    // Q/E 旋转视角
    if (this.keys.has('q')) { this.cam.yaw += dt * 1.8; this.game.userCam = true; }
    if (this.keys.has('e')) { this.cam.yaw -= dt * 1.8; this.game.userCam = true; }

    const speed = 16 * dt * (this.cam.dist / 26);
    // 屏幕方向 → 地面方向（随 yaw 旋转）
    const fx = -Math.sin(this.cam.yaw), fy = -Math.cos(this.cam.yaw); // 前
    const rx = -fy, ry = fx;                                          // 右
    let mx = 0, my = 0;
    if (this.keys.has('arrowup')) { mx += fx; my += fy; }
    if (this.keys.has('arrowdown')) { mx -= fx; my -= fy; }
    if (this.keys.has('arrowleft')) { mx -= rx; my -= ry; }
    if (this.keys.has('arrowright')) { mx += rx; my += ry; }
    // 边缘滚动（框选/中键拖屏中禁用，防止视野跑偏）
    if (this.mouse.inside && !this.dragStart && !this.panDrag) {
      const m = 26;
      if (this.mouse.x < m) { mx -= rx; my -= ry; }
      if (this.mouse.x > this.renderer.vw - m) { mx += rx; my += ry; }
      if (this.mouse.y < m) { mx += fx; my += fy; }
      if (this.mouse.y > this.renderer.vh - m) { mx -= fx; my -= fy; }
    }
    if (mx || my) {
      this.game.userCam = true; // 用户接管相机（演示模式停止自动跟随）
      const len = Math.hypot(mx, my) || 1;
      this.cam.x = Math.min(this.world.w, Math.max(0, this.cam.x + (mx / len) * speed));
      this.cam.y = Math.min(this.world.h, Math.max(0, this.cam.y + (my / len) * speed));
    }
  }
}
