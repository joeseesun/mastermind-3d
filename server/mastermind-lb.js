// =============================================================
// server/mastermind-lb.js — Mastermind 云端排行榜 API（零依赖）
// 用 Node 内置 http 模块实现，配合 systemd 常驻、Nginx 反代 /api/
//
//   GET  /api/leaderboard  → { entries: [...] }      （前 10 名）
//   POST /api/leaderboard  → { rank, entries }       （提交一条成绩）
//   GET  /healthz          → ok
//
// 排序：轮次少者优先 → 用时短者优先 → 先达成者优先；只保留前 10 名，
// 新成绩进榜时第 10 名会被挤掉。
// =============================================================
import http from 'node:http';
import { readFileSync, writeFileSync, renameSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

const PORT = Number(process.env.PORT || 3091);
const DATA_FILE =
  process.env.DATA_FILE || new URL('./data/leaderboard.json', import.meta.url).pathname;
const MAX_ENTRIES = 10;
const MAX_BODY = 4096; // 请求体上限 4KB
const RATE_WINDOW_MS = 60_000;
// 每 IP 每分钟最多提交条数（测试时可用 RATE_MAX 环境变量调大）
const RATE_MAX_POSTS = Number(process.env.RATE_MAX || 5);

// 与 ../leaderboard.js 中的 compareEntries 保持一致（此处内联，保证服务自包含）
function compareEntries(a, b) {
  if (a.rounds !== b.rounds) return a.rounds - b.rounds;
  if (a.seconds !== b.seconds) return a.seconds - b.seconds;
  return a.date - b.date;
}

/** 每请求读文件：数据量极小（≤10 条），换来外部改文件即时生效 */
function loadEntries() {
  try {
    const arr = JSON.parse(readFileSync(DATA_FILE, 'utf8'));
    return Array.isArray(arr) ? arr : [];
  } catch {
    return [];
  }
}

/** 原子写入：先写临时文件再改名，避免半截 JSON */
function saveEntries(entries) {
  mkdirSync(dirname(DATA_FILE), { recursive: true });
  const tmp = DATA_FILE + '.tmp';
  writeFileSync(tmp, JSON.stringify(entries));
  renameSync(tmp, DATA_FILE);
}

/** 名字清洗：去控制字符和 HTML 特殊字符，截断 12 字，空则"无名氏" */
function sanitizeName(raw) {
  const s = String(raw ?? '')
    // eslint-disable-next-line no-control-regex
    .replace(/[\x00-\x1f<>&"'`]/g, '')
    .trim()
    .slice(0, 12);
  return s || '无名氏';
}

/** 校验并构造一条记录；不合法返回 null */
function buildEntry(body) {
  if (!body || typeof body !== 'object') return null;
  const rounds = Number(body.rounds);
  const seconds = Number(body.seconds);
  const codeLength = Number(body.codeLength);
  if (!Number.isInteger(rounds) || rounds < 1 || rounds > 8) return null;
  if (!Number.isInteger(seconds) || seconds < 0 || seconds > 86400) return null;
  if (codeLength !== 4 && codeLength !== 5) return null;
  return {
    name: sanitizeName(body.name),
    rounds,
    seconds,
    codeLength,
    date: Date.now(),
  };
}

// 简易限流：IP → 最近一分钟的提交时间戳
const rateMap = new Map();
function rateLimited(ip) {
  const now = Date.now();
  const list = (rateMap.get(ip) || []).filter((t) => now - t < RATE_WINDOW_MS);
  if (list.length >= RATE_MAX_POSTS) {
    rateMap.set(ip, list);
    return true;
  }
  list.push(now);
  rateMap.set(ip, list);
  return false;
}

function send(res, code, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(code, {
    'Content-Type': 'application/json; charset=utf-8',
    'Access-Control-Allow-Origin': '*',
    'Cache-Control': 'no-store',
  });
  res.end(body);
}

const server = http.createServer((req, res) => {
  // CORS 预检（本地开发跨端口调试用）
  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
      'Access-Control-Max-Age': '86400',
    });
    res.end();
    return;
  }

  const url = new URL(req.url, 'http://localhost');

  if (req.method === 'GET' && url.pathname === '/healthz') {
    res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('ok\n');
    return;
  }

  if (req.method === 'GET' && url.pathname === '/api/leaderboard') {
    send(res, 200, { entries: loadEntries().slice(0, MAX_ENTRIES) });
    return;
  }

  if (req.method === 'POST' && url.pathname === '/api/leaderboard') {
    const ip = req.headers['x-real-ip'] || req.socket.remoteAddress || 'unknown';
    if (rateLimited(ip)) {
      send(res, 429, { error: '提交太频繁，请稍后再试' });
      return;
    }
    let raw = '';
    let tooBig = false;
    req.on('data', (chunk) => {
      raw += chunk;
      if (raw.length > MAX_BODY) {
        tooBig = true;
        req.destroy();
      }
    });
    req.on('end', () => {
      if (tooBig) return; // 连接已销毁
      let body;
      try {
        body = JSON.parse(raw);
      } catch {
        send(res, 400, { error: '请求不是合法 JSON' });
        return;
      }
      const entry = buildEntry(body);
      if (!entry) {
        send(res, 400, { error: '成绩数据不合法' });
        return;
      }
      const all = loadEntries();
      all.push(entry);
      all.sort(compareEntries);
      const rank = all.indexOf(entry);
      const kept = all.slice(0, MAX_ENTRIES); // 第 11 名起被挤掉
      saveEntries(kept);
      send(res, 200, { rank: rank < MAX_ENTRIES ? rank : -1, entries: kept });
    });
    return;
  }

  send(res, 404, { error: 'not found' });
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`mastermind-lb listening on 127.0.0.1:${server.address().port}, data: ${DATA_FILE}`);
});
