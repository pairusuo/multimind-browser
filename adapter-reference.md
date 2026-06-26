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

  // 3. 轮询等待发送按钮真正变为可用，不要用固定延迟
  //    （2026年6月实测：发送按钮可用的延迟不固定，曾观察到比 300ms
  //    更久才可用的情况，固定延迟点击过早会导致"文本已填入但没有
  //    发送"，进而让上层编排逻辑误以为已发送、陷入等待新回答超时）
  const btn = await waitForEnabledButton(
    () => document.querySelector('button[data-testid="send-button"]')
      || document.querySelector('button[aria-label="Send message"]'),
    2000  // 超时上限（毫秒）
  );

  // 4. 点击发送，并确认输入框已清空（确认真正触发了发送，不只是
  //    "点击了按钮"——按钮被点击和发送真正生效不完全等价）
  if (btn) {
    btn.click();
    await new Promise(r => setTimeout(r, 200));
    const cleared = input.textContent.trim() === '';
    if (cleared) return true;
  }

  // 5. 回退：模拟 Enter（即使上面未能确认清空，仍尝试一次兜底）
  input.dispatchEvent(new KeyboardEvent('keydown', {
    key: 'Enter', code: 'Enter', bubbles: true, cancelable: true
  }));
  return true;
}

// 轮询直到按钮出现且可用，而不是假设一个固定延迟后就一定可用
async function waitForEnabledButton(getBtn, timeout) {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    const btn = getBtn();
    if (btn && !btn.disabled) return btn;
    await new Promise(r => setTimeout(r, 100));
  }
  return null;
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

**模式一：停止生成按钮消失/变回发送按钮**（需逐站验证，不能假设通用）

> ⚠️ 三站点实测结论（2026年6月）：ChatGPT 和 Claude 上模式一验证可靠
> （前提是准确识别真实的停止控件，不要被"已停止思考"一类的伪信号
> 误导）；DeepSeek 上模式一不可靠，生成过程中也会返回已完成的信号，
> 原因待查，已改用模式三替代。**结论：模式一不是默认安全选项，每个
> 新站点接入时都必须实测，失败时切换到模式三。** 详见下方「各站点
> 适配状态」表格的完整实测记录。

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

### 各站点适配状态（2026年6月，三站点首轮验证已全部完成）

| 网站 | 完成判断模式 | 回答提取选择器 | 验证状态 |
|-----|------------|-------------|---------|
| Claude (claude.ai) | 模式一，识别真实停止控件（`button[aria-label="Stop response"]`） | `[class*="standard-markdown"]` 优先，兼容 `font-claude-message` / `message-content` 等旧选择器 | **已验证通过**。验证条件：账号 dirkchou，窗口保持前台且未锁屏。发送按钮现场确认为 `button[aria-label="Send message"]`，点击后 3 秒内出现用户消息、`Claude is responding` 和 `Stop response`；生成中 `isResponseComplete()` 返回 `false`，约 6.8 秒后停止控件消失并返回 `true`；`extractLatestResponse()` 提取到正文 476 字，未混入界面文字 |
| ChatGPT (chatgpt.com) | 模式一，识别真实 `stop` 控件（`button[data-testid="stop-button"]`） | `[data-message-author-role="assistant"]`，内容取 `.markdown` | **已验证通过**。修正记录：最初实现误把"已停止思考"按钮当成正在生成中的信号，导致 `isResponseComplete()` 一直返回 `false`，修正为只识别真实 stop 控件后才正确 |
| DeepSeek (chat.deepseek.com) | **模式一不可靠，已改用模式三**（最新回答文本稳定 1.5 秒后判定完成） | `.ds-markdown.ds-assistant-message-main-content`（取整条，不只取最后一段） | **已验证通过**。重要教训：模式一（检测停止生成按钮）在 DeepSeek 上不可靠，生成过程中也会返回 `true`，原因待查（可能该站点的停止按钮状态和实际生成状态不同步）。改用模式三后验证通过。发送控件也非标准 `button`，实际是 `div[role="button"].ds-button--primary`，写入适配器已同步修正 |
| 豆包 (www.doubao.com) | 模式三，最新回答文本稳定 1.5 秒后判定完成，兼容停止按钮检测 | message / markdown / answer / main 内容候选，过滤输入框和 UI 文案 | **已验证通过（初版）**。在四格子 6 链路验证中完成首轮回答提取和 3 次作为目标格子的交叉回复提取；选择器仍属于宽匹配策略，后续如果豆包 UI 改版，需要优先用现场 DOM 收窄选择器 |

**重要教训（2026年6月，Claude 域名问题）**：Claude 适配器为兼容性
新增了对 `claude.com` 域名的识别，但 `claude.ai` 和 `claude.com`
在浏览器里**不是同一套登录 session**——已登录 `claude.ai` 的账号，
访问 `claude.com` 会是全新的未登录状态。一次未登录的匿名访问触发了
Anthropic 后端的 `app-unavailable-in-region` 拦截页，当时误判为
真实的地区限制问题，排查后确认是域名切换导致的登录态丢失，不是
网络环境的问题。**修复方式**：保留对 `claude.com` 的 `urlPattern`
识别能力（不报错），但格子的默认 URL 和持久化逻辑仍以 `claude.ai`
为准；已保存 `claude.ai` 的格子，即使加载过程中页面跳转到了
`claude.com`，也不会把 `claude.com` 写回持久化存储，避免下次启动
时丢失登录态。**适用范围提醒**：如果后续接入新站点时发现同一个
产品有多个域名（常见于产品改版或新旧域名并存期），先确认这些域名
是否共享登录 session，不要假设"看起来都能打开"就等同于"行为一致"。

**关键经验**：不要假设所有站点都适用同一种"生成完毕"判断模式。Claude
和 ChatGPT 上模式一可靠，但 DeepSeek 上模式一会误判，必须针对每个
站点实际验证后才能确定该用哪种模式，不能从一个站点的成功经验直接
套用到另一个站点。另外这轮排查也发现：测试时窗口必须保持前台且不能
锁屏，否则系统对后台应用的节流可能导致"点击后页面未响应"这类假阴性，
容易和真正的选择器错误混淆，下一次遇到类似现象先排除这个变量。

**待补充验证项（不阻塞当前进度，第二阶段后续推进时记得回头补）**：
- ChatGPT 当前验证样本是较短的图示型回答，建议找机会用更长的正文
  内容（如几百字的解释性回答）重新测一次，确认长回答下生成完成的
  判断依然准确，且 `extractLatestResponse()` 不会因为内容过长而截断
  或遗漏

> 开发第二阶段时，每完成一个站点的读取适配器验证，在此表格中更新具体
> 选择器和验证状态，避免后续维护时重新摸索。这个表格是「读取适配器」
> 的活文档，应该随开发进度持续更新，不要等全部完成后一次性补充。

### 读取适配器的失败处理

如果在超时时间内无法判断生成是否完毕，或者提取不到任何回答内容，
读取适配器应该返回明确的失败信号（如返回 `null` 而不是空字符串），
调用方据此判断该格子在本轮交叉验证中跳过，不阻塞其他格子的流程，
并通过统一提示系统告知用户"某个 AI 的回答未能读取，已跳过"。

---

## 交叉验证编排链路（第二阶段，首次验证记录）

### 验证范围与结果（2026年6月）

第二阶段开发指引第2步——"双向交叉验证编排"的最小验证，已在
Claude（cell-0）→ ChatGPT（cell-1）这条单向链路上跑通：

1. 同步发送一个短问题到 Claude 和 ChatGPT 两个格子
2. 等待 Claude 生成完毕（用已验证的 `isResponseComplete`）
3. 提取 Claude 回答（263 字）
4. 构造转述 prompt（"这是另一个 AI 的观点：{内容}，你怎么看，有没有
   需要补充或反驳的地方"，实际长度 295 字）
5. 注入到 ChatGPT 输入框并触发发送
6. 等待 ChatGPT 这一轮生成完毕
7. 提取 ChatGPT 的交叉回复（500 字），内容确认是在针对 Claude 的
   观点进行评价，不是答非所问

**结论**：等待生成完毕 → 提取 → 转述注入 → 再等待 → 再提取，这条
编排链路本身是可靠的。第二阶段最大的技术不确定性（"AI 之间能否
真正进行有意义的交叉验证"）已经得到验证，可以继续推进到更多格子的
完全交叉。

### 已知排查经验，扩展到三/四格子交叉时要注意

- 不要假设所有站点的域名都对应同一套登录 session（见上方 Claude 的
  域名教训），每接入一个新的交叉方向前，先确认参与的格子都处于正确
  的已登录状态
- 排查过程中如果遇到看起来像"环境异常"（地区限制、IndexedDB 锁等）
  的提示，先怀疑是不是登录态/并发实例问题，不要直接当作真实的外部
  限制来处理，这类提示往往是更底层问题的伪装表现
- 扩展到三/四格子完全交叉时，编排的复杂度会显著上升（需要管理多组
  "谁的回答转述给谁"的组合），建议先验证三格子的部分交叉（比如
  A→B、B→C 两条链路），确认编排逻辑能正确处理多个并行的等待/提取
  状态后，再扩展到完全交叉

### 三格子部分交叉验证（2026年6月）

按 Claude（cell-0）、ChatGPT（cell-1）、DeepSeek（cell-2）三格子
跑通一次部分交叉：

1. 三个格子同步发送同一个短问题
2. 并发等待三个首轮回答生成完毕并提取
3. 并发触发两条交叉链路：Claude → DeepSeek、DeepSeek → ChatGPT
4. 分别等待 DeepSeek 和 ChatGPT 的交叉回复生成完毕并提取

验证结果：

| 阶段 | 结果 |
| --- | --- |
| 首轮回答 | Claude 328 字、ChatGPT 182 字、DeepSeek 303 字 |
| Claude → DeepSeek | 转述 prompt 362 字，DeepSeek 交叉回复 870 字 |
| DeepSeek → ChatGPT | 转述 prompt 337 字，ChatGPT 交叉回复 791 字 |

**结论**：三格子的部分交叉链路已跑通。两条交叉链路并发触发后，各自
等待和提取的状态没有互相串扰；没有观察到 DeepSeek 仍在处理时错误触发
ChatGPT、或某个格子读取到另一条链路回复的时序混乱。

排查记录：前两次运行卡在首轮 Claude 新回答等待，原因是 Claude 输入框
已写入但发送按钮尚未被成功触发。修正为等待发送按钮可用、点击后确认
输入框清空，并补充键盘提交兜底后，第三次验证通过。

### 三格子确认性复测（2026年6月）

在 Claude 注入逻辑确认已改为轮询等待按钮可用后，重复跑同一条三格子
部分交叉链路，并一次通过：

| 阶段 | 结果 |
| --- | --- |
| 首轮回答 | Claude 393 字、ChatGPT 168 字、DeepSeek 226 字 |
| Claude → DeepSeek | 转述 prompt 427 字，DeepSeek 交叉回复 640 字 |
| DeepSeek → ChatGPT | 转述 prompt 260 字，ChatGPT 交叉回复 411 字 |

**结论**：Claude 发送逻辑这次没有出现"文本停在输入框里但未发送"的问题；
三格子部分交叉不需要重试即可跑通，可以进入四格子验证。

### 四格子 6 链路验证（2026年6月）

第四站点选择豆包（cell-3），原因是它已有专门写入适配器但尚未做读取
适配器验证。本次先按 4 个格子的 6 个两两组合各跑一个方向，而不是
12 条有向全排列；这和"每个格子的回答都转述给其他三个"在计数上不同，
后者需要 12 条链路。

验证流程：

1. Claude（cell-0）、ChatGPT（cell-1）、DeepSeek（cell-2）、豆包（cell-3）
   同步发送同一个短问题
2. 并发等待四个首轮回答生成完毕并提取
3. 顺序执行 6 条交叉链路，避免同一目标格子同时收到多条 prompt 后难以
   判定回复归属

验证结果：

| 链路 | 结果 |
| --- | --- |
| 首轮回答 | Claude 323 字、ChatGPT 203 字、DeepSeek 291 字、豆包 218 字 |
| Claude → ChatGPT | 转述 prompt 357 字，ChatGPT 交叉回复 604 字 |
| Claude → DeepSeek | 转述 prompt 357 字，DeepSeek 交叉回复 705 字 |
| Claude → 豆包 | 转述 prompt 357 字，豆包交叉回复 1215 字 |
| ChatGPT → DeepSeek | 转述 prompt 237 字，DeepSeek 交叉回复 897 字 |
| ChatGPT → 豆包 | 转述 prompt 237 字，豆包交叉回复 1280 字 |
| DeepSeek → 豆包 | 转述 prompt 325 字，豆包交叉回复 229 字 |

**结论**：四格子 6 链路验证已跑通。豆包读取适配器初版可用；连续多条
链路执行时，没有观察到目标回复归属错乱、读取到上一条链路内容、或某个
格子的等待状态影响其他格子的情况。

**范围说明**：本次 6 条链路是顺序执行，验证的是多站点读取/写入覆盖和
连续链路状态隔离；还没有验证同一目标格子的并发排队，也没有验证 12 条
有向全排列。

### 三格子同源并发排队验证（2026年6月）

为单独验证并发本身，不增加链路数量，继续使用 Claude（cell-0）、
ChatGPT（cell-1）、DeepSeek（cell-2）三格子。首轮三个回答全部生成
并提取后，同时触发两条链路：

1. Claude → DeepSeek
2. Claude → ChatGPT

验证结果：

| 阶段 | 结果 |
| --- | --- |
| 首轮回答 | Claude 371 字、ChatGPT 247 字、DeepSeek 340 字 |
| Claude → DeepSeek | 转述 prompt 405 字，DeepSeek 交叉回复 858 字 |
| Claude → ChatGPT | 转述 prompt 405 字，ChatGPT 交叉回复 598 字 |

**关键证据**：两条并发链路分别从 Claude 读取源回答，得到的
`sourceLength` 都是 371，`sourcePreview` 完全一致：

> 多 AI 交叉验证的一个实际价值在于:不同模型的训练数据、对齐方式和
> "自信表达"的阈值并不相同...

**结论**：同一个源格子在并发读取下没有读错；两个目标格子的等待和
提取状态没有互相干扰；没有观察到 DeepSeek 和 ChatGPT 的交叉回复读串。

### 四格子 12 条有向全排列验证（2026年6月）

在同源并发读取验证通过后，使用 Claude（cell-0）、ChatGPT（cell-1）、
DeepSeek（cell-2）、豆包（cell-3）跑完整 12 条有向链路。为先验证
链路完整性和回复归属，本次 12 条按顺序执行，不做并发。

验证结果：

| 链路 | 结果 |
| --- | --- |
| 首轮回答 | Claude 410 字、ChatGPT 228 字、DeepSeek 291 字、豆包 233 字 |
| Claude → ChatGPT | 转述 prompt 444 字，ChatGPT 交叉回复 790 字 |
| Claude → DeepSeek | 转述 prompt 444 字，DeepSeek 交叉回复 534 字 |
| Claude → 豆包 | 转述 prompt 444 字，豆包交叉回复 1540 字 |
| ChatGPT → Claude | 转述 prompt 262 字，Claude 交叉回复 606 字 |
| ChatGPT → DeepSeek | 转述 prompt 262 字，DeepSeek 交叉回复 730 字 |
| ChatGPT → 豆包 | 转述 prompt 262 字，豆包交叉回复 1424 字 |
| DeepSeek → Claude | 转述 prompt 325 字，Claude 交叉回复 862 字 |
| DeepSeek → ChatGPT | 转述 prompt 325 字，ChatGPT 交叉回复 829 字 |
| DeepSeek → 豆包 | 转述 prompt 325 字，豆包交叉回复 1933 字 |
| 豆包 → Claude | 转述 prompt 267 字，Claude 交叉回复 744 字 |
| 豆包 → ChatGPT | 转述 prompt 267 字，ChatGPT 交叉回复 915 字 |
| 豆包 → DeepSeek | 转述 prompt 267 字，DeepSeek 交叉回复 847 字 |

**结论**：12 条有向全排列全部跑通。每条目标回复从内容预览看都在评价
对应的源回答，例如 DeepSeek → Claude / ChatGPT 都明确评价了 DeepSeek
首轮回答里的医学影像场景，豆包 → Claude / ChatGPT / DeepSeek 都围绕
豆包首轮回答里的"无需人工逐一核查"和金融风控场景展开；没有观察到目标
回复归属错乱、读取上一条链路内容、或等待状态串扰。

**范围说明**：本次 12 条全排列是顺序执行，确认的是完整有向链路成立和
回复归属正确；同一目标格子的并发排队仍留给后续迭代验证。
