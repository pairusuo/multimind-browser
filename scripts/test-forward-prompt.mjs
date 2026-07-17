import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const {
  MAX_CONVERSATION_CHARS,
  buildForwardPrompt,
  detectContentLanguage,
  formatRoleBlocks,
  parseRoleBlocks,
  truncateConversation,
} = require('../dist/main/forwardPrompt.js');

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function countOccurrences(text, needle) {
  return text.split(needle).length - 1;
}

function main() {
  assert(detectContentLanguage('请分析这只股票是否适合买入') === 'zh', 'Expected Chinese content to use zh prompt.');
  assert(detectContentLanguage('Please evaluate this answer for omissions.') === 'en', 'Expected English content to use en prompt.');

  const blocks = parseRoleBlocks('用户：第一问\n继续第一问\n\nAI：第一答\n继续第一答');
  assert(blocks?.length === 2, 'Expected role block parser to preserve two blocks.');
  assert(blocks[0].content === '第一问\n继续第一问', 'Expected user multiline block to be preserved.');
  assert(formatRoleBlocks(blocks) === '用户：第一问\n继续第一问\n\nAI：第一答\n继续第一答', 'Expected formatted role blocks to round-trip.');

  const zhPrompt = buildForwardPrompt('用户：怎么买？\n\nAI：先控制风险。', false);
  assert(zhPrompt.startsWith('下面是一段用户与其它 AI 的完整对话上下文。'), 'Expected zh forward prompt intro.');
  assert(zhPrompt.includes('# 对话上下文'), 'Expected zh prompt to include context header.');
  assert(zhPrompt.includes('# 请你评价'), 'Expected zh prompt to include evaluation header.');
  assert(countOccurrences(zhPrompt, '# 对话上下文') === 1, 'Expected context header to appear once.');
  assert(countOccurrences(zhPrompt, '# 请你评价') === 1, 'Expected evaluation header to appear once.');

  const enPrompt = buildForwardPrompt('User: What should I do?\n\nAI: Keep risk small.', false);
  assert(enPrompt.startsWith('Below is the full conversation context'), 'Expected en forward prompt intro.');
  assert(enPrompt.includes('# Conversation Context'), 'Expected en prompt to include context header.');
  assert(enPrompt.includes('# Your Evaluation'), 'Expected en prompt to include evaluation header.');

  const longConversation = Array.from({ length: 12 }, (_, index) => [
    `用户：第 ${index} 轮问题 ${'问'.repeat(1000)}`,
    `AI：第 ${index} 轮回答 ${'答'.repeat(1000)}`,
  ].join('\n\n')).join('\n\n');
  const truncated = truncateConversation(longConversation);
  assert(truncated.truncated === true, 'Expected long role conversation to be truncated.');
  assert(truncated.text.length <= MAX_CONVERSATION_CHARS, 'Expected truncated conversation to respect max length.');
  assert(!truncated.text.includes('第 0 轮问题'), 'Expected earliest role blocks to be omitted.');
  assert(truncated.text.includes('第 11 轮回答'), 'Expected latest role block to be preserved.');
  assert(/^(用户|AI)：/.test(truncated.text), 'Expected truncated role conversation to start at a role boundary.');

  const veryLongLatestBlock = `用户：短问题\n\nAI：${'超长回答'.repeat(8000)}`;
  const singleBlockTruncated = truncateConversation(veryLongLatestBlock);
  assert(singleBlockTruncated.truncated === true, 'Expected very long latest block to be truncated.');
  assert(singleBlockTruncated.text.length <= MAX_CONVERSATION_CHARS, 'Expected very long latest block to respect max length.');
  assert(singleBlockTruncated.text.startsWith('AI：'), 'Expected very long latest block to keep the role label.');

  const truncatedPrompt = buildForwardPrompt(truncated.text, true);
  assert(truncatedPrompt.startsWith('注意：原始对话较长'), 'Expected truncated zh prompt to start with truncation notice.');
  assert(countOccurrences(truncatedPrompt, '# 对话上下文') === 1, 'Expected truncated prompt context header to appear once.');

  console.log('Forward prompt test passed.');
}

main();
