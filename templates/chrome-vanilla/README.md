# AppForge Chrome Template — Vanilla

A minimal Manifest V3 Chrome extension template with **no UI framework** — for small,
single-surface extensions in the StellarTab / GitaVerses / TeluguPanchangam class. If you need a
real UI (popup + options with components), use `templates/chrome-react` instead.

Demonstrates all four AppForge shared packages together:

- **`@appforge/storage`** — `src/shared/settings.ts` wraps `chrome.storage.local` behind a
  versioned, migratable settings store.
- **`@appforge/messaging`** — the new-tab page and the background service worker talk through a
  typed `sendTypedMessage`/`createMessageRouter` contract (`src/shared/messages.ts`) instead of
  raw `chrome.runtime.sendMessage`.
- **`@appforge/errors`** — both the service worker and the new-tab page install global error
  handlers on wake (`self`/`window` respectively).
- **`@appforge/flags`** — `src/newtab/main.ts` wires up a `FlagsClient`, currently pointed at a
  placeholder `edgeUrl` since `appforge-edge` (P1-10) doesn't exist yet. It correctly falls back
  to compiled-in defaults, which is the point of the demo — replace the URL once a real edge
  deployment exists.

## Using this as a starting point for a real product

This currently lives inside the `appforge-kit` monorepo and depends on the four shared packages
via `workspace:*`, which only resolves here. **A real new product copied out of this template
needs those packages published somewhere it can install from** (npm, or a private registry) —
that publishing step doesn't exist yet (see the master plan, §29c: "needs the GitHub
org/npm token decision"). Until then, treat this as a reference implementation to copy patterns
from, not a `git clone`-and-ship starting point.

`.appforge/product.yaml` and `.appforge/permissions.yaml` here are placeholders so this template
can dogfood `appforge validate` — a real product's `appforge create chrome` (not yet built) would
generate its own.

## Scope notes

- No Playwright/browser-load e2e test yet — that's the dedicated e2e harness, P1-11, a separate
  backlog item. This template is verified by `pnpm build` producing a structurally valid
  `dist/manifest.json`, plus `appforge validate`/`appforge security permissions` run against it
  from the repo root.
- No icons are set in the manifest (Chrome shows its default icon). Add real ones before shipping
  a product built from this template.

## Commands

```bash
pnpm install
pnpm --filter appforge-chrome-vanilla-template dev      # Vite dev server
pnpm --filter appforge-chrome-vanilla-template build     # -> dist/ (load unpacked in chrome://extensions)
pnpm --filter appforge-chrome-vanilla-template test
pnpm --filter appforge-chrome-vanilla-template typecheck
```
