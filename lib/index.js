import { defineTool } from "@deepseek-ai/dsh-tools";
import { snapshotJsonValue } from "@deepseek-ai/dsh-util-values";
import { readFile, readdir } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { homedir } from "node:os";
import { writeFileAtomic } from "@deepseek-ai/dsh-atomic-write";
//#region src/ids.ts
/** Startup line the host can look for. */
const BOOT_MARKER = "[pstack-dsh] loaded";
/** Cordis plugin / Loader row id. */
const PLUGIN_ID = "pstack-dsh";
/** Bundled skill provider name on `ctx.skills`. */
const SKILL_PROVIDER_NAME = "pstack-dsh";
/** Overlay file under `$DSH_HOME`. */
const OVERLAY_FILENAME = "pstack-dsh.json";
/** DSH-owned OAuth store from dsh-oauth-login. Never ~/.pi / ~/.codex / ~/.claude / grok CLI. */
const OAUTH_AUTH_FILENAME = ".dsh-oauth-auth.json";
const OAUTH_AUTH_LEGACY_FILENAME = ".pi-login-auth.json";
/** Antigravity OAuth store from dsh-antigravity-oauth. */
const ANTIGRAVITY_AUTH_FILENAME = ".dsh-antigravity-oauth.json";
/** Official DeepSeek adapter. */
const DEEPSEEK_API_KEY_ENV = "DEEPSEEK_API_KEY";
/** Model-facing tool names this plugin registers. */
const TOOL_CATALOG = "pstack_catalog";
const TOOL_SPAWN = "pstack_spawn";
const TOOL_OVERLAY_READ = "pstack_overlay_read";
const TOOL_OVERLAY_WRITE = "pstack_overlay_write";
//#endregion
//#region src/plugin-config.ts
const Config = { "~standard": {
	version: 1,
	vendor: "pstack-dsh",
	validate(value) {
		if (value === void 0 || value === null) return { value: { spawnProvider: "spawn" } };
		if (typeof value !== "object" || Array.isArray(value)) return { issues: [{ message: "config must be an object" }] };
		const spawnProvider = value.spawnProvider;
		if (spawnProvider !== void 0 && (typeof spawnProvider !== "string" || spawnProvider.length === 0)) return { issues: [{ message: "spawnProvider must be a non-empty string" }] };
		return { value: { spawnProvider: spawnProvider ?? "spawn" } };
	}
} };
//#endregion
//#region src/frontmatter.ts
const NAME_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
function unquote(value) {
	const trimmed = value.trim();
	if (trimmed.startsWith("\"") && trimmed.endsWith("\"") || trimmed.startsWith("'") && trimmed.endsWith("'")) return trimmed.slice(1, -1);
	return trimmed;
}
function parseBool(value, fallback) {
	if (value === void 0) return fallback;
	const normalized = unquote(value).trim().toLowerCase();
	if ([
		"true",
		"yes",
		"on",
		"1"
	].includes(normalized)) return true;
	if ([
		"false",
		"no",
		"off",
		"0"
	].includes(normalized)) return false;
	throw new Error(`invalid boolean "${value}"`);
}
/**
* Minimal YAML frontmatter reader for SKILL.md.
* Official keys: name, description, whenToUse, disable-model-invocation, user-invocable.
* `packages/skill/skill-filesystem/README.md`.
*/
function parseSkillMarkdown(text, fallbackName) {
	if (!text.startsWith("---")) return void 0;
	const end = text.indexOf("\n---", 3);
	if (end < 0) return void 0;
	const raw = text.slice(4, end);
	const body = text.slice(end + 4).replace(/^\s*\n/, "");
	const fields = {};
	for (const line of raw.split("\n")) {
		const match = /^([A-Za-z0-9_-]+):\s*(.*)$/.exec(line);
		if (!match) continue;
		fields[match[1]] = match[2] ?? "";
	}
	let name = unquote(fields.name ?? fallbackName);
	if (name === "Poteto Mode") name = "poteto-mode";
	if (!NAME_RE.test(name)) return void 0;
	const description = unquote(fields.description ?? "");
	if (description.length === 0) return void 0;
	try {
		const disableModel = parseBool(fields["disable-model-invocation"], false);
		const userInvocable = parseBool(fields["user-invocable"], true);
		return {
			frontmatter: {
				name,
				description,
				...fields.whenToUse ? { whenToUse: unquote(fields.whenToUse) } : {},
				modelInvocable: !disableModel,
				userInvocable
			},
			content: body.trimStart()
		};
	} catch {
		return;
	}
}
//#endregion
//#region src/skills-provider.ts
const BUNDLED_SKILL_RANK = 600;
function defaultSkillsRoot() {
	return join(dirname(fileURLToPath(import.meta.url)), "..", "skills");
}
async function loadSkills(root) {
	let entries = [];
	try {
		entries = await readdir(root);
	} catch {
		return [];
	}
	const records = [];
	for (const name of entries) {
		const dir = join(root, name);
		const path = join(dir, "SKILL.md");
		let text;
		try {
			text = await readFile(path, "utf8");
		} catch {
			continue;
		}
		const parsed = parseSkillMarkdown(text, name);
		if (parsed === void 0) continue;
		records.push({
			name: parsed.frontmatter.name,
			description: parsed.frontmatter.description,
			...parsed.frontmatter.whenToUse === void 0 ? {} : { whenToUse: parsed.frontmatter.whenToUse },
			modelInvocable: parsed.frontmatter.modelInvocable,
			userInvocable: parsed.frontmatter.userInvocable,
			content: parsed.content,
			dir
		});
	}
	return records.sort((a, b) => a.name.localeCompare(b.name));
}
function createSkillProvider(skillsRoot = defaultSkillsRoot()) {
	return {
		name: SKILL_PROVIDER_NAME,
		async list() {
			return (await loadSkills(skillsRoot)).map((skill) => ({
				name: skill.name,
				description: skill.description,
				...skill.whenToUse === void 0 ? {} : { whenToUse: skill.whenToUse },
				invocation: {
					modelInvocable: skill.modelInvocable,
					userInvocable: skill.userInvocable
				},
				provider: SKILL_PROVIDER_NAME,
				source: "bundled",
				resourceBase: {
					kind: "directory",
					path: skill.dir
				},
				rank: BUNDLED_SKILL_RANK,
				locator: skill.dir,
				path: join(skill.dir, "SKILL.md")
			}));
		},
		async get(candidate) {
			const skill = (await loadSkills(skillsRoot)).find((entry) => entry.name === candidate.name);
			if (skill === void 0) return void 0;
			return {
				name: skill.name,
				description: skill.description,
				...skill.whenToUse === void 0 ? {} : { whenToUse: skill.whenToUse },
				invocation: {
					modelInvocable: skill.modelInvocable,
					userInvocable: skill.userInvocable
				},
				provider: SKILL_PROVIDER_NAME,
				source: "bundled",
				resourceBase: {
					kind: "directory",
					path: skill.dir
				},
				content: skill.content,
				path: join(skill.dir, "SKILL.md")
			};
		}
	};
}
//#endregion
//#region src/home.ts
/** Official precedence: `$DSH_HOME`, then `~/.dsh`. `packages/util/home-paths/README.md`. */
function resolveDshHome(env = process.env) {
	const fromEnv = env.DSH_HOME?.trim();
	if (fromEnv) return resolve(fromEnv);
	return join(homedir(), ".dsh");
}
//#endregion
//#region src/catalog-types.ts
/** Hints for known logins whose adapter is missing; not an allowlist for live adapters. */
const OAUTH_ROUTE_BY_STORE_ID = {
	"openai-codex": "pi-openai-codex",
	anthropic: "pi-anthropic",
	xai: "pi-xai",
	"github-copilot": "pi-github-copilot",
	openrouter: "pi-openrouter",
	"kimi-coding": "pi-kimi-coding",
	antigravity: "agy-google-antigravity"
};
function storeIdForRoute(route) {
	if (route.startsWith("pi-") && route.length > 3) return route.slice(3);
	if (route === "agy-google-antigravity" || route.startsWith("agy-")) return "antigravity";
}
//#endregion
//#region src/roles.ts
/**
* pstack role keys used by playbooks and Settings → pstack.
* These are pstack names, not Cursor slugs and not grok-build `subagent_type` values.
*/
const SCALAR_ROLES = [
	"feature",
	"refactoring",
	"bug-fix",
	"perf-issue",
	"hillclimb",
	"judgment-and-prose",
	"hardest-tasks",
	"how-explorer",
	"how-explainer",
	"why-investigators",
	"why-synthesizer",
	"reflect-tooling",
	"reflect-judgment",
	"swarm-workers",
	"independent-verifier",
	"poteto-agent",
	"comment-sicko"
];
const PANEL_ROLES = [
	"how-critics",
	"arena-runners",
	"arena-cross-judge-pool",
	"architect-runners",
	"interrogate-reviewers"
];
const ALL_ROLES = [...SCALAR_ROLES, ...PANEL_ROLES];
function isPstackRole(value) {
	return ALL_ROLES.includes(value);
}
function isPanelRole(value) {
	return PANEL_ROLES.includes(value);
}
/** Alias accepted from Cursor-era skills. */
function normalizeRole(raw) {
	const trimmed = raw.trim();
	if (trimmed === "Comment Sicko" || trimmed === "comment sicko") return "comment-sicko";
	if (trimmed === "poteto-agent" || trimmed === "Poteto Agent") return "poteto-agent";
	if (trimmed === "generalPurpose" || trimmed === "general-purpose") return "poteto-agent";
	return trimmed;
}
function emptyOverlay() {
	const roles = {};
	for (const role of ALL_ROLES) roles[role] = {
		inherit: true,
		routes: []
	};
	return {
		version: 1,
		roles
	};
}
function routeKey(provider, model) {
	return `${provider}::${model}`;
}
function isRecord$1(value) {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}
function parseRoute(raw, path) {
	if (!isRecord$1(raw)) throw new Error(`${path} must be an object`);
	const provider = raw.provider;
	const model = raw.model;
	if (typeof provider !== "string" || provider.length === 0) throw new Error(`${path}.provider must be a non-empty string`);
	if (typeof model !== "string" || model.length === 0) throw new Error(`${path}.model must be a non-empty string`);
	const effort = raw.reasoningEffort;
	if (effort !== void 0 && (typeof effort !== "string" || effort.length === 0)) throw new Error(`${path}.reasoningEffort must be a non-empty string when set`);
	const extra = Object.keys(raw).filter((key) => key !== "provider" && key !== "model" && key !== "reasoningEffort");
	if (extra.length > 0) throw new Error(`${path} has unknown fields: ${extra.join(", ")}`);
	return effort === void 0 ? {
		provider,
		model
	} : {
		provider,
		model,
		reasoningEffort: effort
	};
}
function parseRole(raw, role) {
	if (!isRecord$1(raw)) throw new Error(`roles.${role} must be an object`);
	const extra = Object.keys(raw).filter((key) => key !== "inherit" && key !== "routes");
	if (extra.length > 0) throw new Error(`roles.${role} has unknown fields: ${extra.join(", ")}`);
	const inherit = raw.inherit === true || raw.inherit === "true" || raw.inherit === "inherit-parent" || raw.inherit === "auto";
	const routesRaw = raw.routes;
	const routes = Array.isArray(routesRaw) ? routesRaw.map((entry, index) => parseRoute(entry, `roles.${role}.routes[${index}]`)) : [];
	if (inherit) return {
		inherit: true,
		routes: []
	};
	if (routes.length === 0) return {
		inherit: true,
		routes: []
	};
	if (!isPanelRole(role) && routes.length !== 1) throw new Error(`roles.${role} is a scalar role and may have at most one route`);
	return {
		inherit: false,
		routes
	};
}
function parseOverlay(text) {
	let value;
	try {
		value = JSON.parse(text);
	} catch {
		throw new Error("pstack-dsh overlay is not valid JSON");
	}
	if (!isRecord$1(value)) throw new Error("pstack-dsh overlay must be an object");
	if (value.version !== 1) throw new Error(`pstack-dsh overlay version ${String(value.version)} is unsupported`);
	const extra = Object.keys(value).filter((key) => key !== "version" && key !== "roles");
	if (extra.length > 0) throw new Error(`pstack-dsh overlay has unknown fields: ${extra.join(", ")}`);
	const rolesRaw = value.roles;
	if (!isRecord$1(rolesRaw)) throw new Error("pstack-dsh overlay.roles must be an object");
	const roles = {};
	for (const role of ALL_ROLES) {
		const entry = rolesRaw[role];
		roles[role] = entry === void 0 ? {
			inherit: true,
			routes: []
		} : parseRole(entry, role);
	}
	for (const key of Object.keys(rolesRaw)) if (!isPstackRole(key)) throw new Error(`unknown pstack role "${key}"`);
	return {
		version: 1,
		roles
	};
}
function validateOverlayAgainstCatalog(overlay, routes) {
	const errors = [];
	const live = new Map(routes.filter((route) => route.selectable).map((route) => [routeKey(route.provider, route.model), route]));
	for (const role of ALL_ROLES) {
		if (role === "how-critics") continue;
		const assignment = overlay.roles[role] ?? {
			inherit: true,
			routes: []
		};
		if (assignment.inherit) continue;
		for (const [index, entry] of assignment.routes.entries()) {
			const found = live.get(routeKey(entry.provider, entry.model));
			if (found === void 0) {
				errors.push(`${role}[${index}]: ${entry.provider}/${entry.model} is not a logged-in live route`);
				continue;
			}
			if (entry.reasoningEffort === void 0) continue;
			if (found.efforts.length === 0) {
				errors.push(`${role}[${index}]: ${entry.provider}/${entry.model} has no effort field; omit reasoningEffort`);
				continue;
			}
			if (!found.efforts.some((effort) => effort.id === entry.reasoningEffort)) errors.push(`${role}[${index}]: effort "${entry.reasoningEffort}" is not accepted by ${entry.provider}/${entry.model} (live: ${found.efforts.map((effort) => effort.id).join(", ")})`);
		}
	}
	return errors;
}
function resolveRole(overlay, role) {
	const key = role;
	return overlay.roles[key] ?? {
		inherit: true,
		routes: []
	};
}
//#endregion
//#region src/overlay.ts
function overlayPath(dshHome = resolveDshHome()) {
	return join(dshHome, OVERLAY_FILENAME);
}
async function readOverlay(dshHome = resolveDshHome()) {
	const path = overlayPath(dshHome);
	try {
		return {
			path,
			overlay: parseOverlay(await readFile(path, "utf8")),
			missing: false
		};
	} catch (error) {
		if (error.code === "ENOENT") return {
			path,
			overlay: emptyOverlay(),
			missing: true
		};
		throw error;
	}
}
async function writeOverlay(overlay, dshHome = resolveDshHome()) {
	const path = overlayPath(dshHome);
	const body = `${JSON.stringify(overlay, null, 2)}\n`;
	await writeFileAtomic(path, body, {
		mode: 384,
		dirMode: 448
	});
	return path;
}
//#endregion
//#region src/catalog.ts
const API_KEY_REF = /^[A-Za-z_][A-Za-z0-9_]*$/;
function isRecord(value) {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}
function collectApiKeyEnvRefs(value, out) {
	if (Array.isArray(value)) {
		for (const item of value) collectApiKeyEnvRefs(item, out);
		return;
	}
	if (!isRecord(value)) return;
	for (const [key, child] of Object.entries(value)) if (key === "apiKeyEnv" && typeof child === "string" && API_KEY_REF.test(child)) out.add(child);
	else collectApiKeyEnvRefs(child, out);
}
function sliceAtPath(value, path) {
	let current = value;
	for (const segment of path) {
		if (!isRecord(current)) return void 0;
		current = current[segment];
	}
	return current;
}
function settingsValue(entry) {
	if (!isRecord(entry)) return void 0;
	return entry.value ?? entry.base ?? entry.user;
}
function settingsNs(entry) {
	if (!isRecord(entry)) return void 0;
	return typeof entry.ns === "string" ? entry.ns : void 0;
}
async function refConfigured(credentials, env, ref) {
	if (credentials !== void 0) try {
		return (await credentials.describe(ref)).configured === true;
	} catch {
		return false;
	}
	const ambient = env[ref];
	return typeof ambient === "string" && ambient.trim().length > 0;
}
async function readOauthStoreIds(dshHome) {
	const candidates = [join(dshHome, OAUTH_AUTH_FILENAME), join(dshHome, OAUTH_AUTH_LEGACY_FILENAME)];
	let present = false;
	const ids = /* @__PURE__ */ new Set();
	for (const filename of candidates) try {
		const text = await readFile(filename, "utf8");
		const parsed = JSON.parse(text);
		if (!isRecord(parsed) || !isRecord(parsed.credentials)) continue;
		present = true;
		for (const key of Object.keys(parsed.credentials)) ids.add(key);
		break;
	} catch (error) {
		if (error.code === "ENOENT") continue;
		present = true;
		break;
	}
	try {
		const text = await readFile(join(dshHome, ANTIGRAVITY_AUTH_FILENAME), "utf8");
		const parsed = JSON.parse(text);
		if (isRecord(parsed) && isRecord(parsed.credential)) {
			present = true;
			const cred = parsed.credential;
			if (cred.type === "oauth" && typeof cred.projectId === "string" && cred.projectId.trim().length > 0 && typeof cred.expires === "number" && cred.expires > 0) ids.add("antigravity");
		}
	} catch (error) {
		if (error.code !== "ENOENT") present = true;
	}
	return {
		present,
		ids: [...ids]
	};
}
function effortsOf(info) {
	const reasoning = info.reasoning;
	if (reasoning === void 0 || !Array.isArray(reasoning.efforts)) return { efforts: [] };
	return {
		efforts: reasoning.efforts.map((effort) => ({
			id: effort.id,
			name: effort.name,
			...effort.description === void 0 ? {} : { description: effort.description }
		})),
		...reasoning.defaultEffort === void 0 ? {} : { defaultEffort: reasoning.defaultEffort }
	};
}
/**
* Live logged-in routes only. No vendor catalog. No invented slugs.
*/
async function buildCatalog(host, signal) {
	const dshHome = host.dshHome ?? resolveDshHome(host.env);
	const env = host.env ?? process.env;
	const overlay = await readOverlay(dshHome);
	const oauth = await readOauthStoreIds(dshHome);
	const llm = host.llm;
	const providers = llm?.listProviders() ?? [];
	const registered = new Set(providers.map((provider) => provider.id));
	const oauthPluginPresent = [...registered].some((id) => id.startsWith("pi-") || id === "agy-google-antigravity" || id.startsWith("agy-"));
	const recommendOauthLogin = oauth.ids.length === 0 && !oauthPluginPresent;
	const refsByProvider = /* @__PURE__ */ new Map();
	const remember = (provider, ref) => {
		const set = refsByProvider.get(provider) ?? /* @__PURE__ */ new Set();
		set.add(ref);
		refsByProvider.set(provider, set);
	};
	if (host.settings !== void 0) {
		let described = [];
		try {
			described = host.settings.describe({ redactSecrets: true });
		} catch {
			described = [];
		}
		const configurable = llm?.listConfigurableProviders?.() ?? [];
		for (const entry of described) {
			const ns = settingsNs(entry);
			const value = settingsValue(entry);
			for (const row of configurable) {
				if (ns !== void 0 && row.settingsNs !== ns) continue;
				const slice = row.settingsPath.length === 0 ? value : sliceAtPath(value, row.settingsPath);
				const refs = /* @__PURE__ */ new Set();
				collectApiKeyEnvRefs(slice ?? value, refs);
				for (const ref of refs) remember(row.provider, ref);
			}
		}
	}
	for (const provider of providers) if (provider.id === "deepseek-official") remember(provider.id, DEEPSEEK_API_KEY_ENV);
	const routes = [];
	const seen = /* @__PURE__ */ new Set();
	const push = (route) => {
		const key = `${route.provider}::${route.model}`;
		if (seen.has(key)) return;
		seen.add(key);
		routes.push(route);
	};
	if (llm !== void 0) for (const provider of providers) {
		const storeId = storeIdForRoute(provider.id);
		const oauthSignedIn = storeId !== void 0 && oauth.ids.includes(storeId);
		let models = [];
		try {
			models = await llm.listModels(provider.id);
		} catch {
			models = [];
		}
		if (models.length === 0) continue;
		const refs = [...refsByProvider.get(provider.id) ?? []];
		let keyPresent = false;
		for (const ref of refs) if (await refConfigured(host.credentials, env, ref)) {
			keyPresent = true;
			break;
		}
		const selectable = oauthSignedIn || keyPresent;
		const source = oauthSignedIn ? "oauth" : "api-key";
		if (!selectable) continue;
		for (const model of models) {
			let resolved;
			try {
				resolved = await llm.resolveModelInfo(provider.id, model.id, signal);
			} catch {
				resolved = {
					id: model.id,
					name: model.name
				};
			}
			const { efforts, defaultEffort } = effortsOf(resolved);
			push({
				provider: provider.id,
				providerName: provider.name,
				model: model.id,
				modelName: resolved.name || model.name,
				selectable: true,
				source,
				...oauthSignedIn ? { oauthSignedIn: true } : {},
				routeRegistered: true,
				efforts,
				...defaultEffort === void 0 ? {} : { defaultEffort }
			});
		}
	}
	for (const id of oauth.ids) {
		const route = OAUTH_ROUTE_BY_STORE_ID[id];
		if (route === void 0) continue;
		if (registered.has(route)) continue;
		const isAntigravity = id === "antigravity" || route === "agy-google-antigravity";
		push({
			provider: route,
			providerName: isAntigravity ? "Google Antigravity" : id,
			model: "*",
			modelName: isAntigravity ? "(install dsh-antigravity-oauth to load this route)" : "(install dsh-oauth-login to load this route)",
			selectable: false,
			source: "oauth",
			oauthSignedIn: true,
			routeRegistered: false,
			efforts: [],
			hint: isAntigravity ? "Signed in at $DSH_HOME/.dsh-antigravity-oauth.json. Install dsh-antigravity-oauth so the route is live." : "Signed in at $DSH_HOME/.dsh-oauth-auth.json. Install https://github.com/aa2246740/dsh-oauth-login so the route is live."
		});
	}
	const selectableCount = routes.filter((route) => route.selectable).length;
	return {
		routes,
		selectableCount,
		oauthPluginPresent,
		oauthStorePresent: oauth.present,
		oauthSignedInProviders: oauth.ids,
		overlayPath: overlay.path,
		overlayMissing: overlay.missing,
		inheritParent: true,
		recommendOauthLogin,
		...selectableCount === 0 ? { emptyReason: recommendOauthLogin ? "No logged-in API key and no dsh-oauth-login or dsh-antigravity-oauth store. Children inherit this conversation. Add a key in DSH, or install/login https://github.com/aa2246740/dsh-oauth-login / dsh-antigravity-oauth." : "No selectable live route. Children inherit this conversation." } : {}
	};
}
//#endregion
//#region src/persona.ts
function defaultAgentsRoot() {
	return join(dirname(fileURLToPath(import.meta.url)), "..", "agents");
}
function stripFrontmatter(text) {
	if (!text.startsWith("---")) return text;
	const end = text.indexOf("\n---", 3);
	if (end < 0) return text;
	return text.slice(end + 4).replace(/^\s*\n/, "");
}
/**
* Persona for a pstack role. Official spawn persona shadows deployment persona
* (`SubagentStartRequest.persona`, `packages/subagent/subagent/src/types.ts`).
*/
async function loadPersona(role, agentsRoot = defaultAgentsRoot()) {
	const key = normalizeRole(role);
	const files = key === "comment-sicko" ? ["comment-sicko.md"] : key === "poteto-agent" ? ["poteto-agent.md"] : [`${key}.md`, "poteto-agent.md"];
	for (const file of files) try {
		const body = stripFrontmatter(await readFile(join(agentsRoot, file), "utf8")).trim();
		if (body.length > 0) return body;
	} catch {
		continue;
	}
}
//#endregion
//#region src/spawn.ts
function resolveSpawn(overlay, request) {
	const role = normalizeRole(request.role);
	const assignment = resolveRole(overlay, role);
	const inherit = assignment.inherit || assignment.routes.length === 0;
	const index = request.routeIndex ?? 0;
	const route = inherit ? void 0 : assignment.routes[index] ?? assignment.routes[0];
	const agentOptions = route === void 0 ? void 0 : {
		provider: route.provider,
		model: route.model,
		...route.reasoningEffort === void 0 ? {} : { reasoningEffort: route.reasoningEffort }
	};
	return {
		role,
		description: request.description,
		prompt: request.prompt,
		runInBackground: request.runInBackground,
		inherit,
		...agentOptions === void 0 ? {} : { agentOptions },
		...route === void 0 ? {} : { route }
	};
}
//#endregion
//#region src/tools.ts
function textPrompt(prompt) {
	return [{
		type: "text",
		text: prompt
	}];
}
function catalogTool(host) {
	return {
		name: TOOL_CATALOG,
		description: "List live DSH LLM routes pstack may use: registered adapters with a logged-in API key, plus OAuth store routes (dsh-oauth-login, dsh-antigravity-oauth) that are already signed in. Never a vendor catalog. Secrets are omitted.",
		parameters: {},
		async execute(_args, exec) {
			return buildCatalog({
				llm: host.llm,
				credentials: host.credentials,
				settings: host.settings,
				dshHome: host.dshHome,
				env: host.env
			}, exec.signal);
		}
	};
}
function overlayReadTool(host) {
	return {
		name: TOOL_OVERLAY_READ,
		description: "Read $DSH_HOME/pstack-dsh.json. Missing file means inherit the parent conversation for every role.",
		parameters: {},
		async execute() {
			const current = await readOverlay(host.dshHome ?? resolveDshHome(host.env));
			return {
				path: current.path,
				missing: current.missing,
				overlay: current.overlay
			};
		}
	};
}
function overlayWriteTool(host) {
	return {
		name: TOOL_OVERLAY_WRITE,
		description: "Write $DSH_HOME/pstack-dsh.json after validating every provider/model/effort against pstack_catalog. inherit-parent is stored as inherit: true with empty routes.",
		parameters: { overlay: {
			type: "json",
			required: true,
			description: "Full overlay object { version: 1, roles: { <role>: { inherit, routes } } }"
		} },
		async execute(args) {
			const overlay = typeof args.overlay === "string" ? parseOverlay(args.overlay) : parseOverlay(JSON.stringify(args.overlay));
			const errors = validateOverlayAgainstCatalog(overlay, (await buildCatalog({
				llm: host.llm,
				credentials: host.credentials,
				settings: host.settings,
				dshHome: host.dshHome,
				env: host.env
			})).routes);
			if (errors.length > 0) throw new Error(`overlay rejected against live catalog:\n${errors.join("\n")}`);
			return {
				path: await writeOverlay(overlay, host.dshHome ?? resolveDshHome(host.env)),
				overlay
			};
		}
	};
}
function spawnTool(host) {
	return {
		name: TOOL_SPAWN,
		description: "Delegate a pstack role to a DSH subagent via the spawn provider. Send description, prompt, role, and optional run_in_background or route_index. Do not send model, provider, effort, thinking, isolation, or subagent_type. Every role inherits the main session route unless $DSH_HOME/pstack-dsh.json pins it.",
		parameters: {
			description: {
				type: "string",
				required: true,
				description: "A short (3-5 word) description of the delegated task, for display."
			},
			prompt: {
				type: "string",
				required: true,
				description: "The complete, self-contained task. The child does not see this conversation."
			},
			role: {
				type: "string",
				required: true,
				description: "pstack role key (feature, how-explainer, poteto-agent, comment-sicko, …)."
			},
			run_in_background: {
				type: "boolean",
				description: "Default true. The call returns after the child starts; its output arrives as a completion notice."
			},
			route_index: {
				type: "number",
				description: "Which overlay route to use for a panel role. Default 0."
			}
		},
		async execute(args, exec) {
			const parent = exec.agent;
			if (parent === void 0) throw new Error("pstack_spawn requires a calling agent");
			const subagents = host.subagents;
			if (subagents === void 0) throw new Error("pstack_spawn requires ctx.subagents");
			const role = normalizeRole(String(args.role ?? ""));
			if (role === "how-critics") return {
				kind: "disabled",
				role,
				reason: "how-critics was retired in pstack 0.15; no agent was started."
			};
			if (role.length === 0) throw new Error("pstack_spawn role is required");
			const overlay = (await readOverlay(host.dshHome ?? resolveDshHome(host.env))).overlay;
			const resolved = resolveSpawn(overlay, {
				role,
				description: String(args.description ?? ""),
				prompt: String(args.prompt ?? ""),
				runInBackground: args.run_in_background !== false,
				routeIndex: typeof args.route_index === "number" ? args.route_index : void 0
			});
			if (resolved.description.trim().length === 0) throw new Error("description is required");
			if (resolved.prompt.trim().length === 0) throw new Error("prompt is required");
			const persona = await loadPersona(resolved.role);
			const prompt = persona === void 0 ? resolved.prompt : `${persona}\n\n---\n\n${resolved.prompt}`;
			const providerName = host.spawnProvider ?? "spawn";
			const request = {
				prompt: textPrompt(prompt),
				parent,
				...resolved.agentOptions === void 0 ? {} : { agentOptions: resolved.agentOptions }
			};
			const activation = await subagents.startActivation({
				provider: providerName,
				label: resolved.description,
				request,
				signal: exec.signal,
				delivery: resolved.runInBackground ? "parent" : "caller"
			});
			if (resolved.runInBackground) return {
				kind: "background",
				subagentId: activation.childId,
				role: resolved.role,
				inherit: resolved.inherit
			};
			const result = await activation.result;
			await Promise.resolve(activation.dispose?.());
			return {
				kind: "foreground",
				subagentId: activation.childId,
				role: resolved.role,
				inherit: resolved.inherit,
				output: result.output ?? null,
				stopReason: result.stopReason ?? "completed"
			};
		}
	};
}
//#endregion
//#region src/index.ts
const name = PLUGIN_ID;
const inject = ["tools", "skills"];
const JSON_OUTPUT = {
	schema: { type: "json" },
	render: (_args, value) => [{
		type: "text",
		text: JSON.stringify(value, null, 2)
	}]
};
function asHost(ctx, config) {
	return {
		get llm() {
			return ctx.get("llm");
		},
		get credentials() {
			return ctx.get("credentials");
		},
		get settings() {
			return ctx.get("settings");
		},
		get subagents() {
			return ctx.get("subagents");
		},
		spawnProvider: config?.spawnProvider ?? "spawn"
	};
}
function registerOne(ctx, tool) {
	ctx.tools.register(defineTool({
		name: tool.name,
		description: tool.description,
		parameters: tool.parameters,
		output: JSON_OUTPUT,
		async execute(args, exec) {
			const snapshot = snapshotJsonValue(await tool.execute(args, exec));
			if (snapshot === void 0) throw new TypeError(`pstack tool ${tool.name} returned a non-JSON value`);
			return snapshot;
		}
	}));
}
function apply(ctx, config) {
	console.log(BOOT_MARKER);
	const host = asHost(ctx, config);
	registerOne(ctx, catalogTool(host));
	registerOne(ctx, overlayReadTool(host));
	registerOne(ctx, overlayWriteTool(host));
	registerOne(ctx, spawnTool(host));
	ctx.skills.registerProvider(() => createSkillProvider());
}
//#endregion
export { Config, apply, inject, name };
