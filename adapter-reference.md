# 注入适配器技术参考

> 本文档记录各 AI 网站输入框的 DOM 结构和注入方式。
> 当网站更新导致适配器失效时，先更新本文档，再修改对应适配器文件。

---

## 通用原则

### 为什么不能直接赋值

各 AI 网站的输入框都由 React 或类似框架管理。直接 `element.value = text`
不会触发框架的状态更新，导致发送按钮保持禁用，或者发送出去的是空内容。

必须通过原生 setter 绕过框架拦截：

```javascript
// textarea 类输入框
function setNativeValue(el, value) {
  const nativeSetter = Object.getOwnPropertyDescriptor(
    HTMLTextAreaElement.prototype, 'value'
  ).set;
  nativeSetter.call(el, value);
  el.dispatchEvent(new Event('input', { bubbles: true }));
  el.dispatchEvent(new Event('change', { bubbles: true }));
}

// contenteditable 类输入框
function setNativeInnerText(el, value) {
  el.focus();
  // 清空现有内容
  document.execCommand('selectAll', false, null);
  document.execCommand('delete', false, null);
  // 插入新内容
  document.execCommand('insertText', false, value);
}
```

### 等待元素就绪

注入时页面可能尚未加载完成，需要等待输入框出现：

```javascript
function waitForElement(selector, timeout = 5000) {
  return new Promise((resolve, reject) => {
    const el = document.querySelector(selector);
    if (el) return resolve(el);
    const observer = new MutationObserver(() => {
      const el = document.querySelector(selector);
      if (el) { observer.disconnect(); resolve(el); }
    });
    observer.observe(document.body, { childList: true, subtree: true });
    setTimeout(() => { observer.disconnect(); reject(new Error('timeout')); }, timeout);
  });
}
```

---

## Claude (claude.ai)

### 输入框特征

- 类型：`contenteditable` div（不是 textarea）
- 定位方式（按优先级）：
  1. `div[contenteditable="true"][data-testid="chat-input"]`
  2. `div[contenteditable="true"].ProseMirror`
  3. `div[contenteditable="true"]`（取最后一个，避免选到只读元素）

### 发送按钮特征

- `button[data-testid="send-button"]`
- 或 `button[aria-label="Send message"]`
- 发送按钮在输入框有内容时才变为可用状态（`disabled` 属性消失）

### 注入方式

```javascript
// claude.ts 的 injectScript 实现参考
async function inject(text) {
  // 1. 找输入框
  const input = document.querySelector('div[contenteditable="true"][data-testid="chat-input"]')
    || [...document.querySelectorAll('div[contenteditable="true"]')].at(-1);
  if (!input) return false;

  // 2. 填入文字
  input.focus();
  document.execCommand('selectAll', false, null);
  document.execCommand('insertText', false, text);

  // 3. 等待发送按钮变为可用
  await new Promise(r => setTimeout(r, 300));

  // 4. 点击发送
  const btn = document.querySelector('button[data-testid="send-button"]')
    || document.querySelector('button[aria-label="Send message"]');
  if (btn && !btn.disabled) {
    btn.click();
    return true;
  }

  // 5. 回退：模拟 Enter
  input.dispatchEvent(new KeyboardEvent('keydown', {
    key: 'Enter', code: 'Enter', bubbles: true, cancelable: true
  }));
  return true;
}
```

### 已知问题

- 上传附件后发送按钮选择器可能变化，目前先忽略此场景
- 新对话按钮：`button[data-testid="new-conversation"]`（如果需要开新对话时用）

---

## ChatGPT (chatgpt.com)

### 输入框特征

- 类型：`div[contenteditable="true"]`（GPT-4o UI，2025年后的新版）
- 旧版 UI 是 `textarea#prompt-textarea`，目前已基本切换到新版
- 定位：`div#prompt-textarea[contenteditable="true"]`（id + contenteditable 双重确认）

### 发送按钮特征

- `button[data-testid="send-button"]`
- 或 `button[aria-label="Send prompt"]`
- 注意：按钮的 `aria-disabled` 属性（不是 HTML `disabled`）控制是否可点击

### 注入方式

```javascript
async function inject(text) {
  // 新版 UI
  let input = document.querySelector('#prompt-textarea[contenteditable="true"]');

  // 旧版 UI 降级
  if (!input) {
    input = document.querySelector('textarea#prompt-textarea');
  }
  if (!input) return false;

  input.focus();

  if (input.tagName === 'TEXTAREA') {
    // 旧版 textarea
    const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set;
    setter.call(input, text);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  } else {
    // 新版 contenteditable
    document.execCommand('selectAll', false, null);
    document.execCommand('insertText', false, text);
  }

  await new Promise(r => setTimeout(r, 300));

  // 发送按钮（注意 aria-disabled 不是 disabled）
  const btn = document.querySelector('button[data-testid="send-button"]')
    || document.querySelector('button[aria-label="Send prompt"]');
  if (btn && btn.getAttribute('aria-disabled') !== 'true') {
    btn.click();
    return true;
  }

  // 回退：Enter 键
  input.dispatchEvent(new KeyboardEvent('keydown', {
    key: 'Enter', code: 'Enter', bubbles: true, cancelable: true
  }));
  return true;
}
```

### 已知问题

- ChatGPT 有较严格的自动化检测，注入间隔不要太短（各格子之间加 100-200ms 延迟）
- 如果检测到自动化行为，网站可能弹出验证，目前无法绕过，属于已知限制

---

## DeepSeek (chat.deepseek.com)

### 输入框特征

- 类型：`textarea`（相对最简单）
- 定位：`textarea[placeholder]`（页面上通常只有一个）
- 或 `#chat-input`（如果有 id）

### 发送按钮特征

- `button[aria-label="Send"]`
- 或输入框旁边的 `button` 元素（取最后一个 button）

### 注入方式

```javascript
async function inject(text) {
  const input = document.querySelector('textarea');
  if (!input) return false;

  input.focus();
  const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set;
  setter.call(input, text);
  input.dispatchEvent(new Event('input', { bubbles: true }));

  await new Promise(r => setTimeout(r, 200));

  // DeepSeek 通常用 Enter 发送
  input.dispatchEvent(new KeyboardEvent('keydown', {
    key: 'Enter', code: 'Enter', bubbles: true, cancelable: true, composed: true
  }));

  return true;
}
```

### 已知问题

- DeepSeek 在思考模式下（R1 模型）有额外的 toggle 按钮，不影响注入
- 网络较慢时输入框加载较晚，需要等待

---

## Gemini (gemini.google.com)

### 输入框特征

- 类型：`div[contenteditable="true"]`（Google 的 rich-textarea 组件）
- 定位：`rich-textarea div[contenteditable="true"]`
- 或 `div.ql-editor[contenteditable="true"]`（Quill 编辑器）
- Google 经常更新 UI，选择器稳定性最差

### 发送按钮特征

- `button[aria-label="Send message"]`
- 或 `button.send-button`
- 注意：Gemini 的发送按钮可能是 Material Icon，用 `aria-label` 最稳

### 注入方式

```javascript
async function inject(text) {
  // Gemini 使用 rich-textarea 自定义组件
  let input = document.querySelector('rich-textarea div[contenteditable="true"]');
  if (!input) {
    input = document.querySelector('div.ql-editor[contenteditable="true"]');
  }
  if (!input) {
    // 最后降级：找任何 contenteditable
    input = document.querySelector('[contenteditable="true"]');
  }
  if (!input) return false;

  input.focus();
  // 清空
  document.execCommand('selectAll', false, null);
  document.execCommand('delete', false, null);
  // 输入（Gemini 需要用 insertText 而不是直接赋值）
  document.execCommand('insertText', false, text);

  // 等待输入法确认（Gemini 有输入法检测逻辑）
  await new Promise(r => setTimeout(r, 400));

  const btn = document.querySelector('button[aria-label="Send message"]')
    || document.querySelector('button[aria-label="发送消息"]');  // 中文界面
  if (btn && !btn.disabled && !btn.hasAttribute('aria-disabled')) {
    btn.click();
    return true;
  }

  // 回退：Enter
  input.dispatchEvent(new KeyboardEvent('keydown', {
    key: 'Enter', code: 'Enter', bubbles: true
  }));
  return true;
}
```

### 已知问题

- Gemini 对输入法事件有特殊处理，有时需要触发 `compositionend` 事件
- Google 账号登录状态在 Electron WebContentsView 中需要注意 User-Agent 设置
- 建议设置 User-Agent 为 Chrome 的标准 UA，避免被识别为非浏览器环境：
  ```typescript
  view.webContents.setUserAgent(
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 ' +
    '(KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36'
  );
  ```

---

## 通用 User-Agent 配置（重要）

所有 WebContentsView 都需要设置标准的 Chrome User-Agent，否则部分网站
会检测到 Electron 环境并拒绝服务或展示降级界面：

```typescript
// windowManager.ts 中创建 view 时
const view = new WebContentsView({
  webPreferences: {
    partition: `persist:cell-${cellId}`,
    nodeIntegration: false,
    contextIsolation: true,
  }
});

// macOS Intel
view.webContents.setUserAgent(
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) ' +
  'AppleWebKit/537.36 (KHTML, like Gecko) ' +
  'Chrome/131.0.0.0 Safari/537.36'
);
```

---

## 适配器失效时的排查流程

当某个 AI 网站更新后注入失效，按以下步骤排查：

1. 在 MultiMind Browser 中打开该 AI 网站，按 F12 打开该格子的 DevTools
   （主进程代码：`view.webContents.openDevTools({ mode: 'detach' })`）

2. 在 DevTools Console 里手动测试选择器：
   ```javascript
   // 确认输入框
   document.querySelector('div[contenteditable="true"]')

   // 确认发送按钮
   document.querySelector('button[aria-label="Send message"]')
   ```

3. 找到新的选择器后更新对应适配器文件

4. 更新本文档记录新的选择器

---

## 注入时序（多格子并发时）

同时向多个格子注入时，不要完全并发，加入少量延迟避免触发网站的反自动化检测：

```typescript
// ipcHandlers.ts 中处理 SEND_TO_ALL 时
async function sendToAll(text: string, cells: string[]) {
  const results: Record<string, boolean> = {};
  for (const cellId of cells) {
    results[cellId] = await injectToCell(cellId, text);
    // 各格子之间加 150ms 延迟
    await new Promise(r => setTimeout(r, 150));
  }
  return results;
}
```

---

## 读取适配器（第二阶段新增）

> 这部分是第二阶段「讨论 → 文档沉淀」流程的技术基础。在写入适配器的
> 基础上新增"读取 AI 回答内容"和"判断回答是否生成完毕"两个能力。

### 为什么读取比写入难

写入只需要找到输入框、填值、触发发送，是一次性的离散动作。读取需要：

1. 准确定位"最新一条 AI 回答"在 DOM 中的位置（不是用户的问题，是 AI 的回复）
2. 判断这条回答是否已经生成完毕（流式输出过程中读取会拿到不完整的内容）
3. 处理回答内容中可能包含的代码块、列表、表格等富文本结构，决定提取
   纯文本还是保留基本格式

### 通用判断"生成是否完毕"的常见模式

不同网站实现方式不同，但大致可归为以下几类信号，按可靠性排序：

**模式一：停止生成按钮消失/变回发送按钮**（最可靠）

AI 网站在生成过程中通常会把发送按钮替换为"停止生成"按钮，生成完毕后
变回正常的发送按钮（可点击状态）。这是最明确的完成信号。

```javascript
function isGenerating() {
  // 检查是否存在"停止生成"按钮（具体选择器因站点而异）
  const stopButton = document.querySelector('button[aria-label*="Stop"]')
    || document.querySelector('button[aria-label*="停止"]');
  return !!stopButton;
}

// 完成判断：轮询直到 isGenerating() 返回 false
async function waitForCompletion(timeout = 60000) {
  const start = Date.now();
  while (isGenerating()) {
    if (Date.now() - start > timeout) return false;  // 超时
    await new Promise(r => setTimeout(r, 500));
  }
  return true;
}
```

**模式二：流式光标元素消失**

部分网站在 AI 正在输出时，回答末尾会有一个闪烁的光标占位元素
（class 名常包含 `cursor`、`typing`、`streaming` 等关键词），生成完毕后
该元素被移除。

```javascript
function isStreaming() {
  return !!document.querySelector('.result-streaming, .typing-cursor, [data-streaming="true"]');
}
```

**模式三：最后一条消息的内容在一段时间内不再变化**（兜底方案，不推荐
作为首选，因为不够精确）

```javascript
async function waitForContentStable(getContent, stableMs = 1500, timeout = 60000) {
  const start = Date.now();
  let lastContent = getContent();
  let lastChangeTime = Date.now();

  while (Date.now() - start < timeout) {
    await new Promise(r => setTimeout(r, 300));
    const current = getContent();
    if (current !== lastContent) {
      lastContent = current;
      lastChangeTime = Date.now();
    } else if (Date.now() - lastChangeTime > stableMs) {
      return true;  // 内容已经稳定 stableMs 毫秒，认为生成完毕
    }
  }
  return false;  // 超时
}
```

### 提取最新回答内容

定位到最后一条由 AI（非用户）发出的消息容器，提取其文本内容：

```javascript
// 通用思路：AI 消息和用户消息通常有不同的 class 或 data 属性区分
function extractLatestResponse() {
  // 具体选择器需要按各站点 DOM 结构调整，以下为示意结构
  const messages = document.querySelectorAll('[data-message-author="assistant"]');
  if (messages.length === 0) return '';
  const latest = messages[messages.length - 1];
  return latest.innerText.trim();
}
```

**关于格式保留**：第二阶段的"交叉验证"场景下，转述给另一个 AI 时使用
纯文本（`innerText`）即可，不需要保留 markdown 格式或代码高亮，因为
转述的目的是让另一个 AI 理解内容大意，不是完整还原原始排版。

### 各站点适配状态（开发时逐步填充，建立一个跟踪表）

| 网站 | 完成判断模式 | 回答提取选择器 | 验证状态 |
|-----|------------|-------------|---------|
| Claude (claude.ai) | 待确认（建议先试模式一：发送按钮状态） | 待确认 | 未开始 |
| ChatGPT (chatgpt.com) | 待确认（建议先试模式一：Stop generating 按钮） | 待确认 | 未开始 |
| DeepSeek (chat.deepseek.com) | 待确认 | 待确认 | 未开始 |

> 开发第二阶段时，每完成一个站点的读取适配器验证，在此表格中更新具体
> 选择器和验证状态，避免后续维护时重新摸索。这个表格是「读取适配器」
> 的活文档，应该随开发进度持续更新，不要等全部完成后一次性补充。

### 读取适配器的失败处理

如果在超时时间内无法判断生成是否完毕，或者提取不到任何回答内容，
读取适配器应该返回明确的失败信号（如返回 `null` 而不是空字符串），
调用方据此判断该格子在本轮交叉验证中跳过，不阻塞其他格子的流程，
并通过统一提示系统告知用户"某个 AI 的回答未能读取，已跳过"。
