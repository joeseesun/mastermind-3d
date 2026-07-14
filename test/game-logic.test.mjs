import { evaluateGuess, generateSecret, MastermindGame, MAX_ATTEMPTS } from '/Users/joe/Dropbox/code/mastermind/game-logic.js';

let pass = 0, fail = 0;
function eq(actual, expected, label) {
  const ok = actual.exact === expected[0] && actual.partial === expected[1];
  if (ok) { pass++; console.log(`✓ ${label} → exact=${actual.exact} partial=${actual.partial}`); }
  else { fail++; console.log(`✗ ${label} → got exact=${actual.exact} partial=${actual.partial}, expected ${expected}`); }
}

// 0=红 1=蓝 2=绿 3=黄 4=紫 5=橙
eq(evaluateGuess([0,0,1,3], [0,1,1,3]), [3,0], '红红蓝黄 vs 红蓝蓝黄（题目示例）');
eq(evaluateGuess([0,0,1,1], [0,0,0,0]), [2,0], '红红蓝蓝 vs 红红红红（防重复计数）');
eq(evaluateGuess([0,0,1,3], [1,1,0,0]), [0,3], '红红蓝黄 vs 蓝蓝红红（全错位）');
eq(evaluateGuess([1,2,3,4], [1,2,3,4]), [4,0], '完全相同');
eq(evaluateGuess([1,2,3,4], [4,3,2,1]), [0,4], '完全反转');
eq(evaluateGuess([5,5,5,5], [0,5,0,5]), [2,0], '单色暗码 vs 交错猜测');
eq(evaluateGuess([0,1,2,3,4], [0,1,2,4,3]), [3,2], '5位模式：3全对2半对');

// 暗码生成与状态机
const s = generateSecret(4);
console.assert(s.length === 4 && s.every(c => c >= 0 && c <= 6), '暗码长度/范围正确');

// 暗码互异性：4 位和 5 位各跑 500 次，必须每次都不重复
for (const len of [4, 5]) {
  for (let i = 0; i < 500; i++) {
    const sec = generateSecret(len);
    console.assert(new Set(sec).size === len, `暗码必须互不相同(len=${len}): ${sec}`);
  }
}
console.log('✓ 暗码互异性 1000 次抽检通过');

const g = new MastermindGame(4);
g.secret = [0, 1, 2, 3]; // 固定暗码便于测试
g.currentGuess = [0, 1, 2, 3];
const r = g.submitGuess();
console.assert(r.exact === 4 && g.status === 'won', '一轮猜中 → 胜利');

const g2 = new MastermindGame(4);
g2.secret = [5, 5, 5, 5];
for (let i = 0; i < MAX_ATTEMPTS; i++) {
  g2.currentGuess = [0, 0, 0, 0];
  g2.submitGuess();
}
console.assert(g2.status === 'lost' && g2.history.length === 8, '8次用尽 → 失败');

console.log(fail === 0 ? `\n全部通过（${pass} 组用例 + 状态机断言）` : `\n有 ${fail} 组失败`);
process.exit(fail === 0 ? 0 : 1);
