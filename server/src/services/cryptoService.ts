/**
 * AES-256-GCM 加解密服务（P0-4）。
 *
 * - 主密钥来自环境变量 `DB_CLIENT_MASTER_KEY`，通过 SHA-256 派生为 32 字节密钥。
 * - 密文格式单一字符串：base64( iv[12] + authTag[16] + ciphertext )。
 * - 所有密码 / API Key 落盘前 `encrypt`，读取后 `decrypt`。
 * - 失败统一抛 `AppError(40101)`，绝不向调用方泄漏明文/密文。
 */
import { createCipheriv, createDecipheriv, randomBytes, createHash } from 'crypto';
import { getMasterKey } from '../config/env.js';
import { AppError } from '../utils/response.js';

const ALGO = 'aes-256-gcm';
const IV_LEN = 12;
const TAG_LEN = 16;

/** 由主密钥派生 32 字节密钥。 */
function deriveKey(): Buffer {
  return createHash('sha256').update(String(getMasterKey())).digest();
}

/** 加密明文，返回 base64 密文字符串。 */
export function encrypt(plain: string): string {
  try {
    const iv = randomBytes(IV_LEN);
    const cipher = createCipheriv(ALGO, deriveKey(), iv);
    const encrypted = Buffer.concat([
      cipher.update(String(plain), 'utf8'),
      cipher.final(),
    ]);
    const tag = cipher.getAuthTag();
    return Buffer.concat([iv, tag, encrypted]).toString('base64');
  } catch (err) {
    throw new AppError(40101, `加密失败: ${(err as Error).message}`);
  }
}

/** 解密 base64 密文，还原明文。 */
export function decrypt(token: string): string {
  try {
    const buf = Buffer.from(token, 'base64');
    if (buf.length < IV_LEN + TAG_LEN) {
      throw new Error('密文长度不足');
    }
    const iv = buf.subarray(0, IV_LEN);
    const tag = buf.subarray(IV_LEN, IV_LEN + TAG_LEN);
    const encrypted = buf.subarray(IV_LEN + TAG_LEN);
    const decipher = createDecipheriv(ALGO, deriveKey(), iv);
    decipher.setAuthTag(tag);
    const decrypted = Buffer.concat([decipher.update(encrypted), decipher.final()]);
    return decrypted.toString('utf8');
  } catch (err) {
    throw new AppError(40101, `解密失败: ${(err as Error).message}`);
  }
}
