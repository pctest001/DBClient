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
  TableInfo,
  MultiExecResult,
} from '../types';

interface RunQueryOptions {
  unlimited?: boolean;
  limit?: boolean;
  limitValue?: number;
}

/** 写操作二次确认状态（mode 区分「全部执行」与「单条执行」）。 */
interface WriteConfirmState {
  mode: 'multi' | 'single';
  writeCount: number;
  connectionName: string;
  stmt?: string; // 单条执行时的语句
}

interface AppState {
  // 连接
  connections: ConnectionPublic[];
  currentConnection: ConnectionPublic | null;
  // 表结构清单（前端左侧表树）
  tables: TableInfo[];
  tablesLoading: boolean;
  tablesError: string | null;
  // SQL 编辑器
  sql: string;
  // 查询结果（单条执行 / 单条 SQL 结果）
  queryResult: QueryResult | null;
  queryLoading: boolean;
  queryError: string | null;
  // AI（增量迭代：aiResult → aiStatements）
  aiStatements: string[]; // AI 生成的多条语句
  aiHint: string | null; // 纯解释无 SQL 时的友好提示
  aiLoading: boolean;
  aiError: string | null;
  // 多语句执行结果
  multiResult: MultiExecResult | null;
  multiLoading: boolean;
  multiError: string | null;
  // 写操作二次确认（pending 时由 AiPanel 弹窗）
  pendingWriteConfirm: WriteConfirmState | null;
  // 历史
  history: HistoryItem[];
  // 设置弹窗
  settingsOpen: boolean;

  // 动作
  loadConnections: () => Promise<void>;
  setCurrentConnection: (c: ConnectionPublic | null) => void;
  loadTables: (connectionId: string) => Promise<void>;
  setSql: (sql: string) => void;
  runQuery: (opts?: RunQueryOptions) => Promise<void>;
  generateAi: (prompt: string) => Promise<void>;
  runMultiQuery: () => void;
  runSingleQuery: (stmt: string) => void;
  fillEditorWithStatements: (stmt?: string) => void;
  confirmWriteConfirm: () => Promise<void>;
  cancelWriteConfirm: () => void;
  _executeMulti: () => Promise<void>;
  _executeSingle: (stmt: string) => Promise<void>;
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

/** localStorage 键：写入后「本次不再提示」写操作确认（持久，跨会话）。 */
export const WRITE_CONFIRM_SKIP_KEY = 'dbclient_skip_write_confirm';

/** 判断语句是否为写操作（非 SELECT）。主理人决策 #1：所有非 SELECT 一律二次确认。 */
export function isWriteStatement(sql: string): boolean {
  return /^\s*(INSERT|UPDATE|DELETE|REPLACE|CREATE|ALTER|DROP|TRUNCATE|RENAME|GRANT|REVOKE|MERGE|SET)\b/i.test(
    sql
  );
}

/** 是否跳过写操作确认（localStorage 持久）。 */
export function shouldSkipWriteConfirm(): boolean {
  try {
    return localStorage.getItem(WRITE_CONFIRM_SKIP_KEY) === '1';
  } catch {
    return false;
  }
}

/** 设置/清除「跳过写操作确认」。 */
export function setSkipWriteConfirm(skip: boolean): void {
  try {
    if (skip) localStorage.setItem(WRITE_CONFIRM_SKIP_KEY, '1');
    else localStorage.removeItem(WRITE_CONFIRM_SKIP_KEY);
  } catch {
    // 忽略 localStorage 不可用时异常
  }
}

export const useAppStore = create<AppState>((set, get) => ({
  connections: [],
  currentConnection: null,
  tables: [],
  tablesLoading: false,
  tablesError: null,
  sql: '',
  queryResult: null,
  queryLoading: false,
  queryError: null,
  aiStatements: [],
  aiHint: null,
  aiLoading: false,
  aiError: null,
  multiResult: null,
  multiLoading: false,
  multiError: null,
  pendingWriteConfirm: null,
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
    if (c) {
      set({ currentConnection: c });
      // 选中连接后自动拉取表清单
      void get().loadTables(c.id);
    } else {
      set({ currentConnection: null, tables: [], tablesLoading: false, tablesError: null });
    }
  },

  async loadTables(connectionId) {
    set({ tablesLoading: true, tablesError: null });
    try {
      const tables = await api.getTables(connectionId);
      // 防止结果回写时已切换到其它连接
      if (get().currentConnection?.id === connectionId) {
        set({ tables, tablesLoading: false });
      }
    } catch (err) {
      if (get().currentConnection?.id === connectionId) {
        set({ tables: [], tablesLoading: false, tablesError: (err as Error).message });
      }
    }
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
    set({ aiLoading: true, aiError: null, aiHint: null, multiResult: null, multiError: null });
    try {
      const current = get().currentConnection;
      const res = await api.generateSql(
        current ? { connectionId: current.id, prompt } : { prompt }
      );
      // 主理人决策 #6：完全迁移 statements，删除 sql 字段
      set({ aiStatements: res.statements, aiLoading: false });
      if (res.statements.length === 0) {
        // 纯解释无 SQL：友好提示（来自接口 message 的等价文案）
        set({ aiHint: 'AI 未返回可执行的 SQL，请调整需求后重试' });
      }
    } catch (err) {
      set({ aiLoading: false, aiError: (err as Error).message });
    }
  },

  runMultiQuery() {
    const { currentConnection, aiStatements } = get();
    if (!currentConnection) {
      set({ multiError: '请先选择一个数据库连接' });
      return;
    }
    if (!aiStatements.length) {
      set({ multiError: '暂无可执行的 AI 生成语句' });
      return;
    }
    const writeStmts = aiStatements.filter((s) => isWriteStatement(s));
    // 主理人决策 #1：有写语句且未选择「不再提示」→ 置 pending 让 AiPanel 弹确认
    if (writeStmts.length > 0 && !shouldSkipWriteConfirm()) {
      set({
        pendingWriteConfirm: {
          mode: 'multi',
          writeCount: writeStmts.length,
          connectionName: currentConnection.name,
        },
      });
      return;
    }
    void get()._executeMulti();
  },

  runSingleQuery(stmt) {
    const { currentConnection } = get();
    if (!currentConnection) {
      set({ queryError: '请先选择一个数据库连接' });
      return;
    }
    // 单条为非 SELECT 且未选择「不再提示」→ 弹确认
    if (isWriteStatement(stmt) && !shouldSkipWriteConfirm()) {
      set({
        pendingWriteConfirm: {
          mode: 'single',
          writeCount: 1,
          connectionName: currentConnection.name,
          stmt,
        },
      });
      return;
    }
    void get()._executeSingle(stmt);
  },

  fillEditorWithStatements(stmt) {
    const { aiStatements } = get();
    // 单条回填该句，否则回填全部（join 后写入，绝不自动执行）
    const text = stmt ?? aiStatements.join(';\n');
    set({ sql: text });
  },

  async confirmWriteConfirm() {
    const pending = get().pendingWriteConfirm;
    set({ pendingWriteConfirm: null });
    if (!pending) return;
    if (pending.mode === 'single' && pending.stmt) {
      await get()._executeSingle(pending.stmt);
    } else {
      await get()._executeMulti();
    }
  },

  cancelWriteConfirm() {
    set({ pendingWriteConfirm: null });
  },

  async _executeMulti() {
    const { currentConnection, aiStatements } = get();
    if (!currentConnection) return;
    set({ multiLoading: true, multiError: null });
    try {
      const res = await api.executeMultiQuery({
        connectionId: currentConnection.id,
        sql: aiStatements.join(';\n'),
      });
      set({ multiResult: res, multiLoading: false });
      void get().loadHistory();
    } catch (err) {
      set({ multiLoading: false, multiError: (err as Error).message });
    }
  },

  async _executeSingle(stmt: string) {
    const { currentConnection } = get();
    if (!currentConnection) return;
    set({ queryLoading: true, queryError: null });
    try {
      const result = await api.executeQuery({
        connectionId: currentConnection.id,
        sql: stmt,
      });
      set({ queryResult: result, queryLoading: false });
      void get().loadHistory();
    } catch (err) {
      set({ queryLoading: false, queryError: (err as Error).message });
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
