import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { buildDocumentPrompt, detectContentLanguage } = require('../dist/shared/documentPrompt.js');

assert.equal(detectContentLanguage('请总结这次讨论，并给出可执行建议。'), 'zh');
assert.equal(detectContentLanguage('Summarize the discussion and provide actionable recommendations.'), 'en');

const embeddedPrompt = buildDocumentPrompt('zh');

for (const heading of [
  '## 摘要',
  '## 背景与适用范围',
  '## 核心结论',
  '## 重要边界与风险',
  '## 待核查事项',
  '## 可执行建议',
]) {
  assert.ok(embeddedPrompt.includes(heading), `Embedded summary prompt should include ${heading}`);
}

assert.ok(
  embeddedPrompt.includes('请输出原始 Markdown 源码'),
  'Embedded summary prompt should request raw Markdown source',
);
assert.ok(
  !embeddedPrompt.includes('# 当前对话材料'),
  'Embedded summary prompt should not include API source blocks when no source material is provided',
);

const apiPrompt = buildDocumentPrompt('en', [
  {
    index: 1,
    model: 'openrouter/auto',
    content: 'Use one OpenRouter key to call several mainstream models.',
  },
  {
    index: 2,
    model: 'anthropic/claude-sonnet-5',
    content: 'Keep the shared grid controls and stream answers into each cell.',
  },
]);

for (const expected of [
  '# Current Conversation Materials',
  'Cell 1 - openrouter/auto',
  'Cell 2 - anthropic/claude-sonnet-5',
  'Use one OpenRouter key to call several mainstream models.',
  'Keep the shared grid controls and stream answers into each cell.',
  'Do not expose the discussion process',
  'place the complete document inside one markdown code block',
]) {
  assert.ok(apiPrompt.includes(expected), `API summary prompt should include ${expected}`);
}

console.log('Document prompt tests passed.');
