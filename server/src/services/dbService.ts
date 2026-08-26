/**
 * 数据库驱动服务：建连 + 执行 SQL（mysql2 / pg）。
 *
 * - 每次调用均为短生命周期连接（执行后关闭），避免连接泄漏。
 * - 密码在 `ConnectionRecord.passwordEnc` 中，执行前经 `decrypt` 还原为内存明文。
 * - LIMIT 策略：默认对单行 SELECT 且无已有 LIMIT 时追加 `LIMIT {limitValue||1000}`，
 *   标记 `truncated=true`、`appliedLimit`。
 * - 错误按领域错误码抛出：建连失败 50001，SQL 执行失败 50002。
 */
import mysql from 'mysql2/promise';
import pg from 'pg';
import { decrypt } from './cryptoService.js';
import { AppError } from '../utils/response.js';
import type {
  ConnectionInput,
  ConnectionRecord,
  ConnectionTestRes,
  QueryResult,
  MultiExecResult,
  MultiExecStatement,
} from '../models/types.js';
import { splitStatements } from '../utils/sqlSplit.js';

const { Client } = pg;
const DEFAULT_LIMIT = 1000;
const CONNECT_TIMEOUT_MS = 8000;

interface ExecuteOptions {
  limit?: boolean;
  limitValue?: number;
  unlimited?: boolean;
}

/** 构造 mysql2 连接参数。 */
function mysqlConfig(input: ConnectionInput): mysql.PoolOptions {
  return {
    host: input.host,
    port: input.port,
    user: input.username,
    password: input.password,
    database: input.database,
    connectTimeout: CONNECT_TIMEOUT_MS,
    multipleStatements: false,
  };
}

/** 构造 pg 连接参数。 */
function pgConfig(input: ConnectionInput): pg.ClientConfig {
  return {
    host: input.host,
    port: input.port,
    user: input.username,
    password: input.password,
    database: input.database,
    connectionTimeoutMillis: CONNECT_TIMEOUT_MS,
  };
}

/** 测试数据库连接（建连 + SELECT 1）。失败抛 50001。 */
export async function testConnection(
  input: ConnectionInput
): Promise<ConnectionTestRes> {
  const start = Date.now();
  try {
    if (input.type === 'mysql') {
      const conn = await mysql.createConnection(mysqlConfig(input));
      try {
        await conn.query('SELECT 1');
      } finally {
        await conn.end();
      }
    } else {
      const client = new Client(pgConfig(input));
      await client.connect();
      try {
        await client.query('SELECT 1');
      } finally {
        await client.end();
      }
    }
    return { ok: true, message: '连接成功', latencyMs: Date.now() - start };
  } catch (err) {
    throw new AppError(50001, `数据库连接失败: ${(err as Error).message}`);
  }
}

/** 判断是否需要追加 LIMIT（单行 SELECT 且无已有 LIMIT，且未被显式关闭）。 */
function shouldApplyLimit(sql: string, opts: ExecuteOptions): boolean {
  if (opts.unlimited === true) return false;
  if (opts.limit === false) return false;
  const trimmed = sql.trim().replace(/;\s*$/, '');
  if (!/^select\s/i.test(trimmed)) return false;
  if (/\blimit\s+/i.test(trimmed)) return false;
  if (trimmed.includes(';')) return false; // 多语句不处理
  return true;
}

/** 对结果做统一格式化（MySQL）。 */
function formatMysql(
  rows: unknown,
  fields: mysql.FieldPacket[] | undefined,
  start: number,
  appliedLimit: number | null
): QueryResult {
  if (Array.isArray(rows)) {
    const columns = fields
      ? fields.map((f) => f.name)
      : rows[0]
        ? Object.keys(rows[0] as Record<string, unknown>)
        : [];
    const arr = rows as Record<string, unknown>[];
    return {
      columns,
      rows: arr,
      rowCount: arr.length,
      elapsedMs: Date.now() - start,
      truncated: appliedLimit !== null,
      appliedLimit,
    };
  }
  // ResultSetHeader（非 SELECT 语句）
  const header = rows as mysql.ResultSetHeader;
  return {
    columns: ['affectedRows', 'insertId', 'warningStatus'],
    rows: [
      {
        affectedRows: header.affectedRows ?? 0,
        insertId: header.insertId ?? 0,
        warningStatus: header.warningStatus ?? 0,
      },
    ],
    rowCount: header.affectedRows ?? 0,
    elapsedMs: Date.now() - start,
    truncated: false,
    appliedLimit: null,
  };
}

/** 对结果做统一格式化（PostgreSQL）。 */
function formatPg(
  res: pg.QueryResult,
  start: number,
  appliedLimit: number | null
): QueryResult {
  const columns = res.fields
    ? res.fields.map((f) => f.name)
    : res.rows[0]
      ? Object.keys(res.rows[0])
      : [];
  return {
    columns,
    rows: res.rows,
    rowCount: res.rowCount ?? res.rows.length,
    elapsedMs: Date.now() - start,
    truncated: appliedLimit !== null,
    appliedLimit,
  };
}

/**
 * 执行 SQL 并返回统一结果。
 * @param conn 解密后使用的连接记录（含密文密码，内部 decrypt）
 */
export async function execute(
  conn: ConnectionRecord,
  sql: string,
  opts: ExecuteOptions = {}
): Promise<QueryResult> {
  const password = decrypt(conn.passwordEnc);
  const input: ConnectionInput = {
    name: conn.name,
    type: conn.type,
    host: conn.host,
    port: conn.port,
    database: conn.database,
    username: conn.username,
    password,
  };

  const limitValue =
    opts.limitValue && opts.limitValue > 0 ? opts.limitValue : DEFAULT_LIMIT;

  let finalSql = sql;
  let appliedLimit: number | null = null;
  if (shouldApplyLimit(sql, opts)) {
    finalSql = `${sql.trim().replace(/;\s*$/, '')} LIMIT ${limitValue}`;
    appliedLimit = limitValue;
  }

  const start = Date.now();
  try {
    if (conn.type === 'mysql') {
      const connection = await mysql.createConnection(mysqlConfig(input));
      try {
        const [rows, fields] = await connection.query(finalSql);
        return formatMysql(rows, fields as mysql.FieldPacket[], start, appliedLimit);
      } finally {
        await connection.end();
      }
    } else {
      const client = new Client(pgConfig(input));
      await client.connect();
      try {
        const res = await client.query(finalSql);
        return formatPg(res, start, appliedLimit);
      } finally {
        await client.end();
      }
    }
  } catch (err) {
    throw new AppError(50002, `SQL 执行失败: ${(err as Error).message}`);
  }
}

/**
 * 多语句执行（增量迭代）：将整段 SQL 拆分为多条，逐条独立执行（复用 execute）。
 *
 * - 每条语句独立 try/catch，单条失败（含 50002 SQL 错误）不阻断其余语句；
 *   失败信息写入该条 `error`（仅业务信息，无凭据/密文）。
 * - 每条 SELECT 各自经 `execute` 内的 `shouldApplyLimit` 独立追加 `LIMIT 1000`。
 * - 顶层调用方据此聚合，整体返回 `MultiExecResult`（error 隔离在 statements 内，
 *   仅连接不存在 40401 等由 errorHandler 上升为外层错误）。
 */
export async function executeMulti(
  conn: ConnectionRecord,
  sql: string,
  opts: ExecuteOptions = {}
): Promise<MultiExecResult> {
  const statements = splitStatements(sql);
  const results: MultiExecStatement[] = [];
  for (let idx = 0; idx < statements.length; idx++) {
    const s = statements[idx].trim();
    if (!s) continue;
    try {
      const result = await execute(conn, s, opts);
      results.push({ sql: s, result });
    } catch (err) {
      results.push({ sql: s, error: (err as Error).message });
    }
  }
  return {
    statements: results,
    successCount: results.filter((r) => !r.error).length,
    errorCount: results.filter((r) => !!r.error).length,
  };
}
