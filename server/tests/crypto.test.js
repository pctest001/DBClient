/**
 * cryptoService 加解密 roundtrip 测试（零依赖，node:test + node:assert）。
 *
 * 覆盖：
 *  - encrypt → decrypt 还原（含中文/空串/长文本）
 *  - 不同明文 → 不同密文（随机 IV）
 *  - 篡改密文 → decrypt 抛 AppError(40101)
 *  - 主密钥缺失 → 进程入口启动失败（exit 1，验证 P0-4 安全要求）
 *
 * 说明：encrypt/decrypt 通过 config/env 的 getMasterKey() 实时读取
 * process.env.DB_CLIENT_MASTER_KEY，故运行时由 shell 注入该变量。
 */
import { test } from 'node:test';
import assert from 'node:assert';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { encrypt, decrypt } from '../dist/services/cryptoService.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const serverRoot = path.resolve(__dirname, '..');
const NODE = process.execPath;

const samplePlaintexts = [
  'hello world',
  '中文密码测试ABC123',
  '',
  'a'.repeat(5000),
  'special !@#$%^&*()_+-=[]{}|;:,.<>?',
];

test('encrypt 后 decrypt 可还原明文（多种输入）', () => {
  for (const p of samplePlaintexts) {
    const token = encrypt(p);
    assert.strictEqual(decrypt(token), p, `roundtrip 失败: ${JSON.stringify(p).slice(0, 30)}`);
  }
});

test('不同明文产生不同密文（随机 IV）', () => {
  const a1 = encrypt('same');
  const a2 = encrypt('same');
  assert.notStrictEqual(a1, a2, '相同明文两次加密应不同（随机 IV）');
  assert.notStrictEqual(encrypt('foo'), encrypt('bar'), '不同明文密文应不同');
});

test('密文格式为 base64(iv[12]+tag[16]+ciphertext)', () => {
  const token = encrypt('payload');
  const buf = Buffer.from(token, 'base64');
  // 至少包含 12 字节 IV + 16 字节 authTag
  assert.ok(buf.length >= 28, `密文长度应 >= 28，实际 ${buf.length}`);
});

test('篡改密文 → decrypt 抛 AppError(40101)', () => {
  const token = encrypt('secret-value');
  const buf = Buffer.from(token, 'base64');
  // 翻转最后一个字节（密文段），破坏 authTag 校验
  buf[buf.length - 1] ^= 0xff;
  const tampered = buf.toString('base64');
  assert.throws(
    () => decrypt(tampered),
    (err) => err && err.code === 40101,
    '篡改密文应抛 40101'
  );
});

test('主密钥缺失 → 进程入口启动失败（exit 1）', (t, done) => {
  // 不注入 DB_CLIENT_MASTER_KEY，验证 ensureEnv 在入口处拦截（P0-4 安全要求）
  const child = spawn(
    NODE,
    ['dist/index.js'],
    {
      cwd: serverRoot,
      env: { ...process.env, DB_CLIENT_MASTER_KEY: '' }, // 显式置空以触发缺失分支
      stdio: ['ignore', 'ignore', 'pipe'],
    }
  );
  let stderr = '';
  child.stderr.on('data', (d) => (stderr += d.toString()));
  child.on('exit', (code) => {
    try {
      assert.notStrictEqual(code, 0, '主密钥缺失时应非零退出');
      assert.ok(
        /DB_CLIENT_MASTER_KEY/.test(stderr),
        `启动失败日志应包含主密钥提示，实际: ${stderr}`
      );
      done();
    } catch (err) {
      done(err);
    }
  });
});
