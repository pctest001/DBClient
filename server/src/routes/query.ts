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
import { execute } from '../services/dbService.js';
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

export default router;
