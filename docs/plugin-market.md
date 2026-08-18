# HarnessX 插件市场

插件市场是 Desktop 自带的 Host 插件，向当前 Web 页面提供浏览、安装插件和配置插件源的能力。它不绕过官方 `dsh plugin` 语义：安装请求最终通过 `desktopPnpm.runPlugin(['add', spec], profileDir)` 执行。

## 入口

页面左侧会常驻一个拼图按钮。点开后是树形插件市场，包含：

- **发现**：搜索并浏览所有启用源返回的插件，分页加载并安装。
- **插件源**：按源浏览，并新增、编辑、停用或删除插件源。
- **已安装**：查看当前 profile 已安装的第三方插件，并卸载。
- **任务**：查看安装/卸载任务的实时日志，可取消运行中的任务。

市场入口注册在官方 `shell.overlay` slot 中，因此兼容模式和高级模式都可使用。

## 插件源

每个源使用以下字段持久化到当前 profile 的 `.harnessx-desktop/market/sources.json`：

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `id` | `string` | 稳定标识，仅允许小写字母、数字、点、短横线和下划线 |
| `name` | `string` | 界面显示名称 |
| `kind` | `'npm' \| 'manifest' \| 'github' \| 'local'` | 源类型 |
| `url` | `string` | 源地址，具体含义由 `kind` 决定 |
| `enabled` | `boolean` | 是否参与目录请求 |

首次启动会创建五个默认源：

- `npm Registry`：`https://registry.npmjs.org`
- `Awesome DSH Plugins`：`https://awesome-dsh-plugin.com/plugins.json`
- `DSH Plugin Marketplace`：`https://w2112515.github.io/dsh-plugin-marketplace/plugin-marketplace/catalog-v1.json`
- `YELEBAI DSH Marketplace`：`https://raw.githubusercontent.com/YELEBAI/dsh-plugin-marketplace/main/registry/plugins.json`
- `BraDe DSH Marketplace`：`https://raw.githubusercontent.com/bradeGithub/DSH-Plugins-Marketplace/main/registry.json`

已存在的 `sources.json` 会自动补入新增的默认源，不会覆盖用户已有配置。

### `npm`

`url` 是 npm registry 根地址。目录请求会调用该 registry 的 `/-/v1/search`，默认搜索词为 `deepseek-harness`。

### `manifest`

`url` 是远程 JSON 目录地址。文件可以符合下方 manifest 格式，也可以使用已适配的 `plugins[]`、`entries[]` 或 `repos[]` 市场格式。

### `github`

`url` 是公开 GitHub 仓库地址，例如 `https://github.com/owner/repo`。Desktop 会读取仓库根目录的 `dsh-market.json`。

### `local`

`url` 是本地目录或 JSON 文件路径。目录源会依次尝试读取 `dsh-market.json` 和 `market.json`。

## Manifest 格式

```json
{
  "version": 1,
  "plugins": [
    {
      "id": "example-plugin",
      "name": "Example Plugin",
      "description": "Optional description",
      "version": "1.0.0",
      "author": "Example Author",
      "homepage": "https://example.com/plugin",
      "repository": "https://github.com/example/plugin",
      "install": "example-plugin",
      "tags": ["example", "tool"]
    }
  ]
}
```

`install` 是传给 `dsh plugin add` 的 package spec，可以是 npm 包名、npm 别名、Git URL 或本地路径。Desktop 只做格式校验，不会拼接 shell 命令。

## HTTP API

Host 插件注册以下同源 API：

| 方法 | 路径 | 用途 |
| --- | --- | --- |
| `GET` | `/api/desktop/market/sources` | 获取源列表 |
| `POST` | `/api/desktop/market/sources` | 新增或覆盖一个源 |
| `DELETE` | `/api/desktop/market/sources?id=...` | 删除一个源 |
| `GET` | `/api/desktop/market/catalog?query=...&sourceId=...` | 合并返回启用源的插件目录 |
| `GET` | `/api/desktop/market/installed` | 获取当前 profile 已安装的第三方插件 |
| `POST` | `/api/desktop/market/install` | 启动一个 `dsh plugin add` 任务 |
| `POST` | `/api/desktop/market/uninstall` | 启动一个 `dsh plugin remove` 任务 |
| `GET` | `/api/desktop/market/jobs/<jobId>` | 查询安装任务状态和日志 |
| `POST` | `/api/desktop/market/jobs/<jobId>/cancel` | 请求取消安装任务 |

`catalog` 还接受 `limit` 和 `offset` 参数，默认 `limit=60`、`offset=0`，用于大目录分页。

## 安全边界

- 插件安装本质是执行第三方代码；市场只会安装用户明确点击的条目。
- 源地址和 `install` spec 均做严格格式校验，不允许控制字符或超长内容。
- 安装通过 argv 传给 `dsh plugin`，不经过 shell 字符串拼接。
- 同一个 generation 同时只允许一个 package operation；冲突请求返回 `409`。
