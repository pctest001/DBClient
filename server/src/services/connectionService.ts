/**
 * 连接持久化服务：connections.json 增删改查 + 测试连接。
 *
 * - 密码明文入参 → `encrypt` 后存 `passwordEnc`；响应与日志绝不出现密文/明文。
 * - 提供 `getRecordById`（含密文，供执行 / AI 使用）与 `getById`（公开字段）。
 * - 同名连接冲突返回 40901；不存在返回 40401。
 */
import { nanoid } from 'nanoid';
import { readJson, writeJson } from '../utils/store.js';
import { encrypt } from './cryptoService.js';
import { testConnection } from './dbService.js';
import { AppError } from '../utils/response.js';
import type {
  ConnectionInput,
  ConnectionRecord,
  ConnectionPublic,
  ConnectionTestRes,
} from '../models/types.js';

const FILE = 'connections.json';

/** 将入参转为持久化记录（生成 ID + 加密密码）。 */
function toRecord(input: ConnectionInput): ConnectionRecord {
  const now = new Date().toISOString();
  return {
    id: nanoid(),
    name: input.name,
    type: input.type,
    host: input.host,
    port: input.port,
    database: input.database,
    username: input.username,
    passwordEnc: encrypt(input.password),
    createdAt: now,
    updatedAt: now,
  };
}

/** 剔除密码字段，得到对外公开对象。 */
function toPublic(rec: ConnectionRecord): ConnectionPublic {
  const { passwordEnc, ...rest } = rec;
  void passwordEnc;
  return rest;
}

function loadAll(): ConnectionRecord[] {
  return readJson<ConnectionRecord[]>(FILE, []);
}

function saveAll(list: ConnectionRecord[]): void {
  writeJson(FILE, list);
}

export const connectionService = {
  /** 列出全部连接（公开字段）。 */
  list(): ConnectionPublic[] {
    return loadAll().map(toPublic);
  },

  /** 按 ID 获取公开连接信息。 */
  getById(id: string): ConnectionPublic {
    const rec = loadAll().find((c) => c.id === id);
    if (!rec) throw new AppError(40401, `连接不存在: ${id}`);
    return toPublic(rec);
  },

  /** 按 ID 获取完整记录（含密文，供执行 / AI 使用）。 */
  getRecordById(id: string): ConnectionRecord {
    const rec = loadAll().find((c) => c.id === id);
    if (!rec) throw new AppError(40401, `连接不存在: ${id}`);
    return rec;
  },

  /** 创建连接（同名冲突 40901）。 */
  create(input: ConnectionInput): ConnectionPublic {
    const list = loadAll();
    if (list.some((c) => c.name === input.name)) {
      throw new AppError(40901, `连接名已存在: ${input.name}`);
    }
    const rec = toRecord(input);
    list.push(rec);
    saveAll(list);
    return toPublic(rec);
  },

  /** 更新连接（同名冲突 40901，不存在 40401）。 */
  update(id: string, input: ConnectionInput): ConnectionPublic {
    const list = loadAll();
    const idx = list.findIndex((c) => c.id === id);
    if (idx === -1) throw new AppError(40401, `连接不存在: ${id}`);
    if (list.some((c) => c.name === input.name && c.id !== id)) {
      throw new AppError(40901, `连接名已存在: ${input.name}`);
    }
    const now = new Date().toISOString();
    list[idx] = {
      ...list[idx],
      name: input.name,
      type: input.type,
      host: input.host,
      port: input.port,
      database: input.database,
      username: input.username,
      passwordEnc: encrypt(input.password),
      updatedAt: now,
    };
    saveAll(list);
    return toPublic(list[idx]);
  },

  /** 删除连接（不存在 40401）。 */
  remove(id: string): void {
    const list = loadAll();
    const next = list.filter((c) => c.id !== id);
    if (next.length === list.length) {
      throw new AppError(40401, `连接不存在: ${id}`);
    }
    saveAll(next);
  },

  /** 测试连接（失败抛 50001）。 */
  test(input: ConnectionInput): Promise<ConnectionTestRes> {
    return testConnection(input);
  },
};
