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
  AiSettingsInput,
  AiSettingsPublic,
  HistoryItem,
} from '../types';

const BASE = '/api';

/** 执行请求并解析统一响应；非 0 时抛出 message。 */
async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    headers: { 'Content-Type': 'application/json' },
    ...options,
  });
  const json = (await res.json()) as ApiResponse<T>;
  if (json.code !== 0) {
    throw new Error(json.message || '请求失败');
  }
  return json.data as T;
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

  // ===== 查询执行（P0-2 / P1-5） =====
  executeQuery: (req: QueryExecReq) =>
    request<QueryResult>('/query/execute', jsonBody(req)),

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
