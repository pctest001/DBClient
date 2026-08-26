/**
 * 全局状态管理（zustand）：当前连接、SQL、查询结果、AI 结果、历史、设置弹窗。
 * 所有 API 调用集中在此，组件仅消费状态与动作。
 */
import { create } from 'zustand';
import { api } from '../api/client';
import type {
  ConnectionPublic,
  QueryResult,
  HistoryItem,
  AiSettingsInput,
  AiSettingsPublic,
} from '../types';

interface RunQueryOptions {
  unlimited?: boolean;
  limit?: boolean;
  limitValue?: number;
}

interface AppState {
  // 连接
  connections: ConnectionPublic[];
  currentConnection: ConnectionPublic | null;
  // SQL 编辑器
  sql: string;
  // 查询结果
  queryResult: QueryResult | null;
  queryLoading: boolean;
  queryError: string | null;
  // AI
  aiResult: string | null;
  aiLoading: boolean;
  aiError: string | null;
  // 历史
  history: HistoryItem[];
  // 设置弹窗
  settingsOpen: boolean;

  // 动作
  loadConnections: () => Promise<void>;
  setCurrentConnection: (c: ConnectionPublic | null) => void;
  setSql: (sql: string) => void;
  runQuery: (opts?: RunQueryOptions) => Promise<void>;
  generateAi: (prompt: string) => Promise<void>;
  loadHistory: () => Promise<void>;
  deleteHistoryItem: (id: string) => Promise<void>;
  clearHistory: () => Promise<void>;
  setSettingsOpen: (open: boolean) => void;
  loadAiSettings: () => Promise<AiSettingsPublic | null>;
  saveAiSettings: (input: AiSettingsInput) => Promise<AiSettingsPublic>;
  testAiSettings: (
    input: AiSettingsInput
  ) => Promise<{ ok: boolean; message: string }>;
}

export const useAppStore = create<AppState>((set, get) => ({
  connections: [],
  currentConnection: null,
  sql: '',
  queryResult: null,
  queryLoading: false,
  queryError: null,
  aiResult: null,
  aiLoading: false,
  aiError: null,
  history: [],
  settingsOpen: false,

  async loadConnections() {
    try {
      const list = await api.listConnections();
      set({ connections: list });
      const current = get().currentConnection;
      // 若当前连接已不存在于列表中，则清空
      if (current && !list.some((c) => c.id === current.id)) {
        set({ currentConnection: null });
      }
    } catch (err) {
      set({ queryError: (err as Error).message });
    }
  },

  setCurrentConnection(c) {
    set({ currentConnection: c });
  },

  setSql(sql) {
    set({ sql });
  },

  async runQuery(opts = {}) {
    const { currentConnection, sql } = get();
    if (!currentConnection) {
      set({ queryError: '请先选择一个数据库连接' });
      return;
    }
    if (!sql.trim()) {
      set({ queryError: 'SQL 不能为空' });
      return;
    }
    set({ queryLoading: true, queryError: null });
    try {
      const result = await api.executeQuery({
        connectionId: currentConnection.id,
        sql,
        limit: opts.limit,
        limitValue: opts.limitValue,
        unlimited: opts.unlimited,
      });
      set({ queryResult: result, queryLoading: false });
      void get().loadHistory();
    } catch (err) {
      set({ queryLoading: false, queryError: (err as Error).message });
    }
  },

  async generateAi(prompt) {
    if (!prompt.trim()) {
      set({ aiError: '请输入需求描述' });
      return;
    }
    set({ aiLoading: true, aiError: null });
    try {
      const current = get().currentConnection;
      const res = await api.generateSql(
        current ? { connectionId: current.id, prompt } : { prompt }
      );
      set({ aiResult: res.sql, aiLoading: false });
    } catch (err) {
      set({ aiLoading: false, aiError: (err as Error).message });
    }
  },

  async loadHistory() {
    try {
      const current = get().currentConnection;
      const list = await api.listHistory(current ? current.id : undefined, 100);
      set({ history: list });
    } catch (err) {
      // 历史加载失败不影响主流程
      console.warn('加载历史失败:', (err as Error).message);
    }
  },

  async deleteHistoryItem(id) {
    try {
      await api.deleteHistory(id);
      await get().loadHistory();
    } catch (err) {
      set({ queryError: (err as Error).message });
    }
  },

  async clearHistory() {
    try {
      await api.clearHistory();
      set({ history: [] });
    } catch (err) {
      set({ queryError: (err as Error).message });
    }
  },

  setSettingsOpen(open) {
    set({ settingsOpen: open });
  },

  async loadAiSettings() {
    try {
      return await api.getAiSettings();
    } catch (err) {
      set({ queryError: (err as Error).message });
      return null;
    }
  },

  async saveAiSettings(input) {
    const res = await api.saveAiSettings(input);
    return res;
  },

  async testAiSettings(input) {
    return await api.testAiSettings(input);
  },
}));
