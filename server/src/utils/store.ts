/**
 * 轻量 JSON 文件存储辅助（用于 connections / settings / history）。
 * 以 `server/data` 为根，文件不存在时返回 fallback；写入时确保目录存在。
 */
import fs from 'fs';
import path from 'path';
import { getDataDir } from '../config/env.js';

/** 读取 JSON 文件，不存在或解析失败时返回 fallback。 */
export function readJson<T>(fileName: string, fallback: T): T {
  const dir = getDataDir();
  const file = path.join(dir, fileName);
  if (!fs.existsSync(file)) return fallback;
  try {
    const content = fs.readFileSync(file, 'utf8').trim();
    if (!content) return fallback;
    return JSON.parse(content) as T;
  } catch {
    return fallback;
  }
}

/** 写入 JSON 文件（格式化）。 */
export function writeJson(fileName: string, data: unknown): void {
  const dir = getDataDir();
  const file = path.join(dir, fileName);
  fs.writeFileSync(file, JSON.stringify(data, null, 2), 'utf8');
}
