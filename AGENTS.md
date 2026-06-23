# MultiMind — AGENTS.md

> 本文件供 AI 编码 Agent（Codex CLI 等）读取。所有技术决策均以本文件为准。
>
> **v2 说明**：第一阶段 MVP（多 AI 分屏浏览器）已经完成并验收通过。本文件
> 已从开发过程记录精简为「当前生效的规则集」，移除了 Week 1-8 的过程性
> 任务清单和已经走完的 bug 修复叙述，只保留对后续开发仍有约束力的内容。
> 完整历史决策过程见 AGENTS_v1_archive.md（仅供追溯查阅，不再作为开发依据）。

---

## 项目描述

MultiMind 是一个三阶段产品：

- **第一阶段（已完成）**：多 AI 分屏浏览器。Electron 桌面应用，把窗口分割为
  1/2/3/4 个 WebView 格子，底部统一输入框同步发送到所有格子里的 AI 网站
  或搜索引擎。
- **第二阶段（开发中）**：讨论 → 文档沉淀。AI 互相查看彼此回答、交叉验证，
  用户指定一个 AI 汇总成结构化文档，存入本地长期记忆。
- **第三阶段（远期）**：浏览器 + 终端 + Agent。内置真实终端（可运行用户
  已安装的 Codex CLI 等工具），内置 Agent 能力驱动代码生成或通用
  任务执行，用户自备 API Key。

产品设计的完整产品层描述见 `MultiMind_设计文档_v0.2.md`，本文件只关注
技术实现规则。

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
vite              ^5.0.0
@vitejs/plugin-react ^4.0.0
```

第二阶段引入长期记忆系统时，新增：
```
better-sqlite3    （SQLite，含 FTS5 全文检索支持）
```

第三阶段引入内置终端时，新增（**第一个需要原生编译的依赖，见下方
「内置终端模块」章节的打包注意事项**）：
```
@homebridge/node-pty-prebuilt-multiarch    （PTY 进程管理，多平台预编译）
xterm.js                                    （终端渲染前端）
```

---

## 目录结构

```
multimind/
├── AGENTS.md
├── MultiMind_设计文档_v0.2.md
├── adapter-reference.md
├── package.json
├── tsconfig.json / tsconfig.main.json
├── vite.config.ts
├── electron-builder.yml
├── src/
│   ├── main/                   # Electron 主进程
│   │   ├── index.ts
│   │   ├── windowManager.ts    # 管理所有 WebContentsView 和标签页状态
│   │   ├── terminalManager.ts  # 管理所有终端 PTY 进程（第三阶段，独立于 windowManager）
│   │   ├── ipcHandlers.ts
│   │   ├── constants.ts        # UA 等构建时常量
│   │   └── adapters/           # 各 AI/搜索引擎网站的读写适配器
│   │       ├── index.ts
│   │       ├── claude.ts
│   │       ├── chatgpt.ts
│   │       ├── deepseek.ts
│   │       └── ...（按需扩展）
│   ├── renderer/                # React 渲染进程
│   │   ├── App.tsx
│   │   └── components/
│   │       ├── Toolbar.tsx
│   │       ├── SplitView.tsx
│   │       ├── GridCell.tsx
│   │       ├── BottomInput.tsx
│   │       ├── CellConfigPanel.tsx
│   │       ├── CellNotice.tsx
│   │       └── TerminalPane.tsx # 终端面板渲染（xterm.js 容器，第三阶段）
│   └── shared/
│       ├── types.ts            # IPC 频道、CellState、LayoutMode 等共享类型
│       ├── presetSites.ts      # 内置 AI/搜索引擎清单
│       ├── presetTemplates.ts  # 内置布局模板
│       ├── riskySites.ts       # 已知风险网址清单（如 Gemini）
│       └── notices.ts          # 统一提示文案
└── dist/（构建输出，gitignore）
```

---

## 核心架构规则（不可违反）

### WebView 技术

- 必须使用 `WebContentsView`，禁止 `BrowserView`（已废弃）和 `<webview>` 标签
- 每个分屏格子对应一个 `WebContentsView` 实例，由 `windowManager.ts` 统一管理
  在 `Map<string, WebContentsView>` 中
- 每个格子使用独立 `partition: persist:cell-${cellId}`，保证登录状态隔离且持久化

### 进程通信

- 渲染进程只能通过 `window.electronAPI`（contextBridge 暴露）与主进程通信
- 禁止在渲染进程使用 `require('electron')` 或 `remote` 模块
- 禁止在主进程中直接操作 DOM

### 安全设置（BrowserWindow 和 WebContentsView 创建时固定配置）

```typescript
// BrowserWindow
webPreferences: {
  nodeIntegration: false,
  contextIsolation: true,
  sandbox: false,
  preload: path.join(__dirname, 'preload.js'),
}

// 每个格子的 WebContentsView
webPreferences: {
  nodeIntegration: false,
  contextIsolation: true,
  partition: `persist:cell-${cellId}`,
}
```

### 健壮性：销毁状态检查（崩溃修复后确立的规则）

`WindowManager` 所有对外方法和所有事件回调内部，第一行必须检查窗口/视图
是否已被销毁，避免应用退出时的竞态崩溃：

```typescript
someMethod(...) {
  if (this.window.isDestroyed()) return;
}

view.webContents.on('did-navigate', (_, url) => {
  if (this.window.isDestroyed()) return;
});
```

主进程入口需要全局兜底（只记录日志，不弹窗、不退出）：
```typescript
process.on('uncaughtException', (error) => {
  console.error('Uncaught exception:', error);
});
```

---

## 布局与格子系统

### 布局模式

```typescript
export type LayoutMode = 'single' | 'horizontal' | 'vertical' | 'triple' | 'quad';
```

`triple` 布局：左侧一格占 50% 宽（上下贯穿），右侧两格各占 50% 宽 × 50% 高。

### 格子状态结构

```typescript
export type CellMode = 'chat' | 'search';

interface CellState {
  url: string;
  active: boolean;     // 是否参与统一发送
  mode: CellMode;
}

private cellStates: Map<string, CellState> = new Map();
```

**mode 的判定规则**：通过域名匹配 `PRESET_SITES` 自动判定，不要求用户手动
标注。只有当用户输入的 URL 在内置清单中完全找不到匹配时，才向用户展示
"这是搜索引擎"的手动选择开关：

```typescript
function inferModeFromUrl(url: string): CellMode | 'unknown' {
  const matched = PRESET_SITES.find((site) => {
    try {
      return new URL(url).hostname.includes(new URL(site.url).hostname);
    } catch {
      return false;
    }
  });
  return matched ? matched.mode : 'unknown';
}
```

### 内置网站清单（`shared/presetSites.ts`）

```typescript
export interface PresetSite {
  id: string;
  name: string;
  url: string;
  region: 'international' | 'china';
  mode: CellMode;
  searchUrlTemplate?: string;
}
```

当前清单：AI 助手（国际：Claude、ChatGPT、Grok、Perplexity、Copilot；
国内：DeepSeek、Kimi、文心一言、通义千问、豆包、智谱清言）+ 搜索引擎
（Google、Bing、DuckDuckGo、百度、搜狗）。

**Gemini 不在清单中**：仅支持 Google 账号登录，Google 全面禁止嵌入式
浏览器登录 Google 账号，无法绕过。用户仍可通过自定义 URL 手动添加，
此时会命中 `riskySites.ts` 中的风险提示。

### 格子配置面板（`CellConfigPanel.tsx`）交互规则

- 下拉框选项 = `PRESET_SITES` 全部条目（按分组显示）+ "自定义 URL"
- 下拉框默认选中项根据当前格子 URL 反推（域名匹配），不是固定显示"自定义 URL"
- 选择内置网站后，右侧文本框自动填入对应 URL 并立即生效
- 只有匹配不到任何内置网站时，才显示"这是搜索引擎"开关

### URL 持久化语义（产品决策，不要改动）

格子的 `url` 字段记录"最后一次实际停留的地址"，不是模板/预设的原始地址。
模板 URL 只在格子「从无到有创建」时生效一次。这是有意为之的浏览器标准
行为（类似 Chrome 重启恢复标签页），不是 bug。

---

## 内置终端模块（第三阶段，独立于格子系统）

### 核心架构原则：终端与浏览器格子是两套独立系统

终端管理的是 PTY 进程的生命周期，浏览器格子管理的是 `WebContentsView` 的
生命周期，两者底层无共享逻辑。**终端绝对不进入 `CellState` / `cellStates`
这套数据结构**，不要因为"终端也能出现在分屏网格里"而试图把两者合并。

### 网格位置的内容类型抽象

为了让终端可以出现在分屏网格的任意位置（同时和浏览器格子混排），引入一层
独立于 `CellState` 的抽象：

```typescript
export type PaneContent =
  | { type: 'cell'; cellId: string }
  | { type: 'terminal'; terminalId: string };

// 每个网格位置（'cell-0' | 'cell-1' | 'cell-2' | 'cell-3'，复用现有的
// 位置编号）绑定一个 PaneContent，而不是直接绑定一个 CellState
private paneAssignments: Map<string, PaneContent> = new Map();
```

`SplitView.tsx` 渲染每个网格位置时，先查 `paneAssignments` 判断这个位置
应该渲染浏览器格子还是终端，再分别调用对应的渲染逻辑和数据源
（`cellStates` 或 `terminalManager` 的状态）。布局网格的尺寸计算
（`LayoutMode` 对应的矩形划分）保持不变，不区分位置上放的是格子还是终端。

### TerminalManager（主进程，独立于 WindowManager）

```typescript
interface TerminalState {
  id: string;
  cwd: string;        // 当前工作目录
  title: string;       // 显示标题（默认 shell 名称，用户可重命名）
}

class TerminalManager {
  private terminals: Map<string, IPty> = new Map();  // IPty 来自 node-pty

  createTerminal(cwd?: string): string {
    const id = generateId();
    const shell = process.platform === 'win32' ? 'powershell.exe' : (process.env.SHELL || 'bash');
    const ptyProcess = pty.spawn(shell, [], {
      name: 'xterm-color',
      cols: 80,
      rows: 30,
      cwd: cwd || process.env.HOME,
      env: process.env,
    });
    this.terminals.set(id, ptyProcess);
    return id;
  }

  write(id: string, data: string): void {
    this.terminals.get(id)?.write(data);
  }

  resize(id: string, cols: number, rows: number): void {
    this.terminals.get(id)?.resize(cols, rows);
  }

  destroy(id: string): void {
    this.terminals.get(id)?.kill();
    this.terminals.delete(id);
  }

  destroyAll(): void {
    // 应用退出时调用，避免残留子进程
    for (const id of this.terminals.keys()) this.destroy(id);
  }
}
```

应用退出时（`before-quit` 或 `window-all-closed`）必须调用
`terminalManager.destroyAll()`，避免 PTY 子进程成为孤儿进程残留在用户
系统里，这是终端模块特有的清理责任，浏览器格子（WebContentsView）不需要
这一步是因为它们随窗口销毁自动清理。

### IPC（终端专属频道，不复用浏览器格子的 IPC）

```typescript
export const TERMINAL_IPC = {
  CREATE: 'terminal-create',
  WRITE: 'terminal-write',       // 渲染进程 → 主进程，用户输入
  DATA: 'terminal-data',          // 主进程 → 渲染进程，PTY 输出
  RESIZE: 'terminal-resize',
  DESTROY: 'terminal-destroy',
} as const;
```

终端的 IPC 频道独立命名（`TERMINAL_IPC` 而不是塞进现有的 `IPC`
常量对象），避免和浏览器格子的导航/状态广播频道混在一起。

### 渲染前端：xterm.js

`TerminalPane.tsx` 用 `xterm.js` 渲染终端界面，通过 IPC 把用户键盘输入
转发给主进程的 `TerminalManager.write()`，并监听 `TERMINAL_IPC.DATA`
把 PTY 输出写入 xterm 实例。窗口/网格尺寸变化时调用
`TERMINAL_IPC.RESIZE` 同步终端的行列数，否则会出现内容显示错乱。

### 打包注意事项（原生模块，必须额外处理）

`node-pty` 是当前技术栈第一个需要原生编译的依赖，打包时必须注意：

1. **依赖选型**：使用 `@homebridge/node-pty-prebuilt-multiarch`，它为
   macOS（x64/arm64）、Windows、Linux 提供预编译二进制，安装时自动
   匹配当前平台，避免本机从源码编译（需要 Python + C++ 编译器，
   普通用户环境很可能没有）
2. **asar 解包**：`node-pty` 除了 `.node` 二进制本身，还包含一个独立的
   `spawn-helper` 可执行文件，打包成 `asar` 后这个 helper 的相对路径
   会失效。`electron-builder.yml` 中需要配置：
   ```yaml
   asarUnpack:
     - "**/node_modules/@homebridge/node-pty-prebuilt-multiarch/**"
   ```
3. **跨架构验证**：macOS Universal Binary 打包后，除了之前用 `lipo -info`
   验证主程序架构，还需要单独确认 `node-pty` 这个原生模块在 Intel 和
   Apple Silicon 上都能正常加载（不能假设和主程序的 Universal Binary
   是同一回事，原生依赖可能需要分别验证）
4. **首次接入预期**：这是新增的工程脆弱点，第一次让终端在三个平台的
   打包产物里都正常工作，大概率不会一次成功，需要预留排查时间，
   常见的失败现象是"开发环境能跑、打包后的产物里终端打不开"，遇到这种
   情况先检查 `asarUnpack` 配置和路径解析逻辑

### 当前阶段边界（有意收窄，不要在没有需求验证的情况下扩展）

- 不做"讨论结果自动传递给终端"这类跨模块数据打通，本阶段只做终端本身
  的接入和可用性
- 不做代码编辑器（语法高亮、文件树等），只做终端
- 终端默认收起还是常驻、能否开多个终端标签，留待开发时按实际体验调整，
  不在本阶段提前锁定设计

---

## 统一发送机制

```typescript
async sendToAll(text: string): Promise<void> {
  const activeCells = [...this.cellStates.entries()].filter(
    ([, state]) => state.active && state.url
  );

  for (const [cellId, state] of activeCells) {
    if (state.mode === 'search') {
      const site = findPresetSiteByUrl(state.url);
      const searchUrl = buildSearchUrl(site?.searchUrlTemplate, text);
      this.navigate(cellId, searchUrl);
    } else {
      const success = await this.injectScript(cellId, text);
      if (!success) {
        this.sendNotice(cellId, 'inject-failed');
      }
    }
    await new Promise((r) => setTimeout(r, 150 + Math.random() * 100));
  }
}
```

- 空格子（`url` 为空）和未激活格子（`active: false`）自动跳过，不报错不提示
- `search` 模式直接 `navigate` 跳转，不走注入逻辑，不会触发 `inject-failed`
- `chat` 模式走 `injectScript`，失败时统一走提示系统

---

## 注入与读取适配器系统

### 写入适配器（第一阶段，已实现）

每个网站的注入逻辑封装为独立文件（`adapters/claude.ts` 等），接口：

```typescript
export interface SiteAdapter {
  urlPattern: RegExp;
  injectScript: (text: string) => string;
  readyCheckScript: string;
}

export function getAdapterForUrl(url: string): SiteAdapter | null {
  return ADAPTERS.find((a) => a.urlPattern.test(url)) ?? null;
}
```

找不到匹配适配器时返回 `null`，调用方据此返回 `false` 触发失败提示，
不抛异常导致主进程崩溃。

注入前增加随机延迟（300-800ms），避免"加载完成立即填充提交"这种机械
时序（详见下方风控规避部分）。

具体每个网站的 DOM 结构、选择器策略由 `adapter-reference.md` 维护。

### 读取适配器（第二阶段，新增能力）

为支持「交叉验证」流程，需要新增读取能力：从 AI 网站的对话界面中提取
最新一条 AI 回答的文本内容，并判断该回答是否已生成完毕。

```typescript
export interface SiteAdapter {
  extractLatestResponse?: () => string;
  isResponseComplete?: () => string;
}
```

每个网站判断"生成完毕"的方式不同（常见模式：发送按钮从禁用恢复可用、
停止生成按钮消失、流式光标停止闪烁），具体实现细节由
`adapter-reference.md` 维护，开发前先查阅该文档。

---

## IPC 频道（`shared/types.ts` 完整定义为准，此处列出类别）

```typescript
export const IPC = {
  NAVIGATE: 'navigate',
  NAVIGATE_BACK: 'navigate-back',
  NAVIGATE_FORWARD: 'navigate-forward',
  RELOAD: 'reload',

  SET_LAYOUT: 'set-layout',
  SET_CELL_URL: 'set-cell-url',
  TOGGLE_CELL: 'toggle-cell',
  CELL_FOCUSED: 'cell-focused',

  SEND_TO_ALL: 'send-to-all',

  CELL_URL_CHANGED: 'cell-url-changed',
  CELL_TITLE_CHANGED: 'cell-title-changed',
  CELL_FAVICON_CHANGED: 'cell-favicon-changed',
  SHOW_CELL_NOTICE: 'show-cell-notice',
} as const;
```

### 统一提示系统

```typescript
export type NoticeType =
  | 'google-login-blocked'
  | 'inject-failed'
  | 'load-failed'
  | 'load-timeout';

export interface CellNoticePayload {
  cellId: string;
  type: NoticeType;
  message: string;
}
```

文案定义在 `shared/notices.ts` 的 `NOTICE_MESSAGES`。规则：不使用"错误"
"失败"等引发焦虑的词；提示条可手动关闭，不自动消失；同一 `cellId` +
`type` 组合在当前会话中只提示一次。

风险网址检测（`shared/riskySites.ts`）：用户在格子配置面板输入自定义
URL 时实时匹配，命中则在输入框下方显示非阻断性警示。

---

## 浏览器标签页（单屏模式，作为通用浏览器使用时）

```typescript
interface BrowserTab {
  id: string;
  url: string;
  title: string;
  favicon?: string;
}

private tabs: BrowserTab[] = [];
private activeTabId: string | null = null;
```

`tabs` 数组是标签栏 UI 渲染的唯一数据源，不允许标签栏维护独立副本。
新建标签时同时创建 `BrowserTab` 记录并 push 进数组、更新 `activeTabId`。

新建标签默认 `url: ''`（不加载 `about:blank`），地址栏显示占位提示文字，
用户点击后无需先清空即可直接输入。

标签栏容器支持横向滚动（`overflow-x: auto`），保证标签数量超出可视宽度
时，新标签依然可以通过滚动被访问，不会被裁切到完全不可见。

---

## electron-store 数据结构

Key 必须命名空间化，便于后续插件系统隔离存储：

```typescript
interface StoreSchema {
  'browser.layout': LayoutMode;
  'browser.windowBounds': { x: number; y: number; width: number; height: number };
  'cells.<cellId>.url': string;
  'cells.<cellId>.mode': CellMode;
  'cells.<cellId>.active': boolean;
  // 后续插件系统使用 'plugins.<pluginId>.*' 命名空间，不与上述冲突
}
```

---

## 打包配置（electron-builder.yml）

```yaml
appId: com.multimind.app
productName: MultiMind
directories:
  output: release

mac:
  target:
    - target: dmg
      arch: [x64, arm64]
  category: public.app-category.productivity
  identity: null

win:
  target:
    - target: nsis
      arch: [x64]
  signAndEditExecutable: false

nsis:
  oneClick: false
  allowToChangeInstallationDirectory: true
```

**签名决策**：当前版本不做代码签名和 Notarization（无 Apple Developer
账号和 Windows 签名证书），这是有意的 MVP 阶段决策。用户安装时需要手动
绕过 Gatekeeper / SmartScreen 提示，安装说明文档需要写清楚绕过步骤。

**Universal Binary 验证**：每次打包后必须用 `lipo -info` 验证产物真的
包含 `x86_64` 和 `arm64` 两种架构，不能假设命令成功就代表正确。

---

## User-Agent 策略

UA 按打包平台在构建时静态确定，不在运行时做任何判断逻辑：

```typescript
// src/main/constants.ts
export const CHROME_USER_AGENT =
  process.env.BUILD_TARGET === 'win'
    ? 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36'
    : 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';
```

```json
"package:win": "cross-env BUILD_TARGET=win npm run build && electron-builder --win --x64"
```

同一份已安装的应用在运行期间，UA 值永远固定不变，构建完成后不存在
任何动态性。

---

## 风控规避原则（持续性事项）

**已落地的措施**：
- 每个格子独立 `partition`
- 按平台静态固定的 Chrome UA（见上）
- 统一发送时格子间延迟加随机扰动（`150 + Math.random() * 100`）
- 注入脚本执行前增加 300-800ms 随机延迟

**合规边界（不可突破）**：
- 不绕过、不破解任何网站的验证码、双重验证、人机验证机制
- 不模拟或伪造完整的用户身份信息（设备指纹、生物特征等）
- 不做运行时动态切换或随机变化 UA
- 所有优化只是让自动化操作的时序更接近真实用户习惯，不是突破网站的
  安全验证关卡
- 尊重网站明确的反自动化政策声明，不主动针对性绕过

**已知限制，当前不处理**：更深层的指纹识别（鼠标移动轨迹、页面停留
时间分布等）不在当前处理范围。

---

## 插件系统接口预留（现阶段必须遵守，即使插件系统尚未开发）

- 禁止在业务代码中直接调用 `webContents.executeJavaScript()`，必须通过
  `windowManager.injectScript(cellId, script)` 统一封装
- 每个 view 的生命周期事件（导航、标题、favicon 变化）必须通过 IPC
  广播给渲染进程，不在主进程内直接处理业务逻辑
- `electron-store` 的 key 命名空间化（见上方数据结构）

---

## 禁止事项（任何情况下都不能违反）

- 禁止使用 `BrowserView`（已废弃）
- 禁止使用 `<webview>` 标签
- 禁止在渲染进程 `require` Node.js 模块或使用 `remote` 模块
- 禁止引入需要独立启动服务的依赖（SQLite 例外，它不需要独立进程）
- 禁止在没有用户确认的情况下读写 AI 网站的 Cookie 或 localStorage
- 禁止在写入适配器中读取 AI 回答的内容（写入和读取是两套独立接口）
- 禁止绕过验证码、双重验证等网站安全机制
- 禁止运行时动态切换 User-Agent
- 第三阶段 Agent 的文件操作禁止超出用户明确授权的目录范围，禁止静默写入
- 禁止把终端的 `TerminalState` / PTY 进程合并进 `cellStates` 这套数据
  结构，两者必须保持独立（见「内置终端模块」章节）
- 禁止应用退出时遗漏 `terminalManager.destroyAll()`，避免 PTY 子进程
  成为孤儿进程残留在用户系统

---

## 第二阶段开发指引（当前开发优先级，内置终端模块见上方独立章节）

按以下顺序推进，每步验证通过后才进入下一步：

1. **读取适配器**：先为 Claude、ChatGPT、DeepSeek 三个最常用网站实现
   `extractLatestResponse` 和 `isResponseComplete`，验证读取的可靠性
   （参考 `adapter-reference.md`）
2. **交叉验证编排**：实现"把 A 的回答转述注入 B"的流程，先支持双向
   交叉，验证通过后再扩展到三/四格子的完全交叉
3. **文档生成**：实现"用户指定一个 AI 汇总"的触发流程和 prompt 拼接逻辑
4. **长期记忆存储**：引入 `better-sqlite3`，设计文档表结构（建议至少
   包含：id、原始问题、参与 AI 列表、文档正文、生成时间、标签），
   实现 FTS5 全文检索
5. **记忆检索 UI**：提供一个简单的本地知识库浏览/搜索界面

每一步都应该是可以独立演示和验证的，不要在没有验证前一步的情况下
跳着实现。
