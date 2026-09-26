# AppForge Chrome Template — React

A Manifest V3 Chrome extension template with a real **popup + options UI (React)** — for
extensions that need actual components, matching cors-enabler's shape. For small,
single-surface extensions with no framework, use `templates/chrome-vanilla` instead.

Demonstrates all four AppForge shared packages together:

- **`@appforge/storage`** — `src/shared/settings.ts` (identical pattern to chrome-vanilla): a
  versioned, migratable settings store over `chrome.storage.local`.
- **`@appforge/messaging`** — `src/hooks/useSettings.ts` wraps `sendTypedMessage` in a React hook
  (loading/error/data state, and a safe-after-unmount guard) so both the popup and the options
  page talk to the background service worker through one typed contract
  (`src/shared/messages.ts`), the same contract the service worker's router is typed against.
- **`@appforge/errors`** — the service worker, popup, and options page each install global error
  handlers on load.
- **`@appforge/flags`** — the options page wires up a `FlagsClient`, currently pointed at a
  placeholder `edgeUrl` since `appforge-edge` (P1-10) doesn't exist yet. It correctly falls back
  to compiled-in defaults.

## Using this as a starting point for a real product

This currently lives inside the `appforge-kit` monorepo and depends on the four shared packages
via `workspace:*`, which only resolves here. **A real new product copied out of this template
needs those packages published somewhere it can install from** — that publishing step doesn't
exist yet (see the master plan, §29c). Until then, treat this as a reference implementation to
copy patterns from, not a `git clone`-and-ship starting point.

`.appforge/product.yaml` and `.appforge/permissions.yaml` here are placeholders so this template
can dogfood `appforge validate` — a real product's `appforge create chrome --ui react` (not yet
built) would generate its own.

## Scope notes

- No Playwright/browser-load e2e test yet — that's the dedicated e2e harness, P1-11, a separate
  backlog item. `useSettings` is unit-tested with `@testing-library/react`'s `renderHook`
  instead, against a fake `ChromeRuntime`.
- No icons are set in the manifest (Chrome shows its default icon). Add real ones before shipping
  a product built from this template.

## Commands

```bash
pnpm install
pnpm --filter appforge-chrome-react-template dev      # Vite dev server
pnpm --filter appforge-chrome-react-template build     # -> dist/ (load unpacked in chrome://extensions)
pnpm --filter appforge-chrome-react-template test
pnpm --filter appforge-chrome-react-template typecheck
```
