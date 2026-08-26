/**
 * 共享 TS 类型 / 接口定义（后端 models）。
 * 前端在 `web/src/types` 中保持字段对齐。
 */

export type DbType = 'mysql' | 'postgres';

/** 创建 / 测试连接时的入参（密码为明文，来自请求体，仅内存使用）。 */
export interface ConnectionInput {
  name: string;
  type: DbType;
  host: string;
  port: number;
  database: string;
  username: string;
  password: string;
}

/** 持久化记录：密码以密文存储。 */
export interface ConnectionRecord {
  id: string;
  name: string;
  type: DbType;
  host: string;
  port: number;
  database: string;
  username: string;
  passwordEnc: string; // AES-256-GCM 密文（base64）
  createdAt: string; // ISO8601
  updatedAt: string;
}

/** 返回给前端的连接信息（剔除密码字段）。 */
export type ConnectionPublic = Omit<ConnectionRecord, 'passwordEnc'>;

export interface ConnectionTestReq extends ConnectionInput {}
export interface ConnectionTestRes {
  ok: boolean;
  message: string;
  latencyMs: number | null;
}

export interface AiSettingsInput {
  baseUrl: string; // 如 https://api.openai.com/v1
  apiKey: string; // 明文，落盘加密
  model: string; // 如 gpt-4o / qwen-plus / ollama/llama3
  enabled: boolean;
}

export interface AiSettingsRecord {
  baseUrl: string;
  apiKeyEnc: string; // 密文
  model: string;
  enabled: boolean;
  updatedAt: string;
}

/** 对外公开结构：不含密文，hasKey 指示是否已配置 Key。 */
export interface AiSettingsPublic {
  baseUrl: string;
  model: string;
  enabled: boolean;
  hasKey: boolean;
}

export interface QueryExecReq {
  connectionId: string;
  sql: string; // 整段或选中文本
  limit: boolean; // 默认 true（追加 LIMIT 1000）
  limitValue?: number; // 默认 1000
  unlimited?: boolean; // true 时忽略 limit（「取消限制」开关）
}

export interface QueryResult {
  columns: string[];
  rows: Record<string, unknown>[];
  rowCount: number;
  elapsedMs: number;
  truncated: boolean; // 命中 LIMIT 时为 true
  appliedLimit: number | null;
}

export interface AiGenerateReq {
  connectionId?: string; // 可选：提供则带上该库表结构作上下文；不提供则纯自然语言生成
  prompt: string;
}

export interface AiGenerateRes {
  sql: string; // 仅 SQL，已去除 markdown 围栏
  model: string;
}

export interface HistoryItem {
  id: string;
  connectionId: string;
  connectionName: string;
  sql: string;
  status: 'success' | 'error';
  rowCount: number | null;
  elapsedMs: number | null;
  error: string | null;
  executedAt: string;
}

/** 统一响应结构。 */
export interface ApiResponse<T> {
  code: number;
  data: T | null;
  message: string;
}
