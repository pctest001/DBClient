/**
 * aiService.generate 清洗测试（node:test + mock.module + mock fetch，零依赖）。
 *
 * mock settingsService 的 getSettings / decryptApiKey，并 mock 全局 fetch
 * 返回 OpenAI 格式，验证：
 *  - 模型返回 ```sql 围栏 → 清洗为 statements:string[]
 *  - 空内容 → statements:[] 且不抛异常（不抛 50003）
 */
import { test, mock } from 'node:test';
import assert from 'node:assert';

const settingsUrl = new URL('../dist/services/settingsService.js', import.meta.url);

async function loadGenerate(fetchImpl) {
  mock.reset();
  mock.module(settingsUrl, {
    namedExports: {
      getSettings: () => ({ enabled: true, baseUrl: 'https://x/v1', model: 'm', apiKeyEnc: 'k' }),
      decryptApiKey: () => 'fake-api-key',
    },
  });
  mock.method(globalThis, 'fetch', fetchImpl);
  const url = new URL('../dist/services/aiService.js?t=' + Math.random(), import.meta.url);
  const mod = await import(url);
  return mod.generate;
}

test('A. generate 清洗模型返回（```sql 围栏）→ statements', async () => {
  const fetchImpl = async () => ({
    ok: true,
    text: async () =>
      JSON.stringify({ choices: [{ message: { content: '```sql\nselect 1;\nselect 2;\n```' } }] }),
  });
  const generate = await loadGenerate(fetchImpl);

  const res = await generate(null, '需求');

  assert.deepStrictEqual(res.statements, ['select 1', 'select 2']);
  assert.strictEqual(res.model, 'm');
});

test('B. generate 空内容 → statements:[] 且不抛异常（不抛 50003）', async () => {
  const fetchImpl = async () => ({
    ok: true,
    text: async () => JSON.stringify({ choices: [{ message: { content: '' } }] }),
  });
  const generate = await loadGenerate(fetchImpl);

  let threw = false;
  let res;
  try {
    res = await generate(null, '需求');
  } catch (e) {
    threw = true;
  }
  assert.strictEqual(threw, false, '空内容不应抛异常（含 50003）');
  assert.deepStrictEqual(res.statements, [], '空内容 → statements:[]');
  assert.strictEqual(res.model, 'm');
});
