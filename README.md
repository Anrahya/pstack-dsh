# pstack-dsh

DeepSeek Harness port of [official pstack](https://github.com/cursor/plugins/tree/main/pstack). The playbooks and principles are Lauren Tan's. The harness call layer is rewritten for DSH. This fork is server-only: no Settings page, no browser bundle.

- Targets **DSH 0.2.1-rc.3** (`@deepseek-ai/dsh-*` peers `>=0.2.1-rc.1 <0.3.0`).
- Skills synced to **pstack 0.15.32**: 57 skills, 23 playbooks, 24 principles. `make-bot-ui` is intentionally absent because it is Cursor/Grok-only.
- Every role inherits the main session's provider, model, and reasoning effort. Only the review roles are meant to be pinned, and only if you choose to.

## Install

Desktop app: **Settings → Plugins → Add plugin**, then enter:

```text
github:Anrahya/pstack-dsh#v0.3.1
```

Web profile:

```sh
dsh plugin --profile web add github:Anrahya/pstack-dsh#v0.3.1
```

Restart the app or the Web Host once after installing. The package ships `lib/`, so no build step is needed.

## Configure review

There is no GUI. A fresh install needs no configuration: every role inherits this conversation. To pin review, run `/setup-pstack` in a session, or write `$DSH_HOME/pstack-dsh.json` (normally `~/.dsh/pstack-dsh.json`):

```json
{
  "version": 1,
  "roles": {
    "independent-verifier": {
      "inherit": false,
      "routes": [{ "provider": "opencode-go", "model": "glm-5.3-flash", "reasoningEffort": "high" }]
    },
    "interrogate-reviewers": {
      "inherit": false,
      "routes": [{ "provider": "opencode-go", "model": "glm-5.3-flash", "reasoningEffort": "high" }]
    }
  }
}
```

- `independent-verifier` is the single fresh check on a finished change.
- `interrogate-reviewers` is the adversarial panel. One route is one reviewer; add routes for more reviewers.
- Omit `reasoningEffort` when the route does not list it. `glm-5.3-flash` accepts `low`, `high`, and `max`.
- Any role not listed inherits the parent. An empty or missing file inherits everywhere.

Validate and write the overlay with the `pstack_overlay_write` tool. `pstack_catalog` lists the live routes in this install; never write a pair that is not there.

## Skills

Use `/poteto-mode` at the start of a task. It picks a playbook and runs the other skills as steps need them. Other entry points include `/how`, `/why`, `/sharpen`, `/interrogate`, `/swarm`, `/arena`, `/architect`, `/tdd`, `/unslop`, `/no-comments`, `/benchmark-checklist`, and `/statechart`.

Most skills are user-invocable and not model-invocable, matching upstream. The principles and the common workflow skills are model-invocable so the mode can load them.

## Tools this plugin adds

| Tool | Purpose |
|---|---|
| `pstack_spawn` | Start a child for a pstack role. Fields: `description`, `prompt`, `role`, `run_in_background`, `route_index`. No model or effort fields; the overlay supplies them. |
| `pstack_catalog` | List live provider/model routes and their effort ids. |
| `pstack_overlay_read` | Read `$DSH_HOME/pstack-dsh.json`. |
| `pstack_overlay_write` | Validate and write the overlay. |

`pstack_spawn` uses `ctx.subagents.startActivation`: background children use `delivery: 'parent'`, foreground children use `delivery: 'caller'`. A child that is not pinned inherits the parent route. The host's subagent depth limit defaults to 1; raise it if you want a child to delegate again.

## Uninstall

```sh
dsh plugin --profile desktop remove pstack-dsh
```

Then delete `$DSH_HOME/pstack-dsh.json` if you no longer want the review pin.

## Develop

```sh
pnpm install
pnpm typecheck
pnpm test
pnpm build
```

`pnpm check` runs typecheck, tests, and the build. Tests cover the overlay schema, catalog discovery, the spawn tool, skill frontmatter, static call sites, and peer ranges.

## Sync notes

The skill tree is pstack 0.15.32. Eleven new skills were added and the shared files were merged against the port's 0.15.0 baseline. Where upstream 0.15.32 adds Cursor-only model or spawn guidance, the DSH rewrite wins; where upstream changes prose or a principle, the upstream text is kept. `make-bot-ui` is excluded.

See [HARNESS.md](./HARNESS.md) for the DSH API mapping and [UPGRADE-0.15.md](./UPGRADE-0.15.md) for the original port's provenance.

## License

MIT. Playbooks and principles: Lauren Tan. DSH port packaging: aa2246740. This fork's server-only migration and 0.15.32 sync: Anrahya.
