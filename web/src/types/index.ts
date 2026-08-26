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

/** 导出单条：默认含密文 passwordEnc；plain 模式含明文 password 且不含 passwordEnc。 */
export type ConnectionExportItem = Omit<ConnectionInput, 'password'> & {
  id: string;
  createdAt: string;
  updatedAt: string;
  passwordEnc?: string;
  password?: string;
};
export interface ConnectionExport {
  version: number;
  exportedAt: string;
  connections: ConnectionExportItem[];
}
/** 导入单条：二选一提供 passwordEnc（密文）或 password（明文）。 */
export interface ConnectionImportItem {
  name: string;
  type: DbType;
  host: string;
  port: number;
  database: string;
  username: string;
  passwordEnc?: string;
  password?: string;
}
export type ImportConflictStrategy = 'skip' | 'overwrite' | 'rename';
export interface ConnectionImportReq {
  connections: ConnectionImportItem[];
  onConflict?: ImportConflictStrategy;
}
export interface ConnectionImportError {
  name: string;
  error: string;
}
export interface ConnectionImportResult {
  imported: number;
  skipped: number;
  overwritten: number;
  renamed: number;
  errors: ConnectionImportError[];
}

/** 表内单列的元信息（与后端 schemaService 对齐）。 */
export interface ColumnInfo {
  name: string;
  dataType: string;
  nullable: boolean;
  comment: string;
}

/** 单张表的结构化元信息（含列清单）。 */
export interface TableInfo {
  name: string;
  comment: string;
  columns: ColumnInfo[];
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
  connectionId?: string; // 可选：提供则带上该库表结构；不提供则纯自然语言生成
  prompt: string;
}

export interface AiGenerateRes {
  statements: string[];
  model: string;
}

/** 多语句执行请求（与 QueryExecReq 同形）。 */
export interface MultiExecReq {
  connectionId: string;
  sql: string;
  limit?: boolean;
  limitValue?: number;
  unlimited?: boolean;
}

/** 多语句执行——单条结果（成功含 result，失败含 error）。 */
export interface MultiExecStatement {
  sql: string;
  result?: QueryResult;
  error?: string;
}

/** 多语句执行——聚合结果（错误已隔离在 statements[].error，顶层整体成功）。 */
export interface MultiExecResult {
  statements: MultiExecStatement[];
  successCount: number;
  errorCount: number;
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
