# dsh-plugin-labels

给 DSH（DeepSeek Harness）**已安装插件**配「中文名 + 一句话说明」，并在官方**侧栏「插件」页**和**设置 → 内置插件分区**的「中文名」标签页里，以「中文名 → 原始包名 → 一句话中文介绍」三层展示。

- 当前版本：**0.5.0**（本仓库即源码目录；本机以 `link:` 方式安装到 DSH profile）
- 只支持 DSH 桌面版 Web GUI（开发验证版本 0.2.1-rc.2）

## 功能

- **中文名 + 一句话说明**：每个插件一条中文名（≤8 字）和一句中文介绍（≤40 字）。
- **按需翻译**：只有点「翻译未翻译的」才调用模型，不自动产生费用；一次最多 20 个，剩余下次继续。
- **手改优先**：手动编辑的标签不会被自动翻译覆盖；单条「重翻」是显式覆盖。
- **双入口**：侧栏「插件」页与「设置 → 内置插件」分区各有一个「中文名」标签页，内容相同。
- **搜索**：按中文名、包名或说明过滤。
- **导出 / 导入**：导出带 `source`（`ai` / `manual`）的 JSON，导入时保留来源，只接受已安装插件名（≤64KB）。
- **单条操作**：编辑、重翻、恢复 AI；英文原文折叠在行底部。
- **徽章**：官方内置、手改、AI。

## 界面

每行按用户要求的层级排列：

1. **中文名**（主标题，替代原来的英文名；未翻译时显示灰色「未翻译」）；
2. **原始包名 + 版本 + 徽章**（等宽字体、低对比度）；
3. **一句话中文介绍**（未翻译时回退英文描述，再没有则显示「（该插件未提供描述）」）；
4. 更下方是折叠的「英文原文」。

顶部工具栏：搜索框、「翻译未翻译的」、导出、导入；行右侧：编辑 / 重翻 / 恢复AI。

## 安装

### 方式一：本机目录安装（当前使用，`link:` 形式）

本机已通过 DSH 的 `plugin_manager` → `install_bundle` 以**插件目录绝对路径**安装，profile 依赖形如
`"dsh-plugin-labels": "link:<本机插件目录绝对路径>"`，`node_modules/dsh-plugin-labels` 是指向本目录的符号链接。

- 在 DSH 创造模式会话里：`plugin_manager` → `action: install_bundle` → `target` 填本目录绝对路径；
- 注意：`link:` 安装下**源码即已装内容**，源码目录不可删除或移动；修改 `lib/client.js` 后刷新页面即可，修改 host `lib/index.js` 后需重启 DSH。
- 不建议手工编辑 profile 的 `package.json` 来安装（易被 pnpm 清理）。

### 方式二：从 Git 仓库安装（发布到 GitHub 后）

在 DSH 插件页 → 添加插件 → 填本仓库的 Git 地址，DSH 会拉取并安装。私有仓库需具备相应访问权限。

### 方式三：npm 包（发布到 npm 后）

若将来发布到 npm registry，可在插件页填包名安装。**当前尚未发布到 npm**，请勿直接按包名安装。

## 使用

1. 打开侧栏「插件」页（或 设置 → 内置插件），切换到「中文名」。
2. 点「翻译未翻译的」：用当前默认模型（温度 0）补全缺失标签；一次最多 20 个。
3. 单条编辑：点「编辑」填中文名与一句话说明，「保存」后来源记为「手改」。
4. 「重翻」单条；手改条目可「恢复AI」。
5. 「导出」备份为 JSON；「导入」合并别人/旧机器的标签（只保留已装插件名）。

## 兼容性

- DSH 桌面版 **0.2.1-rc.2**（Web GUI）；依赖官方 client 基座模块与 host 服务，只 `require("react")`。
- 使用的官方 slot：`plugins.tab`（owner：`@deepseek-ai/dsh-client-ui-plugin-manager`）、`settings.plugins.tab`（owner：`@deepseek-ai/dsh-client-ui-settings-plugins`），以及 `locale` 服务。
- 若某个 slot 在当前 DSH 版本不存在，对应入口自动跳过，另一个入口仍可用。

## 开发说明

- **无构建步骤**：host 是 ESM 的 `lib/index.js`（`inject: ["webServer"]`）；client 是手写的 `__ModuleLoader__` bundle `lib/client.js`，仅 `require("react")`。
- **数据流**：client 通过 4 个 loopback HTTP 路由与 host 通信：
  - `GET  /api/plugin-labels/list`
  - `POST /api/plugin-labels/translate`（无参=补空缺；`{names:[...]}`=显式重翻）
  - `POST /api/plugin-labels/label`（`{name,title,oneLine}` 或 `{name,action:"reset"}`）
  - `POST /api/plugin-labels/import`
- **安全围栏**：loopback 校验、`sec-fetch-site` 跨站拒绝、POST-only、翻译单飞锁（并发 409）、`AbortSignal.timeout(120s)`、未预期异常统一 500 不泄漏路径。
- **缓存**：`<DSH_HOME>/plugin-labels.json`，UTF-8 无 BOM，临时文件 + `rename` 原子写；缓存 `version: 2`，旧 v1 数据可迁移读取，单条非法条目丢弃。
- **验证**：`node --check lib/index.js`、`node --check lib/client.js`；host 可用桩 `ctx` 跑冒烟。
- 修改 client 后刷新页面；修改 host 后需重启 DSH。

## 目录结构

```
dsh-plugin-labels/
├─ .gitignore              # 忽略 node_modules、日志与本地内部文档
├─ package.json            # manifest（dsh.bundle 组合 patch、dsh.client 平台与 inject）
├─ cordis.patch.yml        # bundle 组合 patch
├─ lib/
│  ├─ index.js             # host：HTTP 路由 + LLM 调用 + 标签缓存
│  └─ client.js            # client：__ModuleLoader__ bundle + 「中文名」tab 组件
├─ locale/
│  ├─ zh.json              # 插件元数据（中文）
│  └─ en.json              # 插件元数据（英文）
├─ icon.svg                # 插件图标
├─ README.md
└─ LICENSE
```

## License

MIT，见 [LICENSE](LICENSE)。Copyright (c) 2026 qyy2005

---

## English summary

`dsh-plugin-labels` is a DSH (DeepSeek Harness) plugin that gives every installed plugin a Chinese name and a one-line explanation. It adds a **Labels** tab to both the sidebar **Plugins** page and the **built-in plugins** settings section. Each row shows the Chinese name as the headline, the original package name below it, and a one-line Chinese description; the full English description stays collapsed. Translation is strictly on demand (tokens are spent only when you press the translate button), results are cached under `<DSH_HOME>/plugin-labels.json`, and manual edits are never overwritten by automatic translation. Labels can be searched, exported and imported (their `ai`/`manual` origin is preserved).

The client half is a hand-written `__ModuleLoader__` bundle with no build step that only requires `react`; the host half is an ESM plugin exposing four loopback-only HTTP routes. Verified on DSH desktop 0.2.1-rc.2. MIT licensed.
