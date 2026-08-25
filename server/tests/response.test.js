/**
 * 统一响应构造器测试（node:test + node:assert）。
 *
 * 覆盖 utils/response.ts：
 *  - AppError 类型（携带领域错误码）
 *  - ok(res, data) → { code:0, data, message:'ok' }，HTTP 200
 *  - fail(res, code, msg) → { code, data:null, message }，HTTP 200
 *  - validate(schema, data) 成功返回解析值；失败抛 AppError(40001)
 *  - asyncHandler 将 async 异常转发到 next()
 *
 * 使用轻量 mock res 对象，不依赖真实 express 实例。
 */
import { test } from 'node:test';
import assert from 'node:assert';
import { z } from 'zod';
import { ok, fail, AppError, validate, asyncHandler } from '../dist/utils/response.js';

/** 构造一个记录 status/json 的 mock express Response。 */
function makeRes() {
  const out = { status: undefined, body: undefined };
  const res = {
    status(code) {
      out.status = code;
      return res;
    },
    json(body) {
      out.body = body;
      return res;
    },
  };
  return { res, out };
}

test('AppError 携带领域错误码', () => {
  const err = new AppError(40001, '参数错误');
  assert.ok(err instanceof Error);
  assert.ok(err instanceof AppError);
  assert.strictEqual(err.code, 40001);
  assert.strictEqual(err.name, 'AppError');
  assert.strictEqual(err.message, '参数错误');
});

test('ok() 构造成功响应 {code:0,data,message:ok}', () => {
  const { res, out } = makeRes();
  const ret = ok(res, { id: 1, name: 't' });
  assert.strictEqual(ret, res, 'ok 应返回 res 以支持链式');
  assert.strictEqual(out.status, 200);
  assert.deepStrictEqual(out.body, {
    code: 0,
    data: { id: 1, name: 't' },
    message: 'ok',
  });
});

test('fail() 构造失败响应 {code,data:null,message}', () => {
  const { res, out } = makeRes();
  fail(res, 50001, '连接失败');
  assert.strictEqual(out.status, 200);
  assert.deepStrictEqual(out.body, {
    code: 50001,
    data: null,
    message: '连接失败',
  });
});

test('validate 成功返回解析后数据', () => {
  const schema = z.object({ a: z.number(), b: z.string() });
  const parsed = validate(schema, { a: 1, b: 'x' });
  assert.deepStrictEqual(parsed, { a: 1, b: 'x' });
});

test('validate 失败抛 AppError(40001)', () => {
  const schema = z.object({ a: z.number() });
  assert.throws(
    () => validate(schema, { a: 'not-a-number' }),
    (err) => err instanceof AppError && err.code === 40001,
    '校验不过应抛 40001'
  );
});

test('asyncHandler 将 async 异常转发到 next()', async () => {
  const mw = asyncHandler(async () => {
    throw new AppError(40901, '连接名冲突');
  });
  const { res } = makeRes();
  let received = null;
  const next = (err) => {
    received = err;
  };
  mw({}, res, next);
  // 异常经 .catch 异步转发，等待一个 tick
  await new Promise((r) => setImmediate(r));
  assert.ok(received instanceof AppError, '异常应被捕获');
  assert.strictEqual(received.code, 40901);
});

test('asyncHandler 正常时不会调用 next()', async () => {
  let called = false;
  const mw = asyncHandler(async (req, res) => {
    ok(res, { ok: true });
  });
  const { res } = makeRes();
  mw({}, res, () => {
    called = true;
  });
  await new Promise((r) => setImmediate(r));
  assert.strictEqual(called, false, '无异常时不应调用 next');
});
