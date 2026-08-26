/**
 * dbService.executeMulti 单元测试（node:test + mock.module，零依赖）。
 *
 * 用 mock.module 替换 'pg'（提供 MockClient）与同级 './cryptoService.js'
 * （decrypt 直接返回明文，绕开沙箱主密钥不匹配的已知环境坑），
 * 验证多语句执行：错误隔离、聚合计数、每条 SELECT 各自追加 LIMIT 1000。
 *
 * 注：源码以 .js 扩展名互相引用，但磁盘上仅存在 .ts；
 * 本环境 Node 22.22.2 不支持 .js→.ts 回退解析，故从已构建的 dist/ 导入，
 * 这与项目既有测试（db-limit.test.js 等）约定一致，同时验证了增量可成功编译。
 */
import { test, mock } from 'node:test';
import assert from 'node:assert';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const cryptoUrl = new URL('../dist/services/cryptoService.js', import.meta.url);

function makeConn() {
  return {
    id: 'c1',
    name: 'n',
    type: 'postgres',
    host: 'h',
    port: 5432,
    database: 'db',
    username: 'u',
    passwordEnc: 'whatever',
    createdAt: '',
    updatedAt: '',
  };
}

/** 注册 mock 并加载一个「全新」的 dbService 模块实例（带查询串 bust，确保 mock 生效）。 */
async function loadExecuteMulti(captured) {
  mock.reset();
  class MockPgClient {
    async connect() {}
    async end() {}
    async query(sql) {
      captured.push(sql);
      if (/bad/i.test(sql)) throw new Error('syntax error near bad');
      return { fields: [{ name: 'x' }], rows: [{ x: 1 }], rowCount: 1 };
    }
  }
  mock.module('pg', { defaultExport: { Client: MockPgClient } });
  mock.module('mysql2/promise', {
    defaultExport: {
      createConnection: async () => ({ query: async () => [[], []], end: async () => {} }),
    },
  });
  // 绕开真实 AES 解密（沙箱主密钥不匹配会抛 40101）
  mock.module(cryptoUrl, { namedExports: { decrypt: () => 'dummy', encrypt: (s) => s } });

  const url = new URL('../dist/services/dbService.js?t=' + Math.random(), import.meta.url);
  const mod = await import(url);
  return mod.executeMulti;
}

test('A. 错误隔离：一条失败不阻断其余，successCount/errorCount 正确', async () => {
  const captured = [];
  const executeMulti = await loadExecuteMulti(captured);
  const conn = makeConn();

  const res = await executeMulti(conn, 'select 1; select bad', {});

  assert.strictEqual(res.statements.length, 2, `应返回 2 条，实际 ${res.statements.length}`);
  assert.ok(res.statements[0].result, '第一条应有 result');
  assert.deepStrictEqual(res.statements[0].result.columns, ['x']);
  assert.deepStrictEqual(res.statements[0].result.rows, [{ x: 1 }]);
  assert.ok(res.statements[1].error, '第二条应有 error');
  assert.ok(
    res.statements[1].error.includes('syntax error'),
    `error 应含 'syntax error'，实际: ${res.statements[1].error}`
  );
  assert.strictEqual(res.successCount, 1);
  assert.strictEqual(res.errorCount, 1);
});

test('B. 空/纯注释输入 → statements:[] 且计数 0', async () => {
  const captured = [];
  const executeMulti = await loadExecuteMulti(captured);
  const conn = makeConn();

  const res = await executeMulti(conn, '-- only comment', {});

  assert.deepStrictEqual(res.statements, [], '纯注释输入 → 空数组');
  assert.strictEqual(res.successCount, 0);
  assert.strictEqual(res.errorCount, 0);
});

test('C. 每条 SELECT 各自追加 LIMIT 1000（校验 mock query 入参）', async () => {
  const captured = [];
  const executeMulti = await loadExecuteMulti(captured);
  const conn = makeConn();

  await executeMulti(conn, 'select 1; select 2', {});

  assert.strictEqual(captured.length, 2, `应执行 2 条，实际 ${captured.length}`);
  for (const q of captured) {
    assert.ok(/LIMIT 1000$/i.test(q), `每条 SELECT 应追加 LIMIT 1000，实际: ${q}`);
  }
});

test('D. unlimited:true 时不为 SELECT 追加 LIMIT', async () => {
  const captured = [];
  const executeMulti = await loadExecuteMulti(captured);
  const conn = makeConn();

  await executeMulti(conn, 'select 1', { unlimited: true });

  assert.strictEqual(captured.length, 1);
  assert.ok(!/LIMIT/i.test(captured[0]), `unlimited 时不应追加 LIMIT，实际: ${captured[0]}`);
});
