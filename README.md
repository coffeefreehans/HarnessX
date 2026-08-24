# DeepSeek HarnessX

<p align="center">
  <strong>HARNESSX</strong><br>
  DeepSeek Harness 的独立桌面客户端
</p>

<p align="center"><sub>中文 · <a href="README.en.md">English</a></sub></p>

DeepSeek HarnessX 将固定版本的 DeepSeek Harness 运行时组合成原生桌面应用，提供窗口与托盘管理、配置切换、本地终端、插件市场、安装任务和应用更新。它是独立维护的社区项目，不是 DeepSeek 官方产品。

## 功能

- 原生 Electron 窗口、系统托盘与单实例运行
- DeepSeek Harness 本地服务启动、停止和异常恢复
- 兼容模式与桌面增强模式
- 多配置发现、切换、重启和失败回退
- Windows/macOS 本地终端入口
- 插件源、插件发现、安装、卸载和任务进度
- 任务结果、开始时间、完成时间、耗时和可折叠命令日志
- GitHub Release 更新检查、版本说明和对应架构安装包下载
- 桌面专属「HARNESSX」设置分组:独立于内核、随桌面功能迭代的设置页(通知、多模态模型等),内核升级不会被覆盖
- 多模态图片能力:发送图片时,当前模型不支持图片会先经通用识图模型转成文字描述再发送;自定义接口可逐模型声明图片输入
- 桌面偏好改由 host 侧持久化(DSH home 下的 `prefs.json`),跨应用重启与内核 Web 端口变化保留

## 首次运行

1. 下载与 CPU 架构匹配的安装包并完成安装。
2. 启动 DeepSeek HarnessX。应用会在本机回环地址启动服务，不向局域网开放端口。
3. 在设置中填写模型提供商和凭据。
4. 从托盘或设置页选择需要使用的配置；切换配置后应用会有序重启。
5. 只从可信来源安装插件。插件安装结束后，“已安装”和“任务”页面会自动刷新。

## 配置与数据

DeepSeek HarnessX 使用 DeepSeek Harness 的 `DSH_HOME`。未显式设置时，实际位置由 DeepSeek Harness 的系统路径规则决定。配置目录保存会话、设置和插件；桌面应用自己的选择状态、下载缓存和运行时命令位于 Electron 用户数据目录。

应用不会在卸载时主动删除 DeepSeek Harness 用户数据。升级或重装前仍建议自行备份重要会话和配置。

## 插件市场

插件市场支持添加仓库源、刷新清单、查看插件、安装和卸载。安装任务按创建时间倒序展示，最新任务位于最上方，并明确显示成功、失败或进行中状态。

安装前会检查目标仓库是否声明可加载的 DeepSeek Harness bundle。依赖安装默认禁止生命周期脚本，避免第三方依赖在安装阶段任意执行本机命令。此限制不能把已启用插件变成安全沙箱：插件仍与宿主共享进程，可能访问宿主提供的能力，因此只能安装已审查且可信的插件。

## 应用更新

设置页的“应用更新”显示当前版本、最新版本、CPU 架构、发布时间、版本标题、版本说明和上次检查时间。检查与下载直接使用公开仓库 `coffeefreehans/HarnessX` 的 GitHub Releases：

```text
https://api.github.com/repos/coffeefreehans/HarnessX/releases/latest
```

应用只接受稳定的两段或三段数字版本标签，例如 `v0.1`、`v0.2` 或 `v1.0.1`。下载时会严格匹配当前系统与 CPU 架构的固定文件名，不会执行来自其他仓库或不匹配版本的资产。

## 安全边界

- 桌面 API 使用每次启动随机生成的 HttpOnly 会话令牌。
- 修改类请求同时校验精确的本地来源。
- 模型凭据在 Windows 使用 DPAPI、在 macOS 使用 Keychain 加密。
- 旧明文凭据只会在成功迁移到系统安全存储后删除。
- 更新接口固定到本项目 GitHub 仓库，并限制响应和安装包大小。
- 安装包下载后会检查文件完整性和平台文件头，再交给系统打开。
- 第三方插件不是隔离进程；操作系统加密无法阻止恶意插件在应用运行时调用已授权服务。

## 从源码运行

要求：

- Windows 10/11 或受支持的 macOS
- Node.js 22.19+ 或 Node.js 24
- Corepack
- Git

```sh
git clone https://github.com/coffeefreehans/HarnessX.git
cd HarnessX
corepack yarn install --immutable
corepack yarn dev
```

根项目使用 Yarn 4 和 `node_modules` linker。 `deepseek-harness/` 是纳入本仓库的固定版本上游源码快照，保留自己的 pnpm workspace；不要在桌面功能分支修改其中内容。

## 检查与打包

```sh
# 完整构建、类型检查、测试和运行时闭包检查
corepack yarn check

# Windows x64 与 ARM64 安装包及本地绿色 ZIP
corepack yarn dist:win

# macOS 签名与公证发布构建，需要 Apple 发布凭据
corepack yarn dist:mac
```

Windows 打包必须在 x64 Windows 主机上使用 x64 Node.js 执行。macOS 的 Intel 与 Apple Silicon 包由对应架构的 GitHub Actions runner 分别生成。公开 Release 只上传两个 Windows 安装包和两个 macOS DMG，不上传绿色 ZIP。

## 仓库结构

| 路径 | 说明 |
| --- | --- |
| `src/` | Electron 启动、桌面 Host/Client 插件和本地服务 |
| `tests/` | 单元测试、集成测试和打包验证 |
| `scripts/` | 构建、运行时闭包检查和平台打包脚本 |
| `build/` | 应用图标与托盘资源 |
| `deepseek-harness/` | 纳入仓库的固定版本 DeepSeek Harness 上游源码快照 |
| `patches/` | 桌面运行和发布所需的依赖补丁 |

## 常见问题

**安装插件后“已安装”没有立即出现**

确认任务状态为“安装成功”。页面会自动刷新；若插件包本身不是有效的 DeepSeek Harness bundle，任务会显示失败原因。

**检查更新失败**

确认可以访问 GitHub API 和 Releases。公开仓库尚未发布 Release、GitHub 限流或网络代理拦截时，设置页会保留当前版本并显示检查失败。

**Windows 安装警告**

当前 0.1.x 发布版本尚未使用 Authenticode 签名。只从本仓库 Release 下载并核对 SHA-256，不要从第三方下载站获取安装包。

**macOS 无法打开**

确认下载的 DMG 与 CPU 架构一致，然后在“系统设置 > 隐私与安全性”中允许打开。未签名或未公证的本地测试包可能需要额外确认。

## 许可

本仓库按照 [MIT License](LICENSE) 发布。项目组合固定版本的 DeepSeek Harness，并依赖多个开源组件；这些组件继续适用各自的许可证和版权声明。再分发时必须保留适用的版权与许可文本。
