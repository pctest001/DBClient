/**
 * 表清单（GET /:id/tables）功能测试 —— node:test + mock.module，零额外依赖。
 *
 * 覆盖：
 *  1) API 契约冒烟：启动真实子进程，GET 不存在连接的 /tables → {code:40401}
 *  2) getTableList(MySQL) 分组（mock.module 'mysql2/promise'）
 *  3) getTableList(PostgreSQL) 分组（mock.module 'pg'）
 *  4) 连接失败路径：驱动建连 reject → 抛出 AppError(50001)
 *
 * 运行（Node 22 必需 --experimental-test-module-mocks，否则 mock.module 不可用）：
 *   cd server
 *   DB_CLIENT_MASTER_KEY=<32位以上随机串> \
 *     /c/Users/Administrator/.workbuddy/binaries/node/versions/22.22.2/node.exe \
 *     --experimental-test-module-mocks --test tests/schema.test.js
 */
import { test, mock } from 'node:test';
import assert from 'node:assert';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { getTableList } from '../dist/services/schemaService.js';
import { encrypt } from '../dist/services/cryptoService.js';
import { AppError } from '../dist/utils/response.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const serverRoot = path.resolve(__dirname, '..');
const NODE = process.execPath; // 托管 Node 22.22.2
const PORT = 4731;
const BASE = `http://localhost:${PORT}`;
// 32 位以上随机主密钥；测试进程内 encrypt/decrypt 与子进程共用同一把 key。
const MASTER_KEY = 'test-master-key-0123456789abcdefghijklmnopqrstuvwxyz';

// getMasterKey() 在 encrypt/decrypt 调用时读取该环境变量，必须在调用前设置。
if (!process.env.DB_CLIENT_MASTER_KEY || process.env.DB_CLIENT_MASTER_KEY.length < 16) {
  process.env.DB_CLIENT_MASTER_KEY = MASTER_KEY;
}

/** 两张表的 information_schema 行（字段名与 schemaService 的 SQL 投影一致）。 */
const FAKE_ROWS = [
  { table_name: 'users', table_comment: '', column_name: 'id', column_type: 'bigint', column_comment: '用户ID', is_nullable: 'NO' },
  { table_name: 'users', table_comment: '', column_name: 'name', column_type: 'varchar', column_comment: '', is_nullable: 'YES' },
  { table_name: 'orders', table_comment: '', column_name: 'id', column_type: 'bigint', column_comment: '', is_nullable: 'NO' },
  { table_name: 'orders', table_comment: '', column_name: 'amount', column_type: 'decimal', column_comment: '', is_nullable: 'YES' },
];

/** 造一条 ConnectionRecord（密码经 encrypt 加密，确保 decrypt 可用）。 */
function makeRecord(type, port) {
  return {
    type,
    host: '127.0.0.1',
    port,
    database: 'test',
    username: type === 'mysql' ? 'root' : 'postgres',
    passwordEnc: encrypt('dummy'),
  };
}

// ---------------------------------------------------------------------------
// 1) API 契约冒烟：真实子进程 + fetch + SIGTERM
// ---------------------------------------------------------------------------
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

test('API契约：不存在连接的 /tables 应返回 {code:40401}', async (t) => {
  const child = spawn(NODE, ['dist/index.js'], {
    cwd: serverRoot,
    env: { ...process.env, DB_CLIENT_MASTER_KEY: MASTER_KEY, PORT: String(PORT) },
    stdio: ['ignore', 'ignore', 'pipe'],
  });
  child.unref();
  let stderr = '';
  child.stderr.on('data', (d) => (stderr += d.toString()));

  try {
    await waitForServer(BASE);
    const r = await fetch(`${BASE}/api/connections/does-not-exist/tables`);
    assert.strictEqual(r.status, 200, `HTTP 应为 200，实际 ${r.status}`);
    const j = await r.json();
    assert.strictEqual(
      j.code,
      40401,
      `不存在连接应返回 40401，实际 code=${j.code}; body=${JSON.stringify(j)}`
    );
  } catch (err) {
    if (stderr) err.message += `\n[server stderr] ${stderr.slice(0, 800)}`;
    throw err;
  } finally {
    if (child && !child.killed) {
      child.kill('SIGTERM');
      await new Promise((res) => {
        const to = setTimeout(res, 3000);
        child.on('exit', () => {
          clearTimeout(to);
          res();
        });
      });
    }
  }
});

// ---------------------------------------------------------------------------
// 2) getTableList(MySQL) 分组（mock.module 'mysql2/promise'）
// ---------------------------------------------------------------------------
test('getTableList(MySQL) 将 information_schema 行正确分组为 TableInfo[]', async (t) => {
  const fakeConn = {
    query: async () => [FAKE_ROWS], // mysql2 返回 [rows, fields]
    end: async () => {},
  };
  const mm = mock.module('mysql2/promise', {
    namedExports: {
      createConnection: async () => fakeConn,
    },
  });
  t.after(() => mm.restore());

  const tables = await getTableList(makeRecord('mysql', 3306));

  assert.strictEqual(tables.length, 2, `应返回 2 张表，实际 ${tables.length}`);
  assert.deepStrictEqual(
    tables.map((x) => x.name),
    ['users', 'orders'],
    '表名顺序应为 [users, orders]'
  );
  assert.strictEqual(tables[0].comment, '');
  assert.deepStrictEqual(tables[0].columns[0], {
    name: 'id',
    dataType: 'bigint',
    nullable: false,
    comment: '用户ID',
  });
  assert.deepStrictEqual(tables[0].columns[1], {
    name: 'name',
    dataType: 'varchar',
    nullable: true,
    comment: '',
  });
  assert.strictEqual(tables[1].name, 'orders');
  assert.deepStrictEqual(tables[1].columns[0], {
    name: 'id',
    dataType: 'bigint',
    nullable: false,
    comment: '',
  });
  assert.deepStrictEqual(tables[1].columns[1], {
    name: 'amount',
    dataType: 'decimal',
    nullable: true,
    comment: '',
  });
});

// ---------------------------------------------------------------------------
// 3) getTableList(PostgreSQL) 分组（mock.module 'pg'）
// ---------------------------------------------------------------------------
test('getTableList(PostgreSQL) 将 information_schema 行正确分组为 TableInfo[]', async (t) => {
  class FakeClient {
    async connect() {}
    async query() {
      return { rows: FAKE_ROWS }; // pg 返回 { rows, fields }
    }
    async end() {}
  }
  const mm = mock.module('pg', {
    namedExports: {
      Client: FakeClient,
    },
  });
  t.after(() => mm.restore());

  const tables = await getTableList(makeRecord('postgres', 5432));

  assert.strictEqual(tables.length, 2, `应返回 2 张表，实际 ${tables.length}`);
  assert.deepStrictEqual(
    tables.map((x) => x.name),
    ['users', 'orders'],
    '表名顺序应为 [users, orders]'
  );
  assert.deepStrictEqual(tables[0].columns[0], {
    name: 'id',
    dataType: 'bigint',
    nullable: false,
    comment: '用户ID',
  });
  assert.deepStrictEqual(tables[1].columns[1], {
    name: 'amount',
    dataType: 'decimal',
    nullable: true,
    comment: '',
  });
});

// ---------------------------------------------------------------------------
// 4) 连接失败路径：驱动 createConnection reject → AppError(50001)
// ---------------------------------------------------------------------------
test('getTableList 建连失败时抛出 AppError(50001)', async (t) => {
  const connErr = new Error('connect ECONNREFUSED 127.0.0.1:3306');
  connErr.code = 'ECONNREFUSED'; // 命中 CONNECTION_ERROR_CODES → 50001
  const mm = mock.module('mysql2/promise', {
    namedExports: {
      createConnection: async () => {
        throw connErr;
      },
    },
  });
  t.after(() => mm.restore());

  await assert.rejects(
    () => getTableList(makeRecord('mysql', 3306)),
    (err) => err instanceof AppError && err.code === 50001,
    '建连失败应抛出 AppError(50001)'
  );
});
