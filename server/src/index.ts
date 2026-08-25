/**
 * 进程入口：加载环境变量 → 校验主密钥 → 启动 Express 服务。
 *
 * 说明：
 * - 使用 `dotenv` 从当前工作目录（server/）加载 `.env`。
 * - `ensureEnv()` 会校验 `DB_CLIENT_MASTER_KEY` 是否存在，缺失则抛错退出。
 * - 监听端口来自 `PORT` 环境变量，默认 4000。
 */
import dotenv from 'dotenv';
import { ensureEnv, getPort } from './config/env.js';
import { createApp } from './app.js';

dotenv.config();

function bootstrap(): void {
  try {
    ensureEnv();
  } catch (err) {
    console.error('[dbclient] 启动失败:', (err as Error).message);
    process.exit(1);
  }

  const app = createApp();
  const port = getPort();

  app.listen(port, () => {
    console.log(`[dbclient] 服务已启动: http://localhost:${port}`);
    console.log(`[dbclient] API 前缀: /api`);
  });
}

bootstrap();
