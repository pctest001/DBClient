/**
 * dbService.executeMulti 单元测试（node:test + mock.module，零依赖）。
 *
 * 用 mock.module 替换 'pg'（提供 MockClient）与同级 './cryptoService.js'
 * （decrypt 直接返回明文，绕开沙箱主密钥不匹配的已知环境坑），
 * 验证多语句执行：错误隔离、聚合计数、每条 SELECT 各自追加 LIMIT 1000；
 * 增量 P2-2 追加事务模式用例：单连接、BEGIN/COMMIT/ROLLBACK 调用序列、
 * 中途失败即回滚且后续语句不再执行、连接最终关闭、默认模式回归。
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

/**
 * 注册 mock 并加载一个「全新」的 dbService 模块实例（带查询串 bust，确保 mock 生效）。
 *
 * options（均可选，供事务模式用例注入可观测的驱动 mock）：
 * - pgClient: 自定义 pg Client 类（默认：失败语句含 'bad'，其余返回 1 行）
 * - mysqlConnection: mysql2 createConnection 的返回值（连接对象工厂）
 */
async function loadExecuteMulti(captured, options = {}) {
  mock.reset();
  const MockPgClient =
    options.pgClient ??
    class MockPgClient {
      async connect() {}
      async end() {}
      async query(sql) {
        captured.push(sql);
        if (/bad/i.test(sql)) throw new Error('syntax error near bad');
        return { fields: [{ name: 'x' }], rows: [{ x: 1 }], rowCount: 1 };
      }
    };
  mock.module('pg', { defaultExport: { Client: MockPgClient } });
  mock.module('mysql2/promise', {
    defaultExport: {
      createConnection:
        options.mysqlConnection ??
        (async () => ({ query: async () => [[], []], end: async () => {} })),
    },
  });
  // 绕开真实 AES 解密（沙箱主密钥不匹配会抛 40101）
  mock.module(cryptoUrl, { namedExports: { decrypt: () => 'dummy', encrypt: (s) => s } });

  const url = new URL('../dist/services/dbService.js?t=' + Math.random(), import.meta.url);
  const mod = await import(url);
  return mod.executeMulti;
}

/**
 * pg 事务用 Mock Client：捕获全部 query 调用（含 BEGIN/COMMIT/ROLLBACK）与 end，
 * failOn 命中的语句抛错（默认无语句失败）。
 */
function makePgTxClientClass(captured, { failOn = null } = {}) {
  return class MockPgTxClient {
    async connect() {}
    async end() {
      captured.push('__END__');
    }
    async query(sql) {
      captured.push(sql);
      if (failOn && failOn.test(sql)) throw new Error('syntax error near bad');
      return { fields: [{ name: 'x' }], rows: [{ x: 1 }], rowCount: 1 };
    }
  };
}

/**
 * mysql 事务用 Mock 连接：捕获 beginTransaction/commit/rollback/end 与逐条 query，
 * 含 'bad' 的语句抛错；返回 { connection, calls } 供断言调用计数。
 */
function makeMysqlTxConnection(captured) {
  const calls = { begin: 0, commit: 0, rollback: 0, end: 0 };
  const connection = {
    async beginTransaction() {
      calls.begin++;
      captured.push('__BEGIN__');
    },
    async commit() {
      calls.commit++;
      captured.push('__COMMIT__');
    },
    async rollback() {
      calls.rollback++;
      captured.push('__ROLLBACK__');
    },
    async end() {
      calls.end++;
      captured.push('__END__');
    },
    async query(sql) {
      captured.push(sql);
      if (/bad/i.test(sql)) throw new Error('syntax error near bad');
      return [[{ x: 1 }], [{ name: 'x' }]];
    },
  };
  return { connection, calls };
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

test('E. 事务模式（pg）全成功：BEGIN→逐条→COMMIT，rolledBack 不为 true，连接最终关闭', async () => {
  const captured = [];
  const executeMulti = await loadExecuteMulti(captured, {
    pgClient: makePgTxClientClass(captured),
  });
  const conn = makeConn();

  const res = await executeMulti(conn, 'select 1; select 2', { transaction: true });

  // 完整调用序列：开事务 → 逐条执行（各自追加 LIMIT 1000）→ 提交 → 关连接
  assert.deepStrictEqual(captured, [
    'BEGIN',
    'select 1 LIMIT 1000',
    'select 2 LIMIT 1000',
    'COMMIT',
    '__END__',
  ]);
  assert.strictEqual(res.statements.length, 2, `应返回 2 条，实际 ${res.statements.length}`);
  assert.ok(res.statements.every((s) => s.result), '每条语句都应有 result');
  assert.deepStrictEqual(res.statements[0].result.columns, ['x']);
  assert.strictEqual(res.successCount, 2);
  assert.strictEqual(res.errorCount, 0);
  assert.ok(res.rolledBack !== true, `全成功时 rolledBack 不应为 true，实际: ${res.rolledBack}`);
});

test('F. 事务模式（pg）中途失败：立即 ROLLBACK、后续语句不再执行、rolledBack=true、连接关闭', async () => {
  const captured = [];
  const executeMulti = await loadExecuteMulti(captured, {
    pgClient: makePgTxClientClass(captured, { failOn: /bad/i }),
  });
  const conn = makeConn();

  const res = await executeMulti(conn, 'select 1; select bad; select 3', { transaction: true });

  // 失败语句之后不应再执行任何语句（无 'select 3'、无 COMMIT）
  assert.deepStrictEqual(captured, [
    'BEGIN',
    'select 1 LIMIT 1000',
    'select bad LIMIT 1000',
    'ROLLBACK',
    '__END__',
  ]);
  assert.strictEqual(res.statements.length, 2, `失败后的语句不应执行，实际 ${res.statements.length}`);
  assert.ok(res.statements[0].result, '第一条应有 result');
  assert.ok(res.statements[1].error, '失败语句应有 error');
  assert.ok(
    res.statements[1].error.includes('syntax error'),
    `error 应含 'syntax error'，实际: ${res.statements[1].error}`
  );
  assert.strictEqual(res.successCount, 1);
  assert.strictEqual(res.errorCount, 1);
  assert.strictEqual(res.rolledBack, true, '事务模式下失败必须 rolledBack === true');
});

test('G. 事务模式（mysql）全成功：beginTransaction→逐条→commit，rollback 未调用，连接关闭', async () => {
  const captured = [];
  const { connection, calls } = makeMysqlTxConnection(captured);
  const executeMulti = await loadExecuteMulti(captured, {
    mysqlConnection: async () => connection,
  });
  const conn = { ...makeConn(), type: 'mysql' };

  const res = await executeMulti(conn, 'select 1; select 2', { transaction: true });

  assert.deepStrictEqual(captured, [
    '__BEGIN__',
    'select 1 LIMIT 1000',
    'select 2 LIMIT 1000',
    '__COMMIT__',
    '__END__',
  ]);
  assert.strictEqual(calls.begin, 1, 'beginTransaction 应调用 1 次');
  assert.strictEqual(calls.commit, 1, 'commit 应调用 1 次');
  assert.strictEqual(calls.rollback, 0, '全成功时不应调用 rollback');
  assert.strictEqual(calls.end, 1, '连接最终应关闭（end 调用 1 次）');
  assert.strictEqual(res.statements.length, 2);
  assert.deepStrictEqual(res.statements[0].result.columns, ['x']);
  assert.strictEqual(res.successCount, 2);
  assert.strictEqual(res.errorCount, 0);
  assert.ok(res.rolledBack !== true, `全成功时 rolledBack 不应为 true，实际: ${res.rolledBack}`);
});

test('H. 事务模式（mysql）中途失败：rollback 调用、commit 未调用、后续语句未执行、连接关闭', async () => {
  const captured = [];
  const { connection, calls } = makeMysqlTxConnection(captured);
  const executeMulti = await loadExecuteMulti(captured, {
    mysqlConnection: async () => connection,
  });
  const conn = { ...makeConn(), type: 'mysql' };

  const res = await executeMulti(conn, 'select 1; select bad; select 3', { transaction: true });

  assert.deepStrictEqual(captured, [
    '__BEGIN__',
    'select 1 LIMIT 1000',
    'select bad LIMIT 1000',
    '__ROLLBACK__',
    '__END__',
  ]);
  assert.strictEqual(calls.rollback, 1, '失败时应调用 rollback');
  assert.strictEqual(calls.commit, 0, '失败时不应调用 commit');
  assert.strictEqual(calls.end, 1, '连接最终应关闭（end 调用 1 次）');
  assert.strictEqual(res.statements.length, 2, `失败后的语句不应执行，实际 ${res.statements.length}`);
  assert.strictEqual(res.rolledBack, true, '事务模式下失败必须 rolledBack === true');
  assert.ok(
    res.statements[1].error.includes('SQL 执行失败'),
    `语句级错误应保持 50002 文案，实际: ${res.statements[1].error}`
  );
  assert.strictEqual(res.successCount, 1);
  assert.strictEqual(res.errorCount, 1);
});

test('I. 不带 transaction（默认）→ 错误隔离、失败不中断，且不出现 rolledBack 字段', async () => {
  const captured = [];
  const executeMulti = await loadExecuteMulti(captured);
  const conn = makeConn();

  const res = await executeMulti(conn, 'select 1; select bad; select 3', {});

  // 回归：与现状一致——三条语句都执行（单条失败不阻断其余）
  assert.strictEqual(captured.length, 3, `默认模式三条语句都应执行，实际 ${captured.length}`);
  assert.strictEqual(res.statements.length, 3);
  assert.strictEqual(res.successCount, 2);
  assert.strictEqual(res.errorCount, 1);
  assert.strictEqual('rolledBack' in res, false, '非事务模式不应出现 rolledBack 字段');
});
