/**
 * dbService.execute 的 LIMIT 追加逻辑测试（node:test + mock.module，零依赖）。
 *
 * shouldApplyLimit / execute 内部直接 import mysql2/pg 驱动，无法连真实库。
 * 使用 Node 22 内置 mock.module 替换驱动模块，注入 mock 连接对象，
 * 验证仅对「单行 SELECT 且无已有 LIMIT」追加 LIMIT {n} 的契约：
 *  - 简单 SELECT → 追加 LIMIT 1000（默认），truncated=true，appliedLimit=1000
 *  - unlimited:true → 不追加
 *  - 已含 LIMIT → 不重复追加
 *  - 非 SELECT 语句 → 不追加
 *  - 自定义 limitValue → 追加对应值
 */
import { test, mock } from 'node:test';
import assert from 'node:assert';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dbUrl = new URL('../dist/services/dbService.js', import.meta.url);
const cryptoUrl = new URL('../dist/services/cryptoService.js', import.meta.url);

function makeConn(type, passwordEnc) {
  return {
    id: 'c1',
    name: 'n',
    type,
    host: 'h',
    port: type === 'mysql' ? 3306 : 5432,
    database: 'db',
    username: 'u',
    passwordEnc,
    createdAt: '',
    updatedAt: '',
  };
}

test('execute 按规则追加 LIMIT（mock 驱动，mysql）', async () => {
  const captured = { sql: null };

  // 替换 mysql2/promise 为 mock 连接对象
  mock.module('mysql2/promise', {
    defaultExport: {
      createConnection: async () => ({
        query: async (sql) => {
          captured.sql = sql;
          return [[], []]; // [rows, fields]
        },
        end: async () => {},
      }),
    },
  });
  // 同时替换 pg（execute 在 mysql 分支不会用到，但模块顶层会 import）
  mock.module('pg', {
    defaultExport: {
      Client: class {
        async connect() {}
        async query() {
          return { rows: [], fields: [], rowCount: 0 };
        }
        async end() {}
      },
    },
  });

  const dbService = await import(dbUrl);
  const cryptoService = await import(cryptoUrl);
  const { execute } = dbService;
  const { encrypt } = cryptoService;

  const conn = makeConn('mysql', encrypt('pw'));

  // a. 简单 SELECT → 默认 LIMIT 1000
  captured.sql = null;
  let res = await execute(conn, 'SELECT id, name FROM users', { limit: true });
  assert.ok(captured.sql.endsWith('LIMIT 1000'), `a 应追加 LIMIT 1000，实际: ${captured.sql}`);
  assert.strictEqual(res.truncated, true, 'a truncated 应为 true');
  assert.strictEqual(res.appliedLimit, 1000, 'a appliedLimit 应为 1000');

  // b. unlimited:true → 不追加
  captured.sql = null;
  await execute(conn, 'SELECT * FROM t', { unlimited: true });
  assert.ok(!/LIMIT/i.test(captured.sql), `b 不应追加 LIMIT，实际: ${captured.sql}`);

  // c. 已含 LIMIT → 不重复追加
  captured.sql = null;
  await execute(conn, 'SELECT * FROM t LIMIT 5', { limit: true });
  assert.strictEqual(captured.sql, 'SELECT * FROM t LIMIT 5', `c 不应修改，实际: ${captured.sql}`);

  // d. 非 SELECT → 不追加
  captured.sql = null;
  await execute(conn, 'INSERT INTO t (a) VALUES (1)', { limit: true });
  assert.ok(!/LIMIT/i.test(captured.sql), `d 非 SELECT 不应追加，实际: ${captured.sql}`);

  // e. 自定义 limitValue=50
  captured.sql = null;
  res = await execute(conn, 'SELECT * FROM t', { limit: true, limitValue: 50 });
  assert.ok(captured.sql.endsWith('LIMIT 50'), `e 应追加 LIMIT 50，实际: ${captured.sql}`);
  assert.strictEqual(res.appliedLimit, 50, 'e appliedLimit 应为 50');

  // f. limit:false → 不追加
  captured.sql = null;
  await execute(conn, 'SELECT * FROM t', { limit: false });
  assert.ok(!/LIMIT/i.test(captured.sql), `f limit:false 不应追加，实际: ${captured.sql}`);
});
