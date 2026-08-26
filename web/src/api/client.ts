/**
 * 前端 API 封装：基于 fetch，统一 baseURL=/api、错误处理。失败时抛出
 * 服务端 message（由 UI 层以 Snackbar / 错误条展示，满足 P1-4）。
 */
import type {
  ApiResponse,
  ConnectionPublic,
  ConnectionInput,
  ConnectionTestRes,
  QueryExecReq,
  QueryResult,
  AiGenerateReq,
  AiGenerateRes,
  MultiExecReq,
  MultiExecResult,
  AiSettingsInput,
  AiSettingsPublic,
  HistoryItem,
  TableInfo,
} from '../types';

const BASE = '/api';

/**
 * 执行请求并解析统一响应；对「后端不可达 / 返回非 JSON」等异常给出友好中文错误。
 *
 * 错误优先级：
 *  1. 网络层失败（后端没启动 / 代理不可达 / fetch 抛 TypeError）
 *  2. HTTP 非 2xx（代理 502/504、Express 返回错误状态码）
 *  3. 响应体为空
 *  4. 响应体非 JSON（通常是代理 HTML 错误页）
 *  5. JSON 解析成功但 code !== 0（保持原 message）
 *  6. 正常返回 data
 */
async function request<T>(path: string, options?: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${BASE}${path}`, {
      headers: { 'Content-Type': 'application/json' },
      ...options,
    });
  } catch (err) {
    // 1. 网络层失败：后端没启动 / 代理不可达 / fetch 抛 TypeError
    const raw = err instanceof Error ? err.message : String(err);
    throw new Error(
      `无法连接后端服务，请确认后端已启动（默认端口 4000）。${
        raw ? `（${raw}）` : ''
      }`
    );
  }

  // 2. HTTP 非 2xx：优先使用响应体中的 message
  if (!res.ok) {
    const bodyText = await readText(res);
    let messageFromBody = '';
    try {
      const parsed = JSON.parse(bodyText) as Partial<ApiResponse<T>> | null;
      messageFromBody = parsed?.message ?? '';
    } catch {
      // 响应体非 JSON，忽略，走下方的 HTTP 状态提示
    }
    if (messageFromBody) {
      throw new Error(messageFromBody);
    }
    throw new Error(`请求失败（HTTP ${res.status} ${res.statusText}）`);
  }

  const text = await readText(res);

  // 3. 响应体为空
  if (text.trim() === '') {
    throw new Error(
      `后端返回为空（HTTP ${res.status} ${res.statusText}），请检查后端服务是否正常。`
    );
  }

  // 4. 响应体非 JSON（通常是代理返回的 HTML 错误页）
  let json: ApiResponse<T> | null = null;
  try {
    json = JSON.parse(text) as ApiResponse<T>;
  } catch {
    throw new Error(
      `后端返回了非预期内容（非 JSON，HTTP ${res.status} ${res.statusText}），请检查后端服务与代理配置是否正常。`
    );
  }

  // 5. JSON 解析成功但 code !== 0：保持现状
  if (json.code !== 0) {
    throw new Error(json.message || '请求失败');
  }

  // 6. 正常返回
  return json.data as T;
}

/** 安全读取响应文本，读取失败时返回空字符串（避免二次异常掩盖真实错误）。 */
async function readText(res: Response): Promise<string> {
  try {
    return await res.text();
  } catch {
    return '';
  }
}

function jsonBody(body: unknown): RequestInit {
  return { method: 'POST', body: JSON.stringify(body) };
}

export const api = {
  // ===== 连接管理（P0-1 / P0-4） =====
  listConnections: () => request<ConnectionPublic[]>('/connections'),
  getConnection: (id: string) => request<ConnectionPublic>(`/connections/${id}`),
  createConnection: (input: ConnectionInput) =>
    request<ConnectionPublic>('/connections', jsonBody(input)),
  updateConnection: (id: string, input: ConnectionInput) =>
    request<ConnectionPublic>(`/connections/${id}`, {
      method: 'PUT',
      body: JSON.stringify(input),
    }),
  deleteConnection: (id: string) =>
    request<{ id: string }>(`/connections/${id}`, { method: 'DELETE' }),
  testConnection: (input: ConnectionInput) =>
    request<ConnectionTestRes>('/connections/test', jsonBody(input)),
  testSavedConnection: (id: string) =>
    request<ConnectionTestRes>(`/connections/${id}/test`, { method: 'POST' }),

  // ===== 表结构清单（前端左侧表树） =====
  getTables: (connectionId: string) =>
    request<TableInfo[]>(`/connections/${connectionId}/tables`),

  // ===== 查询执行（P0-2 / P1-5） =====
  executeQuery: (req: QueryExecReq) =>
    request<QueryResult>('/query/execute', jsonBody(req)),

  // ===== 多语句执行（增量迭代） =====
  executeMultiQuery: (req: MultiExecReq) =>
    request<MultiExecResult>('/query/execute-multi', jsonBody(req)),

  // ===== AI 生成 SQL（P0-3 / P0-5） =====
  generateSql: (req: AiGenerateReq) =>
    request<AiGenerateRes>('/ai/generate', jsonBody(req)),

  // ===== AI 接口配置（P1-3） =====
  getAiSettings: () => request<AiSettingsPublic>('/settings/ai'),
  saveAiSettings: (input: AiSettingsInput) =>
    request<AiSettingsPublic>('/settings/ai', {
      method: 'PUT',
      body: JSON.stringify(input),
    }),
  testAiSettings: (input: AiSettingsInput) =>
    request<{ ok: boolean; message: string }>('/settings/ai/test', jsonBody(input)),

  // ===== 执行历史（P1-1） =====
  listHistory: (connectionId?: string, limit = 50) =>
    request<HistoryItem[]>(
      `/history?limit=${limit}${
        connectionId ? `&connectionId=${encodeURIComponent(connectionId)}` : ''
      }`
    ),
  deleteHistory: (id: string) =>
    request<{ id: string }>(`/history/${id}`, { method: 'DELETE' }),
  clearHistory: () =>
    request<{ deleted: number }>('/history', { method: 'DELETE' }),
};
