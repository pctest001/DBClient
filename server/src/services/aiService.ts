/**
 * AI 生成 SQL 服务（P0-3 / P0-5）。
 *
 * 流程：校验 AI 配置 → 拉取 DDL 上下文 → 组装 system+user prompt →
 * 调用 OpenAI 兼容 `/chat/completions` → 剥离 ```sql 围栏 → 返回 {sql, model}。
 * 仅返回 SQL，绝不自动执行（满足 P0-5）。调用失败返回 50003。
 */
import { getSettings, decryptApiKey } from './settingsService.js';
import { getDdlContext } from './schemaService.js';
import { AppError } from '../utils/response.js';
import type { ConnectionRecord, AiGenerateRes } from '../models/types.js';
import { splitStatements } from '../utils/sqlSplit.js';

const AI_TIMEOUT_MS = 30000;

const SYSTEM_PROMPT = `你是资深 SQL 工程师。下面是被查询数据库的表结构（DDL，仅含表名/列名/类型/注释，不含任何数据行）。
请根据用户需求生成可执行的 SQL；可以生成【多条】，以英文分号 ; 分隔。
SQL 之内可以包含 -- 行注释，但不要在 SQL 之外写解释性文字，不要使用 markdown 代码块围栏。`;

/**
 * 已知 SQL 起始关键字白名单（大小写不敏感）。
 * 用于甄别「模型返回的纯自然语言解释」与「真正的 SQL 语句」，
 * 满足主理人决策 #5：纯解释无 SQL 时返回 statements:[]，不走 50003。
 */
const SQL_KEYWORDS = new Set<string>([
  'SELECT', 'INSERT', 'UPDATE', 'DELETE', 'CREATE', 'ALTER', 'DROP',
  'TRUNCATE', 'WITH', 'REPLACE', 'MERGE', 'GRANT', 'REVOKE', 'EXPLAIN',
  'SHOW', 'USE', 'SET', 'CALL', 'BEGIN', 'COMMIT', 'ROLLBACK', 'PRAGMA',
  'VALUES', 'ANALYZE', 'DESCRIBE',
]);

/**
 * 去掉首尾空白及 SQL 注释（`--` 行注释、`/* *\/` 块注释），返回可读 token 串。
 * 用于关键字甄别与最终输出清洗（剥离装饰性注释，保留可执行 SQL）。
 */
function stripComments(s: string): string {
  return s
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/--[^\n]*/g, ' ')
    .trim();
}

/**
 * 取首个有意义 token（按空白 / 括号分词）。
 * 例：`(select 1)` → `select`；`select 1` → `select`；`这是说明\nselect 2` → `这是说明`。
 */
function firstToken(s: string): string {
  const m = s.match(/[^\s()]+/);
  return m ? m[0] : '';
}

/**
 * 判断片段是否为真正的 SQL 语句：剥离注释后，首个 token（大小写不敏感）命中白名单。
 */
function isSqlStatement(s: string): boolean {
  const cleaned = stripComments(s);
  if (!cleaned) return false;
  return SQL_KEYWORDS.has(firstToken(cleaned).toUpperCase());
}

/**
 * 从拆分后的语句列表中剔除「纯自然语言解释」片段，保留真正的 SQL。
 *
 * - 首 token 命中关键字 → 视为真实 SQL，整条保留（保留多行写法），仅清洗注释。
 * - 首 token 非关键字 → 可能为纯解释，或解释与 SQL 混排；逐行再萃取首 token
 *   命中关键字的 SQL 行（解释行被忽略），避免误删合法 SQL。
 */
function filterSqlStatements(rawStmts: string[]): string[] {
  const out: string[] = [];
  for (const s of rawStmts) {
    if (isSqlStatement(s)) {
      out.push(stripComments(s));
    } else {
      for (const line of s.split('\n')) {
        if (isSqlStatement(line)) out.push(stripComments(line));
      }
    }
  }
  return out;
}

/**
 * 生成 SQL。
 * @param conn 当前连接记录（用于拉取表结构上下文）
 * @param prompt 用户自然语言需求
 */
export async function generate(
  conn: ConnectionRecord | null,
  prompt: string
): Promise<AiGenerateRes> {
  const settings = getSettings();
  if (!settings.enabled) {
    throw new AppError(50003, 'AI 功能未启用，请先在设置中开启并配置接口。');
  }
  if (!settings.baseUrl || !settings.model || !settings.apiKeyEnc) {
    throw new AppError(
      50003,
      'AI 接口配置不完整，请在设置中填写 base URL / API Key / 模型。'
    );
  }

  const apiKey = decryptApiKey();
  const ddl = conn
    ? await getDdlContext(conn)
    : '-- (未选择数据库连接，请基于通用 SQL 语法生成)';
  const userContent = `${ddl}\n\n需求：${prompt}`;

  const baseUrl = settings.baseUrl.replace(/\/$/, '');
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), AI_TIMEOUT_MS);

  let raw = '';
  try {
    const resp = await fetch(`${baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: settings.model,
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          { role: 'user', content: userContent },
        ],
      }),
      signal: controller.signal,
    });

    if (!resp.ok) {
      const text = await resp.text().catch(() => '');
      throw new AppError(50003, `AI 接口返回 ${resp.status}: ${text.slice(0, 200)}`);
    }

    const text = await resp.text();
    let json: { choices?: { message?: { content?: string } }[] };
    try {
      json = JSON.parse(text) as typeof json;
    } catch {
      const looksHtml = /^\s*<(!doctype|html)/i.test(text);
      throw new AppError(
        50003,
        looksHtml
          ? 'AI 接口返回的是网页而非 JSON（疑似 Base URL 地址错误，请确认是否包含 /v1 路径，例如 https://<域名>/v1）'
          : `AI 接口返回非 JSON 内容（HTTP ${resp.status}），请检查 Base URL 与接口地址`
      );
    }
    raw = json.choices?.[0]?.message?.content ?? '';
  } catch (err) {
    if ((err as Error).name === 'AbortError') {
      throw new AppError(50003, 'AI 调用超时（>30s）');
    }
    if (err instanceof AppError) throw err;
    throw new AppError(50003, `AI 调用失败: ${(err as Error).message}`);
  } finally {
    clearTimeout(timer);
  }

  // 主理人决策 #5：纯解释无 SQL → 返回 statements:[]，不抛 50003（友好提示由路由经 message 返回）
  // 过滤掉模型返回的「纯自然语言解释」片段：真实 SQL 首 token 必为白名单关键字之一，
  // 纯解释会被剔除；若 raw 非空但最终 statements 为空，仍返回 []（路由层给友好 message），此处不抛错。
  const statements = filterSqlStatements(splitStatements(raw));
  return { statements, model: settings.model };
}
