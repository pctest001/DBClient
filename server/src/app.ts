/**
 * Express 应用装配：中间件 + 路由挂载 + 统一错误处理。
 *
 * 路由前缀统一为 `/api`，未知路由返回 40401，异常经 errorHandler 统一输出
 * `{ code, data, message }` 结构。生产环境可由 `express.static` 托管前端构建产物
 * （同源部署），此处预留挂载点。
 */
import express, { type Express } from 'express';
import cors from 'cors';
import { errorHandler } from './middleware/errorHandler.js';
import connectionsRouter from './routes/connections.js';
import queryRouter from './routes/query.js';
import aiRouter from './routes/ai.js';
import settingsRouter from './routes/settings.js';
import historyRouter from './routes/history.js';

export function createApp(): Express {
  const app = express();

  app.use(cors());
  app.use(express.json({ limit: '4mb' }));

  // 健康检查
  app.get('/api/health', (_req, res) => {
    res.json({ code: 0, data: { ok: true }, message: 'ok' });
  });

  // 业务路由
  app.use('/api/connections', connectionsRouter);
  app.use('/api/query', queryRouter);
  app.use('/api/ai', aiRouter);
  app.use('/api/settings', settingsRouter);
  app.use('/api/history', historyRouter);

  // 未知接口
  app.use((_req, res) => {
    res.status(200).json({ code: 40401, data: null, message: '接口不存在' });
  });

  // 统一错误处理（必须放在最后）
  app.use(errorHandler);

  return app;
}
