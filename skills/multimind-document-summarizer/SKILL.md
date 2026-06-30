---
name: multimind-document-summarizer
description: Summarize a MultiMind Flow discussion from the summarizer AI's current conversation context into a structured document. Use when the product sends a summary instruction to a selected AI that already has the relevant context and needs a concise seven-section summary for preview, temporary storage, or later long-term memory.
---

# MultiMind Document Summarizer

Turn the selected summarizer AI's current conversation context into a complete Markdown structured document that the user can copy and save locally as a `.md` file.

The task is synthesis, not creative writing. Preserve what the material supports, separate uncertainty from conclusions, and do not invent facts.

## Input Contract

The product may send only a summary instruction, without embedding the full discussion material, when the selected AI already has the relevant context in its current conversation.

If explicit material is provided, expect one or more of these material blocks:

- Per-cell timelines from MultiMind Flow, usually formatted as `用户：...` and `AI：...`.
- Cell labels such as `格子 1 - DeepSeek`, `Cell 2 - ChatGPT`, or a site name.
- Forward records showing source cell, target cell, forwarded context, and target reply.
- Long-form discussion notes, transcripts, or article-like source material.
- Truncation notices indicating that earlier material was omitted.

If the current context or provided material contains multiple cells, treat each cell as one perspective in the same discussion. If it contains forward records, treat them as user-triggered cross-checks and use them to identify corrections, disagreements, and refinements.

## Language

Write the output in the dominant language of the source material:

- Use Chinese if the material is mainly Chinese.
- Use English if the material is mainly English.
- If the material is mixed, choose the language used by the user's original question or by most of the substantive discussion.

Do not follow the application UI language. Follow the discussion content.

## Output Format

Return exactly these seven top-level sections, in this order:

```markdown
## 标题
## 摘要
## 主要共识
## 关键分歧与修正
## 最终结论
## 待核查事项
## 可执行建议
```

For English output, use the equivalent headings:

```markdown
## Title
## Summary
## Main Consensus
## Key Disagreements and Corrections
## Final Conclusion
## Items to Verify
## Actionable Recommendations
```

Do not add a preface, system note, appendix, or extra section.

Put the full document inside one fenced `markdown` code block so the user can copy it directly and save it as a `.md` file.

## Section Rules

### 标题 / Title

Write one specific title that describes the actual topic. Avoid generic titles such as "Discussion Summary" or "AI Comparison Summary".

### 摘要 / Summary

Write 1-3 compact paragraphs. Capture each cell's discussion starting point when there are multiple starts, the discussion direction, and the most important result. If the material was truncated, mention that the summary is based on the retained material.

### 主要共识 / Main Consensus

List the points where the cells or sources broadly agree. Merge duplicate claims. Preserve concrete names, numbers, dates, constraints, and examples when they matter.

### 关键分歧与修正 / Key Disagreements and Corrections

Focus on disagreements, missing points, factual corrections, and places where one AI improved or challenged another answer. If there are no meaningful disagreements, say so briefly and list the main caveats instead.

### 最终结论 / Final Conclusion

State the best-supported conclusion after considering the full discussion. Do not present a shaky claim as settled. If the material supports multiple possible conclusions, name the condition that decides between them.

### 待核查事项 / Items to Verify

List facts, assumptions, dates, legal/medical/financial claims, external references, or implementation details that need independent verification. If nothing needs verification, write a short explicit note instead of inventing tasks.

### 可执行建议 / Actionable Recommendations

Give concrete next steps. Prefer actions the user can actually take. Separate immediate next steps from larger follow-up work when useful, but keep the section concise.

## Workflow

1. Read the current conversation context before writing. If explicit material is provided, read all material first.
2. Identify each cell's first user message separately instead of guessing one global "original question" when multiple starts exist.
3. Build a mental map of: initial questions, each AI's answer, forwarded cross-checks, corrections, consensus, disagreements, and unresolved claims.
4. Collapse repeated points across cells. Do not give equal space to every AI just for symmetry.
5. Promote cross-check outcomes into the right sections:
   - Agreement goes to `主要共识`.
   - Corrections and rebuttals go to `关键分歧与修正`.
   - Remaining uncertainty goes to `待核查事项`.
6. Write the seven-section document.
7. Review for unsupported claims, missing caveats, duplicated content, and section drift.

## Evidence Discipline

- Base the document only on the provided material.
- Do not browse, add external facts, or complete missing context unless the user explicitly asks for research.
- Keep uncertainty visible. Use `材料未说明`, `需要核查`, or the English equivalent when needed.
- Preserve useful specifics: product names, model names, people, organizations, numbers, dates, URLs, constraints, and implementation decisions.
- Remove process noise: UI status messages, repeated prompt wrappers, boilerplate instructions, and internal app metadata unless they affect the conclusion.
- If material includes a truncation notice, do not imply that the full original discussion was reviewed.

## Style

Write from the product perspective. The document should read like a durable work artifact, not a diary of what the AI did.

Use clear prose and compact bullets where they improve scanability. Avoid hype, motivational language, and vague summary phrases. Prefer precise claims over broad abstractions.

## Do Not

- Do not invent facts, citations, or user intent.
- Do not evaluate which AI is better unless the material asks for model comparison.
- Do not include developer diary language such as `I generated`, `I analyzed`, or `the prompt says`.
- Do not preserve repeated forward-prompt wrappers as content.
- Do not turn every minor difference into a major disagreement.
- Do not save to long-term memory or claim persistence; this skill only produces the document content.
