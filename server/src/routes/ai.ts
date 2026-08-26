/**
 * AI 生成 SQL 路由（P0-3 / P0-5）。
 * POST /api/ai/generate  {connectionId, prompt} → {sql, model}
 *
 * 注意：本接口仅返回生成的 SQL，绝不自动执行（满足 P0-5）。
 */
import { Router } from 'express';
import { z } from 'zod';
import { validate, ok, asyncHandler } from '../utils/response.js';
import { connectionService } from '../services/connectionService.js';
import { generate } from '../services/aiService.js';

const router = Router();

const schema = z.object({
  connectionId: z.string().min(1).optional(),
  prompt: z.string().min(1, '需求描述不能为空'),
});

router.post('/generate', asyncHandler(async (req, res) => {
  const body = validate(schema, req.body);
  const connRecord = body.connectionId
    ? connectionService.getRecordById(body.connectionId)
    : null;
  const result = await generate(connRecord, body.prompt);
  // 主理人决策 #5：纯解释无 SQL → 返回 code:0 + 友好 message（不走 50003）
  if (result.statements.length === 0) {
    ok(res, result, 'AI 未返回可执行的 SQL，请调整需求后重试');
  } else {
    ok(res, result);
  }
}));

export default router;
