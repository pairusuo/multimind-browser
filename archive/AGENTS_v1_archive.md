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
  identity: null    # 明确禁用代码签名尝试，见下方「签名决策」说明

win:
  target:
    - target: nsis
      arch:
        - x64
  signAndEditExecutable: false   # 明确禁用签名尝试

nsis:
  oneClick: false
  allowToChangeInstallationDirectory: true
```

### 签名决策（2026年6月，第一版 MVP 明确决定）

**当前版本不做代码签名和 Notarization**，原因是还没有 Apple Developer Program
账号（$99/年）和 Windows Code Signing Certificate，且当前阶段优先验证产品
价值而非分发体验。这是有意决策，不是遗漏，后续如果产品验证通过，再补签名。

**带来的已知影响（需要在用户文档中说明）**：

- macOS：用户首次打开 `.dmg` 安装的应用时，Gatekeeper 会拦截并提示
  "无法验证开发者"或"应用已损坏，要移到废纸篓吗"。解决方法：
  在「系统设置 → 隐私与安全性」中找到该提示，点击"仍要打开"；
  或者右键点击 App → 选择"打开"（而不是双击），会出现"打开"选项绕过拦截
- Windows：用户运行 `.exe` 安装包时，Windows Defender SmartScreen 会提示
  "Windows 已保护你的电脑"。解决方法：点击"更多信息"，然后点击
  "仍要运行"

**任务**：在 README.md 或安装说明文档中，把上述两段绕过步骤写清楚，
配图说明（截图 Gatekeeper 和 SmartScreen 的实际提示界面），放在
下载链接旁边明显位置，避免用户看到警告就放弃安装。

### Universal Binary 构建验证（重要，必须执行）

`electron-builder --mac --universal` 在 Intel Mac 上执行时，arm64 部分的
构建依赖 Electron 官方预编译的 arm64 二进制，不是本机编译，原理上可行，
但**必须验证产物真的包含两种架构**，不能假设命令成功就代表正确：

```bash
# 打包完成后，在生成的 .app 内找到主执行文件验证
lipo -info "release/mac-universal/MultiMind Browser.app/Contents/MacOS/MultiMind Browser"

# 期望输出包含两种架构，类似：
# Architectures in the fat file: ... are: x86_64 arm64
```

如果输出只显示一种架构，说明 Universal Binary 构建失败，需要检查
electron-builder 版本和配置，不能直接发布。这一步是 Week 8 验收的
强制项，不能跳过。

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

> ⚠️ 以下范围已根据实际开发进度重新梳理（原始版本只写了"快捷键、深色模式、
> 悬浮菜单、多标签页"四项，未覆盖搜索引擎模式、提示系统等后续加入的功能）。

完成后验收标准分为四组：

**A. 原计划项**
- 布局快捷键（Cmd/Ctrl+1/2/3/4）全部可用，且与当前聚焦格子无关，全局生效
- 深色/浅色模式跟随系统设置，且应用内有手动切换开关（不强制跟随系统）
- 格子悬浮菜单（刷新/修改地址/新标签页打开/移出同步发送/静音）全部可用
- 多标签页管理可用（注：这里指的是"作为通用浏览器使用"时的标签页，
  不是分屏格子本身）

---

## Bug 修复：单屏模式新建第4个标签后不可见（2026年6月，已修正排查方向）

> ⚠️ 本节是对上一轮记录的修正。上一轮根据"新标签内容加载了但标签栏没显示"
> 这一现象，猜测是状态不同步问题（导航逻辑和标签栏数据是两套独立状态）。
> 后续确认了复现条件：**问题只在已有 3 个标签、新建第 4 个时出现**，
> 这强烈指向是标签栏容器宽度不够、第 4 个标签被样式裁切/溢出隐藏，
> 而不是数据状态问题。如果接下来排查发现 `tabs` 数组里其实已经正确
> 包含了第 4 条记录（只是没在视觉上显示出来），请直接跳过上一轮的
> "数据状态修复"方向，按下方的样式方向排查。

### 问题描述

单屏模式下已有 3 个标签（如 Kimi / 百度 / Google）时，点击 `+` 新建第 4 个
标签并跳转到新网址（如 bing.com），地址栏和页面内容都正确显示该网址，
但标签栏上看不到第 4 个标签。怀疑是标签栏容器的宽度限制或 overflow 样式
导致超出可见区域的标签被裁切，而不是数据没有被记录。

### 排查步骤（按顺序执行，先确认是样式问题还是数据问题）

1. **先确认数据层面是否正确**：在新建第 4 个标签后，临时加一行
   `console.log(this.tabs)`（或在 React DevTools 里查看对应 state），
   确认 `tabs` 数组长度是否变成了 4，且第 4 条记录的 `url` 是否正确
   写入了 bing.com。如果数据层本身就缺了这一条，说明上一轮的"状态
   不同步"判断是对的，按上一轮记录的 4 条修复要求处理
   （创建标签时要同时 push 数组并更新 `activeTabId`）
2. **如果数据层正确（数组里确实有 4 条记录）**，问题就在渲染层。
   检查标签栏容器的 CSS：是否设置了固定宽度或 `overflow: hidden`，
   导致超过容器宽度的标签被裁切而不可见，且没有任何视觉提示
   （比如箭头按钮、横向滚动条）告知用户还有更多标签

### 修复要求（确认是样式问题后）

1. 标签栏容器需要支持标签数量超出可视宽度时的处理，二选一：
   - 方案 A（更简单）：标签栏支持横向滚动（`overflow-x: auto`），
     鼠标滚轮或触控板横向滑动可以看到被挤出去的标签
   - 方案 B（更精致）：标签宽度随数量自动收缩（类似 Chrome 的行为，
     标签越多每个标签越窄，文字超长部分用省略号截断），超过一定数量
     后再触发横向滚动或显示"更多标签"的下拉菜单
   建议先用方案 A 实现，足够解决"标签不可见"的核心问题，
   方案 B 留作后续体验优化
2. 不管选哪个方案，新建标签后必须有某种方式让用户能看到/访问到它，
   不能存在"标签创建成功但用户无法触达"的情况
3. 如果容器本来就没有设置任何宽度限制或 overflow 规则，而问题依然
   复现，说明根因可能是别的（比如 flex 布局的子元素默认行为），
   需要进一步排查 `Toolbar.tsx` 中标签栏部分的实际 CSS

### 验收标准

1. 单屏模式下连续新建 6-8 个标签（超过正常窗口宽度能容纳的数量），
   确认每个标签创建后都能通过某种方式（滚动/收缩）被用户看到和点击
2. 新建的第 4、5、6...个标签，地址栏跳转后立即检查标签栏，
   不需要做任何额外操作就能看到新标签出现在可视区域内或可通过
   滚动触达
3. 标签数量较多时，标签栏整体不能挤压或破坏工具栏其他元素
   （地址栏、前进后退按钮等）的正常显示
4. 关闭当前激活的标签后，地址栏应该立即更新为新激活标签的 URL，
   两者保持同步

**B. 提示系统收尾**
- `SHOW_CELL_NOTICE` 三种类型（google-login-blocked / inject-failed / load-failed）
  在真实场景下都触发过且样式统一
- 风险网址提示（`RISKY_SITES`）在「编辑格子」面板验证有效
- 检查是否有遗漏的边界情况需要提示（例如：格子加载网址后一直空白超过 10 秒、
  网络断开时的格子状态）

**C. 格子配置体验**
- 「编辑格子」面板里 AI 助手和搜索引擎分组显示清晰
- 格子配置变更（URL、mode、active 状态）的持久化全部验证一遍，重启应用后
  恢复正确
- 首次启动的模板选择引导流程走一遍，确认"中美三强"等模板能正确创建对应
  数量和内容的格子

**D. 性能与稳定性**
- 四分屏同时运行时，做一次内存占用检查（Activity Monitor / 任务管理器），
  确认没有明显的内存泄漏（多次切换布局后内存只增不减则有问题）
- 窗口快速连续 resize（拖动窗口边缘晃动几次），确认布局计算不报错、不卡顿
- 统一发送时故意让 4 个格子同时是高负载状态（比如全部是从未加载过的新网址），
  确认 150ms 的间隔机制让请求不会互相阻塞导致应用无响应

**Week 8：打包**

完成后验收标准：

1. `npm run package:mac` 生成 `.dmg`，用 `lipo -info` 验证确实包含
   `x86_64` 和 `arm64` 两种架构（见上方「Universal Binary 构建验证」）
2. 在你的 Intel Mac 上完整走一遍安装流程：双击 `.dmg` → 拖入 Applications →
   首次打开遇到 Gatekeeper 拦截 → 用「右键打开」方式绕过 → 确认应用正常启动
3. 如果有条件，找一台 Apple Silicon Mac（M1/M2/M3 任意），重复第 2 步，
   确认同一个 `.dmg` 在两种架构上都能正常运行
4. `npm run package:win` 生成 `.exe`，在 Windows 机器（或虚拟机）上安装，
   遇到 SmartScreen 提示后用「更多信息→仍要运行」绕过，确认正常启动
5. 两个平台分别验证核心功能链路一次：创建四分屏、混搭 AI 和搜索引擎格子、
   统一发送、重启后配置保留——不需要重新跑 Week 1-7 全部测试，
   只验证「打包后的产物」和「开发环境下跑的版本」行为一致，
   排除打包过程引入新问题的可能
6. README.md 或安装说明中已经写好 Gatekeeper / SmartScreen 的绕过步骤，
   配图清晰

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

   **下拉框的具体交互规范（重要，避免下拉框形同虚设）**：
   - 下拉框的选项列表是 `PRESET_SITES` 中所有条目（按 `region`/`mode` 分组显示，
     如"AI 助手"分组下是 Claude/ChatGPT/DeepSeek 等，"搜索引擎"分组下是
     Google/百度等），加一个固定的末尾选项"自定义 URL"
   - 下拉框默认选中项 = 当前格子 URL 域名匹配到的 `PresetSite`；如果匹配不到
     任何内置网站，下拉框默认显示"自定义 URL"
   - 用户从下拉框选择某个内置网站（如"Claude"）后，右侧文本框**自动填入**
     该 `PresetSite.url`（如 `https://claude.ai`）并立即生效，文本框此时
     仍可编辑（用户可以在选了 Claude 之后自己改成某个具体子路径）
   - 用户选择下拉框中的"自定义 URL"选项后，右侧文本框清空（或保留原值），
     用户手动输入完整地址
   - 不要把下拉框做成一个写死显示"自定义 URL"的静态标签——它必须是真实可选、
     可切换的选择器，这是用户能否快速选站点的关键交互

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

---

## 新增需求：支持搜索引擎格子，与 AI 格子混搭统一发送（2026年6月）

### 背景

格子不应局限于 AI 聊天网站，用户可能希望某个格子是传统搜索引擎（Google/百度等），
统一发送时该格子直接跳转到搜索结果页，与 AI 格子的聊天响应并列展示，便于交叉验证。

### 核心设计：两种格子行为模式

```typescript
// shared/types.ts 新增
export type CellMode = 'chat' | 'search';
```

`chat` 模式沿用现有的 `injectScript` 注入逻辑（填表单 + 触发发送）。
`search` 模式改为直接构造 URL 并调用 `navigate(cellId, url)`，不走 DOM 注入。

### 1. 扩展 PresetSite 数据结构

`shared/presetSites.ts` 中 `PresetSite` 接口新增 `mode` 字段，并新增搜索引擎条目：

```typescript
export interface PresetSite {
  id: string;
  name: string;
  url: string;
  region: 'international' | 'china';
  mode: CellMode;          // 新增
  searchUrlTemplate?: string;  // mode 为 'search' 时必填，{query} 为占位符
}

// 现有 AI 条目补充 mode: 'chat'
// 新增搜索引擎条目：
{ id: 'google', name: 'Google', url: 'https://www.google.com', region: 'international', mode: 'search', searchUrlTemplate: 'https://www.google.com/search?q={query}' },
{ id: 'bing', name: 'Bing', url: 'https://www.bing.com', region: 'international', mode: 'search', searchUrlTemplate: 'https://www.bing.com/search?q={query}' },
{ id: 'duckduckgo', name: 'DuckDuckGo', url: 'https://duckduckgo.com', region: 'international', mode: 'search', searchUrlTemplate: 'https://duckduckgo.com/?q={query}' },
{ id: 'baidu', name: '百度', url: 'https://www.baidu.com', region: 'china', mode: 'search', searchUrlTemplate: 'https://www.baidu.com/s?wd={query}' },
{ id: 'sogou', name: '搜狗', url: 'https://www.sogou.com', region: 'china', mode: 'search', searchUrlTemplate: 'https://www.sogou.com/web?query={query}' },
```

### 2. cellStates 结构增加 mode 字段

`windowManager.ts` 中的 `CellState` 接口：

```typescript
interface CellState {
  url: string;
  active: boolean;
  mode: CellMode;   // 新增，根据用户选择的 PresetSite 决定，自定义 URL 默认 'chat'
}
```

用户通过「编辑格子」选择内置网站时（不管是从下拉菜单选还是直接输入了一个
和 `PresetSite.url` 域名匹配的地址），`mode` 跟随该 `PresetSite.mode`
**自动判定**，不向用户展示任何"这是搜索引擎"之类的勾选项——用户选了 Google
就是搜索引擎，选了 Claude 就是 AI 助手，系统自己知道，不需要用户再确认一遍。

**"这是搜索引擎"开关只在一种情况下出现**：用户输入的 URL 经过域名匹配后，
在 `PRESET_SITES` 中**找不到任何匹配项**（既不是已知 AI 网站，也不是已知
搜索引擎），系统无法判断该网址的类型。这时才显示开关，让用户告知这是一个
搜索引擎还是普通的聊天类网站，默认不勾选即 `mode: 'chat'`。

匹配逻辑：
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

`CellConfigPanel.tsx` 中：用户编辑某个格子的 URL 时，每次输入变化都调用
`inferModeFromUrl`。返回 `'chat'` 或 `'search'` 时直接设置对应 `mode`，
不渲染任何额外 UI；只有返回 `'unknown'` 时，才在输入框下方渲染
"这是搜索引擎"开关（此时还需要额外的查询参数名输入框，参考下方说明）。

### 3. sendToAll 方法分流处理

修改 Week 5-6 中实现的 `sendToAll`：

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
      // search 模式是页面跳转，不需要等待注入结果，无需失败提示
    } else {
      const success = await this.injectScript(cellId, text);
      if (!success) {
        this.window.webContents.send(IPC.SHOW_CELL_NOTICE, {
          cellId, type: 'inject-failed', message: NOTICE_MESSAGES['inject-failed'],
        });
      }
    }
    await new Promise((r) => setTimeout(r, 150));
  }
}

function buildSearchUrl(template: string | undefined, query: string): string {
  if (!template) return '';
  return template.replace('{query}', encodeURIComponent(query));
}
```

### 4. GridCell.tsx / CellConfigPanel.tsx 视觉区分

- 格子左上角 favicon 旁，`search` 模式额外显示一个小放大镜图标，区分于 AI 聊天格子
- 「编辑格子」面板的内置网站选择列表，按 `mode` 分组显示："AI 助手" 分组和 "搜索引擎" 分组

### 验收标准

1. 内置清单中能看到 Google / Bing / 百度等搜索引擎选项，归类在"搜索引擎"分组下
2. 创建一个四分屏：cell-0/1 放 Claude + ChatGPT，cell-2/3 放 Google + 百度
3. 在统一输入框输入一句话发送后：Claude/ChatGPT 格子正常收到文字并触发对话；
   Google/百度格子直接跳转到对应的搜索结果页，URL 正确带上了查询词
4. 搜索引擎格子不会因为"找不到输入框"触发 inject-failed 提示（因为走的是 navigate，不是注入）
5. 从下拉菜单选择已知网站（Claude / ChatGPT / DeepSeek / 百度等），编辑面板
   不显示任何"这是搜索引擎"开关，mode 由系统自动判定，用户全程无感
6. 在格子里手动输入一个不在内置清单中的陌生网址（如某个小众论坛地址），
   此时才出现"这是搜索引擎"开关，默认不勾选
7. 输入的自定义网址如果域名能匹配到内置清单中的某一项（即使是手动打字
   而不是选下拉菜单），也应自动判定 mode，不弹出开关
8. 打开「编辑格子」面板，已加载 claude.ai/login 的格子，其下拉框应自动
   显示"Claude"（不是写死的"自定义 URL"文案）；点击下拉框能看到完整的
   分组选项列表，选择"ChatGPT"后右侧文本框应立即变为 chatgpt.com，
   而不是要求用户手动打字

---

## 产品决策：格子 URL 持久化语义（2026年6月）

### 背景

Week 7 C 组验收时发现一个语义歧义：格子重启后恢复的 URL，是该网站经过登录跳转
后的实际页面（如 `claude.ai/login`），而不是用户最初配置的原始地址（如 `claude.ai`）。
Codex 正确识别了这是语义问题，未自行决定，已确认决策如下。

### 决策：保留退出时实际停留的页面 URL（当前实现已经正确，不需要改代码）

理由：MultiMind Browser 本质是浏览器，浏览器的标准行为就是记住用户上次停留的
页面并原地恢复（类似 Chrome 重启后恢复标签页）。如果用户在某个 AI 对话中聊了
很久，重启后应该回到那个具体对话，而不是回到模板配置的初始首页。

`windowManager.ts` 中 `did-finish-load` 事件持久化当前 URL 到 `cells.<cellId>.url`
的现有逻辑**无需修改**，这是正确行为。

### 明确边界（避免未来产生歧义）

1. **模板/预设的 URL 只在格子「从无到有创建」时生效一次**，作为该格子的初始
   加载地址。此后该格子的 `url` 字段记录的永远是"最后一次实际停留的地址"，
   不会、也不应该再回退到模板定义的原始值。

2. **用户在「编辑格子」面板手动修改 URL 时**，新地址立即生效并触发 `navigate`，
   随后该地址通过 `did-finish-load` 正常持久化，这与「记住最后停留页面」是
   同一套逻辑，没有特殊处理，不需要额外代码路径。

3. **如果某个格子从未登录过**，重启后理所当然停留在登录页——这不是 bug，
   是「记住最后停留页面」语义下的正常结果，不需要做"自动跳回首页"之类的
   特殊处理。

4. 后续如果做"重置格子到默认地址"功能（比如格子右上角悬浮菜单加一个
   "重置为默认"选项），才需要单独读取 `PresetSite.url` 或 `LayoutTemplate`
   中的原始值，与持久化逻辑是两条独立路径，不要混在一起。

---

## 四项修复与优化（2026年6月）

### 1. 崩溃修复：退出时 "Object has been destroyed"（高优先级，阻断性问题）

**问题**：Cmd+Q 退出应用时报错崩溃，调用栈显示
`WindowManager.sendUrl` 在 `windowManager.js:644` 访问了已销毁对象，
触发源是某个 `WebContents` 事件回调（如 `did-navigate` 类事件）。

**根因**：应用退出时，`BrowserWindow`/`WebContentsView` 被销毁的过程中，
仍有进行中的页面导航触发了事件回调，回调函数尝试访问已经不存在的
`window` 或 `view` 对象，导致未捕获异常。这是经典的退出竞态问题。

**修复要求**：

1. 在 `WindowManager` 所有对外暴露的方法（`sendUrl`/`navigate`/
   `injectScript`/`sendToAll` 等）开头增加销毁检查：
   ```typescript
   sendUrl(...) {
     if (this.window.isDestroyed()) return;
     // ... 原有逻辑
   }
   ```
2. 在 `app.on('before-quit')` 或 `window.on('close')` 时，主动移除所有
   `WebContentsView` 的事件监听器（`did-navigate`、`page-title-updated`
   等），避免退出过程中这些事件还在触发回调
3. 所有事件回调内部，第一行也要做存在性检查（不只是方法入口检查），
   因为事件触发和方法调用可能是不同的代码路径：
   ```typescript
   view.webContents.on('did-navigate', (_, url) => {
     if (this.window.isDestroyed()) return;
     // ... 原有逻辑
   });
   ```
4. 给主进程加一个全局的 `uncaughtException` 兜底处理（不弹出崩溃对话框，
   只记录日志），防止任何遗漏的边界情况导致用户看到这种技术性报错弹窗：
   ```typescript
   process.on('uncaughtException', (error) => {
     console.error('Uncaught exception:', error);
     // 不要 app.quit() 或弹窗，只记录，避免影响正常退出流程
   });
   ```

**验收标准**：连续执行 10 次"打开应用 → 创建若干标签和格子 → Cmd+Q
退出"，确认不再出现这个报错弹窗。

---

### 2. 新建标签默认地址优化

**问题**：单屏模式新建标签后，地址栏显示 `about:blank`，用户需要先
手动清空才能输入新地址，体验不便。

**修复要求**：

1. 新建标签时，`BrowserTab.url` 初始值设为空字符串 `''`，不要加载
   `about:blank` 这个内部协议地址
2. 地址栏在 `url` 为空时，不显示任何文字，而是显示一个浅色占位提示
   文字（placeholder），如"输入网址或搜索"，用户点击后直接可以输入，
   不需要先删除已有内容
3. 新标签对应的 WebContentsView 内容区，在没有加载任何真实地址前，
   显示一个简洁的空状态页面（可以列出几个常用网站的快捷入口，
   比如内置 AI 清单里的站点，点击直接跳转），而不是浏览器默认的
   空白页

**验收标准**：新建标签后，地址栏是空的且有占位提示文字，光标点击后
直接能打字，不需要任何清空操作。

---

### 3. 设置按钮图标尺寸与居中问题

**问题一（尺寸）**：工具栏右上角的设置图标偏小，不易点击和辨识。

**问题二（居中，新发现）**：截图显示设置齿轮图标在按钮容器内不居中，
明显偏向左上方，对比同一行的深色模式圆形图标（居中正常）可以看出
差异。

**居中问题排查方向**：这类问题通常不是 flex 容器没设居中样式，而是
图标本身的 SVG 内容在 viewBox 里不对称（很多 icon 库的齿轮图标，
绘制时图形的视觉重心和 SVG 的几何中心点不一致），导致即使容器用了
`display: flex; align-items: center; justify-content: center`，
图标看起来仍然偏移。

**修复要求**：

1. 先确认按钮容器本身的居中样式是否正确（`align-items: center` +
   `justify-content: center`，且容器是固定宽高的正方形或圆形）
2. 如果容器样式没问题，问题出在图标本身，检查当前用的是哪个图标库
   或具体 SVG 来源（比如 `lucide-react` 的 `Settings` 图标），换成
   该图标库里专门为"居中显示"优化过的变体，或者检查 SVG 的 viewBox
   设置是否和实际绘制内容对齐
3. 如果是手写的 SVG path，检查 path 的 bounding box 范围是否真的
   填满了 viewBox（用浏览器 DevTools 检查 SVG 元素的实际渲染边界）
4. 调整图标尺寸到 20-22px 的同一过程中顺带验证居中效果，不要
   分两次单独改尺寸和居中，容易引入新的不一致
5. 点击热区（可点击范围）保持不小于 32x32px，图标本身视觉居中于
   这个热区正中央，不是仅仅居中于图标自身的某个错误边界

**验收标准**：
1. 截图对比设置图标和深色模式图标，两者在各自按钮容器内的视觉
   居中程度应该一致，不能有肉眼可见的偏移
2. 图标尺寸调整后与工具栏其他图标视觉权重一致

---

### 4. 风控规避审视（持续性事项，非一次性修复）

**背景**：产品形态上是浏览器，核心机制依赖在 AI 网站内自动填充和提交
内容，需要持续关注是否触发各网站的反自动化检测，同时严格遵守
合规底线——不绕过登录验证机制本身（如验证码、双重验证），只优化
"看起来更像真实用户操作"的行为特征。

**当前已有的规避措施（保持，不要移除）**：
- 每个格子独立 `partition`，避免多格子共享 cookie 引发异常行为模式
- 统一设置 Chrome 标准 User-Agent
- 统一发送时格子间增加 150ms 延迟，避免看起来像批量脚本操作

**新增审视点**：

> ⚠️ 修正说明（第二次修正）：上一版在这里完全撤回了"UA 按平台区分"
> 这件事，理由是担心"动态切换"带来风险。但这个判断过度了——真正的
> 风险只存在于"运行时随机切换 UA"或"每次请求换一个 UA"这类动态行为，
> 而"同一个用户、同一次安装，UA 永远固定不变"这件事本身没有风险，
> 不管这个固定值是在打包时硬编码的，还是运行时读取一次
> `process.platform` 得出的——两者效果等价，都是"对这个用户而言
> 永远不变的固定值"。现在恢复"UA 按平台区分"，但用更干净的方式实现：
> **打包时静态确定，不在运行时做任何判断逻辑。**

1. **UA 按打包平台静态区分，构建时确定，不用运行时判断**：

   不在代码里写 `process.platform` 之类的运行时判断逻辑，而是在
   构建配置层面为每个平台准备各自的 UA 常量。具体做法是用环境变量
   或构建脚本参数在编译时确定使用哪个 UA 字符串：

   ```typescript
   // src/main/constants.ts
   // 通过构建脚本（package.json 的 build:mac / build:win 命令）
   // 注入不同的环境变量，而不是运行时判断 process.platform

   export const CHROME_USER_AGENT =
     process.env.BUILD_TARGET === 'win'
       ? 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
         '(KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36'
       : 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 ' +
         '(KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';
   ```

   `package.json` 中区分构建命令：
   ```json
   {
     "scripts": {
       "package:mac": "npm run build && electron-builder --mac --universal",
       "package:win": "cross-env BUILD_TARGET=win npm run build && electron-builder --win --x64"
     }
   }
   ```

   效果上这等同于"硬编码两个版本"，只是用环境变量避免维护两份几乎
   相同的源代码文件。关键点是：**这个值在构建完成后就固定死了，
   运行时没有任何分支判断，同一份安装包里这个常量是写死的字符串**，
   不存在"动态性"，因此不引入额外风险。

2. **注入脚本执行前增加最小等待时间**：当前 `injectScript` 在页面
   `did-finish-load` 后可能立即执行，过快的"加载完成立即填充提交"
   时序本身就是自动化脚本的典型特征。建议在 `did-finish-load` 后
   增加一个小的随机延迟（如 300-800ms 之间随机取值）才执行注入，
   而不是固定延迟，更接近真实用户的反应时间分布：
   ```typescript
   async function humanLikeDelay() {
     const delay = 300 + Math.random() * 500;
     await new Promise((r) => setTimeout(r, delay));
   }
   ```

3. **避免同时对所有格子做完全相同的操作序列**：当前统一发送虽然有
   150ms 固定间隔，可以考虑改为有微小随机扰动的延迟（如
   `150 + Math.random() * 100`），让请求间隔不是机械的固定值。

4. **已知限制，不在当前阶段处理**：更深层的指纹识别（鼠标移动轨迹、
   页面停留时间分布等）不在当前 MVP 处理范围内，记录为已知限制。
   如果未来某个特定网站的检测明显升级导致大量用户反馈无法使用，
   再针对性评估是否需要更复杂的规避手段。

**合规边界（必须遵守，不能突破）**：

- 不绕过、不破解任何网站的验证码、双重验证、人机验证机制
- 不模拟或伪造完整的用户身份信息（设备指纹、生物特征等）
- **不做运行时动态切换或随机变化 UA**——按平台在构建时静态确定一个
  固定值是允许的（见上方第1点），但同一份已安装的应用在运行期间，
  UA 必须永远是同一个值，不能在运行中变化或随机轮换
- 所有优化的本质是让"自动填充输入框并提交"这个动作的时序特征更接近
  真实用户操作的自然分布，而不是去突破网站本身设置的安全验证关卡
- 如果某个网站明确通过用户协议禁止自动化访问，应当尊重该网站的政策，
  现阶段不主动针对性绕过任何网站的明确反自动化声明

**验收标准**：
1. macOS 打包产物中 UA 显示 Mac 字符串，Windows 打包产物中 UA 显示
   Windows 字符串；同一个产物多次重启应用，UA 值保持完全一致不变
2. 统一发送时，用网络面板观察各格子的请求时序，确认不是完全机械的
   固定间隔
3. 确认没有任何代码逻辑涉及绕过验证码或双重验证机制
