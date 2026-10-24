/**
 * pstack-dsh: DeepSeek Harness port of official pstack.
 * Function/namespace plugin: named apply, no default export.
 */

import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-skill'
import { defineTool } from '@deepseek-ai/dsh-tools'
import { snapshotJsonValue, type JsonValue } from '@deepseek-ai/dsh-util-values'
import { BOOT_MARKER, PLUGIN_ID, SPAWN_PROVIDER } from './ids.ts'
import { Config, type Config as PluginConfig } from './plugin-config.ts'
import { createSkillProvider } from './skills-provider.ts'
import {
  catalogTool,
  overlayReadTool,
  overlayWriteTool,
  spawnTool,
  type ToolHost,
} from './tools.ts'

export const name = PLUGIN_ID
export const inject = ['tools', 'skills']
export { Config }
export type { PluginConfig as ConfigType }

const JSON_OUTPUT = {
  schema: { type: 'json' as const },
  render: (_args: unknown, value: JsonValue) => [{ type: 'text' as const, text: JSON.stringify(value, null, 2) }],
}

function asHost(ctx: Context, config: PluginConfig | undefined): ToolHost {
  return {
    get llm() { return ctx.get('llm') as ToolHost['llm'] },
    get credentials() { return ctx.get('credentials') as ToolHost['credentials'] },
    get settings() { return ctx.get('settings') as ToolHost['settings'] },
    get subagents() { return ctx.get('subagents') as ToolHost['subagents'] },
    spawnProvider: config?.spawnProvider ?? SPAWN_PROVIDER,
  }
}

function registerOne(ctx: Context, tool: ReturnType<typeof catalogTool>): void {
  ctx.tools.register(defineTool({
    name: tool.name,
    description: tool.description,
    parameters: tool.parameters,
    output: JSON_OUTPUT,
    async execute(args: Record<string, unknown>, exec: { signal?: AbortSignal; agent?: { id: string } }): Promise<JsonValue> {
      const snapshot = snapshotJsonValue(await tool.execute(args, exec))
      if (snapshot === undefined) throw new TypeError(`pstack tool ${tool.name} returned a non-JSON value`)
      return snapshot as JsonValue
    },
  }))
}

export function apply(ctx: Context, config?: PluginConfig): void {
  console.log(BOOT_MARKER)
  const host = asHost(ctx, config)
  registerOne(ctx, catalogTool(host))
  registerOne(ctx, overlayReadTool(host))
  registerOne(ctx, overlayWriteTool(host))
  registerOne(ctx, spawnTool(host))
  ctx.skills.registerProvider(() => createSkillProvider())
}
