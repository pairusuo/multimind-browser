export type PromptLanguage = 'zh' | 'en';

interface DocumentPromptText {
  intro: string;
  grounding: string;
  uncertainty: string;
  distillationRules: string;
  markdownInstruction: string;
  outputHeader: string;
  outputInstruction: string;
  headings: string[];
  sourceHeader: string;
  sourceInstruction: string;
  apiAnswerLabel: string;
}

const DOCUMENT_PROMPT_TEXT: Record<PromptLanguage, DocumentPromptText> = {
  zh: {
    intro: '请基于当前对话上下文，整理一份可长期复用的最终结论型结构化文档。',
    grounding: '只基于当前对话中已经出现的信息总结，不编造信息，不补充对话外事实。',
    uncertainty: '不确定、材料未说明、需要外部验证的内容，统一放入“待核查事项”。',
    distillationRules: '蒸馏规则：默认不写来源主语，直接陈述观点本身；多个 AI 或多轮讨论重复确认的内容，合并为一条最完整、最有用的结论；保留具体数字、条件、例外、风险边界和可执行判断标准，不要压缩成空泛原则；可以加入极少量解释性连接，把对话中已经出现的因果关系理顺，但不能添加对话外事实。顶层标题只能写主题本身，不要包含“总结”“文档”“沉淀文档”“结构化总结”“复盘”“报告”等元信息。摘要只概括最终内容和适用范围，不说明“本文整合了多轮讨论”“基于对话内信息”“保留了哪些材料”这类生成过程。',
    markdownInstruction: '请输出原始 Markdown 源码，不要只输出渲染后的富文本。为方便复制，请把完整文档放在一个 markdown 代码块中；代码块内只包含文档正文，不要添加额外说明。',
    outputHeader: '# 输出格式',
    outputInstruction: '先生成且只生成一个一级标题，然后严格使用下面六个二级标题，保持顺序，不要添加额外章节，也不要重复一级标题或再添加“标题”章节。文档只呈现沉淀后的结论，不展示讨论过程、回答对比过程或转发过程。不要使用“原始提问”“第一版 AI 回答”“第二份 AI 回答”“不同 AI 生成的回答”“评价对象”“前文/上文回答”等过程性措辞；如需吸收这些信息，请直接改写成最终结论、边界条件或可执行建议。',
    headings: [
      '## 摘要',
      '## 背景与适用范围',
      '## 核心结论',
      '## 重要边界与风险',
      '## 待核查事项',
      '## 可执行建议',
    ],
    sourceHeader: '# 当前对话材料',
    sourceInstruction: '以下是同一问题下多个模型已经给出的回答。它们只是材料来源，不是最终文档结构；请吸收内容后直接输出最终结论文档。',
    apiAnswerLabel: '格子 {{index}} - {{model}}',
  },
  en: {
    intro: 'Based on the current conversation context, create a durable structured document of final conclusions.',
    grounding: 'Summarize only information already present in the current conversation. Do not invent facts or add outside information.',
    uncertainty: 'Put uncertain, unspecified, or externally verifiable claims under "Items to Verify".',
    distillationRules: 'Distillation rules: by default, do not name the source speaker or AI; state the idea directly. Merge repeated points confirmed by multiple AIs or multiple turns into the most complete and useful conclusion. Preserve concrete numbers, conditions, exceptions, risk boundaries, and actionable decision criteria instead of flattening them into vague principles. You may add a very thin layer of explanatory connective tissue to clarify causal links already present in the conversation, but do not add facts from outside the conversation.',
    markdownInstruction: 'Output the raw Markdown source, not only rendered rich text. To make copying reliable, place the complete document inside one markdown code block; include only the document body inside that block and no extra explanation.',
    outputHeader: '# Output Format',
    outputInstruction:
      'Generate exactly one top-level title first, then use exactly the six second-level headings below, in order, with no extra sections, no repeated top-level title, and no separate "Title" section. Present only the distilled conclusions. Do not expose the discussion process, answer-comparison process, forwarding process, source-question labels, answer-version labels, or phrases such as "original question", "first AI answer", "second AI answer", "different AI-generated answers", "evaluation target", or "previous answer". If such context is useful, rewrite it directly as final conclusions, boundaries, or actionable recommendations. The top-level title must name only the topic itself; do not include meta labels such as "summary", "document", "distilled document", "structured summary", "review", or "report". The Summary section should summarize the final substance and scope only; it must not explain that the document integrates multiple rounds, uses conversation-only information, or preserves certain source materials.',
    headings: [
      '## Summary',
      '## Background and Scope',
      '## Core Conclusions',
      '## Key Boundaries and Risks',
      '## Items to Verify',
      '## Actionable Recommendations',
    ],
    sourceHeader: '# Current Conversation Materials',
    sourceInstruction: 'The following are answers already produced by multiple models for the same question. They are source material, not the final document structure; synthesize their substance and output the final conclusion document directly.',
    apiAnswerLabel: 'Cell {{index}} - {{model}}',
  },
};

export function detectContentLanguage(text: string): PromptLanguage {
  const chineseCharCount = (text.match(/[\u4e00-\u9fff]/g) ?? []).length;
  return chineseCharCount / Math.max(text.length, 1) > 0.08 ? 'zh' : 'en';
}

export function buildDocumentPrompt(language: PromptLanguage, sourceBlocks?: Array<{ index: number; model: string; content: string }>): string {
  const text = DOCUMENT_PROMPT_TEXT[language];
  const promptParts = [
    text.intro,
    text.grounding,
    text.uncertainty,
    text.distillationRules,
    text.markdownInstruction,
    '',
    text.outputHeader,
    text.outputInstruction,
    text.headings.join('\n'),
  ];

  if (!sourceBlocks?.length) {
    return promptParts.join('\n');
  }

  return [
    ...promptParts,
    '',
    text.sourceHeader,
    text.sourceInstruction,
    '',
    formatApiSourceBlocks(language, sourceBlocks),
  ].join('\n');
}

function formatApiSourceBlocks(language: PromptLanguage, sourceBlocks: Array<{ index: number; model: string; content: string }>): string {
  const text = DOCUMENT_PROMPT_TEXT[language];
  return sourceBlocks
    .map((block) => {
      const label = text.apiAnswerLabel
        .replace('{{index}}', String(block.index))
        .replace('{{model}}', block.model);
      return `## ${label}\n${block.content.trim()}`;
    })
    .join('\n\n');
}
