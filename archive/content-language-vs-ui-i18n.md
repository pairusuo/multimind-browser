# UI 国际化与内容语言适配决策记录

本文记录 MultiMind Flow 第二阶段中“界面语言”和“发给 AI 的任务框架语言”的边界，供后续转发、总结文档、长期记忆等功能实现时参考。

## 结论

MultiMind Flow 的 UI 国际化只负责应用界面，不决定用户讨论内容的语言。

发给 AI 的预置任务框架 prompt 应跟随讨论内容本身，而不是跟随 UI 语言。也就是说：

- 用户使用英文 UI，但讨论中文内容时，转发/总结 prompt 应使用中文框架文案。
- 用户使用中文 UI，但讨论英文内容时，转发/总结 prompt 应使用英文框架文案。
- 总结文档的输出语言也应跟随讨论内容本身。

## 两套语言系统

### UI 文案

走 i18n 系统，覆盖 MultiMind Flow 自己的界面与提示，例如：

- 按钮、菜单、modal 标题
- 状态提示
- 错误提示
- `conversation-truncated` 这类给用户看的 notice

这些文案应跟随用户选择的应用界面语言。

### AI 任务框架 prompt

不走 UI i18n。它是发给目标 AI 的任务说明，应该跟随材料内容语言，例如：

- 转发 prompt 的 intro、context header、evaluation instruction
- 总结文档 prompt 的角色说明、材料结构、输出格式要求
- 总结文档的七段式标题

这些文案应由 `detectContentLanguage(materialText)` 或等价逻辑选择。

## 当前转发实现

转发功能已经按此规则调整。

`buildForwardPrompt(sourceContent, sourceTruncated)` 会根据 `sourceContent` 检测内容语言，选择 `FORWARD_PROMPT_TEXT.zh/en`：

- 中文：`# 对话上下文`、`# 请你评价`
- 英文：`# Conversation Context`、`# Your Evaluation`

裁切提示也跟随内容语言。

现有转发 prompt 解析逻辑需要继续同时支持中文和英文标题，避免多跳转发、DOM 提取、时间线清洗时无法识别旧 prompt。

## 当前语言检测范围

当前检测不是通用语言识别，只区分 `zh | en`。

逻辑是中文字符占比判断：

```ts
function detectContentLanguage(text: string): 'zh' | 'en' {
  const chineseCharCount = (text.match(/[\u4e00-\u9fa5]/g) ?? []).length;
  return chineseCharCount / Math.max(text.length, 1) > 0.15 ? 'zh' : 'en';
}
```

含义：

- 中文字符占比超过 15%，视为中文。
- 否则视为英文。

因此，日语、韩语、法语、德语、西语等目前都会走英文框架 prompt。这是当前阶段的有意简化，因为产品 prompt 框架只维护中英文两套。

后续如需覆盖更多海外用户语言，应先确认是否愿意维护更多 prompt 版本，再扩展为 `ja`、`ko`、`fr`、`de`、`es` 等语言，或引入轻量语言检测库。

## 总结文档功能要求

总结功能遵守同一规则：

- 总结 prompt 不跟随 UI 语言。
- 总结 prompt 跟随总结者 AI 当前对话上下文的内容语言。
- 总结结果也应跟随当前对话上下文的内容语言。
- 中文材料使用中文七段式标题。
- 英文材料使用英文七段式标题。

当前产品决策是：选择某个 AI 作为总结者后，MultiMind Flow 只向该 AI 发送总结使用的指令 prompt，然后关闭选择窗口；不在选择窗口中等待总结完成，也不要求应用层把完整材料再次拼进 prompt。前提是负责总结的 AI 已经在当前会话里拥有完整上下文。

当前简易流程不做后台抽取、不弹预览、不落盘。总结 prompt 需要明确要求总结者 AI 生成完整 Markdown 文档，并把全文放入一个 `markdown` 代码块中，用户自行复制或下载保存为 `.md` 文件。后续如果重新接自动预览/落盘，需要先重新讨论捕获策略，不能用固定超时控制生成完成。

实现形态：

```ts
const lang = detectContentLanguage(knownSummarizerContext);
const prompt = buildDocumentPrompt(lang);
```

并维护类似转发的双语 prompt 常量：

```ts
const DOCUMENT_PROMPT_TEXT = {
  zh: { ... },
  en: { ... },
};
```

对应的产品内总结 skill 规范位于：

```text
skills/multimind-document-summarizer/SKILL.md
```

该文件已经写明：不要跟随应用 UI 语言，应跟随讨论内容语言。

## 实现边界

- 不要把 AI prompt 框架文案接入 i18next。
- 不要让 UI 语言影响转发或总结文档的内容语言。
- 不要为了支持“非中文语言”提前引入复杂语言检测依赖，除非同时决定维护对应语言的 prompt 模板。
- 如果材料被裁切，裁切提示既要进入发给 AI 的 prompt，也要通过 UI notice 告知用户；两边文案分别走内容语言和 UI 语言。
