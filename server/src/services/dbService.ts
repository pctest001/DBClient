/**
 * 数据库驱动服务：建连 + 执行 SQL（mysql2 / pg）。
 *
 * - 每次调用均为短生命周期连接（执行后关闭），避免连接泄漏。
 * - 密码在 `ConnectionRecord.passwordEnc` 中，执行前经 `decrypt` 还原为内存明文。
 * - LIMIT 策略：默认对单行 SELECT 且无已有 LIMIT 时追加 `LIMIT {limitValue||1000}`，
 *   标记 `truncated=true`、`appliedLimit`。
 * - 错误按领域错误码抛出：建连失败 50001，SQL 执行失败 50002。
 * - 多语句执行支持两种模式（增量 P2-2）：默认「错误隔离」（每条语句各建短连接、
 *   单条失败不阻断）；`transaction: true` 时为「事务模式」——只建一次连接全程复用，
 *   任一语句失败立即回滚并停止后续语句（见 executeMultiInTransaction）。
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
  transaction?: boolean; // 事务模式（增量 P2-2）：true 时整批在单一连接上以事务执行
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

/** 解密密码并构造 ConnectionInput（execute / 事务路径共用）。 */
function toInput(conn: ConnectionRecord): ConnectionInput {
  const password = decrypt(conn.passwordEnc);
  return {
    name: conn.name,
    type: conn.type,
    host: conn.host,
    port: conn.port,
    database: conn.database,
    username: conn.username,
    password,
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

/**
 * 依据 LIMIT 策略计算最终 SQL 与实际应用的 limit 值
 * （execute 单语句路径与事务路径共用，保证两侧行为一致）。
 */
function applyLimitClause(
  sql: string,
  opts: ExecuteOptions
): { finalSql: string; appliedLimit: number | null } {
  const limitValue =
    opts.limitValue && opts.limitValue > 0 ? opts.limitValue : DEFAULT_LIMIT;
  if (shouldApplyLimit(sql, opts)) {
    return {
      finalSql: `${sql.trim().replace(/;\s*$/, '')} LIMIT ${limitValue}`,
      appliedLimit: limitValue,
    };
  }
  return { finalSql: sql, appliedLimit: null };
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
  const input = toInput(conn);
  const { finalSql, appliedLimit } = applyLimitClause(sql, opts);

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

/** 在已有 mysql 连接上执行单条语句（LIMIT 追加 + 统一格式化），失败抛原始驱动错误。 */
async function executeOneOnMysql(
  connection: mysql.Connection,
  sql: string,
  opts: ExecuteOptions,
  start: number
): Promise<QueryResult> {
  const { finalSql, appliedLimit } = applyLimitClause(sql, opts);
  const [rows, fields] = await connection.query(finalSql);
  return formatMysql(rows, fields as mysql.FieldPacket[], start, appliedLimit);
}

/** 在已有 pg 客户端上执行单条语句（LIMIT 追加 + 统一格式化），失败抛原始驱动错误。 */
async function executeOneOnPg(
  client: pg.Client,
  sql: string,
  opts: ExecuteOptions,
  start: number
): Promise<QueryResult> {
  const { finalSql, appliedLimit } = applyLimitClause(sql, opts);
  const res = await client.query(finalSql);
  return formatPg(res, start, appliedLimit);
}

/** 事务连接句柄：抹平 mysql / pg 的事务操作差异，供事务路径统一调用。 */
interface TxHandle {
  /** 在该连接上执行单条语句（含 LIMIT 追加与格式化）。 */
  runOne: (sql: string) => Promise<QueryResult>;
  /** 提交事务。 */
  commit: () => Promise<void>;
  /** 回滚事务。 */
  rollback: () => Promise<void>;
  /** 关闭连接（事务模式下全程唯一连接，最终必须关闭）。 */
  close: () => Promise<void>;
}

/**
 * 建立事务连接（增量 P2-2）：只建一次连接并开启事务，全程复用同一连接。
 *
 * - mysql2：createConnection → beginTransaction；
 *   pg：new Client → connect → query('BEGIN')。
 * - 建连 / 开启事务失败统一抛 50001；失败时尽力关闭已建立的连接。
 */
async function openTransaction(
  conn: ConnectionRecord,
  opts: ExecuteOptions
): Promise<TxHandle> {
  const input = toInput(conn);
  let handle: TxHandle | undefined;
  try {
    if (conn.type === 'mysql') {
      const connection = await mysql.createConnection(mysqlConfig(input));
      // 先绑定各操作，确保 beginTransaction 失败时也能在 catch 中关闭连接
      handle = {
        runOne: (sql) => executeOneOnMysql(connection, sql, opts, Date.now()),
        commit: () => connection.commit(),
        rollback: () => connection.rollback(),
        close: () => connection.end(),
      };
      await connection.beginTransaction();
    } else {
      const client = new Client(pgConfig(input));
      handle = {
        runOne: (sql) => executeOneOnPg(client, sql, opts, Date.now()),
        commit: async () => {
          await client.query('COMMIT');
        },
        rollback: async () => {
          await client.query('ROLLBACK');
        },
        close: () => client.end(),
      };
      await client.connect();
      await client.query('BEGIN');
    }
    return handle;
  } catch (err) {
    // 建连 / 开启事务失败：尽力关闭已建立的连接，统一按 50001 上抛
    if (handle) {
      try {
        await handle.close();
      } catch {
        // 忽略关闭失败，避免掩盖原始错误
      }
    }
    throw new AppError(50001, `数据库连接失败: ${(err as Error).message}`);
  }
}

/**
 * 事务模式的多语句执行（增量 P2-2）：只建一次连接，全程复用同一连接。
 *
 * - 与默认「错误隔离」模式语义相反：任一语句失败 → 立即 rollback →
 *   后续语句不再执行 → 返回结果带 rolledBack: true。
 * - 语句级错误捕获后写入该条 `error`（保持与 execute() 一致的 50002 文案），
 *   不上抛到顶层；rollback 自身抛错时吞掉（不能掩盖原始错误），
 *   已产生的语句执行结果照常返回。
 * - 每条 SELECT 独立经 `shouldApplyLimit` 判断追加 `LIMIT 1000`（策略不变）。
 * - 连接最终在 finally 中关闭（无论成败）。
 */
async function executeMultiInTransaction(
  conn: ConnectionRecord,
  statements: string[],
  opts: ExecuteOptions
): Promise<MultiExecResult> {
  const tx = await openTransaction(conn, opts); // 建连失败抛 50001
  const results: MultiExecStatement[] = [];
  let rolledBack = false;
  let finalized = false; // commit 已成功（true 时不再回滚）

  try {
    for (let idx = 0; idx < statements.length; idx++) {
      const s = statements[idx].trim();
      if (!s) continue;
      try {
        const result = await tx.runOne(s);
        results.push({ sql: s, result });
      } catch (err) {
        // 语句级失败：错误写入该条 error，触发整体回滚并停止执行后续语句
        results.push({
          sql: s,
          error: new AppError(50002, `SQL 执行失败: ${(err as Error).message}`)
            .message,
        });
        rolledBack = true;
        break;
      }
    }
    if (!rolledBack) {
      try {
        await tx.commit();
        finalized = true;
      } catch (err) {
        // commit 失败：事务未生效，按 50002 语义上抛（finally 中仍会回滚并关连接）
        throw new AppError(
          50002,
          `SQL 执行失败（COMMIT 阶段）: ${(err as Error).message}`
        );
      }
    }
  } finally {
    if (!finalized) {
      // 语句失败或 commit 未完成：回滚；rollback 自身抛错时吞掉，避免掩盖原始结果
      try {
        await tx.rollback();
      } catch {
        // 忽略回滚自身的异常
      }
    }
    // 无论成败，最终关闭事务连接
    try {
      await tx.close();
    } catch {
      // 忽略关连异常
    }
  }

  return {
    statements: results,
    successCount: results.filter((r) => !r.error).length,
    errorCount: results.filter((r) => !!r.error).length,
    rolledBack,
  };
}

/**
 * 多语句执行（增量迭代）：将整段 SQL 拆分为多条，逐条独立执行（复用 execute）。
 *
 * - 每条语句独立 try/catch，单条失败（含 50002 SQL 错误）不阻断其余语句；
 *   失败信息写入该条 `error`（仅业务信息，无凭据/密文）。
 * - 每条 SELECT 各自经 `execute` 内的 `shouldApplyLimit` 独立追加 `LIMIT 1000`。
 * - 顶层调用方据此聚合，整体返回 `MultiExecResult`（error 隔离在 statements 内，
 *   仅连接不存在 40401 等由 errorHandler 上升为外层错误）。
 * - 事务模式（增量 P2-2）：`opts.transaction === true` 时改走单连接事务路径
 *   `executeMultiInTransaction`（任一语句失败整批回滚）；默认错误隔离行为不变。
 */
export async function executeMulti(
  conn: ConnectionRecord,
  sql: string,
  opts: ExecuteOptions = {}
): Promise<MultiExecResult> {
  const statements = splitStatements(sql);

  // 事务模式：单连接 + BEGIN/COMMIT/ROLLBACK，任一失败全量回滚
  if (opts.transaction === true) {
    return executeMultiInTransaction(conn, statements, opts);
  }

  // 默认（错误隔离模式）：行为与历史版本完全一致
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
