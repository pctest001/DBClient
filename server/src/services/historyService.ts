/**
 * 执行历史服务（P1-1）。
 *
 * 历史记录持久化于 history.json，按插入顺序追加，超出上限（200 条）时
 * 环形保留最近条目。列表接口按执行时间倒序返回。
 */
import { nanoid } from 'nanoid';
import { readJson, writeJson } from '../utils/store.js';
import type { HistoryItem } from '../models/types.js';

const FILE = 'history.json';
const MAX_ITEMS = 200;

function load(): HistoryItem[] {
  return readJson<HistoryItem[]>(FILE, []);
}

function save(list: HistoryItem[]): void {
  writeJson(FILE, list);
}

export const historyService = {
  /** 列出历史（可按连接过滤，倒序，限制条数）。 */
  list(connectionId?: string, limit = 50): HistoryItem[] {
    let items = load();
    if (connectionId) {
      items = items.filter((i) => i.connectionId === connectionId);
    }
    items = items
      .slice()
      .sort((a, b) => b.executedAt.localeCompare(a.executedAt));
    return items.slice(0, limit);
  },

  /** 新增一条历史（自动生成 ID，环形截断）。 */
  add(item: Omit<HistoryItem, 'id'>): HistoryItem {
    const list = load();
    const full: HistoryItem = { id: nanoid(), ...item };
    list.push(full);
    if (list.length > MAX_ITEMS) {
      save(list.slice(list.length - MAX_ITEMS));
    } else {
      save(list);
    }
    return full;
  },

  /** 删除单条。 */
  remove(id: string): void {
    save(load().filter((i) => i.id !== id));
  },

  /** 清空，返回删除条数。 */
  clear(): number {
    const list = load();
    const n = list.length;
    save([]);
    return n;
  },
};
