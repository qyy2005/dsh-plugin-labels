# dsh-plugin-labels

[![CI](https://github.com/qyy2005/dsh-plugin-labels/actions/workflows/ci.yml/badge.svg?branch=main)](https://github.com/qyy2005/dsh-plugin-labels/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

> 版本更新记录见 [CHANGELOG.md](CHANGELOG.md)，或在 GitHub [Releases](https://github.com/qyy2005/dsh-plugin-labels/releases) 查看。

给 DSH（DeepSeek Harness）**已安装插件**配「中文名 + 一句话说明」：官方「插件」页的已安装插件行、插件包卡片与详情页都会**原地显示中文名与中文描述**（由 host 覆盖显示元数据）；新装插件会在启动后自动翻译。同时给 **skills（技能）** 补中文说明：`/` 技能菜单里每条技能显示「英文原描述 ｜中文：<作用>；用法：<怎么用>」。**本插件没有任何 UI 入口**（没有 tab、没有设置项），管理通过 loopback HTTP API 或让 AI 代改。

- 当前版本：**0.9.3**（本仓库即源码目录；通过 `plugin_manager install_bundle` 从 GitHub 或 npm 安装到 DSH profile）
- 只支持 DSH 桌面版 Web GUI（开发验证版本 0.2.1-rc.2 / rc.3）

## 功能

- **中文名 + 一句话说明**：每个插件一条中文名（≤10 字）和一句说明（≤80 字）；说明必须写清**怎么用**，不只是“是什么”（见下方「标签格式」）。
- **官方页原地中文**：官方「插件」页的已安装插件行、点开的详情页，以及插件包卡片（`listBundles`）都会直接显示中文名与中文描述；未翻译的插件回退英文。默认开启。
- **技能中文翻译**：`/` 技能菜单里每条技能追加「｜中文：作用；用法：怎么用」，看懂技能是做什么、什么时候用（见「技能中文翻译」）。
- **自动翻译新插件与新技能**：host 启动约 4 秒后自动补一次缺失标签（每次最多 20 条），再补最多 10 条技能说明；只补空缺、不覆盖手改。
- **手改优先**：手动设置的标签不会被自动翻译覆盖；显式“重翻”才会覆盖。
- **无 UI 管理入口**：通过 7 个 loopback HTTP API（见「使用」）或让 AI/脚本直接调用它们来翻译、手改、重翻、导入导出。
- **导出 / 导入 API**：导出带 `source`（`ai` / `manual`）的 JSON，导入时保留来源，只接受已安装插件名（≤64KB）。
- **缓存**：插件标签在 `<DSH_HOME>/plugin-labels.json`（v2），技能说明在 `<DSH_HOME>/plugin-labels-skills.json`（v1）；均 UTF-8 无 BOM、原子写，旧 v1 标签数据可迁移读取。

### 标签格式

- **中文名**：≤10 个汉字，命名它“做什么”，不直译包名、不用营销词。
- **一句话说明**：≤80 字，必须同时回答：①这插件解决什么问题；②在 DSH 里从哪里进入 / 怎么操作（例如：设置 → 某个分区、侧栏 → 某个页面、在对话里下指令、装好自动生效）；③必要时给一句可执行的第一步。
- 模型无法从包名/描述判断入口时，会被要求写「**入口以界面为准**」并给出用户能做的第一步；**不会编造不存在的菜单或按钮**。

## 界面

官方「插件」页的已安装插件行、插件包卡片与详情页直接显示中文名与中文描述（v0.6.0+，v0.7.0 起补上包级卡片）：

![官方插件页的中文名](https://raw.githubusercontent.com/qyy2005/dsh-plugin-labels/main/docs/official-page.png)

v0.7.0 起插件**没有任何 UI 入口**：没有「中文名」tab，也没有设置项。中文名由 host 覆盖官方显示元数据实现，管理与编辑走 HTTP API（见「使用」）。

## 官方插件页原地显示中文

v0.6.0 起，host 半边会在运行时包装宿主内部的显示元数据，把标签缓存里的中文名与一句话说明作为 `{en, zh}` 覆盖到官方页面上。**这是纯显示层覆盖**：不改任何插件包文件，也不影响包身份、安装、更新与卸载；**默认开启**。v0.6.1 起改用 symbol 标记识别 wrapper（Cordis 的 `ctx.get` 返回 traceable Proxy、函数引用每次不同），修复了 `patched` 状态误判与重复包装；v0.7.0 起同时包装 `pluginManager.listBundles()`，让插件包卡片也显示中文。

- **两处覆盖**：`pluginPackages.metaOf()`（官方「插件」页的已安装插件行 + 详情页标题/描述）和 `pluginManager.listBundles()`（插件包卡片，它本来直接读 `readPluginMeta`）。
- **效果**：官方页面上的英文名原地显示为中文名，描述显示中文一句话；没有标签的插件回退英文（与原行为一致）。
- **原理**：官方页面通过 `pluginPackages.metaOf(specifier, parentURL)` 读取每个包的显示元数据（它会读该包 `locale/*.json` 的 `meta`，缺省回退 `package.json` 的 name/description）；插件包卡片则由 `pluginManager.listBundles()` 直接 `readPluginMeta`。官方没有行级扩展点，所以这里在进程内包装这两个方法，用标签缓存补上 `title`/`description` 的 `{en, zh}` 语言映射，其余字段（如 `icon`、`error`）原样保留。
- **失败安全**：拿不到服务、方法不是函数、赋值失败或读缓存失败时，全部静默 warn 并回退宿主原返回值；包装可被 disposer 恢复，也能在服务实例被替换（HMR/刷新）后重新包装。
- **限制**：依赖 DSH 内部服务，DSH 升级后可能失效（失效时自动回退英文，插件其它功能不受影响）；仅影响显示，不影响包身份/安装/更新；若某些页面直接读 `package.json` 而不走这两个方法，则不受影响。
- **关闭方式**：启动 DSH 前设置环境变量 `DSH_PLUGIN_LABELS_OFFICIAL_META=0`，然后重启 DSH（会同时关闭上述两处覆盖）。未设置、设为 `1` 或其它值都保持默认开启。
- **生效方式**：host 代码在进程启动时安装，**需要重启 DSH 一次**；重启后 `GET /api/plugin-labels/list` 的响应里 `officialMeta` 字段（`{enabled, patched, service, bundles}`）可确认两处覆盖是否已生效，默认应为 `enabled:true, patched:true, bundles:true`。

## 自动翻译新插件

host 启动约 **4 秒**后会自动补一次缺失标签：

- 默认开启；每次启动最多翻译 **20** 条（`MAX_PENDING_PER_CALL`），只补空缺、**不会覆盖手改标签**，剩余的下次启动/手动调用再补。
- 关闭方式：启动 DSH 前设置 `DSH_PLUGIN_LABELS_AUTO_TRANSLATE=0`，然后重启 DSH；未设置/`1`/其它值均为开启。
- 与手动翻译共用同一个单飞锁与 120 秒超时；失败只写日志（warn），不抛错、不阻塞启动。
- 手动补翻译：`POST /api/plugin-labels/translate`（见「使用」）。

## 技能中文翻译

用户的技能大多是英文。命中翻译缓存后，本插件会**把技能描述替换成纯中文**（不再显示英文原文，`/` 菜单一行显示完整中文）：

```
中文：<中文作用>；用法：<什么时候用、怎么触发>
```

- **实现**：host 包装 `skills` 服务的 `snapshot`/`list`，命中缓存才替换描述，未命中保持原样（`/` 菜单走 `skills.list`，模型侧技能目录走同一份 description）。
- **缓存**：`<DSH_HOME>/plugin-labels-skills.json`（独立于插件标签缓存，`version: 1`，UTF-8 无 BOM、原子写）；每条 `{zh ≤22 字, usage ≤40 字, source: "ai" | "manual", at}`。
- **API**（见「使用」）：`GET /api/plugin-labels/skills`、`POST /api/plugin-labels/skills/translate`、`POST /api/plugin-labels/skills/label`。
- **自动翻译**：启动后约 4 秒的自动任务在补完插件标签后，会再补最多 **10** 条技能说明（`MAX_SKILLS_PER_AUTO`）；只补空缺、不覆盖手改；`DSH_PLUGIN_LABELS_AUTO_TRANSLATE=0` 同时关闭插件与技能自动翻译。
- **限制**：只翻译/解释技能的目录描述，**技能正文仍是英文**；中文替换后模型侧技能目录也显示中文（英文原文不再提供）；技能服务（`ctx.get("skills")`）不可用时静默跳过，不影响其它功能。
- **重启**：host 代码在启动时安装，**需要重启 DSH 一次**；`GET /api/plugin-labels/list` 的 `officialMeta.skills` 可确认包装是否已生效。

## 安装

### 方式一：npm 包（推荐，`npm publish` 后）

在 DSH 插件页 → 添加插件 → 填包名 `dsh-plugin-labels`；或在创造模式会话里 `plugin_manager` → `install_bundle` → `target: "dsh-plugin-labels"`。发布后 profile 依赖形如
`"dsh-plugin-labels": "dsh-plugin-labels@^0.9.3"`。

### 方式二：从 Git 仓库安装

在 DSH 插件页 → 添加插件 → 填本仓库的 Git 地址（`https://github.com/qyy2005/dsh-plugin-labels`），DSH 会拉取并安装；此时 profile 依赖形如 `github:qyy2005/dsh-plugin-labels`。私有仓库需具备相应访问权限。

### 方式三：本机目录安装（开发用，`link:` 形式）

用 `plugin_manager` → `install_bundle` → `target` 填本目录绝对路径，profile 依赖形如 `link:<本机插件目录绝对路径>`，`node_modules/dsh-plugin-labels` 是指向本目录的符号链接。

- 适合开发：源码即已装内容，改完刷新/重启即可；**源码目录不可删除或移动**。
- 改 host `lib/index.js` 后需重启 DSH 才生效（v0.7.0 起 client 已无 UI）。
- 不建议手工编辑 profile 的 `package.json` 来安装（易被 pnpm 清理）。

## 使用

v0.9.3 起没有 UI 入口，全部通过 7 个 loopback HTTP API 操作（也可以让 AI/脚本代改）：

```powershell
# 查看已装插件 + 标签 + 诊断字段（officialMeta）
Invoke-WebRequest -UseBasicParsing http://127.0.0.1:<端口>/api/plugin-labels/list

# 补翻译（无参 = 只补空缺；最多 20 条/次）
Invoke-RestMethod -Method Post -ContentType 'application/json' `
  -Body '{}' http://127.0.0.1:<端口>/api/plugin-labels/translate

# 显式重翻指定插件
Invoke-RestMethod -Method Post -ContentType 'application/json' `
  -Body '{"names":["@linxin666/dsh-remote-web-ui"]}' http://127.0.0.1:<端口>/api/plugin-labels/translate

# 手改一条（source=manual），或恢复 AI：{"name":"...","action":"reset"}
Invoke-RestMethod -Method Post -ContentType 'application/json' `
  -Body '{"name":"@linxin666/dsh-remote-web-ui","title":"远程网页访问","oneLine":"扫码配对手机和电脑共用网页界面。"}' `
  http://127.0.0.1:<端口>/api/plugin-labels/label

# 导入导出的 JSON（只保留已装插件名，保留 ai/manual 来源）
Invoke-RestMethod -Method Post -ContentType 'application/json' -InFile labels.json `
  http://127.0.0.1:<端口>/api/plugin-labels/import

# 技能：列出技能 + 已缓存的中文说明
Invoke-WebRequest -UseBasicParsing http://127.0.0.1:<端口>/api/plugin-labels/skills

# 技能：补翻译缺失的技能说明（每次最多 20 条；可重复调用补剩余）
Invoke-RestMethod -Method Post -ContentType 'application/json' -Body '{}' `
  http://127.0.0.1:<端口>/api/plugin-labels/skills/translate

# 技能：手改一条技能说明（source=manual，自动翻译不会覆盖）
Invoke-RestMethod -Method Post -ContentType 'application/json' `
  -Body '{"name":"office","zh":"Office 文档处理","usage":"对 AI 说：用 office 技能处理文档"}' `
  http://127.0.0.1:<端口>/api/plugin-labels/skills/label
```

端口就是当前 DSH Web GUI 的端口；这些路由只接受 loopback 请求且必须是 POST（`/list`、`/skills` 为 GET）。自动翻译会替你补空缺，手改过的条目不会被自动覆盖。

## 插件速查文档

`node scripts/gen-doc.mjs` 会在**本地**生成 `PLUGINS.zh.md` 与 `PLUGINS.zh.html`：中文名、原始包名、一句话作用、版本、说明（AI 生成 / 手改 / 待翻译）。HTML 是单文件、内联样式、可搜索、随系统深浅色，双击即可打开，无需联网。内容来自你本机的标签缓存与已装插件清单，**默认不提交到仓库**（已 gitignore）。

重新生成（装/卸插件，或翻译/手改标签之后）：

```powershell
node scripts/gen-doc.mjs                # 默认读取 $env:DSH_HOME（或 ~/.dsh）的 desktop profile
node scripts/gen-doc.mjs --home "$env:DSH_HOME" --profile desktop
npm run docs                            # 等价于 node scripts/gen-doc.mjs
```

生成器只读本地标签缓存与 profile 清单，产物不含本机路径、`DSH_HOME`、用户名或 token；生成的两个文件只留在本地（已 gitignore），**不要手工编辑**。

## 兼容性

- DSH 桌面版 **0.2.1-rc.2**（Web GUI；技能翻译接口在 **0.2.1-rc.3** 核实）；依赖官方 client 基座模块与 host 服务，只 `require("react")`。
- 本插件不依赖任何 UI slot：显示覆盖包装宿主的 `pluginPackages.metaOf()`（官方页行/详情）与 `pluginManager.listBundles()`（插件包卡片），技能中文包装 `skills` 服务的 `snapshot`/`list`，client 只注册 `locale` 字典。
- 拿不到这些内部服务时静默回退：不显示中文（回退英文）、技能说明保持英文，插件其它功能与 API 仍可用。

## 开发说明

- **无构建步骤**：host 是 ESM 的 `lib/index.js`（`inject: ["webServer"]`）；client 是手写的 `__ModuleLoader__` bundle `lib/client.js`（v0.7.0 起只注册 locale，无 UI），仅 `require("react")`。
- **管理 API**（client 已无 UI，脚本/AI 直接调用）：
  - `GET  /api/plugin-labels/list`
  - `POST /api/plugin-labels/translate`（无参=补空缺；`{names:[...]}`=显式重翻）
  - `POST /api/plugin-labels/label`（`{name,title,oneLine}` 或 `{name,action:"reset"}`）
  - `POST /api/plugin-labels/import`
  - `GET  /api/plugin-labels/skills`（技能列表 + 已缓存中文说明）
  - `POST /api/plugin-labels/skills/translate`（补技能说明，单飞锁，并发 409）
  - `POST /api/plugin-labels/skills/label`（`{name,zh,usage}` 手改技能说明）
- **自动翻译**：`apply` 里注册一个 4 秒后执行一次的定时器（`unref`），先 `translatePending` 补插件标签、再 `translateSkillsPending` 补最多 10 条技能说明；可用 `DSH_PLUGIN_LABELS_AUTO_TRANSLATE=0` 关闭；异常只 warn。
- **显示/技能覆盖**：`installOfficialMeta` / `installBundleMeta` / `installSkillTranslations` 用 symbol 标记识别 wrapper，幂等、可 dispose、服务替换后重打、失败静默回退。`DSH_PLUGIN_LABELS_OFFICIAL_META=0` 关闭前两个显示覆盖（技能翻译不受影响）。
- **安全围栏**：loopback 校验、`sec-fetch-site` 跨站拒绝、POST-only、翻译单飞锁（插件与技能各一把，并发 409）、`AbortSignal.timeout(120s)`、未预期异常统一 500 不泄漏路径。
- **缓存**：插件标签 `<DSH_HOME>/plugin-labels.json`（v2，旧 v1 可迁移）、技能说明 `<DSH_HOME>/plugin-labels-skills.json`（v1）；均 UTF-8 无 BOM，临时文件 + `rename` 原子写，单条非法条目丢弃。
- **验证**：`node --check lib/index.js`、`node --check lib/client.js`；host 可用桩 `ctx` 跑冒烟。
- 修改 host 后需重启 DSH 生效（本插件已没有需要刷新页面的 UI 改动）。

## 目录结构

```
dsh-plugin-labels/
├─ .gitignore              # 忽略 node_modules、日志与本地内部文档
├─ .github/
│  ├─ ISSUE_TEMPLATE/      # Bug / Feature 的 issue forms
│  └─ workflows/ci.yml     # GitHub Actions：node --check + JSON/BOM 校验
├─ docs/
│  └─ official-page.png    # 官方「插件」页原地显示中文名的截图
├─ package.json            # manifest（dsh.bundle 组合 patch、dsh.client 平台与 inject）
├─ cordis.patch.yml        # bundle 组合 patch
├─ lib/
│  ├─ index.js             # host：HTTP API + 显示覆盖 + 技能中文 + 自动翻译 + 缓存
│  └─ client.js            # client：模块骨架，仅注册 locale（v0.7.0 起无 UI）
├─ locale/
│  ├─ zh.json              # 插件元数据（中文）
│  └─ en.json              # 插件元数据（英文）
├─ icon.svg                # 插件图标
├─ scripts/
│  └─ gen-doc.mjs          # 生成 PLUGINS.zh.* 速查文档（本地生成，已 gitignore）
├─ README.md
└─ LICENSE
```

## License

MIT，见 [LICENSE](LICENSE)。Copyright (c) 2026 qyy2005

---

## English summary

`dsh-plugin-labels` is a DSH (DeepSeek Harness) plugin that gives every installed plugin a Chinese name and a one-line explanation. The labels are shown **in place** on the official Plugins page: the installed-plugin rows, the detail pages and the plugin package cards (`pluginManager.listBundles`) all display the Chinese name and description, falling back to English for plugins without a label. **The plugin has no UI entry point** (no tab, no settings item): labels are managed through loopback HTTP routes (or by an AI/script calling them), and results are cached under `<DSH_HOME>/plugin-labels.json` with manual edits never overwritten by automatic translation.

It also translates **skills**: each skill description in the `/` skill menu gets a Chinese purpose and usage hint appended (`English description ｜中文：…；用法：…`), cached separately in `<DSH_HOME>/plugin-labels-skills.json` and managed through `GET/POST /api/plugin-labels/skills…`. Only the catalogue description is translated, the skill body stays English; the model-side catalogue truncates descriptions at 500 characters.

Each label is a Chinese name (≤10 characters) plus a one-line explanation (≤80 characters) that must explain **how to use** the plugin: the problem it solves, where in DSH the user enters or operates it, and a concrete first step. When the entry point cannot be inferred, the model is instructed to write 入口以界面为准 instead of inventing menus.

Newly installed plugins are translated automatically: about 4 seconds after host startup one pass fills up to 20 missing labels and then up to 10 skill explanations (set `DSH_PLUGIN_LABELS_AUTO_TRANSLATE=0` and restart DSH to disable it). The display overrides can be disabled together with `DSH_PLUGIN_LABELS_OFFICIAL_META=0`; `GET /api/plugin-labels/list` reports `officialMeta: {enabled, patched, service, bundles, skills}` for diagnostics. These hooks require one DSH restart after installation.

The client half is a hand-written `__ModuleLoader__` bundle with no build step that only requires `react` (v0.7.0: locale registration only, no UI); the host half is an ESM plugin exposing seven loopback-only HTTP routes plus the display overrides, the skill translation hook and the startup auto-translate. Verified on DSH desktop 0.2.1-rc.2 / rc.3. MIT licensed.
