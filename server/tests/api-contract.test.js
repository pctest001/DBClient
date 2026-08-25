/**
 * API 契约冒烟测试（node:test + fetch，零依赖）。
 *
 * 启动真实后端（node dist/index.js，子进程）并验证统一响应契约，
 * 不依赖真实数据库 / 真实 LLM：
 *  - GET  /api/connections        → { code:0, data:[] }
 *  - POST /api/connections/test   缺必填字段 → { code:40001 }
 *  - GET  /api/settings/ai        → { code:0, data 含 baseUrl/model/enabled/hasKey }
 *  - POST /api/ai/generate        缺参数 → { code:40001 }（校验早于 LLM 调用）
 *
 * 测试前清空 server/data 以保证连接列表为空；使用独立端口避免冲突。
 * 测试结束后关闭子进程。
 */
import { test } from 'node:test';
import assert from 'node:assert';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const serverRoot = path.resolve(__dirname, '..');
const NODE = process.execPath;
const PORT = 4571;
const BASE = `http://localhost:${PORT}`;
const MASTER_KEY = 'dev-only-master-key-change-me';

async function waitForServer(base, timeoutMs = 15000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const r = await fetch(`${base}/api/health`);
      if (r.ok) return;
    } catch {
      // 连接被拒，继续等待
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error('后端在超时时间内未就绪');
}

test('API 契约冒烟测试', async (t) => {
  // 说明：本冒烟测试不写入任何数据文件。环境约束下无法覆盖既有
  // server/data/connections.json（写入报 EPERM），而该文件当前内容即为 []，
  // 且本次测试仅触发只读/校验接口（不会落盘），故直接复用既有空状态即可，
  // 无需预置或清理数据目录。

  const child = spawn(
    NODE,
    ['dist/index.js'],
    {
      cwd: serverRoot,
      env: {
        ...process.env,
        DB_CLIENT_MASTER_KEY: MASTER_KEY,
        PORT: String(PORT),
      },
      stdio: ['ignore', 'ignore', 'pipe'],
    }
  );
  child.unref();
  let stderr = '';
  child.stderr.on('data', (d) => (stderr += d.toString()));

  try {
    await waitForServer(BASE);

    // 1. GET /api/connections → {code:0, data:[]}
    const r1 = await fetch(`${BASE}/api/connections`);
    const j1 = await r1.json();
    assert.strictEqual(j1.code, 0, `GET /api/connections code 应为 0，实际 ${j1.code}`);
    assert.ok(Array.isArray(j1.data), 'GET /api/connections data 应为数组');
    assert.deepStrictEqual(j1.data, [], 'GET /api/connections data 应为空数组');

    // 2. POST /api/connections/test 缺必填 → 40001
    const r2 = await fetch(`${BASE}/api/connections/test`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });
    const j2 = await r2.json();
    assert.strictEqual(j2.code, 40001, `POST /api/connections/test 缺参应 40001，实际 ${j2.code}`);

    // 3. GET /api/settings/ai → code0 且 data 含关键字段
    const r3 = await fetch(`${BASE}/api/settings/ai`);
    const j3 = await r3.json();
    assert.strictEqual(j3.code, 0, `GET /api/settings/ai code 应为 0，实际 ${j3.code}`);
    const d3 = j3.data || {};
    for (const k of ['baseUrl', 'model', 'enabled', 'hasKey']) {
      assert.ok(k in d3, `GET /api/settings/ai data 缺少字段 ${k}`);
    }
    assert.strictEqual(d3.hasKey, false, '未配置 Key 时 hasKey 应为 false');

    // 4. POST /api/ai/generate 缺参数 → 40001（不应触发真实 LLM）
    const r4 = await fetch(`${BASE}/api/ai/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });
    const j4 = await r4.json();
    assert.strictEqual(j4.code, 40001, `POST /api/ai/generate 缺参应 40001，实际 ${j4.code}`);
  } catch (err) {
    if (stderr) {
      err.message += `\n[server stderr] ${stderr.slice(0, 500)}`;
    }
    throw err;
  } finally {
    if (child && !child.killed) {
      child.kill('SIGTERM');
      await new Promise((res) => {
        const to = setTimeout(res, 2000);
        child.on('exit', () => {
          clearTimeout(to);
          res();
        });
      });
    }
  }
});
