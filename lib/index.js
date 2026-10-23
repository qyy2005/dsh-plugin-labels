/**
 * dsh-plugin-labels — host half (v0.7.0: display overrides, no plugin UI).
 *
 * Four loopback-only endpoints (kept for scripts/AI even though the client no
 * longer renders a tab):
 *   GET  /api/plugin-labels/list       -> installed profile bundles + cached labels
 *   POST /api/plugin-labels/translate  -> translate the bundles that have no label yet
 *   POST /api/plugin-labels/label      -> set one manual label, or reset one back to AI
 *   POST /api/plugin-labels/import     -> merge an exported labels JSON
 *
 * Translation uses the live Harness LLM service exactly like the official
 * @deepseek-ai/dsh-experimental-auto-review plugin does:
 *   ctx.llm.stream({ provider, model, temperature: 0, system, messages })
 * Labels are cached in <DSH_HOME>/plugin-labels.json (UTF-8, no BOM, atomic
 * rename). Manual labels carry source:"manual" and are never overwritten by a
 * later translate run; translating only fills missing entries.
 *
 * Display overrides (all failure-safe; marker-detected because Cordis hands out
 * traceable Proxies whose method references differ on every read):
 *   - `installOfficialMeta` wraps `pluginPackages.metaOf()` so the official
 *     Plugins page rows and detail pages show the Chinese labels in place.
 *   - `installBundleMeta` wraps `pluginManager.listBundles()` so the plugin
 *     package cards (which call `readPluginMeta` directly) show them too.
 * Set DSH_PLUGIN_LABELS_OFFICIAL_META=0 to disable both display overrides.
 *
 * Auto translation: shortly after startup one pass fills up to
 * MAX_PENDING_PER_CALL missing labels through the same core, so a newly
 * installed plugin gets a Chinese name without any UI. Set
 * DSH_PLUGIN_LABELS_AUTO_TRANSLATE=0 to disable it. It never throws into or
 * blocks host startup.
 *
 * Failure policy: every handler catches its own errors and answers with JSON;
 * nothing is allowed to escape as an unhandled rejection (that is fatal to the
 * Harness process). The plugin never blocks DSH startup.
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export const name = "plugin-labels";
export const inject = ["webServer"];

export const LIST_PATH = "/api/plugin-labels/list";
export const TRANSLATE_PATH = "/api/plugin-labels/translate";
export const LABEL_PATH = "/api/plugin-labels/label";
export const IMPORT_PATH = "/api/plugin-labels/import";

const CACHE_VERSION = 2;
const LEGACY_CACHE_VERSION = 1;
const MAX_PENDING_PER_CALL = 20;
const MAX_TITLE = 40;
const MAX_ONE_LINE = 120;
const MAX_BODY_BYTES = 65536;
const TRANSLATE_TIMEOUT_MS = 120000;

const SYSTEM_PROMPT = [
    "You label DeepSeek Harness (DSH) plugins for a Chinese-speaking user.",
    "For every plugin you receive, produce:",
    "1. title: a short Chinese name, at most 8 Chinese characters, naming what it does (not a literal translation of the package name).",
    "2. oneLine: one Chinese sentence, at most 40 characters, telling the user what the plugin does and whether it matters to them.",
    "Be concrete. Avoid marketing words. If the description is unclear, say what the package name plus description imply.",
    "Answer with strict JSON only, no prose, no markdown fences:",
    '{"items":[{"name":"<exact package name>","title":"...","oneLine":"..."}]}',
].join("\n");

/**
 * Experimental display-layer override: wrap the host `pluginPackages.metaOf`
 * service so the official Plugins page shows our Chinese labels in place
 * (list rows and detail pages). This only changes display text; it does not
 * touch package identity, installation or updates. Every failure path keeps the
 * host's original behavior.
 */
const OFFICIAL_META_ENV = "DSH_PLUGIN_LABELS_OFFICIAL_META";
const AUTO_TRANSLATE_ENV = "DSH_PLUGIN_LABELS_AUTO_TRANSLATE";
const AUTO_TRANSLATE_DELAY_MS = 4000;

/** Auto-translate missing labels at startup unless explicitly disabled. */
function autoTranslateEnabled() {
    return process.env[AUTO_TRANSLATE_ENV] !== "0";
}

/** Display overrides can be turned off together for a plain host. */
function displayOverrideEnabled() {
    return process.env[OFFICIAL_META_ENV] !== "0";
}

/**
 * Marker carried by our wrapper. Cordis hands out traceable Proxy views whose
 * function properties are re-wrapped on every read, so a wrapper can only be
 * recognized by a marker that rides on the underlying function itself.
 */
const OFFICIAL_META_MARK = Symbol.for("dsh-plugin-labels.official-meta");
const BUNDLE_META_MARK = Symbol.for("dsh-plugin-labels.bundle-meta");

const isOfficialMetaWrapper = (value) => Boolean(value && typeof value === "function" && value[OFFICIAL_META_MARK] === true);
const isBundleMetaWrapper = (value) => Boolean(value && typeof value === "function" && value[BUNDLE_META_MARK] === true);

function markWithSymbol(wrapper, symbol) {
    try {
        Object.defineProperty(wrapper, symbol, {
            value: true,
            enumerable: false,
            configurable: false,
            writable: false,
        });
    } catch {
        // Exotic function object: the wrapper still works, only marking failed.
    }
    return wrapper;
}

function markOfficialMetaWrapper(wrapper) {
    return markWithSymbol(wrapper, OFFICIAL_META_MARK);
}

function markBundleMetaWrapper(wrapper) {
    return markWithSymbol(wrapper, BUNDLE_META_MARK);
}

/** Split a configured specifier into its bare package name (`@scope/name/sub` -> `@scope/name`). */
export function bareNameOf(specifier) {
    if (typeof specifier !== "string") return "";
    const request = specifier.trim();
    if (request === "" || request.startsWith("cordis:")) return "";
    // Relative/absolute/hash specifiers and other schemes are never plugin packages.
    if (/^[.\/\\#]/.test(request) || request.includes(":")) return "";
    const parts = request.split("/").filter((part) => part !== "");
    if (parts.length === 0) return "";
    if (request.startsWith("@")) return parts.length >= 2 ? parts[0] + "/" + parts[1] : "";
    return parts[0];
}

/** English variant of a display field that may be a string or a language map. */
function englishDisplayText(value, fallback) {
    if (typeof value === "string" && value.trim() !== "") return value;
    if (value && typeof value === "object" && !Array.isArray(value)) {
        // Only the English variant counts as "the English original"; a map that
        // carries other languages must not impersonate English.
        if (typeof value.en === "string" && value.en.trim() !== "") return value.en;
    }
    return fallback;
}

/**
 * Overlay one cached label on readPluginMeta()'s base description.
 * `base` may be undefined; title/description keep their English original so the
 * official page can still resolve every language it knows.
 */
export function mergeDisplayMeta(base, label, name) {
    if (!label || typeof label !== "object") return base;
    const title = typeof label.title === "string" ? label.title.trim() : "";
    const oneLine = typeof label.oneLine === "string" ? label.oneLine.trim() : "";
    if (title === "") return base;
    const source = base && typeof base === "object" && !Array.isArray(base) ? base : {};
    return {
        ...source,
        title: { en: englishDisplayText(source.title, name || ""), zh: title },
        description: { en: englishDisplayText(source.description, ""), zh: oneLine },
    };
}

/**
 * An error whose message is meant for the browser. Everything else that escapes
 * a handler is answered with a generic 500: an unexpected error may carry stack
 * traces or absolute filesystem paths and must never reach the web UI.
 */
class HttpError extends Error {
    constructor(status, message, options) {
        super(message);
        this.name = "HttpError";
        this.status = status;
        this.respond = !(options && options.respond === false);
        this.afterRespond = options && typeof options.afterRespond === "function" ? options.afterRespond : null;
    }
}

function badRequest(message) {
    return new HttpError(400, message);
}

/** Write one JSON answer; never throw when the socket is already gone. */
function json(res, status, body, afterRespond) {
    let data;
    try {
        data = JSON.stringify(body);
    } catch {
        status = 500;
        data = '{"ok":false,"error":"internal error"}';
    }
    const done = () => {
        if (typeof afterRespond !== "function") return;
        try {
            afterRespond();
        } catch {
            // The socket is already gone; nothing useful is left to do.
        }
    };
    try {
        if (!res || res.destroyed || res.writableEnded) {
            done();
            return;
        }
        if (!res.headersSent) {
            res.statusCode = status;
            res.setHeader("content-type", "application/json; charset=utf-8");
            res.setHeader("cache-control", "no-store");
            // A rejected oversized body is not read to the end, so this
            // connection must not be reused by the client.
            if (status === 413) res.setHeader("connection", "close");
        }
        res.end(data, done);
    } catch {
        // Writing after the peer vanished is expected under cancellation.
        done();
    }
}

/** Keep an explicit 4xx status, hide everything else behind a stable 500. */
function respondError(res, error) {
    const explicit = error instanceof HttpError;
    if (explicit && error.respond === false) return;
    const afterRespond = explicit ? error.afterRespond : null;
    if (explicit && error.status >= 400 && error.status < 500) {
        json(res, error.status, { ok: false, error: error.message }, afterRespond);
        return;
    }
    json(res, 500, { ok: false, error: "internal error" }, afterRespond);
}

function isLoopback(req) {
    const address = req.socket && req.socket.remoteAddress;
    return address === "127.0.0.1" || address === "::1" || address === "::ffff:127.0.0.1";
}

/**
 * Loopback is not a security boundary: the remote-web-ui tunnel makes every
 * internet client arrive from 127.0.0.1. Reject requests a browser marks as
 * cross-site, and require the write verbs this plugin expects.
 */
function isSameOriginRequest(req) {
    const site = req.headers["sec-fetch-site"];
    if (typeof site === "string" && site !== "same-origin" && site !== "none") return false;
    return true;
}

/**
 * Read a small JSON body; rejects instead of buffering unbounded input.
 *
 * On overflow the promise rejects with a 413 and buffering stops, but the
 * request is only destroyed after the caller has answered (`afterRespond`):
 * destroying it here would make the response write fail with
 * ERR_STREAM_DESTROYED. A client that disconnects first rejects with
 * respond:false so no doomed write is attempted.
 */
function readBody(req) {
    return new Promise((resolve, reject) => {
        const chunks = [];
        let size = 0;
        let settled = false;
        const cleanup = () => {
            // The terminal listeners stay attached on purpose: a stream error
            // after settling (or after req.destroy()) must not go unhandled,
            // and settle() already ignores late calls.
            req.removeListener("data", onData);
            req.removeListener("end", onEnd);
        };
        const settle = (error, value) => {
            if (settled) return;
            settled = true;
            cleanup();
            if (error) reject(error);
            else resolve(value);
        };
        const clientGone = () => settle(new HttpError(400, "client closed the request", { respond: false }));
        function onData(chunk) {
            if (settled) return;
            size += chunk.length;
            if (size > MAX_BODY_BYTES) {
                settle(new HttpError(413, "request body is too large", {
                    afterRespond: () => {
                        try {
                            req.destroy();
                        } catch {
                            // Already destroyed.
                        }
                    },
                }));
                // Stop buffering but keep draining, so the response can flush.
                try {
                    if (typeof req.resume === "function" && !req.destroyed) req.resume();
                } catch {
                    // The stream is already unusable.
                }
                return;
            }
            chunks.push(chunk);
        }
        function onEnd() {
            settle(null, Buffer.concat(chunks).toString("utf8"));
        }
        function onError() {
            clientGone();
        }
        function onAborted() {
            clientGone();
        }
        function onClose() {
            if (!req.readableEnded) clientGone();
        }
        req.on("data", onData);
        req.on("end", onEnd);
        req.on("error", onError);
        req.on("aborted", onAborted);
        req.on("close", onClose);
    });
}

async function readJsonBody(req) {
    const raw = await readBody(req);
    if (raw.trim() === "") return {};
    let parsed;
    try {
        parsed = JSON.parse(raw);
    } catch {
        throw badRequest("request body is not valid JSON");
    }
    if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) throw badRequest("request body must be a JSON object");
    return parsed;
}

function resolveHome() {
    const fromEnv = process.env.DSH_HOME;
    if (fromEnv && fromEnv.trim() !== "") return fromEnv.trim();
    return path.join(os.homedir(), ".dsh");
}

function readProfile(home) {
    const profileDir = path.join(home, "profiles", "desktop");
    const profile = JSON.parse(fs.readFileSync(path.join(profileDir, "package.json"), "utf8"));
    const list = profile && profile.dsh && profile.dsh.profile && profile.dsh.profile.bundles;
    const bundles = Array.isArray(list) ? list.filter((item) => typeof item === "string") : [];
    const nodeModules = path.join(profileDir, "node_modules");
    const plugins = bundles.map((bundle) => {
        let version = "";
        let description = "";
        let kind = "profile-bundle";
        try {
            const pkg = JSON.parse(fs.readFileSync(path.join(nodeModules, bundle, "package.json"), "utf8"));
            version = typeof pkg.version === "string" ? pkg.version : "";
            description = typeof pkg.description === "string" ? pkg.description : "";
        } catch {
            kind = "official-or-missing";
        }
        return { name: bundle, version, description, kind };
    });
    return { profileDir, plugins };
}

function cachePath(home) {
    return path.join(home, "plugin-labels.json");
}

/** Cache keys that would mutate an object's prototype instead of adding an entry. */
const RESERVED_KEYS = new Set(["__proto__", "constructor", "prototype"]);

/**
 * Validate one cached label. Unknown shapes are dropped per entry, so one
 * corrupt row cannot take down the whole cache (or the plugin page).
 */
function normalizeLabel(value) {
    if (!value || typeof value !== "object" || Array.isArray(value)) return null;
    const title = typeof value.title === "string" ? value.title.trim() : "";
    const oneLine = typeof value.oneLine === "string" ? value.oneLine.trim() : "";
    if (title === "" || oneLine === "") return null;
    const source = value.source === "manual" ? "manual" : "ai";
    const label = {
        title: title.slice(0, MAX_TITLE),
        oneLine: oneLine.slice(0, MAX_ONE_LINE),
        source,
    };
    if (typeof value.at === "string" && value.at !== "") label.at = value.at;
    // Only AI labels carry the model that produced them; manual labels never do.
    if (source === "ai" && typeof value.model === "string" && value.model !== "") label.model = value.model;
    return label;
}

function emptyCache() {
    return { version: CACHE_VERSION, entries: {} };
}

function readCache(home) {
    let parsed;
    try {
        parsed = JSON.parse(fs.readFileSync(cachePath(home), "utf8"));
    } catch {
        // Missing or corrupt cache: start over, never fail the request.
        return emptyCache();
    }
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return emptyCache();
    // v1 caches precede shape validation; read them, then persist as v2 on the
    // next write. Any other version is treated as foreign data.
    if (parsed.version !== CACHE_VERSION && parsed.version !== LEGACY_CACHE_VERSION) return emptyCache();
    if (!parsed.entries || typeof parsed.entries !== "object" || Array.isArray(parsed.entries)) return emptyCache();
    const cache = emptyCache();
    for (const [pluginName, value] of Object.entries(parsed.entries)) {
        if (typeof pluginName !== "string" || pluginName.trim() === "" || RESERVED_KEYS.has(pluginName)) continue;
        const label = normalizeLabel(value);
        if (label) cache.entries[pluginName] = label;
    }
    return cache;
}

function writeCache(home, cache) {
    const target = cachePath(home);
    const temporary = target + ".tmp-" + process.pid;
    // UTF-8 without BOM: DSH and Node parse these files as raw JSON text.
    // Renaming a fully written temp file keeps readers from seeing half a cache.
    const body = JSON.stringify({ version: CACHE_VERSION, entries: cache.entries || {} }, null, 2);
    fs.writeFileSync(temporary, body, "utf8");
    try {
        fs.renameSync(temporary, target);
    } catch (error) {
        try {
            fs.unlinkSync(temporary);
        } catch {
            // The temp file is already gone.
        }
        throw error;
    }
}

/**
 * Install the experimental official-page display override.
 * Wraps `pluginPackages.metaOf(specifier, parentURL)` with our cached labels,
 * re-applies it if the host swaps the service instance (HMR/refresh), and
 * restores the original method on dispose. Nothing here may throw: a failed
 * hook just keeps the host's own metadata.
 *
 * Detection is marker-based (v0.6.1): `ctx.get()` hands out Cordis traceable
 * Proxies, and every read of `service.metaOf` returns a fresh wrapper function,
 * so reference/identity comparisons are meaningless. The wrapper therefore
 * carries a symbol marker; `isOfficialMetaWrapper()` is the only ownership test.
 */
export function installOfficialMeta(ctx, home) {
    // Display overrides are on by default; only an explicit "0" turns them off.
    const enabled = displayOverrideEnabled();
    const warn = (message) => {
        try {
            ctx.logger?.warn?.("[plugin-labels] " + message);
        } catch {
            // A logger failure must not break the host.
        }
    };
    let installed = null; // { service, raw, wrapper }

    const currentService = () => {
        try {
            return ctx.get("pluginPackages");
        } catch {
            return undefined;
        }
    };

    const restore = () => {
        const active = installed;
        installed = null;
        if (!active) return;
        try {
            // Compare by marker, never by reference: the traceable Proxy returns
            // a new function wrapper on every read.
            if (!isOfficialMetaWrapper(active.service.metaOf)) return;
            try {
                // Class instances keep the real method on their prototype, so
                // deleting the own property restores the original behavior.
                delete active.service.metaOf;
            } catch {
                // Frozen/exotic service object; fall back to the saved method.
            }
            if (isOfficialMetaWrapper(active.service.metaOf)) active.service.metaOf = active.raw;
        } catch (error) {
            warn("failed to restore pluginPackages.metaOf: " + String((error && error.message) || error));
        }
    };

    const tryPatch = () => {
        if (!enabled) return;
        try {
            const service = currentService();
            if (!service || (typeof service !== "object" && typeof service !== "function")) return;
            // Already ours? The traceable Proxy view may be a different object on
            // every ctx.get, so identity cannot decide: the marker does.
            if (isOfficialMetaWrapper(service.metaOf)) {
                if (!installed) installed = { service, raw: service.metaOf, wrapper: service.metaOf };
                return;
            }
            // A new service instance replaced the old one: restore it first.
            if (installed) restore();
            const raw = service.metaOf;
            if (typeof raw !== "function") return;
            const original = raw.bind(service);
            const wrapper = markOfficialMetaWrapper(function (specifier, parentURL) {
                let base;
                try {
                    base = original(specifier, parentURL);
                } catch {
                    base = undefined;
                }
                try {
                    const pluginName = bareNameOf(specifier);
                    if (pluginName === "") return base;
                    const label = readCache(home).entries[pluginName];
                    return label ? mergeDisplayMeta(base, label, pluginName) : base;
                } catch {
                    return base;
                }
            });
            try {
                service.metaOf = wrapper;
            } catch (error) {
                warn("could not wrap pluginPackages.metaOf: " + String((error && error.message) || error));
                return;
            }
            if (!isOfficialMetaWrapper(service.metaOf)) {
                warn("could not wrap pluginPackages.metaOf: the assignment had no effect");
                return;
            }
            installed = { service, raw, wrapper };
        } catch (error) {
            warn("pluginPackages.metaOf hook skipped: " + String((error && error.message) || error));
        }
    };

    const status = () => ({
        enabled,
        patched: installed !== null,
        service: Boolean(currentService()),
    });

    if (!enabled) return { dispose: () => {}, tryPatch: () => {}, status };
    tryPatch();
    return { dispose: restore, tryPatch, status };
}

/** Overlay a cached label on one `listBundles()` entry (meta is readPluginMeta output). */
function overlayBundleMeta(bundle, home) {
    if (!bundle || typeof bundle !== "object") return bundle;
    const pluginName = bareNameOf(bundle.name);
    if (pluginName === "") return bundle;
    const label = readCache(home).entries[pluginName];
    if (!label) return bundle;
    try {
        bundle.meta = mergeDisplayMeta(bundle.meta, label, pluginName);
    } catch {
        // Keep the host's own metadata for this bundle.
    }
    return bundle;
}

/**
 * Patch the `pluginManager` service so package cards (which read
 * `readPluginMeta` directly, bypassing `pluginPackages.metaOf`) also show the
 * Chinese names. Same marker/idempotency/restore discipline as
 * `installOfficialMeta`; every failure keeps the host's own metadata.
 */
export function installBundleMeta(ctx, home) {
    const enabled = displayOverrideEnabled();
    const warn = (message) => {
        try {
            ctx.logger?.warn?.("[plugin-labels] " + message);
        } catch {
            // A logger failure must not break the host.
        }
    };
    let installed = null; // { service, raw, wrapper }

    const currentService = () => {
        try {
            return ctx.get("pluginManager");
        } catch {
            return undefined;
        }
    };

    const restore = () => {
        const active = installed;
        installed = null;
        if (!active) return;
        try {
            if (!isBundleMetaWrapper(active.service.listBundles)) return;
            try {
                delete active.service.listBundles;
            } catch {
                // Frozen/exotic service object; fall back to the saved method.
            }
            if (isBundleMetaWrapper(active.service.listBundles)) active.service.listBundles = active.raw;
        } catch (error) {
            warn("failed to restore pluginManager.listBundles: " + String((error && error.message) || error));
        }
    };

    const tryPatch = () => {
        if (!enabled) return;
        try {
            const service = currentService();
            if (!service || (typeof service !== "object" && typeof service !== "function")) return;
            if (isBundleMetaWrapper(service.listBundles)) {
                if (!installed) installed = { service, raw: service.listBundles, wrapper: service.listBundles };
                return;
            }
            if (installed) restore();
            const raw = service.listBundles;
            if (typeof raw !== "function") return;
            const wrapper = markBundleMetaWrapper(function (...args) {
                let result;
                try {
                    result = raw.apply(service, args);
                } catch (error) {
                    return Promise.reject(error);
                }
                // listBundles is async today but tolerate a sync array too.
                return Promise.resolve(result).then(
                    (value) => {
                        try {
                            if (!Array.isArray(value)) return value;
                            for (const bundle of value) {
                                try {
                                    overlayBundleMeta(bundle, home);
                                } catch {
                                    // Keep this bundle's own metadata.
                                }
                            }
                            return value;
                        } catch {
                            return value;
                        }
                    },
                    (error) => {
                        throw error;
                    },
                );
            });
            try {
                service.listBundles = wrapper;
            } catch (error) {
                warn("could not wrap pluginManager.listBundles: " + String((error && error.message) || error));
                return;
            }
            if (!isBundleMetaWrapper(service.listBundles)) {
                warn("could not wrap pluginManager.listBundles: the assignment had no effect");
                return;
            }
            installed = { service, raw, wrapper };
        } catch (error) {
            warn("pluginManager.listBundles hook skipped: " + String((error && error.message) || error));
        }
    };

    const status = () => ({
        enabled,
        patched: installed !== null,
        service: Boolean(currentService()),
    });

    if (!enabled) return { dispose: () => {}, tryPatch: () => {}, status };
    tryPatch();
    return { dispose: restore, tryPatch, status };
}

/** Read the configured default route; fall back to the official DeepSeek route. */
function modelOf(ctx) {
    try {
        // The settings service has no get(); the configured default route lives
        // on the agentDefaultModel service (official dsh-headless plugin does
        // exactly this: ctx.get("agentDefaultModel").currentSelection()).
        const service = ctx.get("agentDefaultModel");
        const current = service && typeof service.currentSelection === "function" ? service.currentSelection() : undefined;
        const pick = (value) => (typeof value === "string" ? value : value && typeof value.id === "string" ? value.id : "");
        const provider = pick(current && current.provider);
        const model = pick(current && current.model);
        if (provider !== "" && model !== "") return { provider, model };
    } catch {
        // Fall through to the default route.
    }
    return { provider: "deepseek-official", model: "deepseek-flash" };
}

function pendingOf(plugins, cache) {
    return plugins.filter((plugin) => !cache.entries[plugin.name]);
}

function buildUserText(pending) {
    return JSON.stringify(
        {
            instruction: "Label every plugin below. Reply with the strict JSON object only.",
            plugins: pending.map((plugin) => ({
                name: plugin.name,
                version: plugin.version,
                description: plugin.description || "(no description; infer from the package name)",
            })),
        },
        null,
        2,
    );
}

/** Drain one `llm.stream` result into its final text, rejecting on bad terminals. */
async function collectText(stream) {
    let text = "";
    let finish;
    for await (const chunk of stream) {
        if (!chunk || typeof chunk !== "object") continue;
        if (chunk.type === "text-delta" && typeof chunk.text === "string") text += chunk.text;
        else if (chunk.type === "finish") finish = chunk.reason;
    }
    if (finish && finish.kind !== "stop") {
        const failure = finish.failure || {};
        const detail = [failure.code, failure.message].filter((part) => typeof part === "string" && part !== "").join(": ");
        throw new Error("model ended with " + finish.kind + (detail === "" ? "" : " (" + detail + ")"));
    }
    if (text.trim() === "") throw new Error("model returned no text");
    return text;
}

/** Parse the model's strict-JSON answer, keeping only names we asked about. */
function parseTranslations(text, pending) {
    let body = text.trim();
    const fenced = body.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (fenced) body = fenced[1].trim();
    const start = body.indexOf("{");
    const end = body.lastIndexOf("}");
    if (start < 0 || end <= start) throw new Error("model output contains no JSON object");
    const parsed = JSON.parse(body.slice(start, end + 1));
    const items = parsed && Array.isArray(parsed.items) ? parsed.items : [];
    const wanted = new Set(pending.map((plugin) => plugin.name));
    const out = {};
    for (const item of items) {
        if (!item || typeof item !== "object") continue;
        const pluginName = typeof item.name === "string" ? item.name : "";
        if (!wanted.has(pluginName)) continue;
        const title = typeof item.title === "string" ? item.title.trim() : "";
        const oneLine = typeof item.oneLine === "string" ? item.oneLine.trim() : "";
        if (title === "" || oneLine === "") continue;
        out[pluginName] = { title: title.slice(0, MAX_TITLE), oneLine: oneLine.slice(0, MAX_ONE_LINE) };
    }
    return out;
}

function handleList(home, req, res, officialMetaStatus) {
    if (!isLoopback(req)) {
        json(res, 403, { ok: false, error: "loopback only" });
        return;
    }
    if (!isSameOriginRequest(req) || req.method !== "GET") {
        json(res, 403, { ok: false, error: "cross-site or non-GET request rejected" });
        return;
    }
    try {
        const { profileDir, plugins } = readProfile(home);
        const cache = readCache(home);
        const items = plugins.map((plugin) => ({
            name: plugin.name,
            version: plugin.version,
            description: plugin.description,
            kind: plugin.kind,
            label: cache.entries[plugin.name] || null,
        }));
        // Diagnostics for the experimental official-page override; clients ignore
        // unknown fields, so this stays backward compatible.
        let officialMeta = { enabled: true, patched: false, service: false, bundles: false };
        if (typeof officialMetaStatus === "function") {
            try {
                officialMeta = officialMetaStatus();
            } catch {
                // Diagnostics must never fail the list request.
            }
        }
        json(res, 200, {
            ok: true,
            home,
            profileDir,
            count: items.length,
            translated: items.filter((item) => item.label !== null).length,
            pending: items.filter((item) => item.label === null).length,
            plugins: items,
            officialMeta,
        });
    } catch (error) {
        respondError(res, error);
    }
}

/**
 * Translate missing labels (or an explicit name list) with the live LLM service.
 * Pure of HTTP: loopback handlers add the fencing and JSON envelope, and the
 * startup auto-translate reuses this core unchanged.
 * @returns {{added: number, skipped: number, remaining: number, total: number, labels: object}}
 */
export async function translatePending(ctx, home, options) {
    const names = Array.isArray(options && options.names) ? options.names.filter((item) => typeof item === "string") : [];
    const { plugins } = readProfile(home);
    const cache = readCache(home);
    // Explicit names mean "translate these again" (even if a label exists);
    // no names means the automatic mode that only fills missing entries.
    const targets = names.length > 0
        ? plugins.filter((plugin) => names.includes(plugin.name))
        : pendingOf(plugins, cache);
    const pending = targets.slice(0, MAX_PENDING_PER_CALL);
    const remaining = Math.max(0, targets.length - pending.length);
    const total = targets.length;
    if (pending.length === 0) {
        return { added: 0, skipped: 0, remaining: 0, total, labels: cache.entries };
    }
    const { provider, model } = modelOf(ctx);
    const llm = ctx.get("llm");
    if (!llm || typeof llm.stream !== "function") throw new Error("the llm service is not available in this profile");
    const stream = llm.stream({
        provider,
        model,
        temperature: 0,
        system: SYSTEM_PROMPT,
        messages: [{ role: "user", content: [{ type: "text", text: buildUserText(pending) }] }],
        // A stalled provider must not leave the caller busy forever.
        signal: AbortSignal.timeout(TRANSLATE_TIMEOUT_MS),
    });
    const text = await collectText(stream);
    const translations = parseTranslations(text, pending);
    const at = new Date().toISOString();
    let added = 0;
    for (const [pluginName, value] of Object.entries(translations)) {
        // Automatic mode only fills gaps: a manual label always wins over a
        // later AI run. An explicit per-plugin re-translate may overwrite.
        if (names.length === 0 && cache.entries[pluginName]) continue;
        cache.entries[pluginName] = { title: value.title, oneLine: value.oneLine, source: "ai", model: provider + "/" + model, at };
        added += 1;
    }
    if (added > 0) writeCache(home, cache);
    return { added, skipped: pending.length - added, remaining, total, labels: cache.entries };
}

/** HTTP translate handler: fencing + JSON envelope around `translatePending`. */
async function translateOnce(ctx, home, req, res) {
    if (!isLoopback(req)) {
        json(res, 403, { ok: false, error: "loopback only" });
        return;
    }
    const payload = await readJsonBody(req);
    const names = Array.isArray(payload.names) ? payload.names.filter((item) => typeof item === "string") : [];
    const result = await translatePending(ctx, home, { names });
    json(res, 200, { ok: true, added: result.added, skipped: result.skipped, remaining: result.remaining, labels: result.labels });
}

/** Set one manual label, or reset one entry back to "translate me again". */
async function handleLabel(home, req, res) {
    if (!isLoopback(req)) {
        json(res, 403, { ok: false, error: "loopback only" });
        return;
    }
    const payload = await readJsonBody(req);
    const pluginName = typeof payload.name === "string" ? payload.name.trim() : "";
    const { plugins } = readProfile(home);
    const installed = plugins.find((plugin) => plugin.name === pluginName);
    if (!installed) throw badRequest("unknown installed plugin: " + (pluginName || "(empty)"));

    const cache = readCache(home);
    const action = typeof payload.action === "string" ? payload.action : "set";
    if (action === "reset") {
        delete cache.entries[pluginName];
        writeCache(home, cache);
        json(res, 200, { ok: true, name: pluginName, label: null, labels: cache.entries });
        return;
    }
    const title = typeof payload.title === "string" ? payload.title.trim() : "";
    const oneLine = typeof payload.oneLine === "string" ? payload.oneLine.trim() : "";
    if (title === "" || oneLine === "") throw badRequest("title and oneLine are both required");
    cache.entries[pluginName] = {
        title: title.slice(0, MAX_TITLE),
        oneLine: oneLine.slice(0, MAX_ONE_LINE),
        source: "manual",
        at: new Date().toISOString(),
    };
    writeCache(home, cache);
    json(res, 200, { ok: true, name: pluginName, label: cache.entries[pluginName], labels: cache.entries });
}

/**
 * Single-flight: a second translate request while one is running would spend
 * tokens twice and race the atomic cache rename, so refuse it instead.
 */
let translateInFlight = false;

/**
 * One startup pass that fills missing labels. Never throws (a failed auto-run
 * must not affect the host) and respects the same single-flight lock as HTTP.
 * @returns {{added?: number, skipped?: boolean|number, reason?: string, remaining?: number}}
 */
export async function runAutoTranslate(ctx, home) {
    const log = (level, message) => {
        try {
            ctx.logger?.[level]?.("[plugin-labels] " + message);
        } catch {
            // A logger failure must not break the host.
        }
    };
    if (!autoTranslateEnabled()) return { skipped: true, reason: "disabled" };
    try {
        const { plugins } = readProfile(home);
        const cache = readCache(home);
        const missing = pendingOf(plugins, cache).length;
        if (missing === 0) {
            log("info", "auto-translate: nothing pending");
            return { added: 0, skipped: false, total: 0 };
        }
        if (translateInFlight) return { skipped: true, reason: "busy" };
        translateInFlight = true;
        let result;
        try {
            result = await translatePending(ctx, home, {});
        } finally {
            translateInFlight = false;
        }
        log("info", "auto-translate added " + result.added + " label(s); " + result.remaining + " pending left");
        return result;
    } catch (error) {
        log("warn", "auto-translate failed: " + String((error && error.message) || error));
        return { skipped: true, reason: "error", error: String((error && error.message) || error) };
    }
}

/** Guarded translate entry point. */
async function handleTranslate(ctx, home, req, res) {
    if (!isLoopback(req)) {
        json(res, 403, { ok: false, error: "loopback only" });
        return;
    }
    if (translateInFlight) {
        json(res, 409, { ok: false, error: "a translation is already running" });
        return;
    }
    translateInFlight = true;
    try {
        await translateOnce(ctx, home, req, res);
    } finally {
        translateInFlight = false;
    }
}
/** Merge an exported labels JSON into the cache. */
async function handleImport(home, req, res) {
    if (!isLoopback(req)) {
        json(res, 403, { ok: false, error: "loopback only" });
        return;
    }
    const payload = await readJsonBody(req);
    const entries = payload.entries !== null && typeof payload.entries === "object" ? payload.entries : payload;
    if (entries === null || typeof entries !== "object" || Array.isArray(entries)) throw badRequest("entries must be an object");
    const { plugins } = readProfile(home);
    const installed = new Set(plugins.map((plugin) => plugin.name));
    const cache = readCache(home);
    const now = new Date().toISOString();
    let applied = 0;
    let skipped = 0;
    for (const [pluginName, value] of Object.entries(entries)) {
        if (!installed.has(pluginName) || RESERVED_KEYS.has(pluginName) || value === null || typeof value !== "object" || Array.isArray(value)) {
            skipped += 1;
            continue;
        }
        const title = typeof value.title === "string" ? value.title.trim() : "";
        const oneLine = typeof value.oneLine === "string" ? value.oneLine.trim() : "";
        if (title === "" || oneLine === "") {
            skipped += 1;
            continue;
        }
        // Keep the origin of each label: a round-trip must not turn AI labels
        // into edited ones (or the reverse); unknown sources normalize to "ai".
        const source = value.source === "manual" ? "manual" : "ai";
        const label = {
            title: title.slice(0, MAX_TITLE),
            oneLine: oneLine.slice(0, MAX_ONE_LINE),
            source,
            at: typeof value.at === "string" && value.at !== "" ? value.at : now,
        };
        if (source === "ai" && typeof value.model === "string" && value.model !== "") label.model = value.model;
        cache.entries[pluginName] = label;
        applied += 1;
    }
    if (applied > 0) writeCache(home, cache);
    json(res, 200, { ok: true, applied, skipped, labels: cache.entries });
}
/** Wrap an async handler so a rejection always becomes a JSON answer. */
function guarded(res, req, work) {
    if (!isSameOriginRequest(req)) {
        json(res, 403, { ok: false, error: "cross-site request rejected" });
        return;
    }
    if (req.method !== "POST") {
        json(res, 405, { ok: false, error: "POST required" });
        return;
    }
    return Promise.resolve()
        .then(work)
        // Explicit 4xx statuses (400/413/...) survive; unexpected failures are
        // answered with a stable 500 body that leaks neither stack nor paths.
        .catch((error) => respondError(res, error));
}

export function apply(ctx) {
    const home = resolveHome();
    // Display overrides: the official Plugins page rows/details (pluginPackages)
    // and the plugin package cards (pluginManager.listBundles). Installed before
    // the routes; the service listener re-applies them after a service swap.
    const officialMeta = installOfficialMeta(ctx, home);
    const bundleMeta = installBundleMeta(ctx, home);
    ctx.effect(() => () => {
        officialMeta.dispose();
        bundleMeta.dispose();
    }, "plugin-labels: restore official plugin metadata wrappers");
    ctx.effect(() => {
        try {
            if (typeof ctx.on !== "function") return () => {};
            return ctx.on("internal/service", (serviceName) => {
                if (serviceName === "pluginPackages") officialMeta.tryPatch();
                if (serviceName === "pluginManager") bundleMeta.tryPatch();
            });
        } catch {
            return () => {};
        }
    }, "plugin-labels: watch the official metadata services");
    // Auto-translate: one pass a few seconds after startup fills missing labels,
    // so a newly installed plugin gets a Chinese name without any UI. Never
    // blocks startup; DSH_PLUGIN_LABELS_AUTO_TRANSLATE=0 turns it off.
    if (autoTranslateEnabled()) {
        ctx.effect(() => {
            const timer = setTimeout(() => {
                Promise.resolve()
                    .then(() => runAutoTranslate(ctx, home))
                    .catch(() => {});
            }, AUTO_TRANSLATE_DELAY_MS);
            try {
                if (typeof timer.unref === "function") timer.unref();
            } catch {
                // Some timer implementations cannot be unref'd.
            }
            return () => {
                try {
                    clearTimeout(timer);
                } catch {
                    // Already fired or cleared.
                }
            };
        }, "plugin-labels: auto-translate new plugins");
    }
    ctx.effect(() => ctx.webServer.register({
        kind: "exact",
        path: LIST_PATH,
        handler: (req, res) => handleList(home, req, res, () => ({
            ...officialMeta.status(),
            bundles: bundleMeta.status().patched,
        })),
    }), "plugin-labels: installed plugin list route");
    ctx.effect(() => ctx.webServer.register({
        kind: "exact",
        path: TRANSLATE_PATH,
        handler: (req, res) => guarded(res, req, () => handleTranslate(ctx, home, req, res)),
    }), "plugin-labels: translate route");
    ctx.effect(() => ctx.webServer.register({
        kind: "exact",
        path: LABEL_PATH,
        handler: (req, res) => guarded(res, req, () => handleLabel(home, req, res)),
    }), "plugin-labels: manual label route");
    ctx.effect(() => ctx.webServer.register({
        kind: "exact",
        path: IMPORT_PATH,
        handler: (req, res) => guarded(res, req, () => handleImport(home, req, res)),
    }), "plugin-labels: import labels route");
}
