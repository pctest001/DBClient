/**
 * 统一响应构造器 + 应用错误类型 + 请求体校验辅助。
 *
 * 所有路由均返回 `{ code, data, message }` 结构，`code=0` 表示成功。
 * 业务错误通过 `AppError`（携带领域错误码）抛出，由 errorHandler 统一封装。
 */
import type { Response, Request, NextFunction } from 'express';
import type { ZodType } from 'zod';
import type { ApiResponse } from '../models/types.js';

/** 携带领域错误码的应用错误。 */
export class AppError extends Error {
  code: number;
  constructor(code: number, message: string) {
    super(message);
    this.code = code;
    this.name = 'AppError';
  }
}

/** 成功响应。 */
export function ok<T>(res: Response, data: T, message = 'ok'): Response {
  const body: ApiResponse<T> = { code: 0, data, message };
  return res.status(200).json(body);
}

/** 失败响应（默认 HTTP 200，错误码体现在 body.code）。 */
export function fail(
  res: Response,
  code: number,
  message: string
): Response {
  const body: ApiResponse<null> = { code, data: null, message };
  return res.status(200).json(body);
}

/** 使用 zod schema 校验请求体，失败抛出 40001。 */
export function validate<T>(schema: ZodType<T>, data: unknown): T {
  const result = schema.safeParse(data);
  if (!result.success) {
    const msg = result.error.issues
      .map((i) => `${i.path.join('.') || 'body'}: ${i.message}`)
      .join('; ');
    throw new AppError(40001, `参数校验失败: ${msg}`);
  }
  return result.data;
}

/** 将 async 路由处理器包装为 Express 中间件，自动转发异常到 next()。 */
export function asyncHandler(
  fn: (req: Request, res: Response, next: NextFunction) => Promise<unknown>
) {
  return (req: Request, res: Response, next: NextFunction): void => {
    fn(req, res, next).catch((err) => next(err));
  };
}
