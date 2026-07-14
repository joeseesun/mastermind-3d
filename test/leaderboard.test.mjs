// =============================================================
// leaderboard.test.mjs — 排行榜逻辑单测（Node 直接运行）
//   node test/leaderboard.test.mjs
// =============================================================
import {
  LB_KEY,
  NAME_KEY,
  MAX_ENTRIES,
  compareEntries,
  formatTime,
  loadEntries,
  saveEntry,
  clearEntries,
} from '../leaderboard.js';

// 内存版 localStorage（Node 环境没有 Web Storage）
function mockStorage() {
  const map = new Map();
  return {
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => map.set(k, String(v)),
    removeItem: (k) => map.delete(k),
  };
}

let passed = 0;
function assert(cond, msg) {
  if (!cond) {
    console.error(`✗ ${msg}`);
    process.exit(1);
  }
  passed++;
  console.log(`✓ ${msg}`);
}

const e = (rounds, seconds, date, name = 'A', codeLength = 4) => ({
  name,
  rounds,
  seconds,
  codeLength,
  date,
});

// --- compareEntries：轮次优先，其次用时，最后先到先得 ---
{
  const sorted = [
    e(5, 30, 100), // 5轮30秒
    e(3, 90, 300), // 3轮90秒 → 轮次少，第一
    e(5, 20, 200), // 5轮20秒 → 同5轮比用时，第二
    e(5, 30, 50), // 5轮30秒但更早达成 → 第三
  ].sort(compareEntries);
  assert(sorted[0].rounds === 3 && sorted[0].seconds === 90, '轮次少者排最前');
  assert(sorted[1].seconds === 20, '同轮次用时短者优先');
  assert(sorted[2].date === 50 && sorted[3].date === 100, '轮次用时都同则先达成者优先');
}

// --- saveEntry：有序插入并返回名次 ---
{
  const s = mockStorage();
  assert(saveEntry(e(4, 60, 1, '甲'), s) === 0, '首条记录名次为第 1');
  assert(saveEntry(e(3, 60, 2, '乙'), s) === 0, '更优成绩插到第 1');
  assert(saveEntry(e(4, 30, 3, '丙'), s) === 1, '同轮次用时短者排第 2');
  assert(saveEntry(e(8, 99, 4, '丁'), s) === 3, '最差成绩排第 4');
  const names = loadEntries(s).map((x) => x.name);
  assert(names.join(',') === '乙,丙,甲,丁', '榜单顺序正确');
}

// --- saveEntry：超出 MAX_ENTRIES 截断，未上榜返回 -1 ---
{
  const s = mockStorage();
  for (let i = 0; i < MAX_ENTRIES; i++) saveEntry(e(8, 100 + i, i, `P${i}`), s);
  assert(loadEntries(s).length === MAX_ENTRIES, `榜单最多保留 ${MAX_ENTRIES} 条`);
  assert(saveEntry(e(8, 999, 9999, '垫底'), s) === -1, '更差成绩返回 -1（未上榜）');
  assert(loadEntries(s).length === MAX_ENTRIES, '未上榜记录也占位但不影响名次计算');
  assert(saveEntry(e(1, 1, 10000, '大神'), s) === 0, '新纪录仍可插入第 1');
  assert(loadEntries(s).length === MAX_ENTRIES, '截断后长度不变');
}

// --- loadEntries：数据损坏安全兜底 ---
{
  const s = mockStorage();
  s.setItem(LB_KEY, '{broken json');
  assert(loadEntries(s).length === 0, 'JSON 损坏返回空数组');
  s.setItem(LB_KEY, '{"not":"array"}');
  assert(loadEntries(s).length === 0, '非数组数据返回空数组');
  assert(loadEntries(mockStorage()).length === 0, '空存储返回空数组');
}

// --- clearEntries ---
{
  const s = mockStorage();
  saveEntry(e(4, 60, 1), s);
  clearEntries(s);
  assert(loadEntries(s).length === 0, '清空后榜单为空');
}

// --- formatTime ---
{
  assert(formatTime(45) === '45秒', '45 秒格式');
  assert(formatTime(63) === '1分03秒', '63 秒格式（补零）');
  assert(formatTime(600) === '10分00秒', '600 秒格式');
}

// --- 常量引用（防止误改键名导致旧数据丢失） ---
assert(LB_KEY === 'mastermind-leaderboard-v1', '榜单存储键固定');
assert(NAME_KEY === 'mastermind-player-name', '名字存储键固定');

console.log(`\n全部通过（${passed} 条断言）`);
