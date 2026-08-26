/**
 * connectionService 导入/导出单元测试（node:test + mock.module，零依赖）。
 *
 * 用 mock.module 替换 cryptoService（encrypt/decrypt 本地可逆、跨密钥抛错），
 * 验证 P2-5：导出密文/明文、导入明文、同名 skip/overwrite/rename、密文跨密钥报错、缺字段报错。
 *
 * 与 multiExec.test.js 约定一致：从 ../dist 导入（本环境 Node 不支持 .js→.ts 回退），
 * 并以临时 cwd 隔离 server/data，避免污染真实连接数据。
 */
import { test, mock, before } from 'node:test';
import assert from 'node:assert';
import fs from 'fs';
import path from 'path';

const cryptoUrl = new URL('../dist/services/cryptoService.js', import.meta.url);

const DATA = path.join(process.cwd(), 'data');
const CONN_FILE = path.join(DATA, 'connections.json');

/** 清空连接数据，保证用例隔离（数据落在临时 cwd 下，不碰真实库）。 */
function resetData() {
  fs.mkdirSync(DATA, { recursive: true });
  fs.writeFileSync(CONN_FILE, '[]', 'utf8');
}

/** 加载一个「全新」的 connectionService 实例（带 query 串 bust，确保 mock 生效）。 */
async function loadService() {
  mock.reset();
  mock.module(cryptoUrl, {
    namedExports: {
      encrypt: (s) => 'ENC:' + s,
      decrypt: (s) =>
        s.startsWith('ENC:')
          ? s.slice(4)
          : (() => {
              throw new Error('密文与当前密钥不匹配');
            })(),
    },
  });
  const url = new URL('../dist/services/connectionService.js?t=' + Math.random(), import.meta.url);
  return (await import(url)).connectionService;
}

const base = (name, over = {}) => ({
  name,
  type: 'mysql',
  host: '127.0.0.1',
  port: 3306,
  database: 'db',
  username: 'u',
  ...over,
});

before(() => resetData());

test('1. exportAll(false) 返回密文 passwordEnc，不含明文 password', async () => {
  resetData();
  const svc = await loadService();
  svc.importMany([base('a', { password: 'p1' })], 'skip');
  const exp = svc.exportAll(false);
  assert.strictEqual(exp.version, 1);
  assert.strictEqual(exp.connections.length, 1);
  assert.strictEqual(exp.connections[0].passwordEnc, 'ENC:p1');
  assert.strictEqual(exp.connections[0].password, undefined);
});

test('2. exportAll(true) 返回明文 password，且不含 passwordEnc', async () => {
  resetData();
  const svc = await loadService();
  svc.importMany([base('a', { password: 'p1' })], 'skip');
  const exp = svc.exportAll(true);
  assert.strictEqual(exp.connections[0].password, 'p1');
  assert.strictEqual(exp.connections[0].passwordEnc, undefined);
});

test('3. importMany 明文密码 → imported=1 且落盘可用', async () => {
  resetData();
  const svc = await loadService();
  const res = svc.importMany([base('a', { password: 'secret' })], 'skip');
  assert.strictEqual(res.imported, 1);
  assert.strictEqual(res.errors.length, 0);
  const exp = svc.exportAll(true);
  assert.strictEqual(exp.connections[0].password, 'secret');
});

test('4. importMany 同名默认 skip → skipped=1, imported=0', async () => {
  resetData();
  const svc = await loadService();
  svc.importMany([base('a', { password: 'p' })], 'skip');
  const res = svc.importMany([base('a', { password: 'p2' })], 'skip');
  assert.strictEqual(res.imported, 0);
  assert.strictEqual(res.skipped, 1);
  // 原密码未变
  assert.strictEqual(svc.exportAll(true).connections[0].password, 'p');
});

test('5. importMany overwrite → overwritten=1, 密码被更新', async () => {
  resetData();
  const svc = await loadService();
  svc.importMany([base('a', { password: 'old' })], 'skip');
  const res = svc.importMany([base('a', { password: 'new' })], 'overwrite');
  assert.strictEqual(res.overwritten, 1);
  assert.strictEqual(svc.exportAll(true).connections[0].password, 'new');
});

test('6. importMany rename → renamed=1, 新旧并存且不同名', async () => {
  resetData();
  const svc = await loadService();
  svc.importMany([base('a', { password: 'p' })], 'skip');
  const res = svc.importMany([base('a', { password: 'p' })], 'rename');
  assert.strictEqual(res.renamed, 1);
  const names = svc.exportAll(false).connections.map((c) => c.name);
  assert.strictEqual(names.length, 2);
  assert.ok(names.includes('a') && names.includes('a (2)'));
});

test('7. importMany 跨密钥密文 → 该条进 errors，不中断其余', async () => {
  resetData();
  const svc = await loadService();
  const res = svc.importMany(
    [base('bad', { passwordEnc: 'NOTOURS' }), base('good', { password: 'ok' })],
    'skip'
  );
  assert.strictEqual(res.imported, 1);
  assert.strictEqual(res.errors.length, 1);
  assert.strictEqual(res.errors[0].name, 'bad');
  assert.ok(res.errors[0].error.includes('密钥不匹配'));
  assert.strictEqual(svc.exportAll(true).connections[0].password, 'ok');
});

test('8. importMany 缺字段 → 计入 errors', async () => {
  resetData();
  const svc = await loadService();
  const res = svc.importMany([base('x', { host: '', password: 'p' })], 'skip');
  assert.strictEqual(res.imported, 0);
  assert.strictEqual(res.errors.length, 1);
  assert.strictEqual(res.errors[0].name, 'x');
});

test('9. importMany 同批含多条合法 → 全部 imported', async () => {
  resetData();
  const svc = await loadService();
  const res = svc.importMany(
    [base('a', { password: '1' }), base('b', { password: '2' }), base('c', { password: '3' })],
    'skip'
  );
  assert.strictEqual(res.imported, 3);
  assert.strictEqual(res.errors.length, 0);
});
