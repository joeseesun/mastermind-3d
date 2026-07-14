// =============================================================
// leaderboard-api.test.mjs — 云端排行榜 API 集成测试
// 以子进程方式启动 server/mastermind-lb.js（随机端口 + 临时数据文件）
//   node test/leaderboard-api.test.mjs
// =============================================================
import { spawn } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const dir = mkdtempSync(join(tmpdir(), 'mm-lb-'));
const dataFile = join(dir, 'lb.json');

let passed = 0;
function assert(cond, msg) {
  if (!cond) {
    console.error(`✗ ${msg}`);
    cleanup();
    process.exit(1);
  }
  passed++;
  console.log(`✓ ${msg}`);
}

/** 启动服务进程，返回 { base, child } */
async function startServer() {
  const child = spawn('node', ['server/mastermind-lb.js'], {
    env: { ...process.env, PORT: '0', DATA_FILE: dataFile, RATE_MAX: '10000' },
    stdio: ['ignore', 'pipe', 'inherit'],
  });
  const base = await new Promise((resolve, reject) => {
    let buf = '';
    child.stdout.on('data', (d) => {
      buf += d;
      const m = buf.match(/listening on (127\.0\.0\.1:\d+)/);
      if (m) resolve(`http://${m[1]}`);
    });
    child.on('exit', () => reject(new Error('server exited early')));
    setTimeout(() => reject(new Error('server start timeout')), 5000);
  });
  return { base, child };
}

const post = (base, body) =>
  fetch(`${base}/api/leaderboard`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
const get = (base) => fetch(`${base}/api/leaderboard`).then((r) => r.json());
const entry = (rounds, seconds, name = '玩家', codeLength = 4) => ({
  name,
  rounds,
  seconds,
  codeLength,
});

let child;
function cleanup() {
  if (child && !child.killed) child.kill();
  rmSync(dir, { recursive: true, force: true });
}

// ---------- 启动 ----------
let base;
{
  const s = await startServer();
  base = s.base;
  child = s.child;
  const hz = await fetch(`${base}/healthz`).then((r) => r.text());
  assert(hz.trim() === 'ok', 'healthz 返回 ok');
  const empty = await get(base);
  assert(Array.isArray(empty.entries) && empty.entries.length === 0, '初始榜单为空');
}

// ---------- CORS 预检 ----------
{
  const r = await fetch(`${base}/api/leaderboard`, { method: 'OPTIONS' });
  assert(r.status === 204, 'OPTIONS 预检返回 204');
  assert(r.headers.get('access-control-allow-origin') === '*', 'CORS 允许跨域');
}

// ---------- 提交与排序 ----------
{
  let r = await post(base, entry(5, 30, '甲'));
  let j = await r.json();
  assert(r.status === 200 && j.rank === 0, '首条记录 rank=0');
  j = await (await post(base, entry(3, 90, '乙'))).json();
  assert(j.rank === 0, '更优成绩插到第 1');
  j = await (await post(base, entry(5, 20, '丙'))).json();
  assert(j.rank === 1, '同轮次用时短者第 2');
  j = await get(base);
  assert(j.entries.map((x) => x.name).join(',') === '乙,丙,甲', '榜单顺序正确');
  assert(j.entries[0].date > 0, '服务端补了 date 字段');
}

// ---------- 校验不合法数据 ----------
{
  const cases = [
    [{ name: 'x', rounds: 0, seconds: 10, codeLength: 4 }, '轮次 0 拒绝'],
    [{ name: 'x', rounds: 9, seconds: 10, codeLength: 4 }, '轮次 9 拒绝'],
    [{ name: 'x', rounds: 2.5, seconds: 10, codeLength: 4 }, '轮次非整数拒绝'],
    [{ name: 'x', rounds: 3, seconds: -1, codeLength: 4 }, '负数用时拒绝'],
    [{ name: 'x', rounds: 3, seconds: 10, codeLength: 6 }, '非法难度拒绝'],
    [{ rounds: 3, seconds: 10, codeLength: 4 }, '缺名字仍接受（默认无名氏）', 200],
  ];
  for (const [body, msg, expect = 400] of cases) {
    const r = await post(base, body);
    assert(r.status === expect, msg);
  }
}

// ---------- 名字清洗 ----------
{
  const j = await (
    await post(base, entry(6, 60, '  <script>alert(1)</script>超长名字要截断处理  '))
  ).json();
  const saved = j.entries.find((x) => x.rounds === 6);
  assert(!saved.name.includes('<') && !saved.name.includes('>'), 'HTML 特殊字符被清洗');
  assert(saved.name.length <= 12, '名字截断到 12 字');
  const j2 = await (await post(base, entry(7, 70, '   '))).json();
  assert(j2.entries.find((x) => x.rounds === 7).name === '无名氏', '空名字兜底为无名氏');
}

// ---------- 前 10 名截断与挤出 ----------
{
  // 当前已有 6 条（乙丙甲+清洗 2 条+缺名 1 条），再灌 10 条差成绩把榜单灌满
  for (let i = 0; i < 10; i++) await post(base, entry(8, 500 + i, `灌水${i}`));
  let j = await get(base);
  assert(j.entries.length === 10, '榜单最多 10 条');
  assert(j.entries.every((x) => !(x.rounds === 8 && x.seconds === 509)), '最差成绩被挤出');
  // 比最后一名还差 → rank -1，不进榜
  const worst = await (await post(base, entry(8, 999, '垫底'))).json();
  assert(worst.rank === -1, '未进前 10 返回 rank=-1');
  j = await get(base);
  assert(!j.entries.some((x) => x.name === '垫底'), '未上榜成绩不被保留');
  // 新纪录进榜并把第 10 名挤掉
  const best = await (await post(base, entry(1, 5, '大神'))).json();
  assert(best.rank === 0, '新纪录 rank=0');
  j = await get(base);
  assert(j.entries.length === 10 && j.entries[0].name === '大神', '新纪录进榜并挤出第 10 名');
}

// ---------- 重启后数据仍在（持久化） ----------
{
  child.kill();
  const s = await startServer();
  child = s.child;
  const j = await get(s.base);
  assert(j.entries.length === 10 && j.entries[0].name === '大神', '重启后榜单数据保留');
}

// ---------- 数据文件内容合法 ----------
{
  const raw = JSON.parse(readFileSync(dataFile, 'utf8'));
  assert(Array.isArray(raw) && raw.length === 10, '数据文件为 10 条数组');
}

cleanup();
console.log(`\n全部通过（${passed} 条断言）`);
