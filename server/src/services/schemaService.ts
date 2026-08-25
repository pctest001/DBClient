/**
 * 表结构上下文服务（DDL 上下文，仅结构、无数据行）。
 *
 * 从 `information_schema` 读取当前库的表 / 列 / 类型 / 注释，拼装为文本，
 * 作为 AI 生成 SQL 的上下文。MySQL 与 PostgreSQL 各自适配查询。
 * 读取失败时返回兜底文本（不阻断 AI 流程）。
 */
import { decrypt } from './cryptoService.js';
import type { ConnectionRecord } from '../models/types.js';

interface ColumnMeta {
  table: string;
  column: string;
  type: string;
  nullable: string;
  comment: string;
}

/** 读取 MySQL 表结构。 */
async function readMysql(conn: ConnectionRecord): Promise<ColumnMeta[]> {
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
      `SELECT TABLE_NAME, COLUMN_NAME, COLUMN_TYPE, COLUMN_COMMENT, IS_NULLABLE
       FROM information_schema.COLUMNS
       WHERE TABLE_SCHEMA = ?
       ORDER BY TABLE_NAME, ORDINAL_POSITION`,
      [conn.database]
    );
    return (rows as any[]).map((r) => ({
      table: r.TABLE_NAME,
      column: r.COLUMN_NAME,
      type: r.COLUMN_TYPE,
      nullable: r.IS_NULLABLE,
      comment: r.COLUMN_COMMENT ?? '',
    }));
  } finally {
    await connection.end();
  }
}

/** 读取 PostgreSQL 表结构。 */
async function readPg(conn: ConnectionRecord): Promise<ColumnMeta[]> {
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
      `SELECT c.table_name,
              c.column_name,
              c.data_type,
              c.is_nullable,
              COALESCE(d.description, '') AS column_comment
       FROM information_schema.columns c
       LEFT JOIN pg_catalog.pg_class cl
         ON cl.relname = c.table_name AND cl.relkind = 'r'
       LEFT JOIN pg_catalog.pg_namespace n
         ON n.oid = cl.relnamespace AND n.nspname = c.table_schema
       LEFT JOIN pg_catalog.pg_description d
         ON d.objoid = cl.oid AND d.objsubid = c.ordinal_position
       WHERE c.table_schema = 'public'
       ORDER BY c.table_name, c.ordinal_position`
    );
    return res.rows.map((r: any) => ({
      table: r.table_name,
      column: r.column_name,
      type: r.data_type,
      nullable: r.is_nullable,
      comment: r.column_comment ?? '',
    }));
  } finally {
    await client.end();
  }
}

/** 将列元信息拼装为 DDL 上下文文本。 */
function buildContext(metas: ColumnMeta[]): string {
  if (metas.length === 0) {
    return '-- (当前数据库无可读取的表结构，请基于通用 SQL 语法生成)';
  }
  const byTable = new Map<string, ColumnMeta[]>();
  for (const m of metas) {
    if (!byTable.has(m.table)) byTable.set(m.table, []);
    byTable.get(m.table)!.push(m);
  }
  const lines: string[] = [];
  for (const [table, cols] of byTable) {
    lines.push(`表 ${table}:`);
    for (const c of cols) {
      const nullHint = c.nullable === 'YES' ? ' 可空' : ' 非空';
      const comment = c.comment ? ` 注释:${c.comment}` : '';
      lines.push(`  - ${c.column} ${c.type}${nullHint}${comment}`);
    }
  }
  return lines.join('\n');
}

/**
 * 获取指定连接的 DDL 上下文文本。
 * 读取失败时返回兜底文本（不抛出异常，保证 AI 仍可基于用户需求生成）。
 */
export async function getDdlContext(conn: ConnectionRecord): Promise<string> {
  try {
    const metas =
      conn.type === 'mysql' ? await readMysql(conn) : await readPg(conn);
    return buildContext(metas);
  } catch (err) {
    console.warn(
      `[schema] 读取表结构失败(${conn.name}): ${(err as Error).message}`
    );
    return '-- (无法读取表结构，请基于通用 SQL 语法生成)';
  }
}
