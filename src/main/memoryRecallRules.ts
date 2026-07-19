import {
  MemoryDocument,
  MemoryDocumentType,
  MemoryRecallReason,
  MemoryRecallScoreDetail,
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

const SUGGESTED_TAG_PATTERNS: Array<[string, RegExp]> = [
  ['用户档案', /(用户档案|个人档案|个人偏好|习惯|约束|user profile|preference)/i],
  ['投资', /(投资|股票|基金|仓位|本金|杠杆|回撤|风险|买入|卖出|持有|portfolio|stock|fund|risk)/i],
  ['风险厌恶', /(风险厌恶|低风险|稳健|保守|本金安全|保护本金|avoid risk|risk averse|conservative)/i],
  ['饮食', /(饮食|吃饭|餐厅|吃辣|不辣|辣|喝酒|抽烟|聚餐|food|restaurant|spicy|drink|smoke)/i],
  ['旅行', /(旅行|旅游|游玩|玩乐|行程|出行|travel|trip|itinerary)/i],
  ['不吃辣', /(不能吃辣|不吃辣|不辣|避开辣|少辣|no spicy|not spicy)/i],
  ['不喝酒', /(不喝酒|不能喝酒|无酒精|避开酒|no alcohol|do not drink)/i],
  ['不抽烟', /(不抽烟|不能抽烟|避开烟|no smoking|do not smoke)/i],
  ['项目', /(项目|产品|架构|需求|路线图|project|architecture|requirements?|roadmap)/i],
  ['决策准则', /(准则|规则|原则|决策标准|操作依据|判断标准|criteria|rule|principle|policy)/i],
];

export function inferMemoryType(title: string, tags: string[], contentMarkdown: string): MemoryDocumentType {
  const text = `${title}\n${tags.join('\n')}\n${contentMarkdown}`.toLowerCase();
  return MEMORY_TYPE_INFERENCE_PATTERNS.find(([, pattern]) => pattern.test(text))?.[0] ?? 'reference';
}

export function inferMemoryTags(title: string, contentMarkdown: string, existingTags: string[] = []): string[] {
  const seen = new Set(existingTags.map((tag) => tag.trim()).filter(Boolean));
  const text = `${title}\n${contentMarkdown}`.toLowerCase();

  for (const [tag, pattern] of SUGGESTED_TAG_PATTERNS) {
    if (pattern.test(text)) {
      seen.add(tag);
    }
  }

  return [...seen];
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
  scoreDetails: MemoryRecallScoreDetail[];
} {
  const terms = extractRecallTerms(query);
  const cjkChars = extractMeaningfulCjkChars(query);
  const normalizedQuery = normalizeForRecallMatch(query);
  const title = normalizeForRecallMatch(document.title);
  const originalQuestion = normalizeForRecallMatch(document.originalQuestion);
  const tags = document.tags.map(normalizeForRecallMatch);
  const body = normalizeForRecallMatch(document.contentMarkdown);
  const matchReasons: MemoryRecallReason[] = [];
  const scoreDetails: MemoryRecallScoreDetail[] = [];
  let score = 0;
  const addScore = (reason: MemoryRecallReason, delta: number, matches: string[] = []) => {
    if (delta <= 0) {
      return;
    }
    score += delta;
    matchReasons.push(reason);
    scoreDetails.push({
      reason,
      score: delta,
      ...(matches.length ? { matches: [...new Set(matches)].slice(0, 8) } : {}),
    });
  };

  const matchedTitleTerms = terms.filter((term) => title.includes(normalizeForRecallMatch(term)));
  if (title.includes(normalizedQuery) || matchedTitleTerms.length) {
    addScore('title', 90, matchedTitleTerms.length ? matchedTitleTerms : [query]);
  }

  const matchedTags = tags.filter((tag) => tag.includes(normalizedQuery) || terms.some((term) => tag.includes(normalizeForRecallMatch(term))));
  if (matchedTags.length) {
    addScore('tag', 80, matchedTags);
  }

  const matchedOriginalQuestionTerms = terms.filter((term) => originalQuestion.includes(normalizeForRecallMatch(term)));
  if (originalQuestion.includes(normalizedQuery) || matchedOriginalQuestionTerms.length) {
    addScore('body', 55, matchedOriginalQuestionTerms.length ? matchedOriginalQuestionTerms : [query]);
  } else {
    const matchedBodyTerms = terms
      .map(normalizeForRecallMatch)
      .filter((term) => body.includes(term));
    const matchedBodyCjkChars = cjkChars.filter((char) => body.includes(char));
    if (hasMeaningfulBodyMatch(document.memoryType, matchedBodyTerms, matchedBodyCjkChars, normalizedQuery, body)) {
      addScore('body', Math.min(60, 25 + matchedBodyTerms.length * 5 + Math.min(10, matchedBodyCjkChars.length * 3)), [
        ...matchedBodyTerms,
        ...matchedBodyCjkChars.map((char) => `${char}*`),
      ]);
    }
  }

  if (score <= 0) {
    return {
      score: 0,
      matchReasons: [],
      scoreDetails: [],
    };
  }

  if (document.memoryType === 'profile' && querySuggestsPersonalization(query)) {
    addScore('profile_priority', 25);
  }

  if (document.memoryType === 'decision_rule' && querySuggestsDecision(query)) {
    addScore('decision_rule_priority', 22);
  }

  if (document.memoryScope === 'project') {
    const projectRelevant = matchReasons.includes('title') || matchReasons.includes('tag') || originalQuestion.includes(normalizedQuery);
    if (projectRelevant) {
      addScore('project_scope', 16);
    }
  } else {
    addScore('global_scope', 6);
  }

  addScore('recent', Math.max(0, 5 - Math.floor((Date.now() - document.updatedAt) / (30 * 24 * 60 * 60 * 1000))));

  return {
    score,
    matchReasons: [...new Set(matchReasons)],
    scoreDetails,
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
  memoryType: MemoryDocumentType,
  matchedTerms: string[],
  matchedCjkChars: string[],
  normalizedQuery: string,
  body: string,
): boolean {
  if (!matchedTerms.length && (memoryType !== 'profile' || matchedCjkChars.length < 2)) {
    return false;
  }

  if (body.includes(normalizedQuery) && normalizedQuery.length >= 4) {
    return true;
  }

  const strongTerms = matchedTerms.filter((term) => term.length >= 2 && !isWeakRecallTerm(term));
  return strongTerms.length >= 2 || strongTerms.some((term) => term.length >= 4) || (memoryType === 'profile' && matchedCjkChars.length >= 2);
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
