/**
 * dsh-plugin-labels — browser half (v0.5.0).
 *
 * Registers the same "Labels" tab in BOTH official plugin surfaces:
 *   - `plugins.tab`          — the sidebar Plugins page (owner:
 *     @deepseek-ai/dsh-client-ui-plugin-manager; this is the page the user
 *     actually opens, and it only ships an "Installed" tab on its own)
 *   - `settings.plugins.tab` — the built-in plugins section under Settings
 *     (owner: @deepseek-ai/dsh-client-ui-settings-plugins)
 * The two registrations are independent: a missing slot never blocks the other
 * one. Registration follows the official inventory tab example
 * (@deepseek-ai/dsh-client-ui-settings-plugin-inventory):
 *   ctx.slots.inject(slot, () => ctx.slots.register({
 *     name: slot, id, order, label: () => bind("tabLabel"), locale,
 *   }, Component))
 *
 * Rows follow the layout the user asked for:
 *   1. the Chinese name as the headline (the name that replaces the English one)
 *   2. the original package name + version + badges (built-in / edited / AI)
 *   3. the one-line Chinese explanation (falls back to the English description)
 * and only below those the collapsed English description. Export and import
 * keep each label's source ("ai" vs "manual") so a round-trip does not relabel
 * machine output as hand-written.
 *
 * Contract: hand-written `__ModuleLoader__` bundle with no build step; the
 * factory returns `{ inject, apply }` and has no side effects; only `react` is
 * required; text goes through the Client locale service; styling inherits the
 * host theme through currentColor and component-local styles.
 */

window.__ModuleLoader__.load({
	id: "dsh-plugin-labels",
	factory(require) {
		const React = require("react");

		const API_LIST = "/api/plugin-labels/list";
		const API_TRANSLATE = "/api/plugin-labels/translate";
		const API_LABEL = "/api/plugin-labels/label";
		const API_IMPORT = "/api/plugin-labels/import";

		const dictZh = {
			title: "插件中文名",
			tabLabel: "中文名",
			subtitle: "给已装插件配中文名与一句话说明，侧栏插件页与设置里都能查看。只有点翻译才会花 token，翻过就缓存，可手动编辑。",
			loading: "读取中…",
			ready: "已装",
			translated: "已翻译",
			pending: "未翻译",
			translate: "翻译未翻译的",
			translating: "翻译中…",
			nonePending: "全部已翻译",
			untranslated: "未翻译",
			official: "官方内置",
			manual: "手改",
			ai: "AI",
			edit: "编辑",
			save: "保存",
			cancel: "取消",
			resetAi: "恢复AI",
			retranslate: "重翻",
			export: "导出",
			import: "导入",
			search: "搜索中文名、包名或说明…",
			english: "英文原文",
			noDescription: "（该插件未提供描述）",
			saved: "已保存",
			failed: "失败",
			done: "完成，新增",
			items: "条",
			imported: "导入完成：",
			skipped: "条跳过",
			titlePlaceholder: "中文名（≤8字）",
			oneLinePlaceholder: "一句话说明",
			empty: "没有匹配的插件",
		};
		const dictEn = {
			title: "Plugin Labels",
			tabLabel: "Labels",
			subtitle: "Chinese names and one-line explanations for installed plugins, shown on the sidebar Plugins page and in Settings. Tokens are spent only when you translate; results are cached and editable.",
			loading: "Loading…",
			ready: "Installed",
			translated: "Translated",
			pending: "Pending",
			translate: "Translate missing",
			translating: "Translating…",
			nonePending: "All translated",
			untranslated: "Untranslated",
			official: "Built-in",
			manual: "Edited",
			ai: "AI",
			edit: "Edit",
			save: "Save",
			cancel: "Cancel",
			resetAi: "Reset to AI",
			retranslate: "Re-translate",
			export: "Export",
			import: "Import",
			search: "Search name, package or description…",
			english: "English description",
			noDescription: "(no description)",
			saved: "Saved",
			failed: "Failed",
			done: "Done; added",
			items: "items",
			imported: "Imported:",
			skipped: "skipped",
			titlePlaceholder: "Chinese name (≤8 chars)",
			oneLinePlaceholder: "One-line explanation",
			empty: "No matching plugin",
		};

		/** Component-local styles: inherited colors only, removed on unmount. */
		const CSS = [
			".dsh-pl{display:flex;flex-direction:column;gap:12px;padding:6px 4px 24px;font-size:13px;line-height:1.5;max-width:100%;box-sizing:border-box}",
			".dsh-pl-bar{display:flex;align-items:center;gap:8px;flex-wrap:wrap}",
			".dsh-pl-search{flex:1 1 200px;min-width:160px;padding:6px 10px;font:inherit;font-size:13px;color:inherit;background:color-mix(in srgb,currentColor 4%,transparent);border:1px solid color-mix(in srgb,currentColor 16%,transparent);border-radius:8px;outline:none}",
			".dsh-pl-search:focus{border-color:color-mix(in srgb,currentColor 40%,transparent)}",
			".dsh-pl-btn{padding:5px 10px;font:inherit;font-size:12.5px;color:inherit;background:transparent;border:1px solid color-mix(in srgb,currentColor 18%,transparent);border-radius:8px;cursor:pointer;white-space:nowrap}",
			".dsh-pl-btn:hover:not(:disabled){background:color-mix(in srgb,currentColor 8%,transparent)}",
			".dsh-pl-btn:disabled{opacity:.45;cursor:not-allowed}",
			".dsh-pl-primary{font-weight:600;border-color:color-mix(in srgb,currentColor 38%,transparent);background:color-mix(in srgb,currentColor 10%,transparent)}",
			".dsh-pl-stats{font-size:12px;opacity:.6}",
			".dsh-pl-notice{font-size:12px;opacity:.75}",
			".dsh-pl-list{list-style:none;margin:0;padding:0;display:flex;flex-direction:column}",
			".dsh-pl-row{display:flex;gap:8px 12px;align-items:flex-start;justify-content:space-between;flex-wrap:wrap;padding:11px 8px;border-bottom:1px solid color-mix(in srgb,currentColor 8%,transparent);border-radius:8px}",
			".dsh-pl-row:hover{background:color-mix(in srgb,currentColor 4%,transparent)}",
			".dsh-pl-main{min-width:0;flex:1 1 260px}",
			".dsh-pl-name{font-weight:600;font-size:14px;line-height:1.4;overflow-wrap:anywhere}",
			".dsh-pl-name.dsh-pl-empty{opacity:.45;font-weight:500}",
			".dsh-pl-meta{margin-top:3px;font-family:ui-monospace,Consolas,monospace;font-size:11.5px;line-height:1.4;opacity:.6;display:flex;align-items:center;gap:6px;flex-wrap:wrap;overflow-wrap:anywhere}",
			".dsh-pl-tag{font-family:inherit;font-size:11px;padding:0 6px;border:1px solid color-mix(in srgb,currentColor 22%,transparent);border-radius:99px;opacity:.85}",
			".dsh-pl-one{margin-top:6px;font-size:12.5px;line-height:1.55;opacity:.78;overflow-wrap:anywhere}",
			".dsh-pl-en{margin-top:6px;font-size:11.5px;opacity:.5}",
			".dsh-pl-en summary{cursor:pointer;outline:none}",
			".dsh-pl-en div{margin-top:2px;white-space:pre-wrap;overflow-wrap:anywhere}",
			".dsh-pl-actions{display:flex;gap:6px;flex-wrap:wrap;justify-content:flex-end;flex:0 0 auto;margin-left:auto}",
			".dsh-pl-act{padding:3px 8px;font:inherit;font-size:12px;color:inherit;background:transparent;border:none;border-radius:6px;cursor:pointer;opacity:.7}",
			".dsh-pl-act:hover{background:color-mix(in srgb,currentColor 8%,transparent);opacity:1}",
			".dsh-pl-edit{display:flex;gap:6px;flex-wrap:wrap;margin-top:6px;flex:1 1 100%}",
			".dsh-pl-input{flex:1 1 150px;padding:4px 8px;font:inherit;font-size:12.5px;color:inherit;background:color-mix(in srgb,currentColor 4%,transparent);border:1px solid color-mix(in srgb,currentColor 28%,transparent);border-radius:7px;outline:none}",
			".dsh-pl-hint{font-size:12px;opacity:.55;margin-top:4px}",
		].join("");

		function LabelsSection(props) {
			const t = props && typeof props.t === "function" ? props.t : (key) => key;
			const [state, setState] = React.useState({
				phase: "loading",
				plugins: [],
				pending: 0,
				translated: 0,
				error: "",
				busy: false,
				notice: "",
				query: "",
				editing: null,
				saving: false,
				importing: false,
			});
			const fileRef = React.useRef(null);

			const load = React.useCallback(() => {
				return fetch(API_LIST, { headers: { accept: "application/json" }, credentials: "same-origin" })
					.then((response) => response.json())
					.then((data) => {
						if (data && data.ok) {
							setState((previous) => Object.assign({}, previous, {
								phase: "ready",
								plugins: Array.isArray(data.plugins) ? data.plugins : [],
								pending: Number(data.pending) || 0,
								translated: Number(data.translated) || 0,
								error: "",
							}));
						} else {
							setState((previous) => Object.assign({}, previous, { phase: "error", error: String((data && data.error) || "unknown") }));
						}
					})
					.catch((error) => {
						setState((previous) => Object.assign({}, previous, { phase: "error", error: String((error && error.message) || error) }));
					});
			}, []);

			React.useEffect(() => {
				load().catch(() => {});
			}, [load]);

			const post = (url, body) => fetch(url, {
				method: "POST",
				headers: { "content-type": "application/json", accept: "application/json" },
				credentials: "same-origin",
				body: JSON.stringify(body || {}),
			}).then((response) => response.json());

			const ok = (data) => {
				if (data && data.ok) return data;
				throw new Error(String((data && data.error) || "unknown"));
			};

			const run = (promise, onDone) => promise
				.then(ok)
				.then((data) => { onDone(data); return load(); })
				.catch((error) => setState((previous) => Object.assign({}, previous, {
					busy: false,
					saving: false,
					importing: false,
					notice: t("failed") + "：" + String((error && error.message) || error),
				})));

			const translate = () => {
				setState((previous) => Object.assign({}, previous, { busy: true, notice: "" }));
				run(post(API_TRANSLATE, {}), (data) => setState((previous) => Object.assign({}, previous, {
					busy: false,
					notice: t("done") + " " + (Number(data.added) || 0) + " " + t("items"),
				})));
			};

			const retranslate = (pluginName) => {
				setState((previous) => Object.assign({}, previous, { busy: true, notice: "" }));
				run(post(API_TRANSLATE, { names: [pluginName] }), (data) => setState((previous) => Object.assign({}, previous, {
					busy: false,
					notice: t("done") + " " + (Number(data.added) || 0) + " " + t("items"),
				})));
			};

			const beginEdit = (plugin) => setState((previous) => Object.assign({}, previous, {
				editing: { name: plugin.name, title: plugin.label ? plugin.label.title : "", oneLine: plugin.label ? plugin.label.oneLine : "" },
				notice: "",
			}));
			const cancelEdit = () => setState((previous) => Object.assign({}, previous, { editing: null }));
			const changeField = (key, value) => setState((previous) => (previous.editing ? Object.assign({}, previous, { editing: Object.assign({}, previous.editing, { [key]: value }) }) : previous));

			const saveEdit = () => {
				const editing = state.editing;
				if (!editing) return;
				setState((previous) => Object.assign({}, previous, { saving: true }));
				run(post(API_LABEL, { name: editing.name, title: editing.title, oneLine: editing.oneLine }), () => setState((previous) => Object.assign({}, previous, {
					saving: false,
					editing: null,
					notice: t("saved"),
				})));
			};

			const resetLabel = (pluginName) => {
				setState((previous) => Object.assign({}, previous, { notice: "" }));
				run(post(API_LABEL, { name: pluginName, action: "reset" }), () => {});
			};

			const exportLabels = () => {
				const entries = {};
				state.plugins.forEach((plugin) => {
					if (!plugin.label) return;
					// Carry the origin so re-importing never promotes AI output to
					// "manual" (or the other way around).
					entries[plugin.name] = {
						title: plugin.label.title,
						oneLine: plugin.label.oneLine,
						source: plugin.label.source === "manual" ? "manual" : "ai",
					};
				});
				const text = JSON.stringify({ version: 2, exportedAt: new Date().toISOString(), entries }, null, 2);
				const blob = new Blob([text], { type: "application/json" });
				const url = URL.createObjectURL(blob);
				const anchor = document.createElement("a");
				anchor.href = url;
				anchor.download = "plugin-labels.json";
				anchor.click();
				setTimeout(() => URL.revokeObjectURL(url), 1000);
			};

			const importFile = (event) => {
				const file = event.target.files && event.target.files[0];
				event.target.value = "";
				if (!file) return;
				const reader = new FileReader();
				reader.onload = () => {
					let parsed;
					try {
						parsed = JSON.parse(String(reader.result));
					} catch (error) {
						setState((previous) => Object.assign({}, previous, { notice: t("failed") + "：" + String((error && error.message) || error) }));
						return;
					}
					setState((previous) => Object.assign({}, previous, { importing: true }));
					run(post(API_IMPORT, parsed), (data) => setState((previous) => Object.assign({}, previous, {
						importing: false,
						notice: t("imported") + " " + (Number(data.applied) || 0) + " · " + (Number(data.skipped) || 0) + " " + t("skipped"),
					})));
				};
				reader.readAsText(file);
			};

			const query = state.query.trim().toLowerCase();
			const rows = state.plugins.filter((plugin) => {
				if (query === "") return true;
				const haystack = [plugin.name, plugin.description || "", plugin.label ? plugin.label.title : "", plugin.label ? plugin.label.oneLine : ""].join(" ").toLowerCase();
				return haystack.indexOf(query) >= 0;
			});

			const stats = state.phase === "loading"
				? t("loading")
				: state.phase === "error"
					? t("failed") + "：" + state.error
					: t("ready") + " " + state.plugins.length + " · " + t("translated") + " " + (state.translated || 0) + " · " + t("pending") + " " + (state.pending || 0);

			const canTranslate = state.phase === "ready" && !state.busy && (state.pending || 0) > 0;

			const renderRow = (plugin) => {
				const isEditing = state.editing !== null && state.editing.name === plugin.name;
				// Third line: the Chinese one-liner, or the English description when
				// the plugin has not been translated yet.
				const oneLine = plugin.label && plugin.label.oneLine ? plugin.label.oneLine : (plugin.description || t("noDescription"));
				return React.createElement(
					"li",
					{ key: plugin.name, className: "dsh-pl-row" },
					React.createElement(
						"div",
						{ className: "dsh-pl-main" },
						// 1) Chinese name replaces the English name as the headline.
						plugin.label
							? React.createElement("div", { className: "dsh-pl-name", title: plugin.label.title }, plugin.label.title)
							: React.createElement("div", { className: "dsh-pl-name dsh-pl-empty" }, t("untranslated")),
						// 2) Original package name + version + badges.
						React.createElement(
							"div",
							{ className: "dsh-pl-meta" },
							React.createElement("span", { className: "dsh-pl-original" }, plugin.name + (plugin.version ? "  v" + plugin.version : "")),
							plugin.kind === "official-or-missing" ? React.createElement("span", { className: "dsh-pl-tag" }, t("official")) : null,
							plugin.label && plugin.label.source === "manual" ? React.createElement("span", { className: "dsh-pl-tag" }, t("manual")) : null,
							plugin.label && plugin.label.source === "ai" ? React.createElement("span", { className: "dsh-pl-tag" }, t("ai")) : null,
						),
						// 3) One-line Chinese explanation (edit inputs live here while
						// editing so the actions keep their place on the right).
						isEditing
							? React.createElement(
									"div",
									{ className: "dsh-pl-edit" },
									React.createElement("input", {
										className: "dsh-pl-input",
										value: state.editing.title,
										placeholder: t("titlePlaceholder"),
										onChange: (event) => changeField("title", event.target.value),
									}),
									React.createElement("input", {
										className: "dsh-pl-input",
										value: state.editing.oneLine,
										placeholder: t("oneLinePlaceholder"),
										onChange: (event) => changeField("oneLine", event.target.value),
									}),
								)
							: React.createElement("div", { className: "dsh-pl-one" }, oneLine),
						// 4) The full English description stays collapsed below the fold.
						React.createElement(
							"details",
							{ className: "dsh-pl-en" },
							React.createElement("summary", null, t("english")),
							React.createElement("div", null, plugin.description || t("noDescription")),
						),
					),
					React.createElement(
						"div",
						{ className: "dsh-pl-actions" },
						isEditing
							? [
									React.createElement("button", { key: "save", type: "button", className: "dsh-pl-act", disabled: state.saving || state.busy, onClick: saveEdit }, t("save")),
									React.createElement("button", { key: "cancel", type: "button", className: "dsh-pl-act", onClick: cancelEdit }, t("cancel")),
								]
							: [
									React.createElement("button", { key: "edit", type: "button", className: "dsh-pl-act", disabled: state.busy, onClick: () => beginEdit(plugin) }, t("edit")),
									React.createElement("button", { key: "retranslate", type: "button", className: "dsh-pl-act", disabled: state.busy, onClick: () => retranslate(plugin.name) }, t("retranslate")),
									plugin.label && plugin.label.source === "manual"
										? React.createElement("button", { key: "reset", type: "button", className: "dsh-pl-act", disabled: state.busy, onClick: () => resetLabel(plugin.name) }, t("resetAi"))
										: null,
								],
					),
				);
			};

			return React.createElement(
				"div",
				{ className: "dsh-pl" },
				React.createElement("style", null, CSS),
				React.createElement("div", { className: "dsh-pl-hint" }, t("subtitle")),
				React.createElement(
					"div",
					{ className: "dsh-pl-bar" },
					React.createElement("input", {
						className: "dsh-pl-search",
						value: state.query,
						placeholder: t("search"),
						onChange: (event) => setState((previous) => Object.assign({}, previous, { query: event.target.value })),
					}),
					React.createElement(
						"button",
						{
							type: "button",
							className: "dsh-pl-btn" + (canTranslate ? " dsh-pl-primary" : ""),
							disabled: !canTranslate,
							onClick: canTranslate ? translate : undefined,
						},
						state.busy ? t("translating") : (state.pending || 0) > 0 ? t("translate") + "（" + state.pending + "）" : t("nonePending"),
					),
					React.createElement("button", { type: "button", className: "dsh-pl-btn", onClick: exportLabels }, t("export")),
					React.createElement("button", { type: "button", className: "dsh-pl-btn", disabled: state.importing || state.busy, onClick: () => fileRef.current && fileRef.current.click() }, state.importing ? t("loading") : t("import")),
					React.createElement("input", { type: "file", accept: ".json,application/json", ref: fileRef, style: { display: "none" }, onChange: importFile }),
				),
				React.createElement("div", { className: "dsh-pl-stats" }, stats + (rows.length !== state.plugins.length ? " · " + rows.length + " / " + state.plugins.length : "")),
				state.notice ? React.createElement("div", { className: "dsh-pl-notice" }, state.notice) : null,
				React.createElement("ul", { className: "dsh-pl-list" }, rows.length > 0 ? rows.map(renderRow) : React.createElement("li", { className: "dsh-pl-hint" }, t("empty"))),
			);
		}

		function apply(ctx) {
			ctx.effect(() => ctx.locale.register("plugin-labels", { zh: dictZh, en: dictEn }), "plugin-labels: dictionaries");
			// One component, two official tabs: the sidebar Plugins page and the
			// built-in plugins section under Settings. Each registration is
			// isolated, so a missing slot never blocks the other one.
			const registerTab = (slotName) => {
				try {
					ctx.slots.inject(slotName, () => {
						try {
							const bind = ctx.locale.bind("plugin-labels");
							return ctx.slots.register(
								{
									name: slotName,
									id: "labels",
									order: 20,
									label: () => bind("tabLabel"),
									locale: "plugin-labels",
								},
								LabelsSection,
							);
						} catch (error) {
							return () => {};
						}
					});
				} catch (error) {
					// The slot registry is unavailable; the other tab may still mount.
				}
			};
			registerTab("plugins.tab");
			registerTab("settings.plugins.tab");
		}

		return {
			inject: ["slots", "locale"],
			apply,
		};
	},
});
