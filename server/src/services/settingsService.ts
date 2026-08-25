/**
 * AI 接口配置服务（P1-3）。
 *
 * - 配置持久化于 settings.json，API Key 以密文存储。
 * - GET 返回公开结构（含 hasKey 指示是否已配置 Key，绝不回传密文）。
 * - 连通性测试使用入参明文 Key（不入文件）。
 */
import { readJson, writeJson } from '../utils/store.js';
import { encrypt, decrypt } from './cryptoService.js';
import { AppError } from '../utils/response.js';
import type {
  AiSettingsInput,
  AiSettingsRecord,
  AiSettingsPublic,
} from '../models/types.js';

const FILE = 'settings.json';
const AI_TIMEOUT_MS = 30000;

const EMPTY: AiSettingsRecord = {
  baseUrl: '',
  apiKeyEnc: '',
  model: '',
  enabled: false,
  updatedAt: '',
};

function load(): AiSettingsRecord {
  return readJson<AiSettingsRecord>(FILE, EMPTY);
}

function save(rec: AiSettingsRecord): void {
  writeJson(FILE, rec);
}

/** 读取完整配置（含密文，供 AI 调用解密使用）。 */
export function getSettings(): AiSettingsRecord {
  return load();
}

/** 读取公开配置（含 hasKey，不回传密文）。 */
export function getPublic(): AiSettingsPublic {
  const rec = load();
  return {
    baseUrl: rec.baseUrl,
    model: rec.model,
    enabled: rec.enabled,
    hasKey: Boolean(rec.apiKeyEnc),
  };
}

/** 保存配置（明文 Key 加密存储；若入参 Key 为空则保留原有 Key，避免误清空）。 */
export function saveSettings(input: AiSettingsInput): AiSettingsPublic {
  const now = new Date().toISOString();
  const existing = load();
  const apiKeyEnc =
    input.apiKey && input.apiKey.length > 0 ? encrypt(input.apiKey) : existing.apiKeyEnc;
  const rec: AiSettingsRecord = {
    baseUrl: input.baseUrl,
    apiKeyEnc,
    model: input.model,
    enabled: input.enabled,
    updatedAt: now,
  };
  save(rec);
  return getPublic();
}

/** 连通性测试（使用入参明文 Key）。 */
export async function testSettings(
  input: AiSettingsInput
): Promise<{ ok: boolean; message: string }> {
  const baseUrl = input.baseUrl?.replace(/\/$/, '');
  if (!baseUrl || !input.apiKey || !input.model) {
    return { ok: false, message: 'base URL / API Key / 模型 均不能为空' };
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), AI_TIMEOUT_MS);
  try {
    const resp = await fetch(`${baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${input.apiKey}`,
      },
      body: JSON.stringify({
        model: input.model,
        messages: [{ role: 'user', content: 'ping' }],
        max_tokens: 5,
      }),
      signal: controller.signal,
    });
    if (!resp.ok) {
      const text = await resp.text().catch(() => '');
      return {
        ok: false,
        message: `接口返回 ${resp.status}: ${text.slice(0, 200)}`,
      };
    }
    return { ok: true, message: '连通性测试成功' };
  } catch (err) {
    if ((err as Error).name === 'AbortError') {
      return { ok: false, message: '连接超时（>30s）' };
    }
    return { ok: false, message: `连接失败: ${(err as Error).message}` };
  } finally {
    clearTimeout(timer);
  }
}

/** 解密已保存的 API Key（供 aiService 使用）。 */
export function decryptApiKey(): string {
  const rec = load();
  if (!rec.apiKeyEnc) return '';
  return decrypt(rec.apiKeyEnc);
}
