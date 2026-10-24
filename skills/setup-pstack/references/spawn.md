# pstack_spawn

Canonical DSH spawn for this port. Playbooks follow this file. Do not send Cursor `Task` fields or grok `task` fields.

## Call

```text
pstack_spawn
  description: <3-5 words>
  prompt: <complete brief>
  role: <pstack role key>
  run_in_background: true
  route_index: <optional, panel roles only>
```

Allowed fields: `description`, `prompt`, `role`, `run_in_background`, `route_index`.

Forbidden on this call: `model`, `provider`, `reasoning_effort`, `thinking`, `isolation`, `subagent_type`, `environment`, `readonly`, `resume_from`.

Route and effort come from `$DSH_HOME/pstack-dsh.json` when `/setup-pstack` pinned that role to a live route. Missing overlay, `inherit: true`, or empty `routes`: inherit this conversation. Usable without setup.

## Fallback

If `pstack_spawn` is not registered, call official `subagent` with only `description`, `prompt`, `run_in_background`. That child inherits the parent. You lose per-role overlay.

## Wait and cancel

- Background (`delivery: parent` on `startActivation`): the call returns a subagent id. A settlement notice arrives when the child ends. `send_message` gives it more work. `interrupt_agent` stops the current turn.
- One-shot background: collect with `job_output`, stop with `job_kill`.

Do not poll `list_agents` for completion.

## Isolation

DSH `subagent` has no isolation field. Children share the parent cwd (`packages/subagent/subagent-spawn-in-process/README.md`). When workers must not share a tree, the **parent** runs `git worktree add` (or a unique directory) and puts that path in each prompt.

## Roles

| Role key | Used by |
|---|---|
| `feature` `refactoring` `bug-fix` `perf-issue` `hillclimb` | playbook code delegates |
| `judgment-and-prose` `hardest-tasks` | hardest / judgment code |
| `how-explorer` `how-explainer` | `/how` |
| `why-investigators` `why-synthesizer` | `/why` |
| `reflect-tooling` `reflect-judgment` | `/reflect` |
| `swarm-workers` | `/swarm` |
| `arena-runners` `arena-cross-judge-pool` | `/arena` |
| `architect-runners` | `/architect` via arena |
| `interrogate-reviewers` | `/interrogate` |
| `independent-verifier` | second opinion; does not write the diff |
| `poteto-agent` | ad-hoc playbook helpers |
| `comment-sicko` | `/no-comments` |

`generalPurpose` and `Comment Sicko` normalize to `poteto-agent` and `comment-sicko`.

Panel roles (`arena-runners`, `arena-cross-judge-pool`, `architect-runners`, `interrogate-reviewers`): call `pstack_overlay_read`. If the role inherits, spawn N independent children all inheriting (same route, separate reads). If the role has routes, one `pstack_spawn` per route with `route_index` 0..n-1. Do not invent slugs to fake a panel.

## Todo and questions

- `todo_write({ todos: [{ content, status }] })` replaces the whole list. Status is `pending`, `in_progress`, or `completed`. No `id`, `merge`, or `cancelled`.
- Product or preference questions: `ask_user_question`. Not Cursor `AskQuestion`.
