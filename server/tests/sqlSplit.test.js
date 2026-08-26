/**
 * sqlSplit.splitStatements 单元测试（node:test + node:assert，零依赖）。
 *
 * 覆盖状态机拆分规则：基础多语句、单/双引号字面量、反引号标识符、
 * -- 行注释、/* *\/ 块注释、PG $$ / $tag$ 美元引用、```sql 围栏剥离、
 * 首尾解释性文字、纯空白/纯注释 → 空数组。逐条精确断言拆分结果。
 */
import { test } from 'node:test';
import assert from 'node:assert';
import { splitStatements, stripFences, cleanAndSplit } from '../dist/utils/sqlSplit.js';

test('1. 基础多语句按分号拆分', () => {
  assert.deepStrictEqual(splitStatements('select 1; select 2'), ['select 1', 'select 2']);
  assert.deepStrictEqual(splitStatements('SELECT a; SELECT b; SELECT c'), ['SELECT a', 'SELECT b', 'SELECT c']);
});

test('2. 单引号内分号不拆分', () => {
  assert.deepStrictEqual(splitStatements("SELECT 'a;b'"), ["SELECT 'a;b'"]);
  assert.deepStrictEqual(splitStatements("INSERT INTO t VALUES ('x;y')"), ["INSERT INTO t VALUES ('x;y')"]);
});

test('3. 双引号内分号不拆分', () => {
  assert.deepStrictEqual(
    splitStatements('SELECT * FROM t WHERE name = "x;y"'),
    ['SELECT * FROM t WHERE name = "x;y"']
  );
});

test('4. 反引号标识符内分号不拆分', () => {
  assert.deepStrictEqual(
    splitStatements('SELECT `a;b` FROM t; SELECT 2'),
    ['SELECT `a;b` FROM t', 'SELECT 2']
  );
});

test('5. 行注释 -- 内的分号不导致误拆', () => {
  const r = splitStatements('SELECT 1; SELECT 2 -- x; y');
  assert.strictEqual(r.length, 2, `行注释内分号不应导致额外拆分，实际: ${JSON.stringify(r)}`);
  assert.strictEqual(r[0], 'SELECT 1');
  assert.ok(r[1].startsWith('SELECT 2'), `第二条应以 SELECT 2 开头，实际: ${r[1]}`);
});

test('6. 块注释 /* */ 内的分号不导致误拆', () => {
  const r = splitStatements('SELECT 1; /* a; b */ SELECT 2');
  assert.strictEqual(r.length, 2, `块注释内分号不应导致额外拆分，实际: ${JSON.stringify(r)}`);
  assert.strictEqual(r[0], 'SELECT 1');
  assert.ok(r[1].includes('SELECT 2'), `第二条应含 SELECT 2，实际: ${r[1]}`);
});

test('7. PG 美元引用 $$ 内的分号不拆分', () => {
  const sql =
    'CREATE FUNCTION f() RETURNS void AS $$\nBEGIN\n  x := 1;\nEND;\n$$ LANGUAGE plpgsql; SELECT 1';
  const r = splitStatements(sql);
  assert.strictEqual(r.length, 2, `$$ 内分号不应拆分，实际: ${JSON.stringify(r)}`);
  assert.ok(r[0].includes('BEGIN') && r[0].includes('END'), `函数体应保留完整，实际: ${r[0]}`);
  assert.strictEqual(r[1], 'SELECT 1');
});

test('8. 带标签美元引用 $tag$ 内的分号不拆分', () => {
  const sql = 'DO $body$\n  x := 1;\n$body$ ; SELECT 2';
  const r = splitStatements(sql);
  assert.strictEqual(r.length, 2, `$tag$ 内分号不应拆分，实际: ${JSON.stringify(r)}`);
  assert.ok(r[0].includes('$body$') && r[0].includes('x := 1'), `带标签美元引用应保留，实际: ${r[0]}`);
  assert.strictEqual(r[1], 'SELECT 2');
});

test('9. 整段 ```sql 围栏被剥离并按多语句拆分', () => {
  assert.deepStrictEqual(splitStatements('```sql\nselect 1;\nselect 2;\n```'), ['select 1', 'select 2']);
});

test('10. 首尾解释性文字被剥离，仅保留 SQL', () => {
  const sql = '这里给你两条 SQL：\n```sql\nSELECT 1;\nSELECT 2;\n```\n希望对你有帮助';
  assert.deepStrictEqual(splitStatements(sql), ['SELECT 1', 'SELECT 2']);
});

test('11. 纯空白 / 纯注释输入 → 空数组', () => {
  assert.deepStrictEqual(splitStatements('   '), []);
  assert.deepStrictEqual(splitStatements('-- only a comment'), []);
  assert.deepStrictEqual(splitStatements('/* only comment */'), []);
  assert.deepStrictEqual(splitStatements(''), []);
});

test('12. 转义引号 \'\' 内分号不拆分', () => {
  assert.deepStrictEqual(
    splitStatements("INSERT INTO t VALUES ('it''s; ok')"),
    ["INSERT INTO t VALUES ('it''s; ok')"]
  );
});

test('13. cleanAndSplit 与 splitStatements 行为一致（含围栏剥离）', () => {
  assert.deepStrictEqual(cleanAndSplit('```sql\nSELECT 1;\nSELECT 2;\n```'), ['SELECT 1', 'SELECT 2']);
  assert.strictEqual(stripFences('```sql\nSELECT 1;\n```'), 'SELECT 1;');
});
