// =============================================================
// ui-interaction.js — 鼠标交互与界面逻辑
// 负责：Raycaster 拾取 / 悬停高亮 / 放球与移除 / 提交猜测 /
//       HUD 更新 / 音效（WebAudio 合成，无需音频文件）
// =============================================================
import * as THREE from 'three';
import { COLORS, MAX_ATTEMPTS } from './game-logic.js';
import { Easing, LAYOUT } from './scene-setup.js';
import { renderIcons } from './vendor/lucide-icons.js';

/** 简易音效合成器（首次用户点击时才创建 AudioContext，符合浏览器策略） */
class SoundFX {
  constructor() {
    this.ctx = null;
  }

  ensure() {
    if (!this.ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (AC) this.ctx = new AC();
    }
    if (this.ctx && this.ctx.state === 'suspended') this.ctx.resume();
  }

  blip(freq, dur = 0.08, type = 'sine', vol = 0.15) {
    if (!this.ctx) return;
    const t0 = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t0);
    gain.gain.setValueAtTime(vol, t0);
    gain.gain.exponentialRampToValueAtTime(0.001, t0 + dur);
    osc.connect(gain).connect(this.ctx.destination);
    osc.start(t0);
    osc.stop(t0 + dur);
  }

  place() {
    this.blip(520, 0.07, 'triangle');
  }
  clear() {
    this.blip(240, 0.09, 'sine');
  }
  confirm() {
    this.blip(440, 0.08, 'triangle');
    setTimeout(() => this.blip(660, 0.1, 'triangle'), 90);
  }
  win() {
    [523, 659, 784, 1047].forEach((f, i) =>
      setTimeout(() => this.blip(f, 0.2, 'triangle', 0.2), i * 150)
    );
  }
  lose() {
    [440, 392, 330, 262].forEach((f, i) =>
      setTimeout(() => this.blip(f, 0.25, 'sawtooth', 0.1), i * 200)
    );
  }
}

export class InteractionController {
  /**
   * @param {object} opts
   * @param {SceneManager} opts.sceneManager
   * @param {MastermindGame} opts.game
   * @param {object} opts.dom 各 HTML 元素的引用
   * @param {Function} opts.onRestart 重开回调（由 main.js 提供）
   * @param {Function} opts.onToggleDifficulty 切换难度回调（由 main.js 提供）
   */
  constructor({ sceneManager, game, dom, onRestart, onToggleDifficulty }) {
    this.sm = sceneManager;
    this.game = game;
    this.dom = dom;
    this.onRestart = onRestart;
    this.onToggleDifficulty = onToggleDifficulty;

    this.raycaster = new THREE.Raycaster();
    this.pointer = new THREE.Vector2(999, 999); // 初始置于画面外
    this.hovered = null;
    this.guessBalls = new Array(game.codeLength).fill(null); // 当前轮已放置的球
    this.sound = new SoundFX();

    // 指针交互状态：点按候选 / 拖拽候选 / 拖拽中（三态互斥推进）
    this.pendingClick = null; // 点按调色板球的候选 { colorId, x, y }
    this.dragCandidate = null; // 点按猜测球的候选 { ball, slot, x, y }
    this.dragging = null; // 拖拽中 { ball, fromSlot }
    // 拖拽时球所在的水平面（板面前方一层，避免与板面 z-fighting）
    this.dragPlane = new THREE.Plane(new THREE.Vector3(0, 0, 1), -(LAYOUT.BALL_Z + 0.8));

    this.bindEvents();
    this.refreshHud();
    this.refreshConfirmState();
  }

  // ---------- 事件绑定 ----------
  bindEvents() {
    const { canvas } = this.dom;
    canvas.addEventListener('pointermove', (e) => this.onPointerMove(e));
    canvas.addEventListener('pointerleave', () => this.pointer.set(999, 999));
    canvas.addEventListener('pointerdown', (e) => this.onPointerDown(e));
    // pointerup/cancel 绑在 window 上：拖出画布外松手也能正常落位
    window.addEventListener('pointerup', (e) => this.onPointerUp(e));
    window.addEventListener('pointercancel', () => this.cancelDrag());

    this.dom.btnConfirm.addEventListener('click', () => this.confirmGuess());
    this.dom.btnClear.addEventListener('click', () => this.clearCurrentGuess());
    this.dom.btnRestart.addEventListener('click', () => this.onRestart());
    this.dom.btnAgain.addEventListener('click', () => this.onRestart());
    this.dom.btnRules.addEventListener('click', () =>
      this.dom.rulesPanel.classList.toggle('hidden')
    );
    this.dom.btnDifficulty.addEventListener('click', () => this.onToggleDifficulty());

    // 回车快捷提交
    window.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') this.confirmGuess();
    });
  }

  updatePointerNDC(e) {
    const rect = this.dom.canvas.getBoundingClientRect();
    this.pointer.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
    this.pointer.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
  }

  // ---------- 拾取目标 ----------
  getPickTargets() {
    if (this.game.status !== 'playing') return [];
    const targets = [...this.sm.paletteBalls];
    for (const b of this.guessBalls) if (b) targets.push(b);
    return targets;
  }

  /** 每帧调用：更新悬停高亮 */
  update() {
    if (this.dragging) return; // 拖拽中不做悬停检测，光标由拖拽逻辑控制
    const targets = this.getPickTargets();
    let hit = null;
    if (targets.length) {
      this.raycaster.setFromCamera(this.pointer, this.sm.camera);
      const hits = this.raycaster.intersectObjects(targets, false);
      if (hits.length) hit = hits[0].object;
    }
    if (hit !== this.hovered) {
      if (this.hovered) this.applyHover(this.hovered, false);
      this.hovered = hit;
      if (hit) this.applyHover(hit, true);
    }
    // 猜测球显示"可抓取"手势，调色板球显示指针
    this.dom.canvas.style.cursor = hit
      ? hit.userData.type === 'guess'
        ? 'grab'
        : 'pointer'
      : 'default';
  }

  /** 悬停效果：轻微放大 + 自发光 */
  applyHover(mesh, on) {
    const from = mesh.scale.x;
    const to = on ? 1.12 : 1;
    this.sm.tweens.add({
      tag: 'hover-' + mesh.uuid, // 同一物体只保留最新一个悬停补间
      duration: 0.18,
      ease: Easing.easeOutCubic,
      onUpdate: (e) => mesh.scale.setScalar(from + (to - from) * e),
    });
    if (mesh.material.emissive) {
      mesh.material.emissive.copy(mesh.material.color);
      // 记录材质自带的基础自发光强度，悬停结束时复位到它
      if (mesh.userData.baseEmissive === undefined) {
        mesh.userData.baseEmissive = mesh.material.emissiveIntensity;
      }
      mesh.material.emissiveIntensity = on ? 0.22 : mesh.userData.baseEmissive;
    }
  }

  // ---------- 指针处理（点按 + 拖拽交换） ----------
  /** 按下：记录候选目标，等 pointerup / 拖动阈值再决定行为 */
  onPointerDown(e) {
    if (this.game.status !== 'playing') return;
    this.sound.ensure();
    this.updatePointerNDC(e);
    this.raycaster.setFromCamera(this.pointer, this.sm.camera);
    const hits = this.raycaster.intersectObjects(this.getPickTargets(), false);
    if (!hits.length) return;

    const obj = hits[0].object;
    if (obj.userData.type === 'palette') {
      // 调色板球：点按候选，pointerup 时确认放入
      this.pendingClick = { colorId: obj.userData.colorId, x: e.clientX, y: e.clientY };
    } else if (obj.userData.type === 'guess') {
      // 已放置的球：拖拽候选（若没拖动则视为点按移除）
      this.dragCandidate = { ball: obj, slot: obj.userData.slot, x: e.clientX, y: e.clientY };
    }
  }

  onPointerMove(e) {
    this.updatePointerNDC(e);
    // 按住猜测球移动超过阈值 → 升级为拖拽
    if (this.dragCandidate && !this.dragging) {
      const dx = e.clientX - this.dragCandidate.x;
      const dy = e.clientY - this.dragCandidate.y;
      if (Math.hypot(dx, dy) > 6) this.startDrag();
    }
    if (this.dragging) this.moveDraggedBall();
  }

  onPointerUp(e) {
    if (this.dragging) {
      this.finishDrag();
      return;
    }
    if (this.dragCandidate) {
      // 未超过拖动阈值 → 视为点按：移除该球
      const slot = this.dragCandidate.slot;
      this.dragCandidate = null;
      this.removeFromSlot(slot);
      return;
    }
    if (this.pendingClick) {
      const { colorId, x, y } = this.pendingClick;
      this.pendingClick = null;
      // 手指/鼠标基本没动才算点按（防止滑动误触发）
      if (Math.hypot(e.clientX - x, e.clientY - y) < 8) this.placeColor(colorId);
    }
  }

  /** 开始拖拽：把球提到板面前方一层并放大 */
  startDrag() {
    const ball = this.dragCandidate.ball;
    this.dragging = { ball, fromSlot: this.dragCandidate.slot };
    this.dragCandidate = null;
    this.pendingClick = null;
    // 顶掉可能仍在进行的飞入补间（同 tag 的空补间会让旧补间被移除）
    this.sm.tweens.add({ tag: 'move-' + ball.uuid, duration: 0.001, onUpdate: () => {} });
    if (this.hovered) {
      this.applyHover(this.hovered, false);
      this.hovered = null;
    }
    ball.position.z = LAYOUT.BALL_Z + 0.8;
    ball.scale.setScalar(1.15);
    this.dom.canvas.style.cursor = 'grabbing';
  }

  /** 拖拽中：球跟随指针在拖拽平面上移动 */
  moveDraggedBall() {
    this.raycaster.setFromCamera(this.pointer, this.sm.camera);
    const p = new THREE.Vector3();
    if (this.raycaster.ray.intersectPlane(this.dragPlane, p)) {
      this.dragging.ball.position.x = p.x;
      this.dragging.ball.position.y = p.y;
    }
  }

  /** 松手落位：吸附到最近槽位，空槽则移动、有球则交换，否则回原位 */
  finishDrag() {
    const { ball, fromSlot } = this.dragging;
    this.dragging = null;
    const row = this.game.history.length; // 当前轮所在列

    // 在当前列各槽位中找离松手位置最近的一个
    let best = -1;
    let bestDist = Infinity;
    for (let s = 0; s < this.game.codeLength; s++) {
      const pos = this.sm.slotPosition(row, s);
      const d = Math.hypot(pos.x - ball.position.x, pos.y - ball.position.y);
      if (d < bestDist) {
        bestDist = d;
        best = s;
      }
    }

    if (best !== -1 && bestDist < 1.4 && best !== fromSlot) {
      const other = this.guessBalls[best];
      // 同步逻辑层：先清空两个槽，再按新位置填回
      this.game.clearSlot(fromSlot);
      this.game.clearSlot(best);
      this.game.placeColor(best, ball.userData.colorId);
      ball.userData.slot = best;
      this.guessBalls[best] = ball;
      if (other) {
        // 目标槽已有球 → 两球交换位置
        this.game.placeColor(fromSlot, other.userData.colorId);
        other.userData.slot = fromSlot;
        this.guessBalls[fromSlot] = other;
        this.dropInto(other, this.sm.slotPosition(row, fromSlot));
      } else {
        this.guessBalls[fromSlot] = null;
      }
      this.dropInto(ball, this.sm.slotPosition(row, best));
    } else {
      // 没有合法的落点 → 回到原槽
      this.dropInto(ball, this.sm.slotPosition(row, fromSlot));
    }
    this.sound.place();
    this.refreshConfirmState();
  }

  /** 拖拽结束动画：从当前位置补间落入目标槽位（缩放复位） */
  dropInto(ball, pos) {
    const from = ball.position.clone();
    const fromScale = ball.scale.x;
    this.sm.tweens.add({
      tag: 'move-' + ball.uuid, // 顶掉该球残留的飞入/落位补间
      duration: 0.22,
      ease: Easing.easeOutCubic,
      onUpdate: (e) => {
        ball.position.lerpVectors(from, pos, e);
        ball.scale.setScalar(fromScale + (1 - fromScale) * e);
      },
    });
  }

  /** pointercancel（系统手势打断等）：放弃拖拽，球回原位 */
  cancelDrag() {
    this.pendingClick = null;
    this.dragCandidate = null;
    if (!this.dragging) return;
    const { ball, fromSlot } = this.dragging;
    this.dragging = null;
    this.dropInto(ball, this.sm.slotPosition(this.game.history.length, fromSlot));
    this.dom.canvas.style.cursor = 'default';
  }

  /** 点击样本球：填入当前列最上方的空槽（从上往下填） */
  placeColor(colorId) {
    const slot = this.game.firstEmptySlot();
    if (slot === -1) return; // 已放满，需先移除

    const row = this.game.history.length; // 当前轮对应的棋盘列
    const ball = this.sm.createGlassBall(COLORS[colorId].hex);
    ball.userData = { type: 'guess', slot, colorId };
    this.game.placeColor(slot, colorId);
    this.guessBalls[slot] = ball;
    // 从被点击的样本球位置飞出，沿路径嵌入槽位
    const fromPos = this.sm.paletteBalls[colorId]?.position;
    this.sm.dropBall(ball, this.sm.slotPosition(row, slot), fromPos);
    this.sound.place();
    this.refreshConfirmState();
  }

  /** 点击已放入的球：移除（之后可重新选择填入，即"替换"） */
  removeFromSlot(slot) {
    const ball = this.guessBalls[slot];
    if (!ball) return;
    if (this.hovered === ball) {
      this.applyHover(ball, false);
      this.hovered = null;
    }
    this.game.clearSlot(slot);
    this.guessBalls[slot] = null;
    this.sm.shrinkAndRemove(ball);
    this.sound.clear();
    this.refreshConfirmState();
  }

  /** 清空本轮所有已放入的球 */
  clearCurrentGuess() {
    for (let i = 0; i < this.guessBalls.length; i++) {
      if (this.guessBalls[i]) this.removeFromSlot(i);
    }
  }

  // ---------- 提交与结算 ----------
  confirmGuess() {
    if (this.game.status !== 'playing' || !this.game.isGuessComplete()) return;

    const result = this.game.submitGuess();
    const row = this.game.history.length - 1;

    // 本轮球转为历史记录（留在棋盘上，但不可再点击移除）
    const submittedBalls = this.guessBalls;
    submittedBalls.forEach((b) => (b.userData.type = 'history'));
    this.guessBalls = new Array(this.game.codeLength).fill(null);

    this.sm.spawnFeedback(row, result.exact, result.partial);
    this.sound.confirm();
    this.refreshHud();
    this.refreshConfirmState();

    if (this.game.status === 'won') {
      this.sm.celebrate(submittedBalls);
      this.sound.win();
      // 胜利同样抽开木板、揭晓暗码；横幅等揭晓完成后弹出
      const revealMs = this.sm.revealAnswer(this.game.secret);
      setTimeout(
        () => this.showBanner(`通关！你在第 ${this.game.history.length} 轮猜出了暗码！`, 'trophy'),
        revealMs
      );
    } else if (this.game.status === 'lost') {
      // 先抽开木板、逐个揭晓暗码，全部展示完后再弹出结算
      const revealMs = this.sm.revealAnswer(this.game.secret);
      this.sound.lose();
      setTimeout(() => this.showBanner('8 次用尽，暗码已揭晓', 'lock-open'), revealMs);
    }
  }

  showBanner(text, icon) {
    this.dom.bannerText.innerHTML =
      (icon ? `<i data-icon="${icon}"></i>` : '') + `<span>${text}</span>`;
    renderIcons(this.dom.bannerText);
    this.dom.banner.classList.remove('hidden');
  }

  // ---------- HUD ----------
  refreshHud() {
    this.dom.roundEl.textContent = Math.min(this.game.history.length + 1, MAX_ATTEMPTS);
    this.dom.leftEl.textContent = this.game.attemptsLeft;
  }

  refreshConfirmState() {
    this.dom.btnConfirm.disabled = !(
      this.game.status === 'playing' && this.game.isGuessComplete()
    );
  }

  /** 重开一局时重置交互状态 */
  resetForNewGame() {
    this.guessBalls = new Array(this.game.codeLength).fill(null);
    this.hovered = null;
    this.pendingClick = null;
    this.dragCandidate = null;
    this.dragging = null;
    this.dom.canvas.style.cursor = 'default';
    this.dom.banner.classList.add('hidden');
    this.refreshHud();
    this.refreshConfirmState();
  }
}
