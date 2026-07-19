import {
  MemoryDocumentType,
  MemoryRecallItem,
  MemoryScope,
} from '../shared/types';
import { MEMORY_TYPE_PRIORITY } from './memoryRecallRules';

const AGENT_MEMORY_CONTEXT_TEXT = {
  zh: {
    title: '# 用户长期记忆',
    instruction: '以下内容是用户确认保存的长期背景。请只在与当前问题相关时使用；当前用户指令优先于长期记忆。',
    memoryTypeLabels: {
      profile: '稳定用户档案',
      decision_rule: '相关决策准则',
      project: '项目和任务背景',
      event: '情景事件记忆',
      reference: '参考资料',
    },
    memoryScopeLabels: {
      global: '全局',
      project: '项目',
    },
  },
  en: {
    title: '# User Long-Term Memory',
    instruction: 'The following memories were explicitly confirmed by the user. Use them only when relevant to the current request; the current user instruction takes priority over long-term memory.',
    memoryTypeLabels: {
      profile: 'Stable User Profile',
      decision_rule: 'Relevant Decision Rules',
      project: 'Project and Task Background',
      event: 'Episodic Memories',
      reference: 'Reference Material',
    },
    memoryScopeLabels: {
      global: 'global',
      project: 'project',
    },
  },
} satisfies Record<string, {
  title: string;
  instruction: string;
  memoryTypeLabels: Record<MemoryDocumentType, string>;
  memoryScopeLabels: Record<MemoryScope, string>;
}>;

export function buildAgentMemoryContext(items: MemoryRecallItem[], query: string, maxChars: number): string {
  const lang = detectChineseText(query) ? 'zh' : 'en';
  const text = AGENT_MEMORY_CONTEXT_TEXT[lang];
  const groupedItems = groupRecallItems(items);
  const sections = [
    text.title,
    '',
    text.instruction,
    '',
    ...groupedItems.flatMap(([memoryType, groupItems]) => [
      `## ${text.memoryTypeLabels[memoryType]}`,
      '',
      ...groupItems.flatMap((item, index) => {
        const tags = item.tags.length ? `; tags: ${item.tags.join(', ')}` : '';
        return [
          `### ${index + 1}. ${item.title} [${text.memoryScopeLabels[item.memoryScope]}${tags}]`,
          item.excerpt,
          '',
        ];
      }),
    ]),
  ];

  return truncateText(sections.join('\n').trim(), maxChars);
}

function groupRecallItems(items: MemoryRecallItem[]): Array<[MemoryDocumentType, MemoryRecallItem[]]> {
  const groups = new Map<MemoryDocumentType, MemoryRecallItem[]>();
  for (const item of items) {
    const group = groups.get(item.memoryType) ?? [];
    group.push(item);
    groups.set(item.memoryType, group);
  }
  return MEMORY_TYPE_PRIORITY
    .map((memoryType): [MemoryDocumentType, MemoryRecallItem[]] => [memoryType, groups.get(memoryType) ?? []])
    .filter(([, groupItems]) => groupItems.length > 0);
}

function detectChineseText(text: string): boolean {
  const chineseCharCount = (text.match(/[\u4e00-\u9fa5]/g) ?? []).length;
  return chineseCharCount / Math.max(text.length, 1) > 0.15;
}

function truncateText(text: string, maxChars: number): string {
  if (text.length <= maxChars) {
    return text;
  }
  return `${text.slice(0, Math.max(0, maxChars - 1)).trimEnd()}…`;
}
