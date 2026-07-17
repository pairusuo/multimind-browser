export type PromptLanguage = 'zh' | 'en';

export const MAX_CONVERSATION_CHARS = 20000;

export function truncateConversation(fullText: string): { text: string; truncated: boolean } {
  if (fullText.length <= MAX_CONVERSATION_CHARS) {
    return { text: fullText, truncated: false };
  }

  const blocks = parseRoleBlocks(fullText);
  if (blocks?.length) {
    const keptBlocks: Array<{ role: 'user' | 'assistant'; content: string }> = [];
    let usedChars = 0;

    for (let index = blocks.length - 1; index >= 0; index -= 1) {
      const block = blocks[index];
      const formattedBlock = formatRoleBlocks([block]);
      const separatorChars = keptBlocks.length ? 2 : 0;
      if (usedChars + separatorChars + formattedBlock.length > MAX_CONVERSATION_CHARS) {
        break;
      }
      keptBlocks.unshift(block);
      usedChars += separatorChars + formattedBlock.length;
    }

    if (keptBlocks.length) {
      return {
        text: formatRoleBlocks(keptBlocks),
        truncated: true,
      };
    }

    const latestBlock = blocks.at(-1);
    if (latestBlock) {
      const roleLabel = latestBlock.role === 'user' ? '用户：' : 'AI：';
      const contentBudget = Math.max(0, MAX_CONVERSATION_CHARS - roleLabel.length);
      return {
        text: `${roleLabel}${latestBlock.content.slice(-contentBudget)}`,
        truncated: true,
      };
    }
  }

  return {
    text: fullText.slice(fullText.length - MAX_CONVERSATION_CHARS),
    truncated: true,
  };
}

export function buildForwardPrompt(
  sourceContent: string,
  sourceTruncated: boolean,
): string {
  const text = FORWARD_PROMPT_TEXT[detectContentLanguage(sourceContent)];
  const header = sourceTruncated ? text.truncateNotice : text.intro;

  return [
    header,
    '',
    text.contextHeader,
    sourceContent,
    '',
    text.evaluateHeader,
    text.evaluateInstruction,
  ].join('\n');
}

export function detectContentLanguage(text: string): PromptLanguage {
  const chineseCharCount = (text.match(/[\u4e00-\u9fa5]/g) ?? []).length;
  return chineseCharCount / Math.max(text.length, 1) > 0.15 ? 'zh' : 'en';
}

export function parseRoleBlocks(content: string): Array<{ role: 'user' | 'assistant'; content: string }> | null {
  const lines = content.trim().split('\n');
  if (!lines.some((line) => /^(用户|AI)：/.test(line.trim()))) {
    return null;
  }

  const blocks: Array<{ role: 'user' | 'assistant'; content: string[] }> = [];
  lines.forEach((line) => {
    const trimmed = line.trim();
    const match = /^(用户|AI)：(.*)$/.exec(trimmed);
    if (match) {
      blocks.push({
        role: match[1] === '用户' ? 'user' : 'assistant',
        content: [match[2].trim()],
      });
      return;
    }

    const current = blocks.at(-1);
    if (current) {
      current.content.push(line);
    }
  });

  return blocks.map((block) => ({
    role: block.role,
    content: block.content.join('\n').trim(),
  }));
}

export function formatRoleBlocks(blocks: Array<{ role: 'user' | 'assistant'; content: string }>): string {
  return blocks
    .filter((block) => block.content.trim())
    .map((block) => `${block.role === 'user' ? '用户' : 'AI'}：${block.content.trim()}`)
    .join('\n\n');
}

const FORWARD_PROMPT_TEXT: Record<PromptLanguage, {
  intro: string;
  contextHeader: string;
  evaluateHeader: string;
  evaluateInstruction: string;
  truncateNotice: string;
}> = {
  zh: {
    intro: '下面是一段用户与其它 AI 的完整对话上下文。',
    contextHeader: '# 对话上下文',
    evaluateHeader: '# 请你评价',
    evaluateInstruction: '请先理解上面的完整讨论脉络，再评价一下该 AI 回答：有没有遗漏、错误、需要补充或反驳的地方？',
    truncateNotice: '注意：原始对话较长，已省略最早的部分，以下是保留的最近对话内容。',
  },
  en: {
    intro: 'Below is the full conversation context between the user and another AI.',
    contextHeader: '# Conversation Context',
    evaluateHeader: '# Your Evaluation',
    evaluateInstruction:
      'Please understand the full discussion above before evaluating the last AI response: are there omissions, errors, or points that need elaboration or rebuttal?',
    truncateNotice: 'Note: the original conversation was long; the earliest portions were omitted. Below is the retained recent content.',
  },
};
