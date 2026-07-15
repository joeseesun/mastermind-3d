// =============================================================
// leaderboard.js — 云端排行榜客户端（同源 /api/ 接口）
// 排序规则与 server/mastermind-lb.js 保持一致：
//   轮次少者优先 → 用时短者优先 → 先达成者优先，仅保留前 10 名
// compareEntries / formatTime 为纯函数，可在 Node 中单测
// =============================================================

export const NAME_KEY = 'mastermind-player-name'; // 上次使用的名字（本地便利性存储）
export const MAX_ENTRIES = 10; // 与服务端保持一致

/**
 * 排行榜排序比较函数（服务端为准，这里供测试与本地排序复用）
 * @param {{rounds:number, seconds:number, date:number}} a
 * @param {{rounds:number, seconds:number, date:number}} b
 */
export function compareEntries(a, b) {
  if (a.rounds !== b.rounds) return a.rounds - b.rounds;
  if (a.seconds !== b.seconds) return a.seconds - b.seconds;
  return a.date - b.date;
}

/** 用时格式化：63 秒 → "1分03秒"，45 秒 → "45秒" */
export function formatTime(seconds) {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return m > 0 ? `${m}分${String(s).padStart(2, '0')}秒` : `${s}秒`;
}

/** API 基础路径：默认同源；本地开发可用 window.MM_API_BASE 指向独立服务 */
const apiBase = () => globalThis.MM_API_BASE ?? '';

// ---------- 前端缓存：页面加载后预热，弹窗秒开 + 后台刷新 ----------
let cache = null; // { entries: Array, ts: number }
let inflight = null; // 进行中的拉取 Promise（去重，避免并发重复请求）

/** 最近一次成功拉取的榜单（无则为 null），供弹窗立即渲染 */
export function getCachedEntries() {
  return cache ? cache.entries : null;
}

/** 拉取榜单；并发调用共享同一次请求；成功后写入缓存 */
export async function fetchEntries() {
  if (inflight) return inflight;
  inflight = (async () => {
    try {
      const r = await fetch(`${apiBase()}/api/leaderboard`, { cache: 'no-store' });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const j = await r.json();
      const entries = Array.isArray(j.entries) ? j.entries : [];
      cache = { entries, ts: Date.now() };
      return entries;
    } finally {
      inflight = null;
    }
  })();
  return inflight;
}

/** 静默预热（页面加载后调用，失败忽略） */
export function prefetchLeaderboard() {
  fetchEntries().catch(() => {});
}

/**
 * 提交一条通关成绩；成功后直接用响应更新缓存，下次开榜零等待
 * @param {{name:string, rounds:number, seconds:number, codeLength:number}} entry
 * @returns {{rank:number, entries:Array}} rank 0 起，-1 表示未进前 10
 */
export async function postEntry(entry) {
  const r = await fetch(`${apiBase()}/api/leaderboard`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(entry),
    cache: 'no-store',
  });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  const j = await r.json();
  if (Array.isArray(j.entries)) cache = { entries: j.entries, ts: Date.now() };
  return j;
}
