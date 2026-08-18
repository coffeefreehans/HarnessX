# Agent Note: 固定上游源码与扁平化 Yarn 包

Status: implemented

[English](2026-08-15-pinned-upstream-and-isolated-yarn-workspace.md) | 中文

## Problem

HarnessX 需要保留可供审查的 DeepSeek Harness 官方精确源码，同时让桌面产品独立演进。若把上游源码作为普通文件跟踪，桌面提交就能改写上游实现，代码归属也会变得模糊。共享同一个包管理图还会把上游的 pnpm 规则与桌面产品的 Yarn 发行流程混在一起。

## Decision

[`deepseek-harness/`](../../../../deepseek-harness/) 是 Git 子模块，固定到 [`upstream.json`](../../../../upstream.json) 记录的官方仓库和精确提交。桌面分支把该子模块视为只读内容。更新上游时，在独立提交中同时修改 gitlink 与元数据。

根 README 文件和资源由产品仓库拥有，不从官方源码子模块派生。包级初始化和发行文档位于 [`docs/package-reference.md`](../../../../docs/package-reference.md)。

仓库根目录是使用 `node_modules` linker 的唯一 HarnessX Yarn 4 包。纳入仓库的上游源码快照按照自己的[包管理器决策](../../../../deepseek-harness/.agents/notes/implemented/process/2026-06-16-pnpm-over-yarn.zh.md)保持独立的 pnpm 工作区。根目录的 `upstream:*` 脚本通过 Yarn portable shell 进入该目录，再由 Corepack 调用上游固定的 pnpm 版本。

普通桌面构建从 npm registry 解析已发布的 DSH 包，不从源码快照链接源码。`upstream.json` 分别记录源码版本和运行时包 family。纳入仓库的 GitHub 公开源码为 `0.1.0-rc.7`，桌面运行时也使用已发布的 `0.1.0-rc.7` family。

`yarn check:layout` 会拒绝缺失或嵌套的 Git 目录、包管理边界、嵌套桌面包或 DSH 运行时 family。CI 以 immutable 模式安装根包，运行桌面检查，并在 Windows 上执行上游命令路径。

## Verification

当前仓库结构通过 `yarn check:layout`、`yarn upstream:version`、`yarn install --immutable` 和 `yarn check`。`yarn check` 中的 Loader smoke 会通过 Cordis 激活构建后的桌面包，但不会打开 Electron 窗口。

## Alternatives considered

**继续在根目录携带可编辑的上游文件。** 这种方式只需要一个 checkout，但无法机械地区分官方源码和桌面自有修改，无法解决本结构要消除的归属问题。

**通过 subtree 或复制快照 vendoring 上游源码。** 副本可以记录来源，但上游文件仍表现为产品自有的普通文件，意外提交补丁仍然很容易。

**把上游 checkout 加入 Yarn workspace 或使用源码链接。** 这会让桌面依赖解析耦合到未修改的 pnpm monorepo，并让产品构建依赖未发布的源码布局，而不是用户实际安装的包。

**把上游 checkout 转换为 Yarn。** 包管理器转换会修改官方源码，并使其 lockfile 和仓库检查失效。因此，上游命令继续使用 pnpm。

**把 npm 运行时版本视为对应源码修订的证明。** 已发布包的元数据没有标识这样的修订。分别记录源码和 artifact 版本可以避免错误的来源声明。

## Consequences

桌面改动直接位于根包，官方 checkout 可以与其远端提交直接比较。根落地页展示 HarnessX，详细使用方式由包级参考文档负责。产品安装与检查可由根 Yarn lockfile 复现，上游验证则继续使用自己的 pnpm lockfile。

克隆时必须初始化子模块，贡献者也需要维护两套有意隔离的包管理器缓存。GitHub 公开修订与 npm 发布 family 可能不对应，因此源码 pin 更新和运行时 family 更新需要分别提供验证证据。
