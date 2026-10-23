# 更新日志（Changelog）

本文件记录 `dsh-plugin-labels` 的版本变更；GitHub Releases 页面按版本展示同样的内容。

## [0.8.0] - 2026-10-23

### 变更
- 标签说明改为必须讲清「怎么用」：翻译提示词要求每条写清 **作用 + 在 DSH 里的入口/操作 + 第一步**；无法判断入口时写「入口以界面为准」，禁止编造菜单。
- 一句话上限统一为 **80 字**（此前内部上限 120，实际显示常被截断）。

## [0.7.0] - 2026-10-23

### 新增
- **新插件自动翻译**：DSH 启动约 4 秒后自动补一次缺失标签（每次最多 20 条，只补空缺、不覆盖手改）；`DSH_PLUGIN_LABELS_AUTO_TRANSLATE=0` 可关闭。
- **插件包卡片中文**：覆盖 `pluginManager.listBundles()`，官方「已安装插件」列表的包卡片也显示中文名与中文描述（此前只覆盖组件行）。

### 变更
- 移除最后一个「中文名」UI 入口（设置 → 内置插件的 tab）；管理只保留 4 个 loopback HTTP API。
- 仓库补充 Issues 模板、GitHub Actions CI、README 截图。

## [0.6.2] - 2026-10-23

### 变更
- 移除侧栏「插件」页的「中文名」tab（v0.6.2 起只在设置 → 内置插件保留管理入口）。

## [0.6.1] - 2026-10-23

### 修复
- 修复 Cordis traceable Proxy 下的包装身份误判：导致 `officialMeta.patched` 恒为 false、无法还原、重复事件叠加包装。

## [0.6.0] - 2026-10-23

### 新增
- **官方插件页原地中文**：host 包装宿主内部 `pluginPackages.metaOf`，用标签缓存覆盖 `title`/`description`（默认开启；`DSH_PLUGIN_LABELS_OFFICIAL_META=0` 关闭）。
- 速查文档生成器 `scripts/gen-doc.mjs`（本地生成 `PLUGINS.zh.md` / `PLUGINS.zh.html`，默认不入库）。

## [0.5.0] - 2026-10-23

### 新增
- 「中文名」tab：侧栏「插件」页与「设置 → 内置插件」双入口；行布局改为 **中文名 → 原始包名 → 一句话说明**。
- 搜索、翻译未翻译、导出/导入（带 `source`）、手改、单条重翻、恢复 AI。
- 首次开源：README、MIT LICENSE、`.gitignore`，发布到 GitHub。

## [0.4.2] - 2026-10-23（本仓库历史之前）

### 修复
- 413 超限响应边界（先响应后断开）、错误分类（显式 4xx / 内部 500）、缓存 v1 → v2 无损迁移与逐条形状校验、导出/导入保留 `source`。
- 安装方式改为官方 `plugin_manager install_bundle`。
