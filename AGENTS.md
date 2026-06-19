# MultiMind Browser — AGENTS.md

> 本文件供 AI 编码 Agent（Codex CLI 等）读取。
> 所有技术决策均以本文件为准，与其他文档冲突时以本文件优先。

---

## 项目一句话描述

MultiMind Browser 是一个 Electron 桌面浏览器，核心功能是把窗口分割为 1/2/4 个
WebView 格子，底部有统一输入框，用户输入后自动把文字注入所有格子里的 AI 网页并触发发送。

---

## 技术栈（锁定版本，不要擅自升级或替换）

```
electron          ^33.0.0
react             ^18.3.0
react-dom         ^18.3.0
typescript        ^5.5.0
tailwindcss       ^3.4.0
electron-store    ^10.0.0
electron-builder  ^25.0.0
vite              ^5.0.0          # 渲染进程构建
@vitejs/plugin-react ^4.0.0
```

---

## 目录结构（必须严格遵守）

```
multimind-browser/
├── AGENTS.md
├── package.json
├── tsconfig.json
├── tsconfig.main.json          # 主进程单独的 tsconfig
├── vite.config.ts              # 渲染进程 vite 配置
├── electron-builder.yml
├── src/
│   ├── main/                   # Electron 主进程（Node.js 环境）
│   │   ├── index.ts            # 入口，创建 BrowserWindow
│   │   ├── windowManager.ts    # 管理所有 WebContentsView
│   │   ├── ipcHandlers.ts      # 所有 ipcMain.handle 注册
│   │   └── adapters/           # 各 AI 网站注入脚本
│   │       ├── index.ts        # 适配器注册表
│   │       ├── claude.ts
│   │       ├── chatgpt.ts
│   │       ├── deepseek.ts
│   │       └── gemini.ts
│   ├── renderer/               # React 渲染进程（浏览器环境）
│   │   ├── index.html
│   │   ├── index.tsx           # React 入口
│   │   ├── App.tsx
│   │   └── components/
│   │       ├── Toolbar.tsx     # 顶部工具栏（地址栏、布局切换等）
│   │       ├── SplitView.tsx   # 分屏容器（管理格子布局）
│   │       ├── GridCell.tsx    # 单个格子的 overlay UI
│   │       └── BottomInput.tsx # 底部统一输入框
│   └── shared/
│       └── types.ts            # 主进程和渲染进程共用的类型定义
└── dist/                       # 构建输出（gitignore）
```

---

## 核心架构规则（违反任何一条都是错误）

### WebView 技术

- **必须使用 `WebContentsView`**，这是 Electron 33 的官方推荐 API
- **严禁使用 `BrowserView`**，已在 Electron 30+ 废弃，会产生警告并在未来版本移除
- **严禁使用 `<webview>` HTML 标签**，安全性差且行为不一致
- 每个格子对应一个 `WebContentsView` 实例，由主进程的 `windowManager.ts` 统一管理

### 进程通信

- 渲染进程（React）**只能**通过 `window.electronAPI`（contextBridge 暴露）与主进程通信
- **严禁**在渲染进程中使用 `require('electron')` 或 `remote` 模块
- **严禁**在主进程中直接操作 DOM
- 所有 IPC 频道名称定义在 `src/shared/types.ts` 中，不要在代码里硬编码字符串

### 安全设置

主进程创建 `BrowserWindow` 时必须包含以下配置：

```typescript
new BrowserWindow({
  webPreferences: {
    nodeIntegration: false,        // 必须 false
    contextIsolation: true,         // 必须 true
    sandbox: false,                 // WebContentsView 需要 false
    preload: path.join(__dirname, 'preload.js'),
  }
})
```

每个 `WebContentsView` 加载 AI 网站时，`webPreferences` 设置：

```typescript
new WebContentsView({
  webPreferences: {
    nodeIntegration: false,
    contextIsolation: true,
    partition: `persist:cell-${cellId}`,  // 每个格子独立 session
  }
})
```

`partition: 'persist:cell-N'` 是关键——这确保每个格子有独立的 Cookie 和登录状态，
且 `persist:` 前缀让 session 在重启后持久保存。

---

## 布局系统

### 布局类型定义（放在 shared/types.ts）

```typescript
export type LayoutMode = 'single' | 'horizontal' | 'vertical' | 'quad';

export interface CellConfig {
  id: string;           // 'cell-0' | 'cell-1' | 'cell-2' | 'cell-3'
  defaultUrl: string;
  active: boolean;      // 是否参与统一发送
}

export const DEFAULT_URLS: Record<string, string> = {
  'cell-0': 'https://claude.ai',
  'cell-1': 'https://chatgpt.com',
  'cell-2': 'https://chat.deepseek.com',
  'cell-3': 'https://gemini.google.com',
};

export const LAYOUT_CELLS: Record<LayoutMode, string[]> = {
  single:     ['cell-0'],
  horizontal: ['cell-0', 'cell-1'],
  vertical:   ['cell-0', 'cell-1'],
  quad:       ['cell-0', 'cell-1', 'cell-2', 'cell-3'],
};
```

### WebContentsView 定位

WebContentsView 的位置和尺寸由主进程根据窗口大小计算，通过 `view.setBounds()` 设置。

渲染进程负责绘制布局框架（格子边框、overlay 信息），**不**控制 WebContentsView 的位置。

当布局切换时，渲染进程通过 IPC 通知主进程，主进程重新计算并设置所有 view 的 bounds。

窗口 resize 时主进程监听 `BrowserWindow` 的 `resize` 事件并重新布局。

---

## 注入适配器系统

### 适配器接口（src/main/adapters/index.ts）

```typescript
export interface SiteAdapter {
  /** 匹配该适配器的 URL 模式 */
  urlPattern: RegExp;
  /** 填充输入框并触发发送的 JS 代码（返回 true 表示成功） */
  injectScript: (text: string) => string;
  /** 检测页面是否已就绪可接受输入的 JS 代码（返回 boolean） */
  readyCheckScript: string;
}
```

### 注入脚本规范

每个适配器的 `injectScript` 返回一段 JS 字符串（不是函数），由主进程通过
`webContents.executeJavaScript(script)` 执行。脚本必须：

1. 找到输入框元素
2. 用原生 setter 设置值（绕过 React/Vue 框架拦截）：

```javascript
// 正确做法——绕过框架
const nativeInputValueSetter = Object.getOwnPropertyDescriptor(
  window.HTMLTextAreaElement.prototype, 'value'
).set;
nativeInputValueSetter.call(inputEl, text);
inputEl.dispatchEvent(new Event('input', { bubbles: true }));

// contenteditable 元素用这个方法
const nativeTextSetter = Object.getOwnPropertyDescriptor(
  window.HTMLElement.prototype, 'innerText'
)?.set;
if (nativeTextSetter) {
  nativeTextSetter.call(inputEl, text);
} else {
  document.execCommand('insertText', false, text);
}
inputEl.dispatchEvent(new Event('input', { bubbles: true }));
```

3. 尝试触发发送（先点按钮，再模拟 Enter）
4. **返回 `true` 表示成功，`false` 或抛出异常表示失败**

### 失败处理

主进程执行注入后，根据返回值决定：
- 返回 `true`：注入成功，无需处理
- 返回 `false` 或异常：通过 IPC 通知渲染进程，在该格子上方显示提示条

---

## IPC 频道定义（src/shared/types.ts 中完整定义）

```typescript
// 渲染进程 → 主进程
export const IPC = {
  // 发送统一输入
  SEND_TO_ALL:      'send-to-all',
  // 切换布局
  SET_LAYOUT:       'set-layout',
  // 导航（格子内）
  NAVIGATE:         'navigate',
  NAVIGATE_BACK:    'navigate-back',
  NAVIGATE_FORWARD: 'navigate-forward',
  RELOAD:           'reload',
  // 设置格子URL
  SET_CELL_URL:     'set-cell-url',
  // 切换格子参与同步发送
  TOGGLE_CELL:      'toggle-cell',

  // 主进程 → 渲染进程
  INJECT_FAILED:    'inject-failed',     // 注入失败通知
  CELL_URL_CHANGED: 'cell-url-changed',  // 格子 URL 变化
  CELL_TITLE_CHANGED: 'cell-title-changed',
  CELL_FAVICON_CHANGED: 'cell-favicon-changed',
} as const;
```

---

## electron-store 数据结构

```typescript
interface StoreSchema {
  layout: LayoutMode;                        // 上次使用的布局
  cellUrls: Record<string, string>;          // 各格子的自定义默认 URL
  windowBounds: { x: number; y: number; width: number; height: number };
  activeCells: Record<string, boolean>;      // 各格子是否参与同步发送
  showBottomInput: boolean;                  // 单屏时底部输入框是否显示
}
```

---

## 打包配置（electron-builder.yml）

```yaml
appId: com.multimind.browser
productName: MultiMind Browser
directories:
  output: release

mac:
  target:
    - target: dmg
      arch:
        - x64      # Intel Mac
        - arm64    # Apple Silicon
  category: public.app-category.productivity

win:
  target:
    - target: nsis
      arch:
        - x64

nsis:
  oneClick: false
  allowToChangeInstallationDirectory: true
```

---

## npm scripts（package.json 中必须包含）

```json
{
  "scripts": {
    "dev": "concurrently \"vite\" \"electron .\"",
    "build:renderer": "vite build",
    "build:main": "tsc -p tsconfig.main.json",
    "build": "npm run build:renderer && npm run build:main",
    "package:mac": "npm run build && electron-builder --mac --universal",
    "package:win": "npm run build && electron-builder --win --x64",
    "package:all": "npm run build && electron-builder --mac --universal --win --x64"
  }
}
```

---

## 开发顺序（按 Week 推进，不要跳步）

**Week 1-2：骨架**
完成后验收标准：`npm run dev` 能打开一个带工具栏的窗口，工具栏有地址栏和前进后退刷新，
单个 WebContentsView 能正常加载 claude.ai，登录后重启状态保留。

**Week 3-4：分屏**
完成后验收标准：工具栏的布局切换按钮可用，切换到四分屏后四个格子分别加载四个 AI 网站，
格子间可拖拽调整比例，格子左上角显示 favicon 和域名。

**Week 5-6：同步发送**

> ⚠️ 以下验收标准已根据当前实际进度更新（原始版本写的是"四个 AI 网站"，
> 已不适用——格子数量和内容现在由用户自定义，Gemini 已移除，cell-3 默认留空）。

完成后验收标准：
- 底部输入框输入文字按 Enter 后，所有**当前激活**（active=true）的格子同时收到文字并发送，
  未激活或为空的格子不受影响
- 各格子之间注入有 150ms 延迟（参考 adapter-reference.md 中的时序建议），不完全并发
- 注入成功的格子无需额外提示
- 注入失败的格子通过已有的 `SHOW_CELL_NOTICE`（`type: 'inject-failed'`）机制提示，
  不要新建一套提示逻辑
- 空格子（未配置 URL）在统一发送时自动跳过，不报错也不提示
- 底部输入框旁的格子图标组（参考设计文档 5.4 节）可点击切换某格子是否参与本次发送，
  状态持久化存入 `electron-store`（`cells.<cellId>.active`）
- 发送后输入框自动清空；上箭头键可召回上一次发送的内容（本地内存即可，不需要持久化历史）

**Week 7：体验打磨**
完成后验收标准：快捷键可用，深色模式跟随系统，格子悬浮菜单可用，多标签页可用。

**Week 8：打包**
完成后验收标准：`npm run package:mac` 生成 Universal dmg，
在 Intel Mac 和 M 系芯片 Mac 上均可安装运行。

---

## 禁止事项（任何情况下都不能违反）

- 禁止使用 `BrowserView`（已废弃）
- 禁止使用 `<webview>` 标签
- 禁止在渲染进程 `require` Node.js 模块
- 禁止使用 `remote` 模块
- 禁止引入需要独立启动服务的依赖（如 Chroma、Qdrant、Redis）
- 禁止在没有用户确认的情况下读写 AI 网站的 Cookie 或 localStorage
- 禁止在注入脚本中读取 AI 回答的内容（只写入，不读取）
- 禁止一次性生成超过 Week 计划范围的代码（按阶段推进）

---

## 插件系统接口预留规范（现阶段必须遵守）

后续版本会引入用户脚本和原生插件系统，当前开发必须为此留口子：

### 1. executeJavaScript 必须统一封装

禁止在业务代码中直接调用 `webContents.executeJavaScript()`。
必须通过 WindowManager 的统一方法调用：

```typescript
// windowManager.ts 中封装
async injectScript(cellId: string, script: string): Promise<unknown> {
  const view = this.views.get(cellId);
  if (!view) return;
  return view.webContents.executeJavaScript(script);
}
```

适配器和 ipcHandlers 一律调用 `windowManager.injectScript()`，
这样后续插件系统可以在这一层做 hook，实现插件脚本的注入。

### 2. WebContentsView 生命周期事件必须通过 IPC 广播

每个 view 的以下事件必须通过 ipcMain 向渲染进程广播，不在主进程内直接处理业务逻辑：

```typescript
// 在 bindViewEvents() 中
view.webContents.on('did-navigate', (_, url) => {
  this.window.webContents.send(IPC.CELL_URL_CHANGED, { cellId, url });
});
view.webContents.on('page-title-updated', (_, title) => {
  this.window.webContents.send(IPC.CELL_TITLE_CHANGED, { cellId, title });
});
view.webContents.on('page-favicon-updated', (_, favicons) => {
  this.window.webContents.send(IPC.CELL_FAVICON_CHANGED, { cellId, favicon: favicons[0] });
});
```

### 3. electron-store 的 key 必须命名空间化

```typescript
// 正确
store.set('browser.layout', 'quad');
store.set('cells.cell-0.url', 'https://claude.ai');

// 错误
store.set('layout', 'quad');
store.set('url', 'https://claude.ai');
```

后续插件存储使用 `plugins.<pluginId>.*` 命名空间，不会与浏览器数据冲突。

---

## Week 3-4 验收反馈与修正任务（2026年6月）

Week 3-4 整体验收通过：四种布局切换正常、格子相互独立、拖拽调整比例后自动重算。
以下两项需要在 Week 5-6 开始前修正，属于对现有代码的扩展，不要推倒重写。

### 修正一：地址栏跟随聚焦格子

**当前问题**：多格子模式下，地址栏始终只显示固定的一个 URL（如 claude.ai），
用户无法看出当前操作的是哪个格子。

**修正方案**：
1. `GridCell.tsx` 增加点击事件，点击后通过 IPC 通知主进程「该格子被聚焦」
2. 新增 IPC 频道 `IPC.CELL_FOCUSED`，payload 为 `{ cellId: string }`
3. 主进程记录当前聚焦的 cellId（`WindowManager` 增加 `private focusedCellId: string`）
4. `Toolbar.tsx` 的地址栏始终绑定「当前聚焦格子」的 URL：
   - 监听 `IPC.CELL_URL_CHANGED` 事件，仅当 `cellId === focusedCellId` 时更新地址栏显示
   - 用户在地址栏输入并回车时，导航作用于 `focusedCellId` 对应的格子（调用现有的 `navigate()`，但需要传入 cellId 参数，修改 `navigate(cellId, url)` 签名）
5. 聚焦格子边框高亮：蓝色 2px solid 描边，通过 `GridCell.tsx` 的 props 控制
6. 默认聚焦第一个格子（`cell-0`）

**注意**：`navigate`、`navigateBack`、`navigateForward`、`reload` 这几个方法目前是无参或单参数（作用于唯一 view），
Week 3-4 扩展为多 view 后，需要全部改为接收 `cellId` 参数，作用于该 cellId 对应的 view。

### 修正二：用户自定义格子数量与网站（重要架构调整）

**当前问题**：格子数量固定为 1/2/4（缺少 3 格），且每个格子加载的网站硬编码在 `DEFAULT_URLS` 中，
用户无法自由配置。

**修正方案**：

1. **新增「三分屏」布局模式**，`shared/types.ts` 中扩展：
   ```typescript
   export type LayoutMode = 'single' | 'horizontal' | 'vertical' | 'triple' | 'quad';
   ```
   `triple` 布局建议：左侧一格占 50% 宽（上下贯穿），右侧两格各占 50% 宽 × 50% 高（上下分布）。

2. **格子网址完全用户可配置**，不再是写死的 `DEFAULT_URLS` 常量：
   - `electron-store` 中新增 `cells.<cellId>.url` 存储每个格子当前 URL，初始为空或预设模板值
   - 新增「编辑格子」UI 面板（新组件 `CellConfigPanel.tsx`），列出当前布局下所有格子，
     每个格子可从内置 AI 清单中选择，或手动输入任意 URL

3. **内置 AI 网站清单**，新建 `shared/presetSites.ts`：
   ```typescript
   export interface PresetSite {
     id: string;
     name: string;
     url: string;
     region: 'international' | 'china';
   }

   export const PRESET_SITES: PresetSite[] = [
     { id: 'claude', name: 'Claude', url: 'https://claude.ai', region: 'international' },
     { id: 'chatgpt', name: 'ChatGPT', url: 'https://chatgpt.com', region: 'international' },
     { id: 'gemini', name: 'Gemini', url: 'https://gemini.google.com', region: 'international' },
     { id: 'grok', name: 'Grok', url: 'https://grok.com', region: 'international' },
     { id: 'perplexity', name: 'Perplexity', url: 'https://perplexity.ai', region: 'international' },
     { id: 'copilot', name: 'Copilot', url: 'https://copilot.microsoft.com', region: 'international' },
     { id: 'deepseek', name: 'DeepSeek', url: 'https://chat.deepseek.com', region: 'china' },
     { id: 'kimi', name: 'Kimi', url: 'https://kimi.moonshot.cn', region: 'china' },
     { id: 'yiyan', name: '文心一言', url: 'https://yiyan.baidu.com', region: 'china' },
     { id: 'tongyi', name: '通义千问', url: 'https://tongyi.aliyun.com', region: 'china' },
     { id: 'doubao', name: '豆包', url: 'https://www.doubao.com', region: 'china' },
     { id: 'chatglm', name: '智谱清言', url: 'https://chatglm.cn', region: 'china' },
   ];
   ```

4. **内置布局模板**，新建 `shared/presetTemplates.ts`：
   ```typescript
   export interface LayoutTemplate {
     id: string;
     name: string;
     layout: LayoutMode;
     siteIds: string[];   // 对应 PRESET_SITES 的 id，按 cell-0, cell-1... 顺序
   }

   export const LAYOUT_TEMPLATES: LayoutTemplate[] = [
     { id: 'big-four', name: '中美四强', layout: 'quad', siteIds: ['claude', 'chatgpt', 'deepseek', 'gemini'] },
     { id: 'china-two', name: '国产双雄', layout: 'horizontal', siteIds: ['deepseek', 'kimi'] },
     { id: 'us-two', name: '美国双雄', layout: 'horizontal', siteIds: ['claude', 'chatgpt'] },
   ];
   ```

5. **首次启动引导**改为：展示模板选择卡片（含「自定义」选项），用户选择后调用
   `windowManager.applyTemplate(template)`，按模板的 layout 和 siteIds 创建对应格子。

**验收标准**：
1. 工具栏可切换到三分屏，布局为左 1 格（贯穿上下）+ 右 2 格（上下分布）
2. 点击「编辑格子」按钮，打开面板可看到当前所有格子，每个格子可重新选择 AI 网站或输入自定义 URL，确认后立即生效
3. 点击任意格子，地址栏显示该格子的 URL，且该格子有蓝色边框高亮
4. 在地址栏输入新 URL 并回车，仅当前聚焦的格子导航到新地址，其他格子不受影响
5. 首次启动展示模板选择，选择「中美四强」后四个格子按预期网站加载
6. 所有格子配置（布局模式 + 每个格子的 URL）存入 electron-store，重启应用后恢复

---

## 已知限制：Google 账号登录在内嵌格子中受限（2026年6月发现）

> ⚠️ 本节中描述的 `IPC.GOOGLE_LOGIN_BLOCKED` 单独频道方案已被下方
> 「统一用户提示系统」取代，请以文档末尾的「重要变更」章节为准实现，
> 本节仅保留作为问题背景说明。

### 问题描述

Google 自数年前起已全面禁止所有嵌入式浏览器（embedded browser / WebView）登录 Google 账号，
不区分内核新旧，Electron 的 WebContentsView 被归类为此类环境，触发
`accounts.google.com/v3/signin/rejected` 拦截页，提示"此浏览器或应用可能不安全"。

这是 Google 的既定安全策略，不是 User-Agent 或 Client Hints 配置问题，
**无法通过技术手段绕过**，不要在 UA 伪装上花时间。

### 影响范围

任何 AI 网站如果用户选择"使用 Google 账号登录"，都会触发此问题，目前已确认影响 ChatGPT
（Continue with Google，但可设置密码规避）。Gemini 因无替代登录方式已从内置清单移除，
详见文档末尾「重要变更：移除 Gemini」章节。Claude、DeepSeek 等支持邮箱/手机号登录的网站不受影响。

### 处理方案（已作废，见文末「统一用户提示系统」）

> 以下方案描述已被取代，不要实现，仅保留历史背景。检测逻辑思路保留（监听
> `signin/rejected` 路径），但 IPC 频道和提示组件改为统一系统的 `SHOW_CELL_NOTICE`。

**检测与提示**：
1. WindowManager 监听 view 的导航事件，检测 URL 是否匹配
   `accounts.google.com/v3/signin/rejected` 或包含 `signin/rejected` 路径
2. 检测到后，通过 IPC（新增 `IPC.GOOGLE_LOGIN_BLOCKED`，payload `{ cellId }`）
   通知渲染进程
3. 渲染进程在该格子上方显示提示条："Google 账号登录在内嵌浏览器中受限，
   建议改用邮箱/手机号方式登录此网站"
4. 提示条提供"了解原因"链接（跳转到一个内置说明页或本应用的帮助文档）

**不实现的方案（已评估，不可行或成本过高）**：
- ❌ User-Agent 伪装 — Google 检测不依赖 UA，无效
- ❌ 系统默认浏览器登录后同步会话 — 各网站机制不同，WebContentsView
  使用独立 partition，无法自动同步系统浏览器的 Cookie，工作量大且不稳定
- 后续如有更好方案，可重新评估，但不在当前 MVP 范围内

### 验收标准

1. 在 ChatGPT 格子点击"Continue with Google"，触发拦截后格子上方出现提示条
2. 提示条文案清晰，不引起用户恐慌（不要出现"错误""失败"等词，用"受限"）
3. Claude、DeepSeek 等不受影响的网站正常登录，不触发任何提示

---

## 重要变更：移除 Gemini，调整 Google 登录限制处理方案（2026年6月）

### 背景

经过验证，Gemini（gemini.google.com）仅支持 Google 账号登录，没有邮箱/密码等替代登录方式。
ChatGPT 虽然默认引导 Google 登录，但支持设置密码后改用邮箱+密码登录，可以规避 Google 对
嵌入式浏览器的限制。Gemini 没有这条退路，因此决定将 Gemini 从内置 AI 网站清单中移除。

### 代码修改任务

**1. 删除 Gemini 适配器**
- 删除 `src/main/adapters/gemini.ts`
- `src/main/adapters/index.ts` 中移除对 gemini 适配器的注册

**2. 更新 `shared/presetSites.ts`**
移除 Gemini 条目：
```typescript
// 删除这一行
{ id: 'gemini', name: 'Gemini', url: 'https://gemini.google.com', region: 'international' },
```

**3. 更新 `shared/presetTemplates.ts`**
"中美四强"模板改为"中美三强"，移除 gemini：
```typescript
export const LAYOUT_TEMPLATES: LayoutTemplate[] = [
  { id: 'big-three', name: '中美三强', layout: 'quad', siteIds: ['claude', 'chatgpt', 'deepseek'] },
  { id: 'china-two', name: '国产双雄', layout: 'horizontal', siteIds: ['deepseek', 'kimi'] },
  { id: 'us-two', name: '美国双雄', layout: 'horizontal', siteIds: ['claude', 'chatgpt'] },
];
```
注意：`big-three` 用 `quad` 布局但只有 3 个 siteIds 时，第 4 个格子（`cell-3`）保持空白状态，
由用户自行决定加载什么，不强制填充。

**4. 更新默认 URL 常量**
`shared/types.ts` 中的 `DEFAULT_URLS`，`cell-3` 不再默认指向 Gemini，改为空字符串或留空：
```typescript
export const DEFAULT_URLS: Record<string, string> = {
  'cell-0': 'https://claude.ai',
  'cell-1': 'https://chatgpt.com',
  'cell-2': 'https://chat.deepseek.com',
  'cell-3': '',  // 留空，用户自行选择
};
```

**5. ChatGPT 适配器补充说明**
在 `adapters/chatgpt.ts` 文件头部加注释说明：用户若用 Google 账号注册 ChatGPT，
建议引导其在 ChatGPT 设置中新增密码登录方式，以规避 Electron 环境下 Google OAuth 受限的问题。
此说明仅供代码维护参考，不需要在适配器逻辑中做任何特殊处理。

### 新增：统一用户提示系统（重要，覆盖多个场景）

之前为 Google 登录拦截单独设计的 `IPC.GOOGLE_LOGIN_BLOCKED` 提示机制，现在升级为
通用提示系统，覆盖所有需要提示用户的场景，不再是单一用途。

**1. 新增通用 IPC 频道**（替代之前单独的 `GOOGLE_LOGIN_BLOCKED`）：
```typescript
// shared/types.ts
export const IPC = {
  // ...现有频道保留...
  SHOW_CELL_NOTICE: 'show-cell-notice',   // 主进程 → 渲染进程，格子级提示
};

export type NoticeType = 'google-login-blocked' | 'inject-failed' | 'load-failed';

export interface CellNoticePayload {
  cellId: string;
  type: NoticeType;
  message: string;
}
```

**2. 提示文案统一定义**，新建 `shared/notices.ts`：
```typescript
export const NOTICE_MESSAGES: Record<NoticeType, string> = {
  'google-login-blocked': 'Google 账号登录在内嵌浏览器中受限，建议改用邮箱/密码方式登录此网站（如该网站支持）',
  'inject-failed': '文字已填入，请手动按 Enter 发送',
  'load-failed': '该网站当前无法访问，可点击重试',
};
```

**3. 新增「自定义网址风险清单」**，新建 `shared/riskySites.ts`：
```typescript
export interface RiskySite {
  urlPattern: RegExp;
  reason: string;
}

export const RISKY_SITES: RiskySite[] = [
  {
    urlPattern: /gemini\.google\.com/,
    reason: '该网站仅支持 Google 账号登录，Google 已限制嵌入式浏览器登录，可能无法正常使用',
  },
  // 后续发现其他仅支持 Google/受限登录方式的网站，在此追加
];
```

**4. CellConfigPanel.tsx 中接入风险检测**：
用户在「编辑格子」面板输入自定义 URL 时，实时匹配 `RISKY_SITES`，命中则在输入框下方
显示警示文案（黄色背景，非阻断性，用户仍可选择继续添加）。

**5. GridCell.tsx 中接入统一提示组件**：
监听 `IPC.SHOW_CELL_NOTICE`，渲染一个可手动关闭的悬浮提示条组件 `CellNotice.tsx`，
根据 `type` 选择图标和样式（不使用红色错误样式，统一用中性的灰色/蓝色提示样式）。
同一 `cellId` + `type` 组合在当前会话中只提示一次，用 React state 或简单的
`Set<string>` 记录已提示过的 `cellId-type` 组合。

**6. WindowManager 中触发提示的位置**：
- 检测到 `signin/rejected` 路径 → 发送 `SHOW_CELL_NOTICE` with `type: 'google-login-blocked'`
- `injectScript()` 返回 `false` → 发送 `SHOW_CELL_NOTICE` with `type: 'inject-failed'`
- view 的 `did-fail-load` 事件触发 → 发送 `SHOW_CELL_NOTICE` with `type: 'load-failed'`

### 验收标准

1. 内置 AI 清单和模板中不再出现 Gemini
2. 默认四分屏的第四格不再自动加载任何网址，保持空白等待用户选择
3. 在「编辑格子」面板手动输入 `gemini.google.com`，输入框下方出现风险提示，但不阻止用户确认添加
4. 添加 Gemini 后在该格子尝试登录，触发 `google-login-blocked` 提示，提示条样式中性、可关闭
5. 模拟一次注入失败和一次加载失败，分别触发对应类型的提示，文案和样式符合统一规范
6. 同一格子同一类型的提示在当前会话中只出现一次

---

## Week 5-6 实现要点（同步发送功能落地）

这是 MVP 最核心的功能，把之前所有准备工作串联起来。实现顺序建议：

### 1. windowManager.ts 新增 sendToAll 方法

```typescript
async sendToAll(text: string): Promise<void> {
  const activeCells = [...this.views.entries()].filter(
    ([cellId]) => this.cellStates.get(cellId)?.active && this.cellStates.get(cellId)?.url
  );

  for (const [cellId, view] of activeCells) {
    const success = await this.injectScript(cellId, text);
    if (!success) {
      this.window.webContents.send(IPC.SHOW_CELL_NOTICE, {
        cellId,
        type: 'inject-failed',
        message: NOTICE_MESSAGES['inject-failed'],
      });
    }
    await new Promise((r) => setTimeout(r, 150));
  }
}
```

`injectScript(cellId, text)` 内部根据该格子当前 URL 匹配 `adapters/index.ts` 中注册的
适配器（用 adapter-reference.md 里各网站的 `urlPattern` 匹配），调用对应的注入脚本。

### 2. adapters/index.ts 的适配器匹配逻辑

```typescript
export function getAdapterForUrl(url: string): SiteAdapter | null {
  return ADAPTERS.find((a) => a.urlPattern.test(url)) ?? null;
}
```

找不到匹配适配器（用户加载了清单外的网站）时，`injectScript` 直接返回 `false`，
触发统一的失败提示，不要抛异常导致主进程崩溃。

### 3. ipcHandlers.ts 注册 SEND_TO_ALL

```typescript
ipcMain.handle(IPC.SEND_TO_ALL, (_event, payload: { text: string }) => {
  return windowManager.sendToAll(payload.text);
});
```

### 4. BottomInput.tsx 交互逻辑

- 文本框：受控组件，`Enter` 发送，`Shift+Enter` 换行
- 发送时通过 `window.electronAPI.sendToAll(text)` 调用主进程（preload.ts 中需暴露此方法）
- 发送中禁用输入框，显示 loading 态；`sendToAll` 是 `Promise<void>`，resolve 后恢复
- 维护一个本地 `lastSentText` state，上箭头键回填到输入框（不需要历史列表，只存最近一条）
- 左侧格子图标组：每个图标对应一个 cellId，点击切换 `active` 状态，
  通过 `IPC.TOGGLE_CELL` 通知主进程并持久化

### 5. cellStates 数据结构（windowManager.ts 内部状态）

Week 3-4 可能还没有这个统一结构，如果没有需要补上：

```typescript
interface CellState {
  url: string;
  active: boolean;
}

private cellStates: Map<string, CellState> = new Map();
```

`active` 默认值：有配置 URL 的格子默认 `true`，空格子默认 `false`（无法发送）。

### 验收时重点检查

1. 四分屏下，cell-3 为空时点击发送，前三个格子正常收到文字，不报错
2. 取消勾选某个格子的图标后发送，该格子不收到文字，其他格子不受影响
3. 故意让某个格子停在一个不在适配器清单里的网站（比如百度首页），发送后该格子触发
   `inject-failed` 提示，其他格子正常
4. 连续发送两次不同内容，第二次发送前按上箭头键，输入框回填的是第一次发送的内容
