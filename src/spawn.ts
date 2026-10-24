import type { Overlay, OverlayRoute } from './overlay.ts'
import { resolveRole } from './overlay.ts'
import { normalizeRole } from './roles.ts'

export interface SpawnRequest {
  readonly role: string
  readonly description: string
  readonly prompt: string
  readonly runInBackground: boolean
  readonly routeIndex?: number
}

export interface AgentOptions {
  provider?: string
  model?: string
  /** Route-owned effort id. Omit when the route exposes no effort field. */
  reasoningEffort?: string
}

export interface ResolvedSpawn {
  readonly role: string
  readonly description: string
  readonly prompt: string
  readonly runInBackground: boolean
  readonly inherit: boolean
  readonly agentOptions?: AgentOptions
  readonly route?: OverlayRoute
}

export function resolveSpawn(overlay: Overlay, request: SpawnRequest): ResolvedSpawn {
  const role = normalizeRole(request.role)
  const assignment = resolveRole(overlay, role)
  const inherit = assignment.inherit || assignment.routes.length === 0
  const index = request.routeIndex ?? 0
  const route = inherit ? undefined : assignment.routes[index] ?? assignment.routes[0]
  const agentOptions = route === undefined
    ? undefined
    : {
      provider: route.provider,
      model: route.model,
      ...route.reasoningEffort === undefined ? {} : { reasoningEffort: route.reasoningEffort },
    }
  return {
    role,
    description: request.description,
    prompt: request.prompt,
    runInBackground: request.runInBackground,
    inherit,
    ...agentOptions === undefined ? {} : { agentOptions },
    ...route === undefined ? {} : { route },
  }
}

/** Fields a skill may send on pstack_spawn. Official subagent has no model/effort fields. */
export const SPAWN_MODEL_FIELDS = ['description', 'prompt', 'role', 'run_in_background', 'route_index'] as const
