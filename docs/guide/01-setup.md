# Set up pstack

Install the plugin, decide whether review should use a different route, and run a first task. A fresh install needs no model configuration: every role inherits the main session.

## Install the plugin

Desktop app: **Settings → Plugins → Add plugin**, then `github:Anrahya/pstack-dsh#v0.3.1`.

Web profile:

```sh
dsh plugin --profile web add github:Anrahya/pstack-dsh#v0.3.1
```

Restart that Host and reload the page. Adding writes to the profile; it does not hot-load a running process.

## Review model

The default is inherit everywhere. To pin review, run [`/setup-pstack`](../../skills/setup-pstack/SKILL.md). It reads the live catalog, asks once, and writes `$DSH_HOME/pstack-dsh.json` through `pstack_overlay_write`.

You can also edit the file yourself:

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

A missing file means inherit. A role left as `inherit: true` keeps the parent route. A panel role runs one child per route. Effort must be an id that route lists; `glm-5.3-flash` accepts `low`, `high`, and `max`.

New `pstack_spawn` calls pick up the overlay immediately. No restart is needed for a config change.

If the project has no way to prove app behavior, generate one with [`/create-verification-skill`](../../skills/create-verification-skill/SKILL.md). [Verify and ship](./06-verify-and-ship.md#create-a-project-verification-skill) covers when it earns its place.

## Run your first task

Pick something real but small, and describe it the way you'd describe it to a colleague:

```text
/poteto-mode add a --json flag to this command. text output stays byte-identical. verify both.
```

Watch the todo list. Its first items are the matched playbook's steps copied in, the Feature playbook for this prompt. If `/poteto-mode` skips a step, the step stays in the list with `skip: <reason>`, so you can see what it chose not to do.

`/poteto-mode` applies to the message that names it. DSH has no Custom Mode, so start each task with `/poteto-mode`, or put a line in the project `AGENTS.md` if you want the style on by default.

Next: [Route work through `/poteto-mode`](./02-poteto-mode.md).
