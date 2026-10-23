#!/usr/bin/env node
/**
 * Generate the public plugin index for dsh-plugin-labels.
 *
 * Reads the label cache (`plugin-labels.json`) plus the installed profile
 * manifest and every bundle's package.json, then writes two committed docs:
 *   - PLUGINS.zh.md    Markdown table for the repository
 *   - PLUGINS.zh.html  single-file, searchable HTML (inline CSS, no dependencies)
 *
 * The generated files are public: they only contain package names, Chinese
 * labels, descriptions and versions — never local paths, the DSH home, user
 * names or tokens.
 *
 * Usage:
 *   node scripts/gen-doc.mjs [--home <DSH_HOME>] [--profile <name>] [--out-dir <dir>]
 *
 * Defaults: `$DSH_HOME` (or ~/.dsh), profile "desktop", this repository root.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const OUTPUT_MD = "PLUGINS.zh.md";
const OUTPUT_HTML = "PLUGINS.zh.html";
const DESCRIPTION_LIMIT = 120;

function fail(message) {
    console.error("gen-doc: " + message);
    process.exit(1);
}

function usage() {
    return [
        "Usage: node scripts/gen-doc.mjs [--home <DSH_HOME>] [--profile <name>] [--out-dir <dir>]",
        "",
        "  --home      DSH home directory (default: $DSH_HOME or ~/.dsh)",
        "  --profile   profile name (default: desktop)",
        "  --out-dir   output directory (default: this repository root)",
    ].join("\n");
}

function parseArgs(argv) {
    const fromEnv = typeof process.env.DSH_HOME === "string" ? process.env.DSH_HOME.trim() : "";
    const options = {
        home: fromEnv !== "" ? fromEnv : path.join(os.homedir(), ".dsh"),
        profile: "desktop",
        outDir: REPO_ROOT,
    };
    for (let index = 0; index < argv.length; index += 1) {
        const arg = argv[index];
        if (arg === "--help" || arg === "-h") {
            console.log(usage());
            process.exit(0);
        }
        if (arg !== "--home" && arg !== "--profile" && arg !== "--out-dir") {
            fail("unknown argument: " + arg + "\n" + usage());
        }
        const value = argv[index + 1];
        if (typeof value !== "string" || value.trim() === "") fail(arg + " requires a value\n" + usage());
        index += 1;
        if (arg === "--home") options.home = value.trim();
        else if (arg === "--profile") options.profile = value.trim();
        else options.outDir = value.trim();
    }
    return options;
}

function readJson(file, label) {
    let raw;
    try {
        raw = fs.readFileSync(file, "utf8");
    } catch (error) {
        fail(
            "cannot read " + label + " (" + (error && error.code ? error.code : "unknown error") + "); " +
            "pass --home <DSH_HOME> / --profile <name> when the layout is not the default",
        );
    }
    try {
        return JSON.parse(raw);
    } catch (error) {
        fail(label + " is not valid JSON (" + String((error && error.message) || error) + ")");
    }
}

function cleanText(value, fallback) {
    if (typeof value !== "string") return fallback;
    const text = value.replace(/\s+/g, " ").trim();
    return text === "" ? fallback : text;
}

function truncate(value, limit) {
    const characters = Array.from(value);
    if (characters.length <= limit) return value;
    return characters.slice(0, limit - 1).join("") + "…";
}

function loadEntries(home) {
    const cache = readJson(path.join(home, "plugin-labels.json"), "plugin-labels.json");
    const entries = cache && cache.entries;
    if (!entries || typeof entries !== "object" || Array.isArray(entries)) {
        fail("plugin-labels.json has no usable entries object");
    }
    return entries;
}

function loadBundles(home, profile) {
    const manifest = readJson(path.join(home, "profiles", profile, "package.json"), "the profile manifest (profiles/<profile>/package.json)");
    const bundles = manifest && manifest.dsh && manifest.dsh.profile && manifest.dsh.profile.bundles;
    if (!Array.isArray(bundles)) fail("the profile manifest has no dsh.profile.bundles array");
    const nodeModules = path.join(home, "profiles", profile, "node_modules");
    const names = bundles.filter((name) => typeof name === "string" && name.trim() !== "");
    if (names.length === 0) fail("the profile manifest lists no bundles; nothing to generate");
    return names.map((name) => {
        let version = "";
        let description = "";
        try {
            const pkg = JSON.parse(fs.readFileSync(path.join(nodeModules, name, "package.json"), "utf8"));
            version = cleanText(pkg.version, "");
            description = cleanText(pkg.description, "");
        } catch {
            // A missing bundle manifest only leaves version/description empty.
        }
        return { name, version, description };
    });
}

function buildRows(bundles, entries) {
    return bundles.map((bundle) => {
        const raw = entries[bundle.name];
        const label = raw && typeof raw === "object" && !Array.isArray(raw) ? raw : null;
        const title = label ? cleanText(label.title, "") : "";
        const oneLine = label ? cleanText(label.oneLine, "") : "";
        const translated = title !== "" && oneLine !== "";
        const status = !translated ? "待翻译" : label.source === "manual" ? "手改" : label.source === "ai" ? "AI 生成" : "—";
        return {
            name: bundle.name,
            title: translated ? title : "未翻译",
            oneLine: translated ? oneLine : truncate(bundle.description === "" ? "（无描述）" : bundle.description, DESCRIPTION_LIMIT),
            version: bundle.version,
            status,
            translated,
        };
    });
}

function timestamp(date) {
    const pad = (value) => String(value).padStart(2, "0");
    return date.getFullYear() + "-" + pad(date.getMonth() + 1) + "-" + pad(date.getDate()) + " " +
        pad(date.getHours()) + ":" + pad(date.getMinutes()) + ":" + pad(date.getSeconds());
}

/** Refuse to publish anything that looks like a local path or a secret. */
function assertPublic(text) {
    const patterns = [
        [/\b[A-Za-z]:[\\/]/, "a Windows drive path"],
        [/[\\/]Users[\\/]/i, "a user home path"],
        [/\.dsh[\\/]/i, "the DSH home path"],
        [/ghp_[A-Za-z0-9]{10,}/, "a GitHub token"],
        [/github_pat_[A-Za-z0-9_]{10,}/, "a GitHub token"],
        [/sk-[A-Za-z0-9]{10,}/, "an API key"],
        [/-{5}BEGIN/, "a private key"],
    ];
    for (const [pattern, description] of patterns) {
        if (pattern.test(text)) fail("refusing to write documentation containing " + description);
    }
}

function markdownCell(value) {
    return String(value).replace(/\\/g, "\\\\").replace(/\|/g, "\\|");
}

function renderMarkdown(rows, translated, generatedAt) {
    const lines = [
        "# DSH 插件中文名速查表",
        "",
        "> 由 dsh-plugin-labels 的标签缓存生成，请勿手工修改；重新生成：`node scripts/gen-doc.mjs`。",
        ">",
        "> 生成时间：" + generatedAt + "（本地时间） · 已翻译 " + translated + " / " + rows.length + " 个已安装插件。",
        "",
        "| 中文名 | 原始包名 | 一句话作用 | 版本 | 说明 |",
        "| --- | --- | --- | --- | --- |",
    ];
    for (const row of rows) {
        lines.push(
            "| " + markdownCell(row.title) + " | `" + markdownCell(row.name) + "` | " + markdownCell(row.oneLine) +
            " | " + markdownCell(row.version) + " | " + markdownCell(row.status) + " |",
        );
    }
    lines.push("");
    return lines.join("\n");
}

function escapeHtml(value) {
    return String(value).replace(/[&<>"']/g, (character) => ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#39;",
    }[character]));
}

const HTML_STYLE = [
    ":root{color-scheme:light dark;--bg:#ffffff;--fg:#1f2328;--muted:#656d76;--line:#d0d7de;--code:#f6f8fa;--accent:#0969da}",
    "@media (prefers-color-scheme:dark){:root{--bg:#0d1117;--fg:#e6edf3;--muted:#8b949e;--line:#30363d;--code:#161b22;--accent:#2f81f7}}",
    "*{box-sizing:border-box}",
    'body{margin:0;background:var(--bg);color:var(--fg);font:14px/1.6 -apple-system,BlinkMacSystemFont,"Segoe UI","Noto Sans SC","Microsoft YaHei",sans-serif}',
    "main{max-width:1080px;margin:0 auto;padding:32px 20px 64px}",
    "h1{font-size:22px;margin:0 0 8px}",
    ".meta{color:var(--muted);font-size:12.5px;margin:0 0 18px}",
    ".meta code,td.name code{background:var(--code);padding:1px 5px;border-radius:5px;font-size:12px}",
    ".search{display:flex;gap:10px;align-items:center;margin:0 0 12px}",
    ".search input{flex:1 1 auto;max-width:420px;padding:7px 10px;font:inherit;color:inherit;background:var(--code);border:1px solid var(--line);border-radius:8px;outline:none}",
    ".search input:focus{border-color:var(--accent)}",
    "#count{color:var(--muted);font-size:12px}",
    "table{width:100%;border-collapse:collapse;font-size:13px}",
    "th,td{text-align:left;vertical-align:top;padding:8px 10px;border-bottom:1px solid var(--line)}",
    "th{color:var(--muted);font-weight:600;white-space:nowrap}",
    "tbody tr:hover{background:var(--code)}",
    "td.title{font-weight:700}",
    "td.status{color:var(--muted);white-space:nowrap}",
    ".empty{color:var(--muted)}",
    "@media (max-width:720px){th:nth-child(4),td:nth-child(4){display:none}}",
].join("");

function renderHtml(rows, translated, generatedAt) {
    const body = rows.map((row) => [
        "<tr>",
        '<td class="title">' + escapeHtml(row.title) + "</td>",
        '<td class="name"><code>' + escapeHtml(row.name) + "</code></td>",
        "<td>" + escapeHtml(row.oneLine) + "</td>",
        "<td>" + escapeHtml(row.version) + "</td>",
        '<td class="status">' + escapeHtml(row.status) + "</td>",
        "</tr>",
    ].join("")).join("\n");
    return [
        "<!DOCTYPE html>",
        '<html lang="zh-CN">',
        "<head>",
        '<meta charset="utf-8">',
        '<meta name="viewport" content="width=device-width, initial-scale=1">',
        "<title>DSH 插件中文名速查表</title>",
        "<style>" + HTML_STYLE + "</style>",
        "</head>",
        "<body>",
        "<main>",
        "<h1>DSH 插件中文名速查表</h1>",
        '<p class="meta">由 dsh-plugin-labels 的标签缓存生成，请勿手工修改；重新生成：<code>node scripts/gen-doc.mjs</code>。<br>生成时间：' +
            escapeHtml(generatedAt) + "（本地时间） · 已翻译 " + translated + " / " + rows.length + " 个已安装插件。</p>",
        '<p class="search"><input id="q" type="search" placeholder="搜索中文名、包名或作用…" autocomplete="off"><span id="count"></span></p>',
        "<table>",
        "<thead><tr><th>中文名</th><th>原始包名</th><th>一句话作用</th><th>版本</th><th>说明</th></tr></thead>",
        '<tbody id="rows">',
        body,
        "</tbody>",
        "</table>",
        '<p class="empty" id="empty" hidden>没有匹配的插件</p>',
        "</main>",
        "<script>",
        "(function () {",
        '  var input = document.getElementById("q");',
        '  var rows = Array.prototype.slice.call(document.querySelectorAll("#rows tr"));',
        '  var count = document.getElementById("count");',
        '  var empty = document.getElementById("empty");',
        "  function render() {",
        "    var query = input.value.trim().toLowerCase();",
        "    var shown = 0;",
        "    rows.forEach(function (row) {",
        "      var visible = query === \"\" || row.textContent.toLowerCase().indexOf(query) >= 0;",
        "      row.hidden = !visible;",
        "      if (visible) shown += 1;",
        "    });",
        "    count.textContent = shown + \" / \" + rows.length;",
        "    empty.hidden = shown !== 0;",
        "  }",
        '  input.addEventListener("input", render);',
        "  render();",
        "})();",
        "</script>",
        "</body>",
        "</html>",
        "",
    ].join("\n");
}

function writeOutput(file, content) {
    assertPublic(content);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, content, "utf8");
    console.log("gen-doc: wrote " + path.basename(file) + " (" + Buffer.byteLength(content, "utf8") + " bytes)");
}

const options = parseArgs(process.argv.slice(2));
const entries = loadEntries(options.home);
const bundles = loadBundles(options.home, options.profile);
if (Object.keys(entries).length === 0) {
    console.error("gen-doc: the label cache is empty; every row will be marked 未翻译");
}
const rows = buildRows(bundles, entries);
const translated = rows.filter((row) => row.translated).length;
const generatedAt = timestamp(new Date());
writeOutput(path.join(options.outDir, OUTPUT_MD), renderMarkdown(rows, translated, generatedAt));
writeOutput(path.join(options.outDir, OUTPUT_HTML), renderHtml(rows, translated, generatedAt));
console.log("gen-doc: " + rows.length + " plugins, " + translated + " translated");
