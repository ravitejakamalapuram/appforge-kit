import { defineWorkspace } from 'vitest/config';

// Vitest 2.x's multi-project mechanism: each entry keeps ITS OWN vitest.config.ts/vite.config.ts
// (and therefore its own `test.environment`) when tests are run from the repo root. Without
// this, a root-level `pnpm test` silently ignores every package's own config and runs
// everything under one global default environment ('node') — which broke
// templates/chrome-react's jsdom-dependent React tests with "document is not defined" the
// moment they were added, even though `pnpm --filter appforge-chrome-react-template test`
// (which runs vitest from inside that package, picking up its own config directly) passed.
// The previous root vitest.config.ts's `test: { projects: [...] } }` was not a valid Vitest 2.x
// option and did nothing — this file is the real fix, not a rename.
// apps/edge is deliberately excluded: it needs @cloudflare/vitest-pool-workers, which requires
// Vitest 4.x, and Vitest 4 removed defineWorkspace (this very mechanism) in favor of a
// `test.projects` array in one vitest.config.ts. Forcing the whole monorepo onto Vitest 4 to
// accommodate one new app risked regressing every already-shipped package/template for no
// benefit — see docs/superpowers/plans/2026-09-26-appforge-edge.md's Task 2 ledger entry.
// apps/edge runs its own Vitest 4 via `pnpm --filter @appforge/edge test`, wired into the root
// `test` script in package.json so `pnpm test` still covers it.
export default defineWorkspace(['packages/*', 'templates/*']);
