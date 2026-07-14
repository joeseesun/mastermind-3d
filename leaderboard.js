// =============================================================
// leaderboard.js — 通关排行榜（localStorage 本地记录）
// 纯逻辑模块：不依赖 Three.js / DOM，可单独在 Node 中测试
// 排序规则：轮次少者优先 → 用时短者优先 → 先达成者优先
// =============================================================

export const LB_KEY = 'mastermind-leaderboard-v1'; // 榜单存储键
export const NAME_KEY = 'mastermind-player-name'; // 上次使用的名字
export const MAX_ENTRIES = 50; // 最多保留条数

/**
 * 排行榜排序比较函数
 * @param {{rounds:number, seconds:number, date:number}} a
 * @param {{rounds:number, seconds:number, date:number}} b
 */
export function compareEntries(a, b) {
  if (a.rounds !== b.rounds) return a.rounds - b.rounds; // 用的轮次越少越靠前
  if (a.seconds !== b.seconds) return a.seconds - b.seconds; // 同轮次比用时
  return a.date - b.date; // 都相同则先达成的靠前
}

/** 用时格式化：63 秒 → "1分03秒"，45 秒 → "45秒" */
export function formatTime(seconds) {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return m > 0 ? `${m}分${String(s).padStart(2, '0')}秒` : `${s}秒`;
}

/** 读取榜单（数据损坏时安全返回空数组） */
export function loadEntries(storage = globalThis.localStorage) {
  try {
    const raw = storage.getItem(LB_KEY);
    const arr = raw ? JSON.parse(raw) : [];
    return Array.isArray(arr) ? arr : [];
  } catch {
    return [];
  }
}

/**
 * 写入一条通关记录并保持有序（只保留前 MAX_ENTRIES 名）
 * @param {{name:string, rounds:number, seconds:number, codeLength:number, date:number}} entry
 * @returns {number} 该记录的名次（0 起），未上榜返回 -1
 */
export function saveEntry(entry, storage = globalThis.localStorage) {
  const entries = loadEntries(storage);
  entries.push(entry);
  entries.sort(compareEntries);
  const rank = entries.indexOf(entry);
  try {
    storage.setItem(LB_KEY, JSON.stringify(entries.slice(0, MAX_ENTRIES)));
  } catch {
    /* 存储满/被禁用时静默失败，不影响游戏流程 */
  }
  return rank < MAX_ENTRIES ? rank : -1;
}

/** 清空榜单 */
export function clearEntries(storage = globalThis.localStorage) {
  try {
    storage.removeItem(LB_KEY);
  } catch {
    /* 同上，静默失败 */
  }
}
