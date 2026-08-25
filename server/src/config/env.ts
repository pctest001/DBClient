/**
 * 环境变量读取与校验。
 *
 * 关键约束：主密钥 `DB_CLIENT_MASTER_KEY` 为必填项，缺失或为空时
 * `ensureEnv()` 抛错，进程应在入口处捕获并退出（满足 P0-4 安全要求）。
 */
import path from 'path';
import fs from 'fs';

const MASTER_KEY_ENV = 'DB_CLIENT_MASTER_KEY';
const MIN_KEY_LEN = 16;

/**
 * 校验启动所需的环境变量。缺失主密钥时抛错。
 * @throws {Error} 主密钥缺失
 */
export function ensureEnv(): void {
  const key = process.env[MASTER_KEY_ENV];
  if (!key || key.trim().length === 0) {
    throw new Error(
      `环境变量 ${MASTER_KEY_ENV} 缺失或为空，无法启动（加密主密钥必填）。`
    );
  }
  if (key.length < MIN_KEY_LEN) {
    console.warn(
      `[warn] ${MASTER_KEY_ENV} 长度建议 ≥${MIN_KEY_LEN} 位，当前仅 ${key.length} 位。`
    );
  }
}

/** 获取加密主密钥（已确保存在）。 */
export function getMasterKey(): string {
  const key = process.env[MASTER_KEY_ENV];
  if (!key) {
    throw new Error(`${MASTER_KEY_ENV} 未设置`);
  }
  return key;
}

/** 获取服务监听端口（默认 4000）。 */
export function getPort(): number {
  const raw = process.env.PORT;
  const port = raw ? Number(raw) : 4000;
  return Number.isFinite(port) && port > 0 ? port : 4000;
}

/**
 * 获取运行时数据目录（server/data），不存在则创建。
 * 以进程工作目录（server/）为基准，避免 ESM/CJS 下 __dirname 差异。
 */
export function getDataDir(): string {
  const dir = path.resolve(process.cwd(), 'data');
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  return dir;
}
