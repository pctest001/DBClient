/**
 * 连接持久化服务：connections.json 增删改查 + 测试连接。
 *
 * - 密码明文入参 → `encrypt` 后存 `passwordEnc`；响应与日志绝不出现密文/明文。
 * - 提供 `getRecordById`（含密文，供执行 / AI 使用）与 `getById`（公开字段）。
 * - 同名连接冲突返回 40901；不存在返回 40401。
 */
import { nanoid } from 'nanoid';
import { readJson, writeJson } from '../utils/store.js';
import { encrypt, decrypt } from './cryptoService.js';
import { testConnection } from './dbService.js';
import { AppError } from '../utils/response.js';
import type {
  ConnectionInput,
  ConnectionRecord,
  ConnectionPublic,
  ConnectionTestRes,
  ConnectionExport,
  ConnectionExportItem,
  ConnectionImportItem,
  ConnectionImportResult,
  ImportConflictStrategy,
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

  /**
   * 导出全部连接。plain=false（默认）每条含密文 passwordEnc；plain=true 含明文 password。
   * 属于用户主动触发的下载动作，可直接返回密码字段；其余常规接口仍不泄密。
   */
  exportAll(plain: boolean): ConnectionExport {
    const list = loadAll();
    const connections: ConnectionExportItem[] = list.map((rec) => {
      if (plain) {
        const { passwordEnc, ...rest } = rec;
        void passwordEnc;
        return { ...rest, password: decrypt(rec.passwordEnc) } as ConnectionExportItem;
      }
      return { ...rec } as ConnectionExportItem;
    });
    return { version: 1, exportedAt: new Date().toISOString(), connections };
  },

  /**
   * 批量导入连接。逐条处理，单条失败计入 errors 不中断其余。
   * - 提供 passwordEnc：用当前密钥 decrypt 校验，成功则原样入库，失败记错误（跨密钥）。
   * - 提供 password：encrypt 后入库。
   * - onConflict：skip（默认跳过同名）/ overwrite（覆盖）/ rename（自动加后缀）。
   */
  importMany(
    items: ConnectionImportItem[],
    onConflict: ImportConflictStrategy = 'skip'
  ): ConnectionImportResult {
    const list = loadAll();
    const result: ConnectionImportResult = {
      imported: 0,
      skipped: 0,
      overwritten: 0,
      renamed: 0,
      errors: [],
    };

    const build = (
      item: ConnectionImportItem,
      passwordEnc: string,
      id?: string,
      createdAt?: string
    ): ConnectionRecord => {
      const now = new Date().toISOString();
      return {
        id: id ?? nanoid(),
        name: item.name,
        type: item.type,
        host: item.host,
        port: item.port,
        database: item.database,
        username: item.username,
        passwordEnc,
        createdAt: createdAt ?? now,
        updatedAt: now,
      };
    };

    for (const item of items) {
      // 基础字段校验
      if (
        !item.name ||
        (item.type !== 'mysql' && item.type !== 'postgres') ||
        !item.host ||
        !item.database ||
        !item.username ||
        typeof item.port !== 'number' ||
        item.port <= 0
      ) {
        result.errors.push({ name: item.name ?? '(无名)', error: '字段缺失或非法' });
        continue;
      }

      // 解析密码字段
      let passwordEnc: string;
      if (item.passwordEnc) {
        try {
          decrypt(item.passwordEnc); // 校验当前密钥可解
          passwordEnc = item.passwordEnc;
        } catch {
          result.errors.push({ name: item.name, error: '密文与当前密钥不匹配，无法导入' });
          continue;
        }
      } else if (item.password) {
        passwordEnc = encrypt(item.password);
      } else {
        result.errors.push({ name: item.name, error: '缺少密码（password 或 passwordEnc）' });
        continue;
      }

      const existingIdx = list.findIndex((c) => c.name === item.name);
      if (existingIdx >= 0) {
        if (onConflict === 'skip') {
          result.skipped++;
          continue;
        }
        if (onConflict === 'overwrite') {
          list[existingIdx] = build(
            item,
            passwordEnc,
            list[existingIdx].id,
            list[existingIdx].createdAt
          );
          result.overwritten++;
          continue;
        }
        // rename：自动加后缀避免重名
        let newName = item.name;
        let n = 2;
        while (list.some((c) => c.name === newName)) {
          newName = `${item.name} (${n})`;
          n++;
        }
        list.push(build({ ...item, name: newName }, passwordEnc));
        result.renamed++;
        continue;
      }

      list.push(build(item, passwordEnc));
      result.imported++;
    }

    saveAll(list);
    return result;
  },
};
