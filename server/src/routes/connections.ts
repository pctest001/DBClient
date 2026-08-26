/**
 * 连接管理路由（P0-1 / P0-4）。
 * GET /api/connections
 * GET /api/connections/:id
 * POST /api/connections
 * PUT /api/connections/:id
 * DELETE /api/connections/:id
 * POST /api/connections/test
 */
import { Router } from 'express';
import { z } from 'zod';
import { connectionService } from '../services/connectionService.js';
import { decrypt } from '../services/cryptoService.js';
import { getTableList } from '../services/schemaService.js';
import { validate, ok, asyncHandler } from '../utils/response.js';
import type { ConnectionInput } from '../models/types.js';

const router = Router();

const inputSchema = z.object({
  name: z.string().min(1, '名称必填'),
  type: z.enum(['mysql', 'postgres']),
  host: z.string().min(1, '主机必填'),
  port: z.number().int().positive('端口必须为正整数'),
  database: z.string().min(1, '数据库名必填'),
  username: z.string().min(1, '用户名必填'),
  password: z.string(),
});

router.get('/', (_req, res) => {
  ok(res, connectionService.list());
});

router.get('/:id', (req, res) => {
  ok(res, connectionService.getById(req.params.id));
});

router.post('/', asyncHandler(async (req, res) => {
  const parsed = validate(inputSchema, req.body);
  ok(res, connectionService.create(parsed));
}));

router.put('/:id', asyncHandler(async (req, res) => {
  const parsed = validate(inputSchema, req.body);
  ok(res, connectionService.update(req.params.id, parsed));
}));

router.delete('/:id', asyncHandler(async (req, res) => {
  connectionService.remove(req.params.id);
  ok(res, { id: req.params.id });
}));

router.post('/test', asyncHandler(async (req, res) => {
  const parsed = validate(inputSchema, req.body);
  // 测试失败会在服务层抛 50001，由 errorHandler 统一返回
  const result = await connectionService.test(parsed);
  ok(res, result);
}));

/**
 * 测试已保存连接（按 ID）。
 * 说明：前端不持有明文密码，故由服务端解密后测试。
 * 属于在约定 6 个端点之外的便利扩展，用于列表项「测试」按钮。
 */
router.post('/:id/test', asyncHandler(async (req, res) => {
  const rec = connectionService.getRecordById(req.params.id);
  const input: ConnectionInput = {
    name: rec.name,
    type: rec.type,
    host: rec.host,
    port: rec.port,
    database: rec.database,
    username: rec.username,
    password: decrypt(rec.passwordEnc),
  };
  const result = await connectionService.test(input);
  ok(res, result);
}));

/**
 * 获取指定连接的结构化表清单（供前端左侧表树展示）。
 * 连接不存在时 connectionService.getRecordById 抛 40401；建连失败抛 50001。
 */
router.get('/:id/tables', asyncHandler(async (req, res) => {
  const rec = connectionService.getRecordById(req.params.id);
  const tables = await getTableList(rec);
  ok(res, tables);
}));

export default router;
