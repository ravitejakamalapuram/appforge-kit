# appforge-kit

Shared code and templates for the AppForge AI product factory: the
`@appforge/router` model-routing library, `@appforge/schemas` (JSON Schema
validators for `.appforge/*.yaml` plus the permission-diff and product
state-machine checkers), and the `appforge` CLI.

This is one repo of the AppForge AI platform described in
[`appforge-ai-master-plan.md`](https://github.com/ravitejakamalapuram) (kept
in a separate private planning repo). See `docs/superpowers/plans/` for the
implementation plan this repo's first packages were built from.

## Packages

- `packages/router` — `@appforge/router`: pure, deterministic model-tier
  routing (`ModelRouter.select()`).
- `packages/schemas` — `@appforge/schemas`: permissions.yaml validation,
  the manifest-vs-permissions diff gate, and the product state-machine
  transition checker.
- `packages/cli` — `@appforge/cli`: the `appforge` command-line tool
  (`appforge validate`, `appforge product-transition`).

## Development

```bash
pnpm install
pnpm test
pnpm typecheck
pnpm build
```
