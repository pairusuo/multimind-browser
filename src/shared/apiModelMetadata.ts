export interface ApiModelProviderMeta {
  id: string;
  label: string;
  badgeText: string;
}

const PROVIDER_META: Record<string, ApiModelProviderMeta> = {
  openai: { id: 'openai', label: 'OpenAI', badgeText: 'AI' },
  anthropic: { id: 'anthropic', label: 'Claude', badgeText: 'C' },
  google: { id: 'google', label: 'Gemini', badgeText: 'G' },
  deepseek: { id: 'deepseek', label: 'DeepSeek', badgeText: 'DS' },
  'bytedance-seed': { id: 'bytedance-seed', label: 'Doubao', badgeText: 'DB' },
  'x-ai': { id: 'x-ai', label: 'Grok', badgeText: 'G' },
  qwen: { id: 'qwen', label: 'Qwen', badgeText: 'Q' },
  moonshotai: { id: 'moonshotai', label: 'Kimi', badgeText: 'K' },
  'z-ai': { id: 'z-ai', label: 'Z.ai', badgeText: 'Z' },
  other: { id: 'other', label: 'Other', badgeText: 'AI' },
};

export function getApiModelProvider(model: string): string {
  const normalized = model.trim().toLowerCase();
  const explicitProvider = normalized.split('/')[0] || '';
  if (explicitProvider && normalized.includes('/') && PROVIDER_META[explicitProvider]) {
    return explicitProvider;
  }

  if (/^gpt-|^o\d|^chatgpt-|^openai\//.test(normalized)) return 'openai';
  if (/^claude-|^anthropic\//.test(normalized)) return 'anthropic';
  if (/^gemini-|^google\//.test(normalized)) return 'google';
  if (/^deepseek-|^deepseek\//.test(normalized)) return 'deepseek';
  if (/^seed-|^doubao-|^bytedance-seed\//.test(normalized)) return 'bytedance-seed';
  if (/^grok-|^x-ai\//.test(normalized)) return 'x-ai';
  if (/^qwen-|^qwen\//.test(normalized)) return 'qwen';
  if (/^kimi-|^moonshot|^moonshotai\//.test(normalized)) return 'moonshotai';
  if (/^glm-|^z-ai\//.test(normalized)) return 'z-ai';
  return 'other';
}

export function getApiModelProviderMeta(modelOrProvider: string): ApiModelProviderMeta {
  const provider = modelOrProvider.includes('/') || isLikelyBareModelName(modelOrProvider)
    ? getApiModelProvider(modelOrProvider)
    : modelOrProvider.toLowerCase();
  return PROVIDER_META[provider] ?? {
    ...PROVIDER_META.other,
    label: modelOrProvider || PROVIDER_META.other.label,
  };
}

export function getApiModelProviderLabel(provider: string): string {
  return getApiModelProviderMeta(provider).label;
}

export function getApiModelDisplayName(model: string): string {
  return model.includes('/') ? model.split('/').slice(1).join('/') : model;
}

function isLikelyBareModelName(value: string): boolean {
  return /^(gpt|o\d|chatgpt|claude|gemini|deepseek|seed|doubao|grok|qwen|kimi|moonshot|glm)-/i.test(value.trim());
}
