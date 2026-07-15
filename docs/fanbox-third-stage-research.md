# FanBox 对 MultiMind Flow 第三阶段的参考价值调研

调研对象：[alchaincyf/fanbox](https://github.com/alchaincyf/fanbox)  
调研时间：2026-07-02  
检视版本：`87c372b` / `v2.5.0`，提交说明为 `feat: 回合安全带——agent 开工前自动存档 + 一键回滚 + 影子 git 覆盖非 git 项目 diff + release 2.5.0`

## 结论

FanBox 和 MultiMind Flow 第三阶段相似的地方不是“都是 Electron + 终端”，而是它已经把 **本地真实终端、Coding Agent CLI、文件系统可观测性、上下文/记忆管理、远程操控入口** 接成了一个完整工作流。

对 MultiMind Flow 最值得参考的不是它的单文件后端或文件管理 UI，而是以下 7 个机制：

1. 主进程统一托管 PTY，渲染层只通过 preload 暴露的窄 API 操作终端。
2. 用登录 shell 和环境复刻解决 GUI App 找不到 `claude` / `codex` / 代理变量的问题。
3. Agent 启动器不是写死一个命令，而是内置注册表 + 用户配置覆盖 + 安装检测。
4. 文件监听 + Git/影子 Git 快照，让用户能看清 Agent 改了什么，并能回滚。
5. 终端输出录制成 asciinema v2，作为 Agent 任务黑匣子。
6. 无头 CLI 驱动 `claude` / `codex`，通过 stdin 传 prompt、JSONL 解析进度和 session id。
7. 长上下文压缩前先 memory flush，用结构化 `<memory>` ops 做确定性记忆写入。

不建议照搬的是：FanBox 的 Node 单文件 HTTP 服务架构、微信 iLink 接入、macOS 专属合盖不睡实现、以及“文件管理器 + 预览器 + 轻编辑器”的产品重心。MultiMind Flow 第三阶段应该保留现有 Electron 主/渲染进程边界，把 FanBox 的机制拆成独立模块吸收。

## FanBox 架构概览

FanBox 当前架构分成三层：

| 层 | 主要文件 | 职责 |
|---|---|---|
| 本地 HTTP 服务 | `server.js` | 文件浏览、搜索、预览、编辑、Git diff、影子快照、Agent 项目/skills 扫描等 |
| Electron 主进程 | `electron/main.js` | BrowserWindow、node-pty、终端录制、文件监听、系统能力、微信 bridge IPC |
| 前端 | `public/app.js` | 文件 UI、预览/编辑器、xterm.js 终端、多终端标签、Agent 启动按钮 |

这种“HTTP 服务 + Electron 壳”的方案让 FanBox 从网页版平滑升级到桌面版，但对 MultiMind Flow 不一定合适。MultiMind Flow 已经有清晰的 Electron 主进程、renderer、shared 类型和 IPC 结构，第三阶段应继续使用现有 IPC 模型，而不是引入一个新的本地 HTTP API 层。

FanBox 的核心依赖：

- `electron ^33.2.0`
- `node-pty ^1.0.0`
- `@xterm/xterm ^5.5.0`
- xterm addons：fit、webgl、unicode11、clipboard
- Monaco、Milkdown、marked、highlight.js 等编辑/预览能力

和 MultiMind Flow 当前技术栈高度接近，尤其 Electron 版本同属 33 系列，xterm/node-pty 的经验可直接参考。

## README 致谢段落的技术底座启发

FanBox README 的 “Standing on the shoulders of giants · 建在巨人肩膀上” 段落不只是致谢清单，它实际说明了 FanBox 的技术路线：核心体验尽量站在成熟开源底座上，产品层做集成、编排和体验闭环，而不是重造终端、编辑器、Markdown 渲染或自动化测试。

对 MultiMind Flow 第三阶段，可以按价值分三层参考：

| FanBox 依赖 | 对第三阶段的参考价值 | 建议 |
|---|---|---|
| Electron | 现有桌面壳与系统能力入口 | 已采用，继续沿用，不换壳 |
| node-pty | 真实 PTY 是内嵌 Agent 终端的基础 | 思路采用，但依项目规则用 `@homebridge/node-pty-prebuilt-multiarch` 降低打包风险 |
| xterm.js + addon-fit + addon-unicode11 + addon-webgl | 终端渲染、尺寸适配、中文宽字符、性能 | 第三阶段终端 Pane 应直接采用；unicode11 和 fit 属于必要能力，WebGL 可作为增强 |
| Monaco Editor | Git diff、代码只读查看、后续轻编辑 | 不放进终端 MVP，但“Agent 改了什么”的 diff 视图可优先考虑 Monaco DiffEditor |
| marked + highlight.js | Markdown/代码预览 | 第二阶段文档沉淀和第三阶段 Agent 输出预览可参考，但 MultiMind Flow 已有自己的 UI 边界，不必做完整文件预览器 |
| Milkdown Crepe | Markdown 所见即所得编辑 | 暂不建议进入第三阶段 MVP；等“讨论 → 文档沉淀”从复制保存升级到内置文档编辑时再评估 |
| esbuild/vendor 本地资源 | 离线可用、运行时 no-build、减少外部 CDN 风险 | MultiMind Flow 打包桌面应用时也应避免依赖 CDN；终端/编辑器资源应随包内置 |
| electron-builder | 原生模块 asarUnpack、签名、公证、分发 | 项目已用 electron-builder，应重点参考 FanBox 对原生模块打包风险的处理 |
| Playwright | Electron 真机截图和 UI 验证 | 第三阶段尤其需要：验证 xterm 非空、resize 正常、输入输出可用、中文宽字符不乱 |

这里最关键的启发是：第三阶段不要把“内置终端”当作一个自绘文本框来做。FanBox 明确用 `node-pty + xterm.js + fit/unicode11/webgl` 组成终端底座，再把 Agent 启动、文件变化、录制、diff、上下文粘贴做在上层。MultiMind Flow 也应保持这个分层。

另一个值得吸收的点是“前端依赖本地 vendor 化/包内置”的产品含义。FanBox 这样做是为了离线可用和隐私边界清晰。MultiMind Flow 第三阶段引入终端和 Agent 后，用户会自然预期本地能力可靠可用，因此 xterm、字体、图标、编辑器 worker 等资源不应依赖公网加载。

## 终端实现

FanBox 的 PTY 生命周期在 `electron/main.js` 中集中管理：

- `terminals: Map<id, ptyProcess>` 存活跃终端。
- `pty:spawn` 创建 PTY。
- `pty:input` 写入用户输入。
- `pty:resize` 同步行列。
- `pty:kill` 终止会话。
- `pty:cwd` 用 `lsof` 反查真实 cwd。
- `pty:proc` 读取前台进程名，用于判断当前终端是不是空闲 shell。

渲染层通过 `electron/preload.js` 暴露：

```js
window.fanboxPty.spawn(opts)
window.fanboxPty.input(id, data)
window.fanboxPty.resize(id, cols, rows)
window.fanboxPty.kill(id)
window.fanboxPty.cwd(id)
window.fanboxPty.proc(id)
window.fanboxPty.onData(cb)
window.fanboxPty.onExit(cb)
```

这和 MultiMind Flow 的第三阶段设计一致：终端不进入 `CellState`，由独立 `TerminalManager` 管理，renderer 通过 contextBridge 访问。

FanBox 有几个细节值得直接吸收：

- PTY spawn 使用登录 shell：macOS GUI App 启动时环境变量很少，直接 spawn shell 会找不到 Homebrew、nvm、npm 全局命令。FanBox 在 `pty:spawn` 中对非 Windows 使用 `['-l']`，让 shell 读取登录环境。
- 强制 UTF-8 locale：如果 GUI 环境没有 `LANG` / `LC_*`，中文路径会乱码。FanBox 设置 `LANG=zh_CN.UTF-8` 或 `en_US.UTF-8` 兜底。
- 终端关闭前确认：`before-quit` 检查还有没有终端会话，避免用户误退出杀掉 Agent 任务。
- 最后清理：`window-all-closed` / `will-quit` 中 kill 全部终端并恢复系统状态。
- xterm 主题随 UI 主题切换，不只是嵌一个黑框。

对 MultiMind Flow 的建议：

- 按 AGENTS.md 里的 `TerminalManager` 继续独立实现，但补上 FanBox 的登录 shell、UTF-8、退出确认和 `proc/cwd` 查询。
- IPC 命名继续用 `TERMINAL_IPC`，不要照搬 FanBox 的字符串散落式频道。
- `@homebridge/node-pty-prebuilt-multiarch` 仍优先于 FanBox 的 `node-pty`，因为项目规则已经明确要降低原生编译风险。

## Agent 启动器

FanBox 在 `public/app.js` 中维护 `AGENT_REGISTRY`，内置 Claude Code、Codex、Hermes、OpenClaw、Kimi Code、opencode、Qoder 等 11 个 Agent。每个条目包含：

- `id`
- `label`
- `cmd`
- `bin` 或 `app`
- `install`

配置策略是三层：

1. 内置注册表提供默认 Agent。
2. `~/.fanbox/config.json` 的 `enabledAgents` 决定显示哪些按钮。
3. `config.json` 的 `agents` 数组可覆盖内置命令或追加新 Agent。

安装检测由 `/api/agents/which` 完成：

- CLI 用登录 shell 跑 `command -v`。
- 桌面 App 用 macOS `open -Ra` 检测。

启动策略也值得参考：点击 Agent 按钮时，FanBox 先判断当前终端是不是空闲 shell。如果是空闲 shell，就在当前标签启动；如果前台进程不是 shell，就新开标签，避免把 `codex` 命令打进正在运行的 `vim` / `claude` / `npm test`。

对 MultiMind Flow 的建议：

- 第三阶段不要只做“打开一个终端”。应做一个最小 Agent 启动器：
  - 默认 `Codex`、`Claude Code` 两个按钮。
  - 用户可配置命令。
  - 检测命令是否存在。
  - 正在运行程序的终端不复用。
- 这部分可以作为 `src/shared/agentLaunchers.ts` + renderer 控件 + main 检测 IPC 实现。
- 按项目现阶段边界，先不要内置 11 个 Agent。MultiMind Flow 的定位不是 Agent launcher 市场，默认 2-3 个足够。

## 文件变更可观测性

FanBox 最有价值的能力之一是“看 Agent 改了什么”。它用了两层机制：

### 实时层：文件监听

`electron/main.js` 的 `fs:watch-set` 支持监听多个目录：

- 当前浏览目录。
- 每个终端会话所在项目目录。
- 监听到变更后通过 `fs:changed` 推给渲染层。
- 用 mtime/ctime 过滤 FSEvents 中“只是被读了一下”的噪声。

### 事后层：Git diff + 影子 Git 快照

`server.js` 中有两套 diff 基准：

- 如果目录本身是 Git 仓库，用 `git status` 和 `git show HEAD:<file>` 展示真实 Git diff。
- 如果不是 Git 仓库，FanBox 在 `~/.fanbox/snapshots/<hash>/` 建一个独立 Git 仓库作为影子快照，不污染用户项目目录。

影子快照特性：

- Agent 开工前静默快照。
- 每项目保留 40 个 tag。
- 对大目录、系统目录、`node_modules` 等有排除和资格过滤。
- 回滚前先自动备份当前状态，避免 reset 变成不可逆破坏。

这对 MultiMind Flow 第三阶段非常关键。第三阶段如果只是内置终端，用户仍然看不清 Agent 做了什么；如果加上“Agent 变更收件箱/快照”，产品价值会明显高一档。

建议分两步吸收：

1. MVP 只做文件监听和变更列表：哪些文件被创建/修改/删除。
2. 后续做 Git diff：Git 项目读真实 diff，非 Git 项目再考虑影子快照。

注意边界：MultiMind Flow 当前是多 AI 浏览器，不是文件管理器。第三阶段的变更视图可以是“终端 Pane 的辅助面板”，不要扩展成完整 Finder。

## 终端黑匣子录制

FanBox 把每个 PTY 的输入、输出、resize 旁路写成 asciinema v2 `.cast`：

- 输出事件：`recEvent(id, 'o', data)`
- 输入事件：`recEvent(id, 'i', data)`
- resize 事件：`recEvent(id, 'r', 'colsxrows')`
- 每个录制文件头部包含 cwd、尺寸、主题、启动时间等 FanBox 私有元数据。
- 保留最近 60 个或总量 800MB，超出自动裁剪。
- 录制失败时静默自废，不影响 PTY 主链路。

这对 MultiMind Flow 很适合，因为第三阶段目标包含 Agent 执行。如果用户之后问“刚才 Agent 做了什么”，录制比只保存最后输出可靠。

建议：

- MVP 可以不做视频导出，只保存 `.cast` 或轻量 JSONL。
- 录制要默认有上限，不能无限增长。
- 录制器必须是旁路，失败不能影响终端输入输出。

## 终端与上下文互操作

FanBox 前端有几个交互值得借鉴：

- 从文件列表拖文件/文件夹进终端，自动插入 shell quote 后的路径。
- 预览中选中文字，一键用“来源 + fenced code block”格式发送到终端。
- 发送多行文本时使用 bracketed paste：`\x1b[200~...\x1b[201~`，避免 shell 或 TUI 把多行内容逐行误执行。
- 点击终端里的路径后，结合当前 cwd、scrollback 回扫和文件系统 `stat` 定位真实文件。

MultiMind Flow 第三阶段虽然暂不做完整文件浏览器，但仍可吸收两个低成本能力：

- 把当前讨论总结/某个 AI 回答作为 fenced block 发给终端中的 Agent。
- 用 bracketed paste 发送多行上下文，避免误执行。

这比“复制到剪贴板，让用户自己粘贴”更符合第三阶段“浏览器 + 终端 + Agent”的联动目标。

## 无头 CLI 驱动

FanBox 的 `electron/wechat/driver.js` 展示了另一条路线：不把 Claude/Codex 当 TUI 跑在 xterm 里，而是在后台用 CLI 的 headless/exec 模式作为“大脑”。

实现要点：

- 所有用户 prompt 走 stdin，不拼进命令行，避免转义和长度问题。
- `claude` 使用 `claude -p --output-format stream-json --verbose`，通过 `--session-id` / `--resume` 续上下文。
- `codex` 使用 `codex exec --json` / `codex exec resume <id>`，从 JSONL 事件里抓 `thread_id` 和最终 assistant 文本。
- stdout 按行解析 JSONL，工具调用转成“正在看/正在改/正在跑”的进度提示。
- 用“空闲超时”而不是总耗时判断卡死：长任务只要持续有输出就不杀。
- resume 失败时自动新建会话，避免把底层 session 错误暴露给用户。
- 通过 `env.js` 复刻用户登录 shell 环境，补 PATH、代理、BASE_URL 等变量。

对 MultiMind Flow 的启发：

- 第三阶段可以有两类 Agent 运行方式：
  - 交互式：xterm 中运行 `codex` / `claude`，用户直接看和接管。
  - 后台式：主进程调用 CLI headless 模式，作为“把讨论交给 Agent 执行”的能力。
- MVP 阶段建议先做交互式终端。后台式 CLI 驱动更强，但也更依赖各 CLI 的稳定 JSON 输出和 session 语义。
- 如果做后台式，必须像 FanBox 一样把 prompt 走 stdin，并集中处理环境复刻、超时、重试、session id。

## 记忆与上下文压缩

FanBox 的 `electron/wechat/memory.js` 和 `bridge.js` 中有一套轻量但清晰的记忆机制：

- 记忆文件写到 `~/.fanbox/memory/MEMORY.md`。
- 同时只读引用 `~/.claude/memory/MEMORY.md` 和 `PROJECTS.md`。
- 注入模型的记忆有字符预算，磁盘保完整，注入副本可截断。
- 让 Agent 在回复末尾输出：

```xml
<memory>[{"op":"ADD|UPDATE|DELETE","topic":"简短主题","text":"一句话内容"}]</memory>
```

- 应用层解析后确定性落盘，按 topic 去重。也就是说，Agent 只能提出 ops，真正写入由应用执行。

压缩流程也值得参考：

- 当上下文 token 超过阈值，回合结束后自动 compact，不打断当前回答。
- compact 前先让 Agent 做一次 `memoryFlush`：把值得长期记住的内容写成 memory ops，并输出短进度摘要。
- 清掉 CLI session id。
- 下一轮把摘要和最近几轮原话作为 seed 注入新 session。

这和 MultiMind Flow 第二阶段“讨论 → 文档沉淀”以及第三阶段“Agent 执行”有交叉价值，但不应急着内置完整长期记忆系统。更现实的吸收方式：

- 第三阶段先把“讨论上下文发给终端 Agent”做好。
- 后续如果引入长期记忆，采用“Agent 提议结构化 ops，应用确定性写入”的模式，避免让 Agent 随意改本地记忆文件。

## 安全与健壮性

FanBox 有几类工程经验值得吸收：

- 本地服务监听 loopback，并校验 Host，防 DNS rebinding。
- HTML 预览放 sandbox iframe，避免预览页面触达终端能力。
- 配置写入用串行读改写和原子写。
- 删除走系统废纸篓，不直接 `rm`。
- 终端相关功能如果 node-pty 不可用，App 降级但不崩。
- 终端任务运行时退出前确认。
- 文件系统路径操作大量使用 `stat` 验证，不靠字符串猜测。

MultiMind Flow 的第三阶段会引入真实 shell 权限，安全边界要更明确：

- renderer 不能直接拿 Node 能力。
- 终端 IPC 只暴露必要操作。
- 从 AI 网页内容发送到终端前，必须明确是“粘贴文本”还是“执行命令”。默认应使用 bracketed paste，不自动回车执行。
- 任何自动执行命令的能力都应该单独设计确认和审计，不要混进普通转发。

## 跨平台风险

FanBox 当前主要验证 Apple Silicon macOS。它自己的跨平台评估指出：

- Intel Mac 主要是构建和 node-pty 架构问题。
- Windows 难点集中在 shell、PATH、代理、quoting、ConPTY、凭据位置。
- macOS 专属能力很多：`pmset`、`osascript`、`scutil`、`lsof`、`open -Ra`、截图目录监听等。

MultiMind Flow 若要保持跨平台，应从一开始把这些能力隔离：

- `TerminalManager` 只做通用 PTY 生命周期。
- `ShellEnvironmentService` 分平台处理 PATH/代理/登录 shell。
- `AgentLauncherService` 分平台处理 `command -v` / `where` / `Get-Command`。
- `PowerGuard`、截图监听、系统通知等作为可选平台能力，不进核心终端模块。

## 对 MultiMind Flow 第三阶段的落地建议

建议按以下顺序吸收 FanBox 经验：

### 1. 终端 MVP

- 引入 `TerminalManager`，独立于 `WindowManager`。
- 使用 `@homebridge/node-pty-prebuilt-multiarch` + xterm.js。
- 实现 create/write/resize/destroy/data/exit IPC。
- spawn 使用登录 shell，补 UTF-8 locale。
- App 退出时 destroyAll，若有运行终端则确认。

### 2. Agent 启动器

- 内置 Codex、Claude Code。
- 支持用户配置命令。
- 检测是否安装。
- 空闲 shell 才复用，否则新开终端。

### 3. 讨论上下文 → 终端

- 从 MultiMind Flow 的讨论时间线构造上下文。
- 用 fenced block + 来源信息发送给终端。
- 使用 bracketed paste，默认不自动执行。
- 可以提供“粘贴到当前终端”和“新开 Agent 终端并粘贴”两种动作。

### 4. 文件变更观察

- 先做当前工作目录的变更列表。
- 再做 Git diff。
- 最后再评估影子 Git 快照和一键回滚。

### 5. 终端黑匣子

- 每个 PTY 保存有上限的录制日志。
- 支持查看最近会话输出。
- 后续再做 replay/export。

### 6. 后台 CLI Agent

- 等交互式终端稳定后再做。
- prompt 走 stdin。
- JSONL 解析集中封装。
- session id、超时、重试、环境复刻都在主进程服务内处理。

## 不建议照搬的部分

- 不建议引入 `server.js` 式大而全本地 HTTP 服务。MultiMind Flow 已有更清晰的主进程 IPC 架构。
- 不建议把终端塞进浏览器格子的 `CellState`。项目 AGENTS.md 已明确终端与 WebContentsView 是两套系统。
- 不建议第一版就做文件管理器、Monaco、图片标注、发版向导、skills 透视等 FanBox 大量周边能力。
- 不建议照搬微信 ClawBot。它对 FanBox 是遥控入口，对 MultiMind Flow 第三阶段不是核心路径。
- 不建议把 macOS 合盖不睡、电源管理放进核心模块。最多作为平台增强。
- 不建议默认启动命令使用类似 `--dangerously-skip-permissions`。这是 FanBox 的自用取舍，MultiMind Flow 面向用户时应更谨慎。

## 推荐的模块映射

| FanBox 机制 | MultiMind Flow 建议模块 |
|---|---|
| `electron/main.js` 的 PTY Map | `src/main/terminalManager.ts` |
| `electron/preload.js` 的 `fanboxPty` | `preload` 暴露 `window.electronAPI.terminal.*` |
| `public/app.js` 的 xterm sessions | `src/renderer/components/TerminalPane.tsx` |
| `AGENT_REGISTRY` | `src/shared/agentLaunchers.ts` |
| `/api/agents/which` | main IPC：`agent-launcher-detect` |
| `fs:watch-set` | main IPC：`workspace-watch-set`，可选 |
| Git/影子 Git diff | 后续 `src/main/workspaceSnapshotManager.ts` |
| `.cast` 录制 | 后续 `src/main/terminalRecorder.ts` |
| `wechat/driver.js` | 后续 `src/main/agentCliDriver.ts` |
| `wechat/memory.js` | 后续长期记忆模块，不应放入终端 MVP |

## 最小可参考设计

第三阶段第一版可以压到这个范围：

```text
Browser panes remain unchanged
        │
        ▼
PaneContent = cell | terminal
        │
        ├── WindowManager: still owns WebContentsView cells
        │
        └── TerminalManager: owns PTY sessions
                │
                ├── xterm TerminalPane
                ├── Agent launcher buttons
                └── Paste discussion context as bracketed paste
```

这一版已经能形成完整用户价值：用户在多 AI 分屏里讨论，得到上下文后，一键打开 Codex/Claude Code 终端，把讨论材料安全粘贴进去，让本地 Agent 接着执行。后续再逐步加文件变更观察、录制和后台 CLI driver。

## 最重要的工程提醒

FanBox 的实践说明，第三阶段真正难的不是 xterm 渲染，而是这些边角：

- GUI App 的环境变量和用户终端不一致。
- 多行上下文发给终端可能被误执行。
- Agent 正在运行时，不能随便复用终端写命令。
- 用户需要知道 Agent 改了哪些文件。
- App 退出不能静默杀掉长任务。
- 原生 PTY 打包后容易“开发环境能跑，打包产物打不开”。

这些问题如果一开始建模清楚，MultiMind Flow 的第三阶段会少走很多弯路。
