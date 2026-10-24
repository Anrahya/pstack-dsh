# Test plan

Run everything against a local DSH 0.2.1 install.

## Static and unit

```bash
pnpm install
pnpm typecheck
pnpm test
pnpm build
```

The suite covers:

- overlay parsing, inheritance, panel routes, and route validation against a live catalog
- catalog discovery: only configured credentials or signed-in OAuth routes, never a vendor catalog
- `pstack_spawn`: disabled retired role, background `delivery: parent`, foreground `delivery: caller`, persona in the prompt, no model or effort fields on the schema
- skill frontmatter, kebab-case names, model-invocable principles, and the 24-principle count
- static call sites: no Cursor `Task` fields, model slugs, `.cursor` rules, `cursor-team-kit`, or `/deslop`
- peer range `>=0.2.1-rc.1 <0.3.0`
- package composition: no client export, no `dsh.client`, no settings route

## Bundle

- `pnpm build` writes only `lib/index.js` and `lib/index.d.ts`.
- `cordis.patch.yml` inserts `id: pstack-dsh`, `name: pstack-dsh`.
- The package has no `prepare` script and ships `lib/`.

## Manual smoke test

1. Install `github:Anrahya/pstack-dsh#v0.3.1` into a throwaway profile, or link the checkout.
2. Restart the Host. Look for `[pstack-dsh] loaded`.
3. Run `/poteto-mode` on a small task. Confirm the skill loads and `pstack_spawn` appears in the tool list.
4. Call `pstack_catalog`. Confirm `opencode-go/glm-5.3-flash` is listed with `low`, `high`, and `max`.
5. Write the review overlay with `pstack_overlay_write`, then start an `independent-verifier` child. Confirm it runs on GLM and the main session stays on its own route.
6. Remove the overlay. Confirm a new child inherits the main session route again.
7. Confirm there is no Settings → pstack page and no `lib/client.js`.
