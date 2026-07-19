import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { __apiConversationTestHooks } = require('../dist/main/apiConversationService.js');

const {
  filterModelCatalog,
  normalizeBaseUrl,
  normalizeCellModels,
  normalizeModels,
} = __apiConversationTestHooks;

assert.equal(
  normalizeBaseUrl('openrouter.ai/api/v1/chat/completions'),
  'https://openrouter.ai/api/v1',
  'OpenRouter chat completions URL should be normalized to the API base URL',
);
assert.equal(
  normalizeBaseUrl('https://openrouter.ai/api/v1/models'),
  'https://openrouter.ai/api/v1',
  'OpenRouter models URL should be normalized to the API base URL',
);
assert.equal(
  normalizeBaseUrl(''),
  'https://openrouter.ai/api/v1',
  'Empty API URL should use the OpenRouter base URL',
);

assert.deepEqual(
  normalizeModels([' openrouter/auto ', 'openrouter/auto', '', 'anthropic/claude-sonnet-5']),
  ['openrouter/auto', 'anthropic/claude-sonnet-5'],
  'Model IDs should be trimmed, deduplicated, and empty values removed',
);

const rawCatalog = [
  'thinkingmachines/inkling',
  'openrouter/auto',
  'openrouter/auto-beta',
  'openrouter/fusion',
  'openai/gpt-chat-latest',
  'openai/gpt-5.6-terra',
  'openai/gpt-5.6-terra-pro',
  'openai/gpt-4o-2024-08-06',
  'openai/gpt-4o-search-preview',
  'anthropic/claude-sonnet-5',
  'anthropic/claude-sonnet-4.6',
  'anthropic/claude-opus-4.8',
  'anthropic/claude-opus-4.8-fast',
  'google/gemini-3.1-pro',
  'google/gemini-3.1-flash',
  'google/gemini-3-pro-image',
  'deepseek/deepseek-chat',
  'deepseek/deepseek-r1',
  'deepseek/deepseek-v3.2',
  'x-ai/grok-4.5',
  'x-ai/grok-latest',
  'qwen/qwen3.7-plus',
  'qwen/qwen3.7-code',
  'moonshotai/kimi-k3',
  'z-ai/glm-5.2',
  'meta-llama/llama-4.1',
  'mistralai/mistral-large-latest',
];

const filtered = filterModelCatalog(rawCatalog);

for (const expected of [
  'openrouter/auto',
  'openai/gpt-chat-latest',
  'openai/gpt-5.6-terra-pro',
  'anthropic/claude-sonnet-5',
  'google/gemini-3.1-pro',
  'deepseek/deepseek-v3.2',
  'x-ai/grok-4.5',
  'qwen/qwen3.7-plus',
  'moonshotai/kimi-k3',
  'z-ai/glm-5.2',
  'meta-llama/llama-4.1',
  'mistralai/mistral-large-latest',
]) {
  assert.ok(filtered.includes(expected), `${expected} should remain in the mainstream model list`);
}

for (const excluded of [
  'thinkingmachines/inkling',
  'openai/gpt-4o-2024-08-06',
  'google/gemini-3-pro-image',
  'qwen/qwen3.7-code',
]) {
  assert.ok(!filtered.includes(excluded), `${excluded} should be filtered out`);
}

assert.deepEqual(
  filtered.filter((model) => model.startsWith('openrouter/')),
  ['openrouter/auto', 'openrouter/auto-beta'],
  'OpenRouter should keep only the preferred router choices',
);
assert.ok(
  filtered.filter((model) => model.startsWith('anthropic/')).length <= 3,
  'Anthropic model list should be capped for a usable dropdown',
);

assert.deepEqual(
  normalizeCellModels(
    {
      'cell-0': 'deepseek-v4-flash',
      'cell-1': 'anthropic/claude-sonnet-5',
    },
    filtered,
    true,
  ),
  {
    'cell-0': filtered[0],
    'cell-1': 'anthropic/claude-sonnet-5',
    'cell-2': filtered[2],
    'cell-3': filtered[3],
  },
  'Saved invalid models should be replaced when a refreshed provider catalog is available',
);

console.log('API conversation tests passed.');
