/**
 * SQL 语句拆分工具（增量迭代：AI 生成 SQL 清洗 + 多语句执行）。
 *
 * - `splitStatements`：按 `;` 拆分为多条语句；状态机尊重单/双引号字符串字面量、
 *   反引号标识符（MySQL）、`--` 行注释、`/* *\/` 块注释、以及 PG 的 `$$` / `$tag$`
 *   美元引用；拆分后逐条 trim，剔除仅空白/仅注释的空语句。
 * - 同时被 `aiService`（清洗模型返回）与 `dbService.executeMulti`（拆分入参）复用，
 *   禁止再各写一套拆分逻辑。
 */

/** 剥离 ```sql ... ``` / ``` ... ``` 围栏，保留内部内容（可能含多条）。 */
export function stripFences(text: string): string {
  let s = (text ?? '').trim();
  const m =
    /^```(?:sql)?\s*([\s\S]*?)\s*```$/i.exec(s) ||
    /```(?:sql)?\s*([\s\S]*?)\s*```/i.exec(s);
  if (m) s = m[1].trim();
  return s;
}

/** 仅含空白或仅含注释（SQL 之外无有效语句）的片段视为空。 */
function isCommentOnly(s: string): boolean {
  const stripped = s
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/--[^\n]*/g, '')
    .replace(/'[^']*'/g, '')
    .replace(/"[^"]*"/g, '')
    .replace(/`[^`]*`/g, '')
    .trim();
  return stripped === '';
}

/**
 * 按 `;` 拆分 SQL 为多条语句。
 *
 * 状态机：处于单引号 `'…'` / 双引号 `"…"` 字符串字面量、反引号 `` `…` `` 标识符、
 * `--` 行注释至行末、`/* … *\/` 块注释、或 PG 美元引用 `$$…$$` / `$tag$…$tag$` 内时，
 * 不拆分；正确识别转义引号（`''` 与 `""`；MySQL 亦支持 `\'`）。
 * 拆分前先剥离 markdown 代码块围栏；拆分后逐条 trim，剔除仅空白 / 仅注释的空语句。
 */
export function splitStatements(sql: string): string[] {
  const cleaned = stripFences(sql ?? '');
  const stmts: string[] = [];
  let buf = '';
  let i = 0;
  const n = cleaned.length;
  let inSingle = false;
  let inDouble = false;
  let inBacktick = false;
  let inLineComment = false;
  let inBlockComment = false;
  let inDollar = false;
  let dollarTag = '';

  const notInLiteral = (): boolean =>
    !inSingle &&
    !inDouble &&
    !inBacktick &&
    !inLineComment &&
    !inBlockComment &&
    !inDollar;

  while (i < n) {
    const ch = cleaned[i];
    const next = i + 1 < n ? cleaned[i + 1] : '';

    // 行注释 -- 至行末
    if (notInLiteral() && ch === '-' && next === '-') {
      inLineComment = true;
      buf += ch;
      i++;
      continue;
    }
    if (inLineComment) {
      if (ch === '\n') inLineComment = false;
      buf += ch;
      i++;
      continue;
    }

    // 块注释 /* ... */
    if (notInLiteral() && ch === '/' && next === '*') {
      inBlockComment = true;
      buf += ch;
      i++;
      continue;
    }
    if (inBlockComment) {
      // 先检测结束符 */：保留完整定界符，避免留下未闭合的 /* 注释
      if (ch === '*' && next === '/') {
        buf += '*/';
        inBlockComment = false;
        i += 2;
        continue;
      }
      buf += ch;
      i++;
      continue;
    }

    // 美元引用 $$ ... $$ 或 $tag$ ... $tag$（PG 函数体等）
    if (notInLiteral() && ch === '$') {
      const m = /^\$([A-Za-z_][A-Za-z0-9_]*)?\$/.exec(cleaned.slice(i));
      if (m) {
        inDollar = true;
        dollarTag = m[1] ?? '';
        buf += m[0];
        i += m[0].length;
        continue;
      }
    }
    if (inDollar) {
      const close = dollarTag === '' ? '$$' : `$${dollarTag}$`;
      if (cleaned.startsWith(close, i)) {
        inDollar = false;
        buf += close;
        i += close.length;
        continue;
      }
      buf += ch;
      i++;
      continue;
    }

    // 单引号字符串字面量
    if (!inDouble && !inBacktick && !inLineComment && !inBlockComment && !inDollar && ch === "'") {
      if (inSingle) {
        if (next === "'") {
          buf += "''";
          i += 2;
          continue;
        }
        if (next === '\\') {
          // MySQL 转义 \'（吞掉转义符，语义等同单引号）
          buf += ch;
          i++;
          continue;
        }
        inSingle = false;
        buf += ch;
        i++;
        continue;
      }
      inSingle = true;
      buf += ch;
      i++;
      continue;
    }

    // 双引号字符串 / 标识符
    if (!inSingle && !inBacktick && !inLineComment && !inBlockComment && !inDollar && ch === '"') {
      if (inDouble) {
        if (next === '"') {
          buf += '""';
          i += 2;
          continue;
        }
        inDouble = false;
        buf += ch;
        i++;
        continue;
      }
      inDouble = true;
      buf += ch;
      i++;
      continue;
    }

    // 反引号标识符（MySQL）
    if (!inSingle && !inDouble && !inLineComment && !inBlockComment && !inDollar && ch === '`') {
      inBacktick = !inBacktick;
      buf += ch;
      i++;
      continue;
    }

    // 分号分隔（仅语句级、非字面量/注释/美元引用内）
    if (ch === ';' && notInLiteral()) {
      const t = buf.trim();
      if (t && !isCommentOnly(t)) stmts.push(t);
      buf = '';
      i++;
      continue;
    }

    buf += ch;
    i++;
  }

  const tail = buf.trim();
  if (tail && !isCommentOnly(tail)) stmts.push(tail);
  return stmts;
}

/** AI 原始返回 → 结构化 statements（兼容别名，逻辑与 splitStatements 一致）。 */
export function cleanAndSplit(raw: string): string[] {
  return splitStatements(raw);
}
