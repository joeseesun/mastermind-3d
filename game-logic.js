// =============================================================
// game-logic.js — Mastermind（猜颜色）核心游戏逻辑
// 纯逻辑模块：不依赖 Three.js / DOM，可单独在 Node 中测试
// =============================================================

// 颜色池：7 种玻璃球颜色（hex 供 Three.js 材质使用，name 供界面显示）
// 色相尽量拉开，保证任意两球都有明显色差
export const COLORS = [
  { id: 0, name: '红', hex: 0xff1f4b },
  { id: 1, name: '蓝', hex: 0x1f6fff },
  { id: 2, name: '绿', hex: 0x12c46a },
  { id: 3, name: '黄', hex: 0xffe600 }, // 更黄更亮
  { id: 4, name: '紫', hex: 0x9b30ff },
  { id: 5, name: '棕', hex: 0x7a3b12 }, // 深棕
  { id: 6, name: '灰', hex: 0x9aa4b0 },
];

export const MAX_ATTEMPTS = 8; // 总尝试次数

/**
 * 随机生成暗码（规则：暗码中每种颜色至多出现一次）
 * 用 Fisher-Yates 洗牌后取前 codeLength 个，保证互不相同
 * @param {number} codeLength 暗码长度（4 = 标准，5 = 困难）
 * @returns {number[]} 颜色 id 数组
 */
export function generateSecret(codeLength) {
  const pool = COLORS.map((c) => c.id);
  for (let i = pool.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [pool[i], pool[j]] = [pool[j], pool[i]];
  }
  if (codeLength <= pool.length) return pool.slice(0, codeLength);
  // 防御：长度超过颜色总数时退化为允许重复（当前规则下不会触发）
  const secret = pool.slice();
  while (secret.length < codeLength) {
    secret.push(pool[Math.floor(Math.random() * pool.length)]);
  }
  return secret;
}

/**
 * 标准 Mastermind 比对算法（核心，避免重复颜色被过度计数）
 *
 * 伪代码：
 *   1) 第一遍扫描：位置与颜色都相同 → exact++；
 *      其余位置把暗码和猜测分别收进两个"待匹配"数组。
 *   2) 用哈希表统计待匹配暗码中各颜色的剩余数量。
 *   3) 第二遍扫描：遍历待匹配猜测，若该颜色在哈希表中数量 > 0，
 *      则 partial++ 并把数量减 1（每个暗码球最多被匹配一次）。
 *
 * 示例（0=红 1=蓝 2=绿 3=黄）：
 *   暗码 [红,红,蓝,黄]  猜测 [红,蓝,蓝,黄]
 *     → 位置0/2/3 全对：exact = 3
 *     → 待匹配：暗码剩 [红]，猜测剩 [蓝] → partial = 0
 *     → 结果 { exact: 3, partial: 0 }
 *   暗码 [红,红,蓝,蓝]  猜测 [红,红,红,红]
 *     → exact = 2（位置0/1），待匹配暗码 [蓝,蓝] 猜测 [红,红]
 *     → partial = 0（不会把"红"重复算成半对）
 */
export function evaluateGuess(secret, guess) {
  const n = secret.length;
  let exact = 0;
  const secretRemain = [];
  const guessRemain = [];

  // 第一遍：统计全对，未全对的两侧分别收集
  for (let i = 0; i < n; i++) {
    if (guess[i] === secret[i]) {
      exact++;
    } else {
      secretRemain.push(secret[i]);
      guessRemain.push(guess[i]);
    }
  }

  // 第二遍：用计数表匹配半对，每个暗码球只参与一次匹配
  const counts = {};
  for (const c of secretRemain) counts[c] = (counts[c] || 0) + 1;
  let partial = 0;
  for (const c of guessRemain) {
    if (counts[c] > 0) {
      partial++;
      counts[c]--;
    }
  }

  return { exact, partial };
}

/**
 * 游戏状态机：暗码、历史记录、当前猜测、胜负判定
 */
export class MastermindGame {
  constructor(codeLength = 4) {
    this.reset(codeLength);
  }

  /** 开始/重开一局 */
  reset(codeLength = this.codeLength) {
    this.codeLength = codeLength;
    this.secret = generateSecret(codeLength);
    this.history = []; // 每轮记录：{ guess: [...], exact, partial }
    this.currentGuess = new Array(codeLength).fill(null); // null = 空槽
    this.status = 'playing'; // 'playing' | 'won' | 'lost'
  }

  /** 剩余尝试次数 */
  get attemptsLeft() {
    return MAX_ATTEMPTS - this.history.length;
  }

  /** 在指定槽位放入颜色 */
  placeColor(slotIndex, colorId) {
    if (this.status !== 'playing') return;
    this.currentGuess[slotIndex] = colorId;
  }

  /** 清空指定槽位 */
  clearSlot(slotIndex) {
    if (this.status !== 'playing') return;
    this.currentGuess[slotIndex] = null;
  }

  /** 第一个空槽的下标（-1 表示已放满） */
  firstEmptySlot() {
    return this.currentGuess.indexOf(null);
  }

  /** 当前轮是否已放满 */
  isGuessComplete() {
    return this.currentGuess.every((c) => c !== null);
  }

  /**
   * 提交本轮猜测
   * @returns {{guess:number[], exact:number, partial:number}|null}
   */
  submitGuess() {
    if (this.status !== 'playing' || !this.isGuessComplete()) return null;

    const guess = [...this.currentGuess];
    const { exact, partial } = evaluateGuess(this.secret, guess);
    this.history.push({ guess, exact, partial });

    if (exact === this.codeLength) {
      this.status = 'won';
    } else if (this.history.length >= MAX_ATTEMPTS) {
      this.status = 'lost';
    }

    // 清空本轮，准备下一轮
    this.currentGuess = new Array(this.codeLength).fill(null);
    return { guess, exact, partial };
  }
}
