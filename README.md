# MultiMind Flow

MultiMind Flow is a desktop workspace for discussing with multiple AI assistants and search engines side by side. It supports split-screen cells, a shared input box, per-cell configuration, and manual cross-checking between AI responses.

## Supported Platforms

- macOS: Apple Silicon and Intel builds are packaged as a Universal app.
- Windows: x64 installer.

## Development

```bash
npm install
npm run dev
```

## Build

```bash
npm run build
```

## Packaging

```bash
npm run package:mac
npm run package:win
npm run package:all
```

## Installation

### macOS

Open the `.dmg`, drag **MultiMind Flow** into **Applications**, then launch it.

The current build is not code-signed or notarized. If macOS blocks the first launch, right-click **MultiMind Flow** and choose **Open**, or allow it from **System Settings -> Privacy & Security**.

### Windows

Run the `.exe` installer and follow the prompts.

The current build is not code-signed. If SmartScreen blocks it, choose **More info -> Run anyway**.

---

# MultiMind Flow 中文说明

MultiMind Flow 是一个桌面工作区，用于并排使用多个 AI 助手和搜索引擎进行讨论。它支持多格子分屏、底部统一输入、单格配置，以及手动把某个 AI 的回答转发给其它 AI 做交叉验证。

## 支持平台

- macOS：Apple Silicon 和 Intel，打包为 Universal 应用。
- Windows：x64 安装包。

## 本地开发

```bash
npm install
npm run dev
```

## 构建

```bash
npm run build
```

## 打包

```bash
npm run package:mac
npm run package:win
npm run package:all
```

## 安装

### macOS

打开 `.dmg`，把 **MultiMind Flow** 拖入 **Applications**，然后启动应用。

当前构建未做代码签名和 notarization。首次启动如果被 macOS 拦截，可以右键 **MultiMind Flow** 选择 **Open**，或在 **System Settings -> Privacy & Security** 中允许打开。

### Windows

运行 `.exe` 安装包并按提示安装。

当前构建未做代码签名。如果被 SmartScreen 拦截，选择 **More info -> Run anyway**。
