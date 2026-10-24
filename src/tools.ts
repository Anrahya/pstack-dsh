import type { ParameterSchemaSpec } from '@deepseek-ai/dsh-tools'
import type { CatalogHost } from './catalog.ts'
import { buildCatalog } from './catalog.ts'
import {
  parseOverlay,
  readOverlay,
  validateOverlayAgainstCatalog,
  writeOverlay,
  type Overlay,
} from './overlay.ts'
import { resolveDshHome } from './home.ts'
import { loadPersona } from './persona.ts'
import { resolveSpawn } from './spawn.ts'
import { normalizeRole } from './roles.ts'
import {
  SPAWN_PROVIDER,
  TOOL_CATALOG,
  TOOL_OVERLAY_READ,
  TOOL_OVERLAY_WRITE,
  TOOL_SPAWN,
} from './ids.ts'

export interface ToolDefinition {
  name: string
  description: string
  parameters: ParameterSchemaSpec
  execute(args: Record<string, unknown>, exec: { signal?: AbortSignal; agent?: { id: string } }): Promise<unknown>
}

export interface ActivationHandle {
  readonly childId: string
  readonly result: Promise<{ output?: unknown; stopReason?: string }>
  dispose?(): Promise<void> | void
}

export interface ActivationSpec {
  readonly provider: string
  readonly label?: string
  readonly request: Record<string, unknown>
  readonly signal?: AbortSignal
  readonly delivery: 'parent' | 'caller'
}

export interface SubagentHandle {
  startActivation(spec: ActivationSpec): Promise<ActivationHandle>
}

export interface ToolHost {
  llm?: CatalogHost['llm']
  credentials?: CatalogHost['credentials']
  settings?: CatalogHost['settings']
  subagents?: SubagentHandle
  dshHome?: string
  env?: NodeJS.ProcessEnv
  spawnProvider?: string
}

function textPrompt(prompt: string): unknown[] {
  return [{ type: 'text', text: prompt }]
}

export function catalogTool(host: ToolHost): ToolDefinition {
  return {
    name: TOOL_CATALOG,
    description:
      'List live DSH LLM routes pstack may use: registered adapters with a logged-in API key, plus OAuth store routes (dsh-oauth-login, dsh-antigravity-oauth) that are already signed in. Never a vendor catalog. Secrets are omitted.',
    parameters: {},
    async execute(_args, exec) {
      return buildCatalog({
        llm: host.llm,
        credentials: host.credentials,
        settings: host.settings,
        dshHome: host.dshHome,
        env: host.env,
      }, exec.signal)
    },
  }
}

export function overlayReadTool(host: ToolHost): ToolDefinition {
  return {
    name: TOOL_OVERLAY_READ,
    description: 'Read $DSH_HOME/pstack-dsh.json. Missing file means inherit the parent conversation for every role.',
    parameters: {},
    async execute() {
      const current = await readOverlay(host.dshHome ?? resolveDshHome(host.env))
      return {
        path: current.path,
        missing: current.missing,
        overlay: current.overlay,
      }
    },
  }
}

export function overlayWriteTool(host: ToolHost): ToolDefinition {
  return {
    name: TOOL_OVERLAY_WRITE,
    description:
      'Write $DSH_HOME/pstack-dsh.json after validating every provider/model/effort against pstack_catalog. inherit-parent is stored as inherit: true with empty routes.',
    parameters: {
      overlay: {
        type: 'json',
        required: true,
        description: 'Full overlay object { version: 1, roles: { <role>: { inherit, routes } } }',
      },
    },
    async execute(args) {
      const overlay = typeof args.overlay === 'string'
        ? parseOverlay(args.overlay)
        : parseOverlay(JSON.stringify(args.overlay))
      const catalog = await buildCatalog({
        llm: host.llm,
        credentials: host.credentials,
        settings: host.settings,
        dshHome: host.dshHome,
        env: host.env,
      })
      const errors = validateOverlayAgainstCatalog(overlay, catalog.routes)
      if (errors.length > 0) {
        throw new Error(`overlay rejected against live catalog:\n${errors.join('\n')}`)
      }
      const path = await writeOverlay(overlay, host.dshHome ?? resolveDshHome(host.env))
      return { path, overlay }
    },
  }
}

export function spawnTool(host: ToolHost): ToolDefinition {
  return {
    name: TOOL_SPAWN,
    description:
      'Delegate a pstack role to a DSH subagent via the spawn provider. Send description, prompt, role, and optional run_in_background or route_index. Do not send model, provider, effort, thinking, isolation, or subagent_type. Every role inherits the main session route unless $DSH_HOME/pstack-dsh.json pins it.',
    parameters: {
      description: {
        type: 'string',
        required: true,
        description: 'A short (3-5 word) description of the delegated task, for display.',
      },
      prompt: {
        type: 'string',
        required: true,
        description: 'The complete, self-contained task. The child does not see this conversation.',
      },
      role: {
        type: 'string',
        required: true,
        description: 'pstack role key (feature, how-explainer, poteto-agent, comment-sicko, …).',
      },
      run_in_background: {
        type: 'boolean',
        description: 'Default true. The call returns after the child starts; its output arrives as a completion notice.',
      },
      route_index: {
        type: 'number',
        description: 'Which overlay route to use for a panel role. Default 0.',
      },
    },
    async execute(args, exec) {
      const parent = exec.agent
      if (parent === undefined) throw new Error('pstack_spawn requires a calling agent')
      const subagents = host.subagents
      if (subagents === undefined) throw new Error('pstack_spawn requires ctx.subagents')
      const role = normalizeRole(String(args.role ?? ''))
      if (role === 'how-critics') {
        return { kind: 'disabled', role, reason: 'how-critics was retired in pstack 0.15; no agent was started.' }
      }
      if (role.length === 0) throw new Error('pstack_spawn role is required')
      const overlay: Overlay = (await readOverlay(host.dshHome ?? resolveDshHome(host.env))).overlay
      const resolved = resolveSpawn(overlay, {
        role,
        description: String(args.description ?? ''),
        prompt: String(args.prompt ?? ''),
        runInBackground: args.run_in_background !== false,
        routeIndex: typeof args.route_index === 'number' ? args.route_index : undefined,
      })
      if (resolved.description.trim().length === 0) throw new Error('description is required')
      if (resolved.prompt.trim().length === 0) throw new Error('prompt is required')

      const persona = await loadPersona(resolved.role)
      const prompt = persona === undefined
        ? resolved.prompt
        : `${persona}\n\n---\n\n${resolved.prompt}`
      const providerName = host.spawnProvider ?? SPAWN_PROVIDER
      const request: Record<string, unknown> = {
        prompt: textPrompt(prompt),
        parent,
        ...resolved.agentOptions === undefined ? {} : { agentOptions: resolved.agentOptions },
      }

      const activation = await subagents.startActivation({
        provider: providerName,
        label: resolved.description,
        request,
        signal: exec.signal,
        delivery: resolved.runInBackground ? 'parent' : 'caller',
      })

      if (resolved.runInBackground) {
        return {
          kind: 'background',
          subagentId: activation.childId,
          role: resolved.role,
          inherit: resolved.inherit,
        }
      }

      const result = await activation.result
      await Promise.resolve(activation.dispose?.())
      return {
        kind: 'foreground',
        subagentId: activation.childId,
        role: resolved.role,
        inherit: resolved.inherit,
        output: result.output ?? null,
        stopReason: result.stopReason ?? 'completed',
      }
    },
  }
}

export const ALL_TOOLS = [catalogTool, overlayReadTool, overlayWriteTool, spawnTool] as const
