import { safeStorage } from 'electron';
import {
  ApiConversationConfig,
  ApiConversationModelResult,
  ApiConversationResult,
  CELL_IDS,
  RunApiConversationPayload,
  SaveApiConversationConfigPayload,
} from '../shared/types';
import { BrowserStore } from './windowManager';

const CONFIG_KEY = 'apiConversation.config';
const DEFAULT_BASE_URL = 'https://api.openai.com/v1';
const DEFAULT_MODELS = ['gpt-4o-mini'];
const REQUEST_TIMEOUT_MS = 60000;

interface StoredApiConversationConfig {
  baseUrl?: string;
  models?: string[];
  cellModels?: Record<string, string>;
  apiKey?: string;
  apiKeyEncrypted?: boolean;
}

interface ChatCompletionResponse {
  choices?: Array<{
    message?: {
      content?: string;
    };
    text?: string;
  }>;
  error?: {
    message?: string;
  };
}

export class ApiConversationService {
  constructor(private readonly store: BrowserStore) {}

  getConfig(): ApiConversationConfig {
    const stored = this.getStoredConfig();
    return {
      baseUrl: stored.baseUrl || DEFAULT_BASE_URL,
      models: normalizeModels(stored.models),
      cellModels: normalizeCellModels(stored.cellModels, stored.models),
      apiKeyConfigured: Boolean(stored.apiKey),
    };
  }

  saveConfig(payload: SaveApiConversationConfigPayload): ApiConversationConfig {
    const current = this.getStoredConfig();
    const next: StoredApiConversationConfig = {
      ...current,
      baseUrl: normalizeBaseUrl(payload.baseUrl),
      models: normalizeModels(payload.models),
      cellModels: normalizeCellModels(payload.cellModels, payload.models),
    };

    if (payload.apiKey?.trim()) {
      const encrypted = encryptApiKey(payload.apiKey.trim());
      next.apiKey = encrypted.value;
      next.apiKeyEncrypted = encrypted.encrypted;
    }

    this.store.set(CONFIG_KEY, next);
    return this.getConfig();
  }

  async runConversation(payload: RunApiConversationPayload): Promise<ApiConversationResult> {
    const prompt = payload.prompt.trim();
    if (!prompt) {
      throw new Error('Prompt is required.');
    }

    const stored = this.getStoredConfig();
    const apiKey = decryptApiKey(stored);
    if (!apiKey) {
      throw new Error('API key is not configured.');
    }

    const baseUrl = normalizeBaseUrl(stored.baseUrl || DEFAULT_BASE_URL);
    const models = normalizeModels(payload.models?.length ? payload.models : stored.models);
    if (!models.length) {
      throw new Error('At least one model is required.');
    }

    const results = await Promise.all(models.map((model) => callModel(baseUrl, apiKey, model, prompt)));
    return {
      prompt,
      results,
      createdAt: Date.now(),
    };
  }

  private getStoredConfig(): StoredApiConversationConfig {
    const value = this.store.get(CONFIG_KEY, {});
    if (!value || typeof value !== 'object') {
      return {};
    }
    return value as StoredApiConversationConfig;
  }
}

async function callModel(baseUrl: string, apiKey: string, model: string, prompt: string): Promise<ApiConversationModelResult> {
  const startedAt = Date.now();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const response = await fetch(`${baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model,
        messages: [{ role: 'user', content: prompt }],
        temperature: 0.7,
        stream: false,
      }),
      signal: controller.signal,
    });
    const json = await response.json().catch(() => ({})) as ChatCompletionResponse;
    const content = json.choices?.[0]?.message?.content ?? json.choices?.[0]?.text ?? '';
    const error = json.error?.message || (!response.ok ? `HTTP ${response.status}` : '');

    return {
      model,
      content: content.trim(),
      ...(error ? { error } : {}),
      elapsedMs: Date.now() - startedAt,
    };
  } catch (error) {
    return {
      model,
      content: '',
      error: error instanceof Error ? error.message : String(error),
      elapsedMs: Date.now() - startedAt,
    };
  } finally {
    clearTimeout(timeout);
  }
}

function normalizeBaseUrl(value: string): string {
  const trimmed = value.trim() || DEFAULT_BASE_URL;
  return trimmed.replace(/\/+$/, '');
}

function normalizeModels(models: string[] | undefined): string[] {
  const normalized = (models ?? DEFAULT_MODELS)
    .map((model) => model.trim())
    .filter(Boolean);
  return [...new Set(normalized)].slice(0, 4);
}

function normalizeCellModels(cellModels: Record<string, string> | undefined, fallbackModels: string[] | undefined): Record<string, string> {
  const fallback = normalizeModels(fallbackModels);
  return CELL_IDS.reduce<Record<string, string>>((next, cellId, index) => {
    next[cellId] = cellModels?.[cellId]?.trim() || fallback[index] || '';
    return next;
  }, {});
}

function encryptApiKey(apiKey: string): { value: string; encrypted: boolean } {
  if (!safeStorage.isEncryptionAvailable()) {
    return { value: apiKey, encrypted: false };
  }
  return {
    value: safeStorage.encryptString(apiKey).toString('base64'),
    encrypted: true,
  };
}

function decryptApiKey(config: StoredApiConversationConfig): string {
  if (!config.apiKey) {
    return '';
  }
  if (!config.apiKeyEncrypted) {
    return config.apiKey;
  }
  try {
    return safeStorage.decryptString(Buffer.from(config.apiKey, 'base64'));
  } catch {
    return '';
  }
}
