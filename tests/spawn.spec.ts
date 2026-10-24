import assert from 'node:assert/strict'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, it } from 'node:test'
import { parseSkillMarkdown } from '../src/frontmatter.ts'
import { emptyOverlay, parseOverlay } from '../src/overlay.ts'
import { normalizeRole } from '../src/roles.ts'
import { resolveSpawn } from '../src/spawn.ts'
import { spawnTool, type ActivationSpec, type SubagentHandle } from '../src/tools.ts'

describe('frontmatter', () => {
  it('maps Poteto Mode to kebab-case poteto-mode', () => {
    const parsed = parseSkillMarkdown(
      '---\nname: Poteto Mode\ndescription: poteto style\ndisable-model-invocation: true\n---\n\nBody\n',
      'poteto-mode',
    )
    assert.equal(parsed?.frontmatter.name, 'poteto-mode')
    assert.equal(parsed?.frontmatter.modelInvocable, false)
    assert.equal(parsed?.frontmatter.userInvocable, true)
  })

  it('drops a name that is not kebab-case', () => {
    const parsed = parseSkillMarkdown(
      '---\nname: Not Valid Name\ndescription: x\n---\n\nBody\n',
      'fallback',
    )
    assert.equal(parsed, undefined)
  })
})

describe('resolveSpawn', () => {
  it('inherits when the overlay is missing a mapping', () => {
    const resolved = resolveSpawn(emptyOverlay(), {
      role: 'feature',
      description: 'build flag',
      prompt: 'add --json',
      runInBackground: true,
    })
    assert.equal(resolved.inherit, true)
    assert.equal(resolved.agentOptions, undefined)
  })

  it('puts the route effort in agentOptions, not on the spawn schema', () => {
    const overlay = parseOverlay(JSON.stringify({
      version: 1,
      roles: {
        feature: {
          inherit: false,
          routes: [{ provider: 'opencode-go', model: 'grok-4.7', reasoningEffort: 'xhigh' }],
        },
        'interrogate-reviewers': {
          inherit: false,
          routes: [
            { provider: 'opencode-go', model: 'gpt-5.6-luna', reasoningEffort: 'xhigh' },
            { provider: 'opencode-go', model: 'qwen3.8-max' },
          ],
        },
      },
    }))
    const resolved = resolveSpawn(overlay, {
      role: 'generalPurpose',
      description: 'ad hoc',
      prompt: 'help',
      runInBackground: true,
    })
    assert.equal(normalizeRole('generalPurpose'), 'poteto-agent')
    assert.equal(resolved.role, 'poteto-agent')
    assert.equal(resolved.inherit, true)

    const feature = resolveSpawn(overlay, {
      role: 'feature',
      description: 'build flag',
      prompt: 'add --json',
      runInBackground: true,
    })
    assert.equal(feature.inherit, false)
    assert.deepEqual(feature.agentOptions, {
      provider: 'opencode-go',
      model: 'grok-4.7',
      reasoningEffort: 'xhigh',
    })

    const secondReviewer = resolveSpawn(overlay, {
      role: 'interrogate-reviewers',
      description: 'review',
      prompt: 'review it',
      runInBackground: true,
      routeIndex: 1,
    })
    assert.deepEqual(secondReviewer.agentOptions, { provider: 'opencode-go', model: 'qwen3.8-max' })
  })
})

describe('retired how-critics spawn', () => {
  for (const background of [undefined, false, true]) {
    it(`starts zero agents with background=${background}`, async () => {
      let starts = 0
      const subagents: SubagentHandle = {
        async startActivation() {
          starts += 1
          return { childId: 'unexpected-child', result: Promise.resolve({ output: 'unexpected' }) }
        },
      }
      const tool = spawnTool({ subagents, dshHome: await mkdtemp(join(tmpdir(), 'pstack-dsh-')) })
      const result = await tool.execute({
        role: 'how-critics',
        description: 'Legacy critic request',
        prompt: 'Review this design',
        ...(background === undefined ? {} : { run_in_background: background }),
        route_index: 1,
      }, { agent: { id: 'parent' } })
      assert.deepEqual(result, {
        kind: 'disabled',
        role: 'how-critics',
        reason: 'how-critics was retired in pstack 0.15; no agent was started.',
      })
      assert.equal(starts, 0)
    })
  }
})

describe('pstack_spawn on the 0.2.1 activation API', () => {
  it('starts a background child with parent delivery and the persona in the prompt', async () => {
    let spec: ActivationSpec | undefined
    const subagents: SubagentHandle = {
      async startActivation(input) {
        spec = input
        return { childId: 'child-1', result: Promise.resolve({ output: 'done' }) }
      },
    }
    const tool = spawnTool({ subagents, dshHome: await mkdtemp(join(tmpdir(), 'pstack-dsh-')) })
    const result = await tool.execute({
      role: 'comment-sicko',
      description: 'strip comments',
      prompt: 'Review this diff',
    }, { agent: { id: 'parent' } })
    assert.deepEqual(result, {
      kind: 'background',
      subagentId: 'child-1',
      role: 'comment-sicko',
      inherit: true,
    })
    assert.equal(spec?.delivery, 'parent')
    assert.equal(spec?.provider, 'spawn')
    assert.match(JSON.stringify(spec?.request), /Comment Sicko/)
    assert.match(JSON.stringify(spec?.request), /Review this diff/)
  })

  it('awaits a foreground child with caller delivery', async () => {
    let spec: ActivationSpec | undefined
    const subagents: SubagentHandle = {
      async startActivation(input) {
        spec = input
        return {
          childId: 'child-2',
          result: Promise.resolve({ output: [{ type: 'text', text: 'answer' }], stopReason: 'completed' }),
          async dispose() {},
        }
      },
    }
    const tool = spawnTool({ subagents, dshHome: await mkdtemp(join(tmpdir(), 'pstack-dsh-')) })
    const result = await tool.execute({
      role: 'how-explainer',
      description: 'explain',
      prompt: 'explain it',
      run_in_background: false,
    }, { agent: { id: 'parent' } })
    assert.equal(spec?.delivery, 'caller')
    assert.deepEqual(result, {
      kind: 'foreground',
      subagentId: 'child-2',
      role: 'how-explainer',
      inherit: true,
      output: [{ type: 'text', text: 'answer' }],
      stopReason: 'completed',
    })
  })
})
