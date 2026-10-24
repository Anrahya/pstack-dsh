# DSH harness map

This port carries pstack 0.15.32's 57 skills, 23 playbooks, and 24 principles, with DSH call sites and model-invocable principles. `make-bot-ui` is excluded because it targets a Cursor/Grok bot surface.

Target: **DSH 0.2.1-rc.3**. Peer range: `>=0.2.1-rc.1 <0.3.0`.

Sources: official pstack (`cursor/plugins` `pstack/`) and official DeepSeek Harness. Tool names and fields below are from DSH source, not from Cursor `Task`.

## Verdict

**Yes. The discipline ports. Cursor and Grok runtimes do not.**

Install as a DSH plugin with `dsh plugin add`, or from Settings → Plugins. Do not write `~/.cursor/rules`. Do not invent Cursor panel slugs. Do not send grok `task` fields. Out of the box, every child inherits the main session route. Review roles may be pinned in `$DSH_HOME/pstack-dsh.json`. There is no Settings page.

## Mapping: pstack need → DSH API

| pstack need | DSH API | Source |
|---|---|---|
| Slash skill / poteto-mode | `ctx.skills` provider + `dsh-tool-skill` `skill` tool. User `/name` injection. Frontmatter: kebab-case `name`, `description`, optional `whenToUse`, `disable-model-invocation`, `user-invocable`. | `packages/skill/tool-skill/README.md`; `docs/subsystems/skills.md`; `packages/skill/skill-filesystem/README.md` |
| Plugin install | npm bundle `dsh.bundle.patch` → `dsh plugin --profile web add github:Anrahya/pstack-dsh#v0.3.0` | `docs/user/develop/basic/publish.md` |
| Role config | `$DSH_HOME/pstack-dsh.json`, read and validated by this plugin. No client bundle, no web routes, no settings slot. | this repository |
| Spawn child | Model-facing official `subagent` takes only `description`, `prompt`, `run_in_background`. This plugin's `pstack_spawn` adds `role` and `route_index`. Internally `ctx.subagents.startActivation`. | `packages/subagent/tool-subagent/README.md`; `packages/subagent/subagent/README.md` |
| Per-child model | `AgentOptions` `{ provider?, model?, reasoningEffort?, maxTokens? }` on the activation request. Not a model-facing field on `subagent` unless the Host enables model selection. Omit it to inherit the parent. | `packages/core/agent/src/runtime-types.ts`; `packages/subagent/subagent/src/types.ts` |
| Per-role reasoning effort | `AgentOptions.reasoningEffort`, set at spawn. Only ids the route lists. Empty efforts: omit. | `packages/llm/llm/src/types.ts` `LlmModelReasoningInfo`; `packages/subagent/tool-subagent/README.md` |
| Wait | `delivery: 'parent'` gives a settlement notice and `send_message`; `delivery: 'caller'` awaits the activation result. | tool-subagent README; subagent README |
| Cancel | `interrupt_agent` for a live child; `job_kill` for a job. | `docs/tool-catalog.md` |
| Isolation / worktree / Cursor cloud | No isolation field. Spawn-in-process inherits the parent cwd. The parent may `git worktree add` and put the path in the prompt. | `packages/subagent/subagent-spawn-in-process/README.md` |
| Nested spawn | Host `maxDepth` default is `1`. Raise the Host subagent limit when a playbook needs a child to delegate again. | `packages/subagent/tool-subagent/README.md` |
| Todo | `todo_write({ todos: [{ content, status }] })` replaces the whole list. Status: `pending`, `in_progress`, `completed`. | `packages/todo/tool-todo/README.md` |
| Ask human | `ask_user_question` | `packages/interaction/tool-ask-user/README.md` |
| Overnight / loop | `create_goal` / `update_goal` with automatic continuation. No scheduler. | `docs/tool-catalog.md` |
| Credentials (presence only) | `ctx.credentials.describe(ref)` returns `{ configured }`, never the value. | `packages/credentials/credentials/README.md` |
| DSH home | `$DSH_HOME`, else `~/.dsh` | `packages/util/home-paths/README.md` |
| Independent verify | `pstack_spawn` `role: independent-verifier`. When the overlay pins a different family, the check runs there; otherwise it inherits. | this repository |
| `cursor-team-kit` (`deslop`, `control-ui`, `control-cli`) | Not shipped. `/unslop`, `/no-comments`, and the real surface remain. | upstream pstack |
| Benny automations | Cursor automation pack. Kept under `automations/` as source, not a DSH runtime. | pstack `automations/` |
| Graphite `gt` | Optional if `gt` is on PATH. Otherwise `gh` + git. | playbooks |

## Default spawn shape

Parent session only:

```text
pstack_spawn
  description: <3-5 words>
  prompt: <full brief, file pointers not inlined dumps>
  role: <pstack role key, e.g. feature | how-explainer | independent-verifier | poteto-agent | comment-sicko>
  run_in_background: true
  route_index: <only for panel roles when the overlay has more than one route; default 0>
```

Do not send model or effort on that call. Route and effort come from `$DSH_HOME/pstack-dsh.json` when that role is pinned; otherwise the child inherits the main session.

If `pstack_spawn` is missing, fall back to official `subagent` with only `description`, `prompt`, `run_in_background`. That path inherits the parent and cannot apply the overlay.

## Effort

Effort is adapter-owned. Store it in the overlay as `roles.<key>.routes[].reasoningEffort`, only when `resolveModelInfo(provider, model).reasoning.efforts` lists that id. `pstack_spawn` passes it on `agentOptions.reasoningEffort`. If the route has no effort field, omit it.

## What this port dropped

| Cursor / Grok field | Why dropped |
|---|---|
| `Task.model` / Cursor panel slugs | Not on DSH `subagent`. Never invent slugs. |
| `Task.subagent_type` | DSH has no such field. Role is `pstack_spawn.role`. |
| `Task.isolation` / `environment: "cloud"` | No isolation field. Parent worktree + path in prompt. |
| grok `task.reasoning_effort` | Not on DSH `subagent`; effort lives in `AgentOptions`. |
| grok `~/.grok/roles` | DSH does not use that tree. Overlay is `$DSH_HOME/pstack-dsh.json`. |
| Cursor `~/.cursor/rules/pstack-models.mdc` | Cursor-only. |
| grok `scheduler_create` / Cursor `/loop` | Not in DSH. Use `create_goal`. |
| grok `get_task_output` | DSH settlement notice / `job_output`. |
| Cursor `AskQuestion` / `TodoWrite` | DSH `ask_user_question` / `todo_write`. |
| Settings GUI | Removed. The overlay file and `/setup-pstack` are the only configuration surfaces. |

## Sync policy

The skill tree comes from pstack 0.15.32. The port's 0.15.0 baseline was merged into it. Where upstream added Cursor model or spawn guidance, the DSH call-site rewrite is kept. Where upstream changed a principle or prose, the upstream text is kept. Eleven new skills were added. `make-bot-ui` is excluded.

## Official `subagent` fields

The shipped `subagent` schema is `description`, `prompt`, and `run_in_background`. A Host that enables model selection adds `provider`, `model`, `reasoning_effort`, and `list_subagent_models`; this plugin does not depend on that. `pstack_spawn` is the stable role path.
