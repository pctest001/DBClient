/**
 * AI 接口配置路由（P1-3）。
 * GET    /api/settings/ai        → AiSettingsPublic（含 hasKey，不回传密文）
 * PUT    /api/settings/ai        → 保存（明文 Key 加密存储）
 * POST   /api/settings/ai/test   → 连通性测试（使用入参明文 Key）
 */
import { Router } from 'express';
import { z } from 'zod';
import { validate, ok, asyncHandler } from '../utils/response.js';
import {
  getPublic,
  saveSettings,
  testSettings,
} from '../services/settingsService.js';

const router = Router();

const schema = z.object({
  baseUrl: z.string().min(1, 'base URL 必填'),
  apiKey: z.string(),
  model: z.string().min(1, '模型名必填'),
  enabled: z.boolean(),
});

router.get('/ai', (_req, res) => {
  ok(res, getPublic());
});

router.put('/ai', asyncHandler(async (req, res) => {
  const parsed = validate(schema, req.body);
  ok(res, saveSettings(parsed));
}));

router.post('/ai/test', asyncHandler(async (req, res) => {
  const parsed = validate(schema, req.body);
  const result = await testSettings(parsed);
  ok(res, result);
}));

export default router;
