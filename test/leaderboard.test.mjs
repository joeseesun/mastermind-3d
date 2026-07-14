// =============================================================
// leaderboard.test.mjs — 排行榜纯函数单测（Node 直接运行）
//   node test/leaderboard.test.mjs
// =============================================================
import { compareEntries, formatTime, MAX_ENTRIES, NAME_KEY } from '../leaderboard.js';

let passed = 0;
function assert(cond, msg) {
  if (!cond) {
    console.error(`✗ ${msg}`);
    process.exit(1);
  }
  passed++;
  console.log(`✓ ${msg}`);
}

const e = (rounds, seconds, date) => ({ name: 'A', rounds, seconds, codeLength: 4, date });

// --- compareEntries：轮次优先，其次用时，最后先到先得 ---
{
  const sorted = [e(5, 30, 100), e(3, 90, 300), e(5, 20, 200), e(5, 30, 50)].sort(
    compareEntries
  );
  assert(sorted[0].rounds === 3 && sorted[0].seconds === 90, '轮次少者排最前');
  assert(sorted[1].seconds === 20, '同轮次用时短者优先');
  assert(sorted[2].date === 50 && sorted[3].date === 100, '轮次用时都同则先达成者优先');
}

// --- formatTime ---
assert(formatTime(45) === '45秒', '45 秒格式');
assert(formatTime(63) === '1分03秒', '63 秒格式（补零）');
assert(formatTime(600) === '10分00秒', '600 秒格式');

// --- 常量（与服务端约定一致） ---
assert(MAX_ENTRIES === 10, '榜单保留前 10 名');
assert(NAME_KEY === 'mastermind-player-name', '名字本地存储键固定');

console.log(`\n全部通过（${passed} 条断言）`);
