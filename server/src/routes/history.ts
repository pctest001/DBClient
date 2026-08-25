/**
 * 执行历史路由（P1-1）。
 * GET    /api/history?connectionId=&limit=  → HistoryItem[]（倒序）
 * DELETE /api/history/:id                    → {id}
 * DELETE /api/history                        → {deleted}（清空）
 */
import { Router } from 'express';
import { ok } from '../utils/response.js';
import { historyService } from '../services/historyService.js';

const router = Router();

router.get('/', (req, res) => {
  const connectionId =
    typeof req.query.connectionId === 'string' ? req.query.connectionId : undefined;
  const limitRaw = req.query.limit;
  const limit =
    limitRaw && Number(limitRaw) > 0 ? Number(limitRaw) : 50;
  ok(res, historyService.list(connectionId, limit));
});

router.delete('/:id', (req, res) => {
  historyService.remove(req.params.id);
  ok(res, { id: req.params.id });
});

router.delete('/', (_req, res) => {
  const deleted = historyService.clear();
  ok(res, { deleted });
});

export default router;
