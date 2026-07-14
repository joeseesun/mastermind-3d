// =============================================================
// main.js — 游戏入口
// 整合 game-logic / scene-setup / ui-interaction，驱动主循环
// =============================================================
import * as THREE from 'three';
import { MastermindGame } from './game-logic.js';
import { SceneManager } from './scene-setup.js';
import { InteractionController } from './ui-interaction.js';
import { renderIcons } from './vendor/lucide-icons.js';

// 收集 HTML 叠加层元素
const dom = {
  canvas: document.getElementById('scene'),
  roundEl: document.getElementById('round'),
  leftEl: document.getElementById('left'),
  btnConfirm: document.getElementById('btn-confirm'),
  btnClear: document.getElementById('btn-clear'),
  btnRestart: document.getElementById('btn-restart'),
  btnRules: document.getElementById('btn-rules'),
  rulesPanel: document.getElementById('rules'),
  btnDifficulty: document.getElementById('btn-difficulty'),
  banner: document.getElementById('banner'),
  bannerText: document.getElementById('banner-text'),
  btnAgain: document.getElementById('btn-again'),
  btnLeaderboard: document.getElementById('btn-leaderboard'),
  winModal: document.getElementById('win-modal'),
  winStats: document.getElementById('win-stats'),
  winName: document.getElementById('win-name'),
  btnSaveScore: document.getElementById('btn-save-score'),
  btnSkipScore: document.getElementById('btn-skip-score'),
  lbModal: document.getElementById('lb-modal'),
  lbList: document.getElementById('lb-list'),
  btnLbClear: document.getElementById('btn-lb-clear'),
  btnLbClose: document.getElementById('btn-lb-close'),
};

// 渲染静态图标（<i data-icon="..."> → 内联 SVG）
renderIcons();

// 当前难度（暗码位数）：4 = 标准，5 = 困难
let difficulty = 4;

// 本局开始时间（用于排行榜计时，重开时归零）
let startedAt = Date.now();

// 初始化三大模块
const game = new MastermindGame(difficulty);
const sm = new SceneManager(dom.canvas);
sm.buildGame(difficulty);

const interaction = new InteractionController({
  sceneManager: sm,
  game,
  dom,
  onRestart: restart,
  getElapsed: () => Math.round((Date.now() - startedAt) / 1000), // 本局已用秒数
  onToggleDifficulty: () => {
    difficulty = difficulty === 4 ? 5 : 4;
    dom.btnDifficulty.querySelector('.num').textContent = difficulty;
    restart();
  },
});

/** 重开一局（切换难度时同样走这里） */
function restart() {
  game.reset(difficulty);
  sm.buildGame(difficulty);
  startedAt = Date.now(); // 计时归零
  interaction.resetForNewGame();
}

// 窗口尺寸自适应
function resize() {
  sm.resize(window.innerWidth, window.innerHeight);
}
window.addEventListener('resize', resize);
resize();

// 调试钩子：方便在浏览器控制台查看状态或做自动化测试
window.__mm = { game, sm, interaction };

// 主循环：补间/彩带更新 → 悬停检测 → 渲染
const clock = new THREE.Clock();
function animate() {
  requestAnimationFrame(animate);
  const dt = Math.min(clock.getDelta(), 0.05); // 限制帧间隔，避免切后台后跳变
  sm.update(dt);
  interaction.update();
  sm.render();
}
animate();
