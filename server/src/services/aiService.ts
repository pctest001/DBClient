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

const AI_TIMEOUT_MS = 30000;

const SYSTEM_PROMPT = `你是资深 SQL 工程师。下面是被查询数据库的表结构（DDL，仅含表名/列名/类型/注释，不含任何数据行）。
请根据用户需求生成【一条】可执行的 SQL。只输出 SQL 本身，不要解释，不要使用 markdown 代码块围栏。`;

/** 剥离模型返回中的 ```sql ... ``` 围栏与语言标识。 */
function stripFences(text: string): string {
  let s = (text ?? '').trim();
  const fenced = /^```(?:sql)?\s*([\s\S]*?)\s*```$/i.exec(s);
  if (fenced) s = fenced[1].trim();
  s = s.replace(/^```(?:sql)?\s*/i, '').replace(/\s*```$/i, '').trim();
  return s;
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

  const sql = stripFences(raw);
  if (!sql) {
    throw new AppError(50003, 'AI 未返回有效 SQL，请调整需求后重试。');
  }
  return { sql, model: settings.model };
}
