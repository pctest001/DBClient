/**
 * 统一异常处理中间件：将异常转换为 `{ code, data, message }` 结构。
 *
 * - `AppError`：直接使用其携带的错误码与消息。
 * - 其它异常（含未捕获错误）：返回 50004 内部错误。
 */
import type { Request, Response, NextFunction } from 'express';
import { AppError } from '../utils/response.js';

// 四个参数签名使 Express 将其识别为错误处理中间件。
export function errorHandler(
  err: unknown,
  _req: Request,
  res: Response,
  _next: NextFunction
): void {
  if (err instanceof AppError) {
    res.status(200).json({ code: err.code, data: null, message: err.message });
    return;
  }

  const message = err instanceof Error ? err.message : '未知服务器错误';
  // 开发期打印堆栈，便于排查
  if (err instanceof Error && err.stack) {
    console.error('[dbclient] 未捕获异常:', err.stack);
  }
  res.status(200).json({ code: 50004, data: null, message });
}
