---
name: setup-pstack
description: Optional. Pin a review model, or leave every role inheriting the main session. Writes $DSH_HOME/pstack-dsh.json. Use for /setup-pstack, "configure pstack models", or changing pstack's review model.
---

# Setup pstack

Optional. A fresh install already works: every role inherits this conversation's provider, model, and reasoning effort. There is no Settings page and no separate config file.

The only useful override is the review path. Everything else should inherit unless the user asks for a specific split.

## Review roles

Two roles cover review:

- `independent-verifier`: one fresh child that checks a finished change and does not write the diff.
- `interrogate-reviewers`: the adversarial panel. One route means one reviewer; each entry in `routes` runs one child.

The recommended pin is `opencode-go/glm-5.3-flash` at `high`. It is a different family from a DeepSeek or Grok builder and is cheap enough to review often.

## Steps

1. Read the current overlay with `pstack_overlay_read`. A missing file means every role inherits; that is valid.
2. List live routes with `pstack_catalog`. Never write a provider/model pair that is not in the catalog.
3. Ask once with `ask_user_question`:

   - `Keep inherit` (recommended when the user has no strong preference)
   - `Pin GLM 5.3 Flash for review` (sets both review roles to `opencode-go/glm-5.3-flash`, effort `high`)
   - `Choose another route` (show only live routes)

4. Build the full overlay. Keep every existing role entry. Change only the two review roles. A scalar role takes at most one route; a panel role may take several.
5. Call `pstack_overlay_write` with the full object. It validates every route and effort against the live catalog and refuses an unknown route.

Example for the recommended pin:

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

6. Tell the user the overlay applies to new subagents. The main session is untouched.

## Rules

- Never send `model`, `provider`, or effort on `pstack_spawn`. The overlay supplies them.
- Do not write Cursor or Grok config trees. Do not invent Cursor panel slugs.
- Do not pin a role just because it exists. Inherit is the default and the cheapest correct choice.
- Effort must be listed by that route. `glm-5.3-flash` accepts `low`, `high`, and `max`; it has no `medium` or `xhigh`.
- A panel with one route runs one reviewer. Add routes only when the user asks for more reviewers.

## Optional follow-ups

After the review choice, offer once each:

- A project verification skill, so agents can drive the real app and capture evidence. Use `/create-verification-skill`.
- A formal verification skill, so a race or invariant is checked past what tests reach. Use `/create-formal-verification-skill`.

If the project already has one, do not offer it again.

## Spawn reminder

Follow [`references/spawn.md`](references/spawn.md).
