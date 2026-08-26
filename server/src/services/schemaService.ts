/**
 * 表结构上下文服务（DDL 上下文，仅结构、无数据行）。
 *
 * 从 `information_schema` 读取当前库的表 / 列 / 类型 / 注释，拼装为文本，
 * 作为 AI 生成 SQL 的上下文。同时导出 `getTableList` 供前端表清单使用。
 * MySQL 与 PostgreSQL 各自适配查询。
 *
 * 错误约定：
 * - 建连失败（超时 / 拒绝 / 账号错等）抛出 `AppError(50001)`；
 * - 其他未预期异常抛出 `AppError(50004)`；
 * - `getDdlContext` 为兜底入口，读取失败时返回占位文本（不阻断 AI 流程）。
 */
import { decrypt } from './cryptoService.js';
import { AppError } from '../utils/response.js';
import type { ConnectionRecord, ColumnInfo, TableInfo } from '../models/types.js';

/** 已知「建连 / 鉴权 / 库不存在」类错误码（mysql2 与 pg 各自集合）。 */
const CONNECTION_ERROR_CODES = new Set<string>([
  // 网络 / 超时类
  'ECONNREFUSED',
  'ETIMEDOUT',
  'ENOTFOUND',
  'EHOSTUNREACH',
  'EAI_AGAIN',
  // MySQL 鉴权 / 权限 / 库类
  'ER_ACCESS_DENIED_ERROR',
  'ER_DBACCESS_DENIED_ERROR',
  'ER_BAD_DB_ERROR',
  'PROTOCOL_CONNECTION_LOST',
  'PROTOCOL_SEQUENCE_TIMEOUT',
  // PostgreSQL 鉴权 / 库类
  '28P01', // password authentication failed
  '28000', // invalid authorization specification
  '3D000', // invalid_catalog_name（database does not exist）
  '08006', // connection failure
  '08001', // unable to connect
  '08004', // server rejected connection
  '57P01', // admin shutdown
  'XX000', // internal error（部分驱动连接期）
]);

/**
 * 判断异常是否属于「建连失败」范畴，据此映射到 50001 / 50004。
 */
function isConnectionError(err: unknown): boolean {
  const e = err as { code?: string; message?: string } | null;
  if (e?.code && CONNECTION_ERROR_CODES.has(e.code)) return true;
  const msg = (e?.message ?? '').toLowerCase();
  return /econnrefused|etimedout|enotfound|connect|timeout|timed out|authentication|access denied|does not exist|password/i.test(
    msg
  );
}

/** 将 information_schema 行（含 table_name / column_* 字段）分组为 TableInfo[]。 */
function rowsToTables(rows: Array<Record<string, unknown>>): TableInfo[] {
  const byTable = new Map<string, TableInfo>();
  for (const r of rows) {
    const name = String(r.table_name ?? '');
    if (!name) continue;
    let table = byTable.get(name);
    if (!table) {
      table = { name, comment: String(r.table_comment ?? ''), columns: [] };
      byTable.set(name, table);
    }
    const column: ColumnInfo = {
      name: String(r.column_name ?? ''),
      dataType: String(r.column_type ?? ''),
      nullable: String(r.is_nullable ?? 'NO').toUpperCase() === 'YES',
      comment: String(r.column_comment ?? ''),
    };
    table.columns.push(column);
  }
  return Array.from(byTable.values());
}

/** 读取 MySQL 表结构，返回结构化表清单（仅 BASE TABLE）。 */
async function readMysql(conn: ConnectionRecord): Promise<TableInfo[]> {
  const mysql = await import('mysql2/promise');
  const password = decrypt(conn.passwordEnc);
  const connection = await mysql.createConnection({
    host: conn.host,
    port: conn.port,
    user: conn.username,
    password,
    database: conn.database,
    connectTimeout: 8000,
  });
  try {
    const [rows] = await connection.query(
      `SELECT t.TABLE_NAME AS table_name,
              COALESCE(t.TABLE_COMMENT, '') AS table_comment,
              c.COLUMN_NAME AS column_name,
              c.COLUMN_TYPE AS column_type,
              COALESCE(c.COLUMN_COMMENT, '') AS column_comment,
              c.IS_NULLABLE AS is_nullable
       FROM information_schema.TABLES t
       JOIN information_schema.COLUMNS c
         ON c.TABLE_SCHEMA = t.TABLE_SCHEMA AND c.TABLE_NAME = t.TABLE_NAME
       WHERE t.TABLE_SCHEMA = ? AND t.TABLE_TYPE = 'BASE TABLE'
       ORDER BY t.TABLE_NAME, c.ORDINAL_POSITION`,
      [conn.database]
    );
    return rowsToTables(rows as Array<Record<string, unknown>>);
  } finally {
    await connection.end();
  }
}

/** 读取 PostgreSQL 表结构（public schema），返回结构化表清单。 */
async function readPg(conn: ConnectionRecord): Promise<TableInfo[]> {
  const pg = await import('pg');
  const { Client } = pg;
  const password = decrypt(conn.passwordEnc);
  const client = new Client({
    host: conn.host,
    port: conn.port,
    user: conn.username,
    password,
    database: conn.database,
    connectionTimeoutMillis: 8000,
  });
  await client.connect();
  try {
    const res = await client.query(
      `SELECT c.table_name AS table_name,
              COALESCE(td.description, '') AS table_comment,
              c.column_name AS column_name,
              c.data_type AS column_type,
              COALESCE(d.description, '') AS column_comment,
              c.is_nullable AS is_nullable
       FROM information_schema.columns c
       LEFT JOIN pg_catalog.pg_class cl
         ON cl.relname = c.table_name AND cl.relkind = 'r'
       LEFT JOIN pg_catalog.pg_namespace n
         ON n.oid = cl.relnamespace AND n.nspname = c.table_schema
       LEFT JOIN pg_catalog.pg_description d
         ON d.objoid = cl.oid AND d.objsubid = c.ordinal_position
       LEFT JOIN pg_catalog.pg_description td
         ON td.objoid = cl.oid AND td.objsubid = 0
       WHERE c.table_schema = 'public'
       ORDER BY c.table_name, c.ordinal_position`
    );
    return rowsToTables(res.rows as Array<Record<string, unknown>>);
  } finally {
    await client.end();
  }
}

/** 将 TableInfo[] 拼装为 DDL 上下文文本。 */
function buildContext(tables: TableInfo[]): string {
  if (tables.length === 0) {
    return '-- (当前数据库无可读取的表结构，请基于通用 SQL 语法生成)';
  }
  const lines: string[] = [];
  for (const t of tables) {
    const tableLabel = t.comment ? `${t.name}（${t.comment}）` : t.name;
    lines.push(`表 ${tableLabel}:`);
    for (const c of t.columns) {
      const nullHint = c.nullable ? ' 可空' : ' 非空';
      const comment = c.comment ? ` 注释:${c.comment}` : '';
      lines.push(`  - ${c.name} ${c.dataType}${nullHint}${comment}`);
    }
  }
  return lines.join('\n');
}

/**
 * 读取指定连接的结构化表清单。
 * 建连失败抛 50001，其他异常抛 50004（均不静默吞掉）。
 */
export async function getTableList(conn: ConnectionRecord): Promise<TableInfo[]> {
  try {
    const tables = conn.type === 'mysql' ? await readMysql(conn) : await readPg(conn);
    return tables;
  } catch (err) {
    const msg = (err as Error).message;
    if (err instanceof AppError) throw err;
    if (isConnectionError(err)) {
      throw new AppError(50001, `读取表结构失败: ${msg}`);
    }
    throw new AppError(50004, `读取表结构失败: ${msg}`);
  }
}

/**
 * 获取指定连接的 DDL 上下文文本（供 AI 生成 SQL）。
 * 复用 getTableList；读取失败时返回兜底文本（不抛出异常，保证 AI 仍可生成）。
 */
export async function getDdlContext(conn: ConnectionRecord): Promise<string> {
  try {
    const tables = await getTableList(conn);
    return buildContext(tables);
  } catch (err) {
    console.warn(
      `[schema] 读取表结构失败(${conn.name}): ${(err as Error).message}`
    );
    return '-- (无法读取表结构，请基于通用 SQL 语法生成)';
  }
}
