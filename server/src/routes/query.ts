/**
 * SQL 执行路由（P0-2 / P1-5）。
 * POST /api/query/execute  {connectionId, sql, limit, limitValue, unlimited}
 *   → {columns, rows, rowCount, elapsedMs, truncated, appliedLimit}
 *
 * 流程：取连接记录（解密密码）→ 执行（按需追加 LIMIT）→ 记录历史。
 */
import { Router } from 'express';
import { z } from 'zod';
import { validate, ok, asyncHandler } from '../utils/response.js';
import { connectionService } from '../services/connectionService.js';
import { execute, executeMulti } from '../services/dbService.js';
import { historyService } from '../services/historyService.js';

const router = Router();

const schema = z.object({
  connectionId: z.string().min(1, 'connectionId 必填'),
  sql: z.string().min(1, 'SQL 不能为空'),
  limit: z.boolean().default(true),
  limitValue: z.number().int().positive().optional(),
  unlimited: z.boolean().optional(),
});

router.post('/execute', asyncHandler(async (req, res) => {
  const body = validate(schema, req.body);
  const connRecord = connectionService.getRecordById(body.connectionId);
  const start = Date.now();

  try {
    const result = await execute(connRecord, body.sql, {
      limit: body.limit,
      limitValue: body.limitValue,
      unlimited: body.unlimited,
    });

    historyService.add({
      connectionId: connRecord.id,
      connectionName: connRecord.name,
      sql: body.sql,
      status: 'success',
      rowCount: result.rowCount,
      elapsedMs: result.elapsedMs,
      error: null,
      executedAt: new Date().toISOString(),
    });

    ok(res, result);
  } catch (err) {
    historyService.add({
      connectionId: connRecord.id,
      connectionName: connRecord.name,
      sql: body.sql,
      status: 'error',
      rowCount: null,
      elapsedMs: Date.now() - start,
      error: (err as Error).message,
      executedAt: new Date().toISOString(),
    });
    throw err; // 交由 errorHandler 以原错误码返回（如 50002）
  }
}));

const multiSchema = z.object({
  connectionId: z.string().min(1, 'connectionId 必填'),
  sql: z.string().min(1, 'SQL 不能为空'),
  limit: z.boolean().default(true),
  limitValue: z.number().int().positive().optional(),
  unlimited: z.boolean().optional(),
  transaction: z.boolean().optional(), // 事务模式（增量 P2-2）：默认 false（错误隔离）
});

router.post('/execute-multi', asyncHandler(async (req, res) => {
  const body = validate(multiSchema, req.body);
  const connRecord = connectionService.getRecordById(body.connectionId); // 缺失抛 40401
  const start = Date.now();
  const result = await executeMulti(connRecord, body.sql, {
    limit: body.limit,
    limitValue: body.limitValue,
    unlimited: body.unlimited,
    transaction: body.transaction, // 事务模式：单连接 + BEGIN/COMMIT/ROLLBACK
  });
  // 记一条聚合历史（sql 为原始整段；有任一失败即记 error）；
  // 事务回滚时追加明确提示，让用户在历史里看得出该批次变更未生效
  historyService.add({
    connectionId: connRecord.id,
    connectionName: connRecord.name,
    sql: body.sql,
    status: result.errorCount > 0 ? 'error' : 'success',
    rowCount: null,
    elapsedMs: Date.now() - start,
    error:
      result.errorCount > 0
        ? `多语句执行：成功 ${result.successCount} / 失败 ${result.errorCount}${
            result.rolledBack
              ? `（事务已回滚 ${result.successCount} 条，本次执行的所有变更未生效）`
              : ''
          }`
        : null,
    executedAt: new Date().toISOString(),
  });
  // 顶层 code:0；语句级错误已隔离在 result.statements[].error 内（仅 40401 等外层错误上升）
  ok(res, result);
}));

export default router;
