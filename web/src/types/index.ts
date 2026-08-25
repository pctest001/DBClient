/**
 * 前端共享类型定义（与后端 server/src/models/types.ts 字段对齐）。
 */

export type DbType = 'mysql' | 'postgres';

/** 创建 / 测试连接入参（密码为明文，仅在请求体中出现）。 */
export interface ConnectionInput {
  name: string;
  type: DbType;
  host: string;
  port: number;
  database: string;
  username: string;
  password: string;
}

/** 对外连接信息（不含密码）。 */
export type ConnectionPublic = Omit<ConnectionInput, 'password'> & {
  id: string;
  createdAt: string;
  updatedAt: string;
};

export interface ConnectionTestRes {
  ok: boolean;
  message: string;
  latencyMs: number | null;
}

export interface AiSettingsInput {
  baseUrl: string;
  apiKey: string;
  model: string;
  enabled: boolean;
}

export type AiSettingsPublic = Omit<AiSettingsInput, 'apiKey'> & {
  hasKey: boolean;
};

export interface QueryExecReq {
  connectionId: string;
  sql: string;
  limit?: boolean;
  limitValue?: number;
  unlimited?: boolean;
}

export interface QueryResult {
  columns: string[];
  rows: Record<string, unknown>[];
  rowCount: number;
  elapsedMs: number;
  truncated: boolean;
  appliedLimit: number | null;
}

export interface AiGenerateReq {
  connectionId: string;
  prompt: string;
}

export interface AiGenerateRes {
  sql: string;
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
