import {
  MemoryDocument,
  MemoryDocumentType,
  MemoryRecallReason,
  MemoryScope,
} from '../shared/types';

export const MEMORY_TYPE_PRIORITY: MemoryDocumentType[] = ['profile', 'decision_rule', 'project', 'event', 'reference'];
export const MEMORY_SCOPE_PRIORITY: MemoryScope[] = ['global', 'project'];

const WEAK_RECALL_TERMS = new Set([
  '一下',
  '一些',
  '这个',
  '这只',
  '那个',
  '相关',
  '问题',
  '计划',
  '推荐',
  '帮我',
  '分析',
  '判断',
  '需要',
  '注意',
  '可以',
  '是否',
  '怎么',
  '什么',
  '最近',
  '很多',
]);

const WEAK_RECALL_CHARS = new Set([
  '我',
  '的',
  '了',
  '是',
  '在',
  '有',
  '和',
  '与',
  '或',
  '这',
  '那',
  '个',
  '一',
  '些',
  '下',
  '能',
  '要',
  '想',
  '请',
  '帮',
  '看',
  '说',
  '做',
  '用',
  '为',
  '到',
  '去',
  '来',
  '给',
  '把',
  '对',
  '就',
  '也',
  '都',
  '很',
  '多',
  '少',
  '新',
  '旧',
  '好',
]);

const MEMORY_TYPE_INFERENCE_PATTERNS: Array<[MemoryDocumentType, RegExp]> = [
  ['profile', /(用户档案|个人档案|个人偏好|风险偏好|投资偏好|习惯|原则偏好|user profile|preference|risk tolerance)/i],
  ['decision_rule', /(准则|规则|原则|决策标准|操作依据|判断标准|decision rule|rule|principle|criteria|policy)/i],
  ['project', /(项目|方案|产品|架构|路线图|需求|project|roadmap|architecture|requirements?)/i],
  ['event', /(复盘|记录|会议|事件|经历|timeline|meeting|event|incident|retrospective)/i],
];

export function inferMemoryType(title: string, tags: string[], contentMarkdown: string): MemoryDocumentType {
  const text = `${title}\n${tags.join('\n')}\n${contentMarkdown}`.toLowerCase();
  return MEMORY_TYPE_INFERENCE_PATTERNS.find(([, pattern]) => pattern.test(text))?.[0] ?? 'reference';
}

export function normalizeMemoryDocumentType(value: string | null | undefined): MemoryDocumentType {
  return MEMORY_TYPE_PRIORITY.includes(value as MemoryDocumentType) ? value as MemoryDocumentType : 'reference';
}

export function normalizeMemoryScope(value: string | null | undefined): MemoryScope {
  return MEMORY_SCOPE_PRIORITY.includes(value as MemoryScope) ? value as MemoryScope : 'global';
}

export function memoryTypeWeight(memoryType: MemoryDocumentType): number {
  return MEMORY_TYPE_PRIORITY.indexOf(memoryType);
}

export function memoryScopeWeight(memoryScope: MemoryScope): number {
  return MEMORY_SCOPE_PRIORITY.indexOf(memoryScope);
}

export function scoreRecallCandidate(document: MemoryDocument, query: string): {
  score: number;
  matchReasons: MemoryRecallReason[];
} {
  const terms = extractRecallTerms(query);
  const cjkChars = extractMeaningfulCjkChars(query);
  const normalizedQuery = normalizeForRecallMatch(query);
  const title = normalizeForRecallMatch(document.title);
  const originalQuestion = normalizeForRecallMatch(document.originalQuestion);
  const tags = document.tags.map(normalizeForRecallMatch);
  const body = normalizeForRecallMatch(document.contentMarkdown);
  const matchReasons: MemoryRecallReason[] = [];
  let score = 0;

  if (title.includes(normalizedQuery) || terms.some((term) => title.includes(normalizeForRecallMatch(term)))) {
    score += 90;
    matchReasons.push('title');
  }

  if (tags.some((tag) => tag.includes(normalizedQuery) || terms.some((term) => tag.includes(normalizeForRecallMatch(term))))) {
    score += 80;
    matchReasons.push('tag');
  }

  if (originalQuestion.includes(normalizedQuery) || terms.some((term) => originalQuestion.includes(normalizeForRecallMatch(term)))) {
    score += 55;
    matchReasons.push('body');
  } else {
    const matchedBodyTerms = terms
      .map(normalizeForRecallMatch)
      .filter((term) => body.includes(term));
    const matchedBodyCjkChars = cjkChars.filter((char) => body.includes(char));
    if (hasMeaningfulBodyMatch(matchedBodyTerms, matchedBodyCjkChars, normalizedQuery, body)) {
      score += Math.min(60, 25 + matchedBodyTerms.length * 5 + Math.min(10, matchedBodyCjkChars.length * 3));
      matchReasons.push('body');
    }
  }

  if (score <= 0) {
    return {
      score: 0,
      matchReasons: [],
    };
  }

  if (document.memoryType === 'profile' && querySuggestsPersonalization(query)) {
    score += 25;
    matchReasons.push('profile_priority');
  }

  if (document.memoryType === 'decision_rule' && querySuggestsDecision(query)) {
    score += 22;
    matchReasons.push('decision_rule_priority');
  }

  if (document.memoryScope === 'project') {
    const projectRelevant = matchReasons.includes('title') || matchReasons.includes('tag') || originalQuestion.includes(normalizedQuery);
    if (projectRelevant) {
      score += 16;
      matchReasons.push('project_scope');
    }
  } else {
    score += 6;
    matchReasons.push('global_scope');
  }

  score += Math.max(0, 5 - Math.floor((Date.now() - document.updatedAt) / (30 * 24 * 60 * 60 * 1000)));
  matchReasons.push('recent');

  return {
    score,
    matchReasons: [...new Set(matchReasons)],
  };
}

export function extractRecallTerms(query: string): string[] {
  const chineseTerms = (query.match(/[\u4e00-\u9fa5]{2,}/g) ?? []).flatMap((term) => {
    const windows = new Set<string>();
    for (let size = 2; size <= Math.min(4, term.length); size += 1) {
      for (let index = 0; index <= term.length - size; index += 1) {
        windows.add(term.slice(index, index + size));
      }
    }
    return [...windows];
  });
  const latinTerms = query.match(/[a-zA-Z0-9][a-zA-Z0-9_-]{2,}/g) ?? [];
  return [...chineseTerms, ...latinTerms]
    .map((term) => term.trim())
    .filter((term) => !isWeakRecallTerm(term))
    .filter(Boolean);
}

export function extractMeaningfulCjkChars(query: string): string[] {
  return [...new Set(query.match(/[\u4e00-\u9fa5]/g) ?? [])]
    .filter((char) => !isWeakRecallChar(char));
}

export function normalizeForRecallMatch(text: string): string {
  return text.replace(/\s+/g, ' ').trim().toLowerCase();
}

function hasMeaningfulBodyMatch(
  matchedTerms: string[],
  matchedCjkChars: string[],
  normalizedQuery: string,
  body: string,
): boolean {
  if (!matchedTerms.length && matchedCjkChars.length < 2) {
    return false;
  }

  if (body.includes(normalizedQuery) && normalizedQuery.length >= 4) {
    return true;
  }

  const strongTerms = matchedTerms.filter((term) => term.length >= 2 && !isWeakRecallTerm(term));
  return strongTerms.length >= 2 || strongTerms.some((term) => term.length >= 4) || matchedCjkChars.length >= 2;
}

function querySuggestsPersonalization(query: string): boolean {
  return /(我|我的|适合我|偏好|风险|经验|习惯|长期|稳健|should i|for me|my |risk tolerance|preference)/i.test(query);
}

function querySuggestsDecision(query: string): boolean {
  return /(是否|应该|可以|怎么买|怎么卖|买入|卖出|持有|判断|建议|决策|规则|准则|should|buy|sell|hold|decide|criteria|rule)/i.test(query);
}

function isWeakRecallTerm(term: string): boolean {
  return WEAK_RECALL_TERMS.has(term);
}

function isWeakRecallChar(char: string): boolean {
  return WEAK_RECALL_CHARS.has(char);
}
