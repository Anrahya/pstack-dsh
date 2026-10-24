---
name: reflect
description: Spawn three parallel review subagents over the active transcript, surface learnings, and route each to a concrete edit on an existing skill. Use when the user says reflect.
disable-model-invocation: true
---

# Reflect

Mine the current conversation for durable learnings, then route them into skill edits.

## When to invoke

Invoke when the user says "reflect" or "/reflect". Skip when the conversation is trivial, off-topic, or already covered by an existing skill the parent followed correctly. One-offs are not learnings.

## Process

### 1. Locate the active transcript

The parent finds this conversation's DSH session log before fanning out. JSONL backends expose a path through `SessionPersistence.locate`; SQLite backends share one database and have no per-session file (`docs/subsystems/persistence.md`). Use the current session and, if present, session-query tools. Do not glob other workspaces or other users' `$DSH_HOME`.

If no on-disk transcript path resolves, write a tight digest of this session and pass that instead.

### 2. Spawn three reviewers in parallel

One message, three `pstack_spawn` calls. Roles: `reflect-judgment`, `reflect-tooling`, `reflect-judgment` again for the divergent lens (`route_index` 0 unless overlay listed extra routes). `run_in_background: true`. Do not send `model` or `readonly`. Overlay or inherit. Reviewers need the same tools as the parent for context lookups. The prompt forbids file writes. The parent applies edits. Follow [`../setup-pstack/references/spawn.md`](../setup-pstack/references/spawn.md).

| Lens | `role` | Prompt template |
|---|---|---|
| Judgment | `reflect-judgment` | `references/judgment-reviewer.md` |
| Tooling | `reflect-tooling` | `references/tooling-reviewer.md` |
| Divergent | `reflect-judgment` | `references/divergent-reviewer.md` |

Pass each template verbatim, substituting the transcript path or digest where marked. Reviewers return findings in the spawn result or settlement notice.

### 3. Synthesize

One `pstack_spawn`, `role: reflect-judgment`. Do not send `model` or `readonly`. Overlay or inherit. Use `references/synthesizer.md` verbatim, with each reviewer's full output inlined where marked. The synthesizer returns a structured Accepted / Rejected / Backlog list.

### 4. Structural enforcement check

Sanity-check the synthesizer's Accepted list. For any item that would be enforced more reliably by a lint rule, script, metadata flag, or runtime check, move it from Accepted to Backlog. See the **encode-lessons-in-structure** principle skill.

### 5. Apply

Before applying any Accepted edit, present the synthesizer's full Accepted/Rejected/Backlog output to the user and wait for explicit approval. The user picks which subset to apply and may redirect routings. Skill changes affect future agents that load them. Do not auto-apply.

Backlog items file to whatever devex / backlog tracker your team uses automatically. Only the Accepted list waits for approval.

For each approved Accepted item, follow the Routing field exactly:

- Trivial existing-skill edit (a one-line bullet, a tightened sentence, a stale fact corrected): parent does directly.
- Substantive existing-skill edit (a new section, a new pattern table, more than ~10 lines): hand to the **authoring-a-skill** playbook skill and run its draft / test / iterate loop.
- `tune description: <skill path>` (the skill exists but didn't trigger when it should have): tighten `description` and kebab-case `name` per DSH skill-filesystem rules.
- `new skill via authoring-a-skill: <kebab-name>`: hand creation to the **authoring-a-skill** playbook. Do not invent the shape ad hoc.

If your environment ships a SKILL.md validator, run it on every touched skill before declaring done. Skip this step if it doesn't.

### 6. Summarize for the user

Short list, no preamble:

- Edits applied: `<skill path>`. What changed, one line each.
- New skills created: `<skill path>`. One line each (rare).
- Backlog filed to the devex tracker: `<issue title>` (`<tags>`). One line each.
- Dropped: one line per rejected finding + reason from the synthesizer.
