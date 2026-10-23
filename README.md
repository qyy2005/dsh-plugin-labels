# dsh-plugin-labels

给 DSH（DeepSeek Harness）**已安装插件**配「中文名 + 一句话说明」，并在官方**侧栏「插件」页**和**设置 → 内置插件分区**的「中文名」标签页里，以「中文名 → 原始包名 → 一句话中文介绍」三层展示。

- 当前版本：**0.6.0**（本仓库即源码目录；本机以 `link:` 方式安装到 DSH profile）
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
- **官方插件页原地中文（实验特性，v0.6.0，默认关闭）**：可选开启 host 运行时覆盖，让官方「插件」页列表与详情页的英文名**原地变成中文名**；需设置 `DSH_PLUGIN_LABELS_OFFICIAL_META=1` 并重启 DSH 才生效（详见下文）。

## 界面

每行按用户要求的层级排列：

1. **中文名**（主标题，替代原来的英文名；未翻译时显示灰色「未翻译」）；
2. **原始包名 + 版本 + 徽章**（等宽字体、低对比度）；
3. **一句话中文介绍**（未翻译时回退英文描述，再没有则显示「（该插件未提供描述）」）；
4. 更下方是折叠的「英文原文」。

顶部工具栏：搜索框、「翻译未翻译的」、导出、导入；行右侧：编辑 / 重翻 / 恢复AI。

## 官方插件页原地显示中文（实验特性，默认关闭）

v0.6.0 起，host 半边可以选择性地在运行时包装宿主内部的 `pluginPackages.metaOf()`，把标签缓存里的中文名与一句话说明作为 `{en, zh}` 覆盖到官方「插件」页（列表行标题 + 详情页标题/描述）上。**这是纯显示层覆盖**：不改任何插件包文件，也不影响包身份、安装、更新与卸载；**默认关闭**，只有显式开启才生效。

- **开启方式**：启动 DSH 前设置环境变量 `DSH_PLUGIN_LABELS_OFFICIAL_META=1`，然后重启 DSH。未设置、设为 `0` 或其它值都不会安装补丁（保持宿主原行为）。
- **效果**：官方「插件」页列表与详情页里的英文名原地显示为中文名，描述显示中文一句话；没有标签的插件回退英文（与原行为一致）。
- **原理**：官方页面通过 `pluginPackages.metaOf(specifier, parentURL)` 读取每个包的显示元数据（它会读该包 `locale/*.json` 的 `meta`，缺省回退 `package.json` 的 name/description）。官方没有行级扩展点，所以这里在进程内包装该方法，返回叠加后的 `title`/`description` 语言映射，其余字段（如 `icon`、`error`）原样保留。
- **失败安全**：拿不到服务、方法不是函数、赋值失败或读缓存失败时，全部静默 warn 并回退宿主原返回值；包装可被 disposer 恢复，也能在服务实例被替换（HMR/刷新）后重新包装。
- **限制**：依赖 DSH 内部服务，DSH 升级后可能失效（失效时自动回退英文，插件其它功能不受影响）；仅影响显示；若某些页面直接读 `package.json` 而不走 `metaOf`，则不受影响。
- **验证**：重启后 `GET /api/plugin-labels/list` 的响应里 `officialMeta` 字段（`{enabled, patched, service}`）可确认补丁是否已生效；默认关闭时应为 `enabled:false`。

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

## 插件速查文档

仓库里的 [`PLUGINS.zh.md`](PLUGINS.zh.md) 与 [`PLUGINS.zh.html`](PLUGINS.zh.html) 是由标签缓存生成的**插件中文名速查表**：中文名、原始包名、一句话作用、版本、说明（AI 生成 / 手改 / 待翻译）。HTML 是单文件、内联样式、可搜索、随系统深浅色，双击即可打开，无需联网。

重新生成（装/卸插件，或翻译/手改标签之后）：

```powershell
node scripts/gen-doc.mjs                # 默认读取 $env:DSH_HOME（或 ~/.dsh）的 desktop profile
node scripts/gen-doc.mjs --home "$env:DSH_HOME" --profile desktop
npm run docs                            # 等价于 node scripts/gen-doc.mjs
```

生成器只读本地标签缓存与 profile 清单，产物不含本机路径、`DSH_HOME`、用户名或 token；生成的两个文件请随仓库提交，但**不要手工编辑**。

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
├─ scripts/
│  └─ gen-doc.mjs          # 生成 PLUGINS.zh.* 速查文档（无第三方依赖）
├─ PLUGINS.zh.md           # 插件中文名速查表（生成物，勿手改）
├─ PLUGINS.zh.html         # 同上，单文件可搜索 HTML（生成物，勿手改）
├─ README.md
└─ LICENSE
```

## License

MIT，见 [LICENSE](LICENSE)。Copyright (c) 2026 qyy2005

---

## English summary

`dsh-plugin-labels` is a DSH (DeepSeek Harness) plugin that gives every installed plugin a Chinese name and a one-line explanation. It adds a **Labels** tab to both the sidebar **Plugins** page and the **built-in plugins** settings section. Each row shows the Chinese name as the headline, the original package name below it, and a one-line Chinese description; the full English description stays collapsed. Translation is strictly on demand (tokens are spent only when you press the translate button), results are cached under `<DSH_HOME>/plugin-labels.json`, and manual edits are never overwritten by automatic translation. Labels can be searched, exported and imported (their `ai`/`manual` origin is preserved).

Since v0.6.0 the host half can also, as an opt-in experiment, override the official Plugins page display metadata at runtime (display-only), so the official list rows and detail pages show the Chinese names in place; untranslated plugins keep their English names. It is disabled by default: set `DSH_PLUGIN_LABELS_OFFICIAL_META=1` and restart DSH to enable it. The repository also ships a generated plugin index (`PLUGINS.zh.md` / `PLUGINS.zh.html`), rebuilt with `node scripts/gen-doc.mjs`.

The client half is a hand-written `__ModuleLoader__` bundle with no build step that only requires `react`; the host half is an ESM plugin exposing four loopback-only HTTP routes. Verified on DSH desktop 0.2.1-rc.2. MIT licensed.
