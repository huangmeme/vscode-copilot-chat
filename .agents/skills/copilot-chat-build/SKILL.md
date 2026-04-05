---
name: copilot-chat-build
description: 编译和打包 GitHub Copilot Chat VS Code 扩展。使用场景：用户要求编译、打包、构建 copilot-chat 项目，或者生成 vsix 安装包。
---

# Copilot Chat 编译打包

编译和打包 GitHub Copilot Chat VS Code 扩展。

## 前置条件

- Node.js 22.x
- 已运行 `npm install` 安装依赖
- 已配置 `.env` 文件（包含 `GITHUB_OAUTH_TOKEN`）

## 编译

使用 Node.js 实验性 TypeScript 支持编译：

```bash
node --experimental-strip-types .esbuild.ts --dev
```

## 打包

编译完成后生成 VSIX 安装包：

```bash
npx @vscode/vsce package
```

## 输出

- 编译输出: `dist/` 目录
- 安装包: `copilot-chat-0.42.3.vsix` (约 21 MB)

## 一键编译打包

```bash
node --experimental-strip-types .esbuild.ts --dev && npx @vscode/vsce package
```

## 安装扩展

```bash
code --install-extension copilot-chat-0.42.3.vsix
```

或在 VS Code 中通过扩展面板的 "..." 菜单选择 "从 VSIX 安装"。
