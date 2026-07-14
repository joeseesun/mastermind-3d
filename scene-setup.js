// =============================================================
// scene-setup.js — Three.js 场景搭建（竖版立板布局）
// 负责：渲染器 / 相机 / 灯光 / 环境反射 / 立板 / 玻璃球工厂 / 动画
// 布局参考《世界游戏大全51》：
//   - 竖直立板面对镜头，每一"列"是一轮猜测（从左到右共 8 列）
//   - 列内槽位从上往下填入；反馈小圆点在列上方
//   - 暗码列在立板右侧，被木板遮挡；失败时木板抽开、逐个揭晓
//   - 7 色样本球放在立板前方的托盘上
// =============================================================
import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { COLORS, MAX_ATTEMPTS } from './game-logic.js';

// ---------- 布局常量（世界单位） ----------
export const LAYOUT = {
  ROWS: MAX_ATTEMPTS, // 8 列（每列一轮猜测）
  COL_SPACING: 2.5, // 相邻两列间距
  SLOT_SPACING: 2.4, // 列内相邻槽位间距
  SLOT_BASE_Y: 2.6, // 最底部槽位的高度
  BALL_RADIUS: 0.85, // 玻璃球半径
  BALL_Z: 0.55, // 球心 z（嵌入立板更深，减少透视视差，避免看起来浮出凹槽）
  PEG_RADIUS: 0.28, // 反馈小圆点半径
  PEG_AREA_GAP: 2.3, // 槽位区与反馈区的间距（分隔条上下留白）
  X_SHIFT: 1.3, // 猜测列整体左移，为右侧暗码列腾空间
  ANSWER_GAP_X: 2.55, // 最后一列与暗码列的间距
  TRAY_Z: 5.6, // 调色板托盘与立板的距离（离棋盘远一点，避免与立板上的球产生视觉混淆）
};

// ---------- 简易缓动函数（不引入额外动画库） ----------
export const Easing = {
  linear: (t) => t,
  easeOutCubic: (t) => 1 - Math.pow(1 - t, 3),
  easeOutBack: (t) => {
    const c1 = 1.70158;
    const c3 = c1 + 1;
    return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2);
  },
  easeOutBounce: (t) => {
    const n1 = 7.5625;
    const d1 = 2.75;
    if (t < 1 / d1) return n1 * t * t;
    if (t < 2 / d1) return n1 * (t -= 1.5 / d1) * t + 0.75;
    if (t < 2.5 / d1) return n1 * (t -= 2.25 / d1) * t + 0.9375;
    return n1 * (t -= 2.625 / d1) * t + 0.984375;
  },
};

// ---------- 极简补间管理器（替代 GSAP/Tween.js） ----------
export class TweenManager {
  constructor() {
    this.items = [];
  }

  /** opts: { duration, delay?, ease?, onUpdate?(easedT, rawT), onComplete?(), tag? } */
  add(opts) {
    // 相同 tag 的旧补间直接移除，避免同一属性被多个补间打架
    if (opts.tag) this.items = this.items.filter((t) => t.tag !== opts.tag);
    this.items.push({ elapsed: 0, delay: 0, ease: Easing.linear, ...opts });
  }

  clear() {
    this.items.length = 0;
  }

  update(dt) {
    // 先取出当前列表并清空：onComplete 里若调用 add()（如 dropBall 的
    // 阶段链式注册），新补间会直接写入 this.items，循环结束后不会被覆盖丢失
    const current = this.items;
    this.items = [];
    for (const tw of current) {
      tw.elapsed += dt;
      if (tw.elapsed < tw.delay) {
        this.items.push(tw);
        continue;
      }
      const t = Math.min((tw.elapsed - tw.delay) / tw.duration, 1);
      tw.onUpdate?.(tw.ease(t), t);
      if (t >= 1) tw.onComplete?.();
      else this.items.push(tw);
    }
  }
}

/** 生成竖向渐变背景贴图 */
function makeGradientTexture(top, bottom) {
  const c = document.createElement('canvas');
  c.width = 4;
  c.height = 256;
  const ctx = c.getContext('2d');
  const g = ctx.createLinearGradient(0, 0, 0, 256);
  g.addColorStop(0, top);
  g.addColorStop(1, bottom);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 4, 256);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/** 释放对象树资源（跳过共享几何体） */
function disposeTree(root, sharedGeos) {
  root.traverse((o) => {
    if (o.geometry && !sharedGeos.has(o.geometry)) o.geometry.dispose();
    if (o.material) {
      const mats = Array.isArray(o.material) ? o.material : [o.material];
      mats.forEach((m) => m.dispose());
    }
  });
}

export class SceneManager {
  constructor(canvas) {
    this.canvas = canvas;

    // 渲染器
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.15;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;

    // 场景 + 渐变背景
    this.scene = new THREE.Scene();
    this.scene.background = makeGradientTexture('#232e40', '#0b0f16');

    // 相机：正面略俯视，正对竖直立板
    // 小视场角（24°）+ 远机位：接近轻微透视，球与凹槽之间的视差错位更小
    this.camera = new THREE.PerspectiveCamera(24, 1, 0.1, 300);
    this.camera.position.set(0, 11, 60);
    this.camera.lookAt(0, 6, 0);

    // 环境反射贴图（玻璃质感的关键：让球体有真实的高光与反射）
    const pmrem = new THREE.PMREMGenerator(this.renderer);
    this.scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;

    // 灯光：环境光 + 主方向光（带阴影，从右前上方照向立板）+ 冷色补光
    this.scene.add(new THREE.AmbientLight(0xffffff, 0.35));
    const key = new THREE.DirectionalLight(0xfff2e0, 2.4);
    key.position.set(10, 20, 16);
    key.target.position.set(0, 6, 0);
    key.castShadow = true;
    key.shadow.mapSize.set(2048, 2048);
    key.shadow.camera.left = -15;
    key.shadow.camera.right = 15;
    key.shadow.camera.top = 14;
    key.shadow.camera.bottom = -14;
    key.shadow.camera.near = 1;
    key.shadow.camera.far = 70;
    key.shadow.bias = -0.0004;
    key.shadow.normalBias = 0.02;
    this.scene.add(key);
    this.scene.add(key.target);

    const fill = new THREE.DirectionalLight(0xbfd4ff, 0.8);
    fill.position.set(-12, 10, 10);
    this.scene.add(fill);

    // 桌面（持久存在，不随重开重建）
    const table = new THREE.Mesh(
      new THREE.PlaneGeometry(200, 200),
      new THREE.MeshStandardMaterial({ color: 0x0f141d, roughness: 0.95 })
    );
    table.rotation.x = -Math.PI / 2;
    table.receiveShadow = true;
    this.scene.add(table);

    // 共享几何体（所有同类型物体复用，节省内存）
    this.ballGeo = new THREE.SphereGeometry(LAYOUT.BALL_RADIUS, 48, 32);
    this.pegGeo = new THREE.SphereGeometry(LAYOUT.PEG_RADIUS, 20, 14);
    // 立板上的凹槽用圆片（面朝 +z），托盘上的凹槽用浅圆柱
    this.holeGeo = new THREE.CircleGeometry(0.98, 40);
    this.pegHoleGeo = new THREE.CircleGeometry(0.3, 16);
    this.trayHoleGeo = new THREE.CylinderGeometry(0.98, 0.9, 0.32, 32);

    this.tweens = new TweenManager();
    this.confetti = [];
    this.boardGroup = null;
    this.paletteBalls = [];
    this.answerCover = null;
    this.codeLength = 4;
  }

  // ---------- 布局坐标计算 ----------
  /** 第 round 列的 x 坐标（第 0 列在最左侧；整体左移给暗码列腾位） */
  colX(round) {
    return (round - (LAYOUT.ROWS - 1) / 2) * LAYOUT.COL_SPACING - LAYOUT.X_SHIFT;
  }

  /** 列内第 slot 个槽位的 y 坐标（slot 0 在最上方，从上往下填） */
  slotY(slot, n = this.codeLength) {
    return LAYOUT.SLOT_BASE_Y + (n - 1 - slot) * LAYOUT.SLOT_SPACING;
  }

  /** 一列中最顶部槽位（slot 0）的 y 坐标 */
  topSlotY(n = this.codeLength) {
    return this.slotY(0, n);
  }

  /** 暗码列的 x 坐标（立板最右侧） */
  answerX() {
    return this.colX(LAYOUT.ROWS - 1) + LAYOUT.ANSWER_GAP_X;
  }

  /** 某列某位槽位的世界坐标（供交互层放球用） */
  slotPosition(round, slot) {
    return new THREE.Vector3(this.colX(round), this.slotY(slot), LAYOUT.BALL_Z);
  }

  /** 第 round 列第 i 个反馈圆点的世界坐标（列上方，2 列 × 2 行网格） */
  pegPosition(round, i, n = this.codeLength) {
    const cols = Math.ceil(n / 2);
    const cx = (i % cols - (cols - 1) / 2) * 0.78;
    const cy = (0.5 - Math.floor(i / cols)) * 0.78;
    return new THREE.Vector3(
      this.colX(round) + cx,
      this.topSlotY(n) + LAYOUT.PEG_AREA_GAP + cy,
      0.5
    );
  }

  /** 调色板第 i 个球的世界坐标（托盘上） */
  palettePosition(i) {
    return new THREE.Vector3(
      (i - (COLORS.length - 1) / 2) * LAYOUT.SLOT_SPACING,
      1.25,
      LAYOUT.TRAY_Z
    );
  }

  // ---------- 物体工厂 ----------
  /** 创建一个玻璃质感球（MeshPhysicalMaterial + transmission） */
  createGlassBall(colorHex) {
    const mat = new THREE.MeshPhysicalMaterial({
      color: new THREE.Color(colorHex),
      metalness: 0,
      roughness: 0.06,
      transmission: 0.92, // 透射率：玻璃的核心参数
      thickness: 1.2, // 玻璃厚度（影响折射与颜色衰减）
      ior: 1.45, // 折射率
      specularIntensity: 1.0,
      clearcoat: 0.35, // 表面清漆层，增加高光
      clearcoatRoughness: 0.12,
      envMapIntensity: 1.3,
      attenuationColor: new THREE.Color(colorHex), // 玻璃内部颜色
      attenuationDistance: 3.8, // 衰减距离越大颜色越透亮（黄球更亮）
      emissive: new THREE.Color(colorHex),
      emissiveIntensity: 0.06, // 轻微自发光提亮整体，避免暗部发灰
    });
    const mesh = new THREE.Mesh(this.ballGeo, mat);
    mesh.castShadow = true;
    return mesh;
  }

  // ---------- 棋盘构建 ----------
  /** 按暗码长度重建整个棋盘（重开/切换难度时调用） */
  buildGame(codeLength) {
    // 清理旧棋盘与未完成的动画
    this.tweens.clear();
    this.clearConfetti();
    if (this.boardGroup) {
      this.scene.remove(this.boardGroup);
      disposeTree(
        this.boardGroup,
        new Set([this.ballGeo, this.pegGeo, this.holeGeo, this.pegHoleGeo, this.trayHoleGeo])
      );
    }

    const group = new THREE.Group();
    this.scene.add(group);
    this.boardGroup = group;
    this.codeLength = codeLength;
    this.paletteBalls = [];

    const n = codeLength;
    const panelHalfW = this.answerX() + 1.55;
    const panelTop = this.topSlotY(n) + LAYOUT.PEG_AREA_GAP + 1.4;
    const slotMidY = (this.topSlotY(n) + this.slotY(n - 1, n)) / 2;

    // 竖直立板（深蓝灰色，衬托彩色玻璃球）
    const panel = new THREE.Mesh(
      new THREE.BoxGeometry(panelHalfW * 2, panelTop, 0.5),
      new THREE.MeshStandardMaterial({ color: 0x2f4a7c, roughness: 0.55, metalness: 0.05 })
    );
    panel.position.set(0, panelTop / 2, 0);
    panel.receiveShadow = true;
    panel.castShadow = true;
    group.add(panel);

    // 凹槽材质：关闭环境反射，纯黑哑光
    const holeMat = new THREE.MeshStandardMaterial({
      color: 0x0c0c0e,
      roughness: 1,
      envMapIntensity: 0,
      side: THREE.DoubleSide,
    });

    // 8 列 × n 个槽位凹槽 + 每列 n 个反馈小孔（列上方）
    for (let r = 0; r < LAYOUT.ROWS; r++) {
      for (let s = 0; s < n; s++) {
        const hole = new THREE.Mesh(this.holeGeo, holeMat);
        hole.position.copy(this.slotPosition(r, s));
        hole.position.z = 0.26; // 贴在板面上（板面前表面 z=0.25）
        group.add(hole);
      }
      for (let i = 0; i < n; i++) {
        const ph = new THREE.Mesh(this.pegHoleGeo, holeMat);
        ph.position.copy(this.pegPosition(r, i, n));
        ph.position.z = 0.26;
        group.add(ph);
      }
    }

    // 暗码列凹槽（被木板遮住）
    for (let c = 0; c < n; c++) {
      const hole = new THREE.Mesh(this.holeGeo, holeMat);
      hole.position.set(this.answerX(), this.slotY(c), 0.26);
      group.add(hole);
    }

    // 分隔条：槽位区/反馈区之间（横向）、猜测区/暗码列之间（竖向）
    const dividerMat = new THREE.MeshStandardMaterial({ color: 0x4a618f, roughness: 0.6 });
    const hDivider = new THREE.Mesh(
      new THREE.BoxGeometry(this.colX(LAYOUT.ROWS - 1) - this.colX(0) + 2.4, 0.1, 0.14),
      dividerMat
    );
    hDivider.position.set(
      (this.colX(0) + this.colX(LAYOUT.ROWS - 1)) / 2,
      this.topSlotY(n) + LAYOUT.PEG_AREA_GAP / 2,
      0.32
    );
    group.add(hDivider);

    const vDivider = new THREE.Mesh(
      new THREE.BoxGeometry(0.12, (n - 1) * LAYOUT.SLOT_SPACING + 2.4, 0.14),
      dividerMat
    );
    vDivider.position.set((this.colX(LAYOUT.ROWS - 1) + this.answerX()) / 2, slotMidY, 0.32);
    group.add(vDivider);

    // 暗码遮挡木板（失败时向右抽开）
    const cover = new THREE.Mesh(
      new THREE.BoxGeometry(2.3, (n - 1) * LAYOUT.SLOT_SPACING + 2.2, 1.2),
      new THREE.MeshStandardMaterial({ color: 0x8a5a2e, roughness: 0.6 })
    );
    cover.position.set(this.answerX(), slotMidY, 0.85);
    cover.castShadow = true;
    group.add(cover);
    this.answerCover = cover;

    // 托盘：立板前方，放 7 个样本球
    const tray = new THREE.Mesh(
      new THREE.BoxGeometry(COLORS.length * LAYOUT.SLOT_SPACING + 2.2, 0.5, 2.2),
      new THREE.MeshStandardMaterial({ color: 0x6e4520, roughness: 0.7, metalness: 0.05 })
    );
    tray.position.set(0, 0.25, LAYOUT.TRAY_Z);
    tray.receiveShadow = true;
    tray.castShadow = true;
    group.add(tray);

    for (let i = 0; i < COLORS.length; i++) {
      const pos = this.palettePosition(i);
      // 托盘凹槽（浅圆柱，顶面略低于托盘面避免 z-fighting）
      const hole = new THREE.Mesh(this.trayHoleGeo, holeMat);
      hole.position.set(pos.x, 0.3, pos.z);
      group.add(hole);

      const ball = this.createGlassBall(COLORS[i].hex);
      ball.position.copy(pos);
      ball.userData = { type: 'palette', colorId: COLORS[i].id };
      group.add(ball);
      this.paletteBalls.push(ball);
    }
  }

  // ---------- 动画 ----------
  /**
   * 放球动效：从托盘位置沿弧线飞到槽位前方，再嵌入槽位
   * @param {THREE.Mesh} mesh 新球
   * @param {THREE.Vector3} targetPos 槽位坐标
   * @param {THREE.Vector3} [fromPos] 起点（通常是样本球位置），缺省从镜头方向飞入
   */
  dropBall(mesh, targetPos, fromPos, onDone) {
    const from = fromPos
      ? fromPos.clone()
      : new THREE.Vector3(targetPos.x, targetPos.y + 2, targetPos.z + 7);
    const mid = targetPos.clone();
    mid.z += 1.6; // 先悬停在槽位前方
    mesh.position.copy(from);
    mesh.scale.setScalar(0.7);
    this.boardGroup.add(mesh);
    // 阶段 1：沿弧线飞到槽位前方（tag 用于拖拽开始时顶掉未完成的飞入补间）
    this.tweens.add({
      tag: 'move-' + mesh.uuid,
      duration: 0.45,
      ease: Easing.easeOutCubic,
      onUpdate: (e) => {
        mesh.position.lerpVectors(from, mid, e);
        mesh.position.y += Math.sin(e * Math.PI) * 1.2; // 弧线抬高
        mesh.scale.setScalar(0.7 + 0.3 * e);
      },
      onComplete: () => {
        // 阶段 2：嵌入槽位（带回弹）
        this.tweens.add({
          tag: 'move-' + mesh.uuid,
          duration: 0.22,
          ease: Easing.easeOutBack,
          onUpdate: (e) => {
            mesh.position.z = mid.z + (targetPos.z - mid.z) * e;
          },
          onComplete: () => {
            mesh.position.copy(targetPos);
            mesh.scale.setScalar(1);
            onDone?.();
          },
        });
      },
    });
  }

  /** 缩小并移除一个球 */
  shrinkAndRemove(mesh, onDone) {
    this.tweens.add({
      duration: 0.25,
      ease: Easing.easeOutCubic,
      onUpdate: (e) => mesh.scale.setScalar(1 - e),
      onComplete: () => {
        this.boardGroup.remove(mesh);
        mesh.material.dispose();
        onDone?.();
      },
    });
  }

  /** 在某列上方生成反馈小圆点（红 = 全对，白 = 半对，红点在前） */
  spawnFeedback(row, exact, partial) {
    const colors = [];
    for (let i = 0; i < exact; i++) colors.push(0xff2b2b);
    for (let i = 0; i < partial; i++) colors.push(0xf2f2f2);

    colors.forEach((color, i) => {
      const mat = new THREE.MeshStandardMaterial({
        color,
        emissive: new THREE.Color(color).multiplyScalar(0.35),
        roughness: 0.25,
        metalness: 0.1,
      });
      const peg = new THREE.Mesh(this.pegGeo, mat);
      peg.position.copy(this.pegPosition(row, i));
      peg.scale.setScalar(0.001);
      this.boardGroup.add(peg);
      // 依次弹入
      this.tweens.add({
        duration: 0.35,
        delay: i * 0.12,
        ease: Easing.easeOutBack,
        onUpdate: (e) => peg.scale.setScalar(Math.max(0.001, e)),
        onComplete: () => peg.scale.setScalar(1),
      });
    });
  }

  /**
   * 失败时：木板向右抽开 → 暗码球逐个显现
   * @returns {number} 整套揭晓动画的总时长（毫秒），供结算横幅排队
   */
  revealAnswer(secretIds) {
    // 木板向右抽开并淡出
    if (this.answerCover) {
      const cover = this.answerCover;
      const x0 = cover.position.x;
      cover.material.transparent = true;
      this.tweens.add({
        duration: 0.7,
        ease: Easing.easeOutCubic,
        onUpdate: (e) => {
          cover.position.x = x0 + 3.8 * e;
          cover.material.opacity = 1 - e;
        },
      });
      this.answerCover = null;
    }
    // 木板抽开后，暗码球逐个弹入
    secretIds.forEach((id, c) => {
      const ball = this.createGlassBall(COLORS[id].hex);
      ball.position.set(this.answerX(), this.slotY(c), LAYOUT.BALL_Z);
      ball.scale.setScalar(0.001);
      ball.userData = { type: 'answer' };
      this.boardGroup.add(ball);
      this.tweens.add({
        duration: 0.5,
        delay: 0.75 + c * 0.3, // 等木板抽开后再逐个显现
        ease: Easing.easeOutBack,
        onUpdate: (e) => ball.scale.setScalar(Math.max(0.001, e)),
        onComplete: () => ball.scale.setScalar(1),
      });
    });
    return (0.75 + (secretIds.length - 1) * 0.3 + 0.55) * 1000;
  }

  /** 胜利庆祝：猜中的球连跳两次并旋转 + 两波彩带雨 + 金色闪光灯 */
  celebrate(balls) {
    balls.forEach((b, i) => {
      const z0 = b.position.z;
      this.tweens.add({
        duration: 0.9,
        delay: i * 0.08,
        onUpdate: (e, t) => {
          b.position.z = z0 + Math.abs(Math.sin(t * Math.PI * 2)) * 0.9; // 连续弹起两次
          b.rotation.y = t * Math.PI * 2; // 顺手旋转一周
        },
        onComplete: () => {
          b.position.z = z0;
          b.rotation.y = 0;
        },
      });
    });
    // 两波彩带：第一波立即落下，第二波稍迟，雨下得更久更密
    this.spawnConfetti(300);
    this.tweens.add({
      duration: 0.6,
      onUpdate: () => {},
      onComplete: () => this.spawnConfetti(220),
    });
    // 两次金色闪光
    this.flashLight(0);
    this.flashLight(0.55);
  }

  /** 金色闪光灯：强度快速起伏一次后移除 */
  flashLight(delay) {
    const light = new THREE.PointLight(0xfff2b0, 0, 70, 1.5);
    light.position.set(0, 8, 9);
    this.scene.add(light);
    this.tweens.add({
      duration: 0.5,
      delay,
      onUpdate: (e, t) => {
        light.intensity = Math.sin(t * Math.PI) * 9;
      },
      onComplete: () => this.scene.remove(light),
    });
  }

  /** 生成 count 片彩色纸屑（在立板前方飘落） */
  spawnConfetti(count = 160) {
    const geo = new THREE.PlaneGeometry(0.4, 0.55);
    for (let i = 0; i < count; i++) {
      const mat = new THREE.MeshBasicMaterial({
        color: COLORS[i % COLORS.length].hex,
        side: THREE.DoubleSide,
      });
      const m = new THREE.Mesh(geo, mat);
      m.position.set(
        (Math.random() - 0.5) * 24,
        14 + Math.random() * 9,
        2 + Math.random() * 4
      );
      m.rotation.set(Math.random() * Math.PI, Math.random() * Math.PI, Math.random() * Math.PI);
      this.scene.add(m);
      this.confetti.push({
        mesh: m,
        vy: -(3 + Math.random() * 5),
        vr: new THREE.Vector3(
          (Math.random() - 0.5) * 4,
          (Math.random() - 0.5) * 4,
          (Math.random() - 0.5) * 4
        ),
        life: 6,
      });
    }
  }

  clearConfetti() {
    for (const c of this.confetti) {
      this.scene.remove(c.mesh);
      c.mesh.material.dispose();
    }
    this.confetti.length = 0;
  }

  updateConfetti(dt) {
    for (let i = this.confetti.length - 1; i >= 0; i--) {
      const c = this.confetti[i];
      c.life -= dt;
      c.vy -= 4 * dt; // 重力
      c.mesh.position.y += c.vy * dt;
      c.mesh.position.x += Math.sin(c.life * 3 + i) * dt * 0.8; // 左右飘摆
      c.mesh.rotation.x += c.vr.x * dt;
      c.mesh.rotation.y += c.vr.y * dt;
      c.mesh.rotation.z += c.vr.z * dt;
      if (c.mesh.position.y < 0.15) {
        c.mesh.position.y = 0.15;
        c.vy *= -0.3; // 落地轻弹
      }
      if (c.life <= 0) {
        this.scene.remove(c.mesh);
        c.mesh.material.dispose();
        this.confetti.splice(i, 1);
      }
    }
  }

  // ---------- 每帧更新 / 渲染 / 尺寸 ----------
  update(dt) {
    this.tweens.update(dt);
    this.updateConfetti(dt);
  }

  render() {
    this.renderer.render(this.scene, this.camera);
  }

  resize(w, h) {
    const aspect = w / h;
    this.camera.aspect = aspect;
    // 竖屏（手机）自动拉远相机，保证立板完整入镜
    const tanH = Math.tan(THREE.MathUtils.degToRad(this.camera.fov / 2));
    const fitW = 13 / (tanH * Math.max(aspect, 0.1)); // 水平方向所需距离
    const fitH = 10.5 / tanH; // 垂直方向所需距离
    const dist = THREE.MathUtils.clamp(Math.max(fitW, fitH), 45, 150);
    this.camera.position.set(0, 6 + dist * 0.085, dist);
    this.camera.lookAt(0, 6, 0);
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(w, h, false);
  }
}
