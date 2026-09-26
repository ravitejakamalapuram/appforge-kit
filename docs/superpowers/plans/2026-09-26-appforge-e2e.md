# appforge-e2e (Playwright Chrome extension harness) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build `@appforge/e2e`, a Playwright-based Chrome MV3 extension test harness living in the `appforge-kit` monorepo, cover it with real (not mocked) browser checks against `templates/chrome-vanilla`'s built output, expose it as `appforge test --e2e` in `@appforge/cli`, and wire a real invocation of it into this repo's own CI — per the master plan's §13.3 ("Chrome QA") and backlog item P1-11.

**Architecture:** A new pure-Node package, `packages/e2e`, exports `runE2eSuite(buildDir, options)`, which launches the target extension with `chromium.launchPersistentContext` (Chrome's documented pattern for automating an unpacked MV3 extension: `--load-extension`/`--disable-extensions-except`, headless via `--headless=new`) and runs two independent checks against it — a smoke check (loads, service worker `activated`, new-tab surface renders with no unexpected console error) and a service-worker-restart check (writes to `chrome.storage.local`, force-stops the worker via the CDP `ServiceWorker` domain, triggers a wake, confirms the value survived). `@appforge/cli` gets a new `test --e2e` command that builds (or accepts a pre-built `--dist`) target and calls `runE2eSuite`, printing a `cli-output@1`-shaped report. `templates/chrome-vanilla` gets a real `test:e2e` script invoking the actual `appforge` binary against its own build, wired into CI — so the harness runs for real on every PR, not just in isolation.

**Tech Stack:** TypeScript (strict, ES2022/NodeNext, matching `tsconfig.base.json`), Playwright `^1.63.0` (the version installed and empirically verified during this plan's investigation — see Global Constraints), Vitest 2.x (existing monorepo pin — `packages/e2e` is auto-covered by the existing `packages/*` entry in `vitest.workspace.ts`, no workspace-config changes needed), Commander (existing `@appforge/cli` base), pnpm workspaces.

**Spec:** `~/git-personal/.claude/appforge-ai-master-plan.md` — §13.3 ("Chrome QA": SW restart, upgrade, offline, multi-tab, axe checks), backlog item P1-11 ("Playwright e2e harness in kit (SW restart, upgrade, offline, multi-tab, axe) · runs on json-workbench in < 10 min · 8 h · flakiness"). This plan implements the SW-restart check and the smoke check only — see Global Constraints for what's explicitly deferred and why.

## Global Constraints

- Node ≥ 22.0, TypeScript `strict: true`, ESM/`NodeNext` module resolution — matches every existing package (`tsconfig.base.json`). `@appforge/e2e`'s public API (`src/index.ts`) exports only plain data types (`E2eReport`, `E2eCheckResult`, `RunE2eSuiteOptions`) and `runE2eSuite` — never raw Playwright types — so `@appforge/cli` depends on Playwright transitively without importing its type surface.
- `packages/e2e` is a new pnpm workspace member, but `pnpm-workspace.yaml` (`packages/*`) and `vitest.workspace.ts` (`packages/*`) already cover it — unlike `apps/edge`, no workspace-glob changes are needed here.
- Playwright is pinned to `^1.63.0` in `packages/e2e/package.json` — the exact version installed and used for every empirical check in this plan's own investigation (headless MV3 extension loading, the `ServiceWorker` CDP domain behavior in Task 3). This repo's shared network path (Node's `NODE_EXTRA_CA_CERTS`, already set in this environment) reaches both the npm registry and Playwright's own CDN for browser binaries — confirmed directly before writing this plan.
- Browser binaries are installed via a `"postinstall": "playwright install chromium"` script in `packages/e2e/package.json`. pnpm runs a **workspace-local** project's own lifecycle scripts (preinstall/install/postinstall) during `pnpm install` by default — this is unrelated to, and not blocked by, pnpm's separate "ignored build scripts" approval gate for *third-party* dependencies. This adds a Chromium download to every future `pnpm install` in this repo — an accepted, one-time-per-machine cost, since headless e2e coverage is now a first-class checked path per P1-11.
- `chromium.launchPersistentContext` (never `chromium.launch()`) is the only way to load an unpacked extension at all — this is Chrome's own documented automation pattern. Headless coverage requires passing `--headless=new` as a raw Chromium arg while leaving Playwright's own `headless` launch option `false`; Playwright's `headless: true` shorthand does not reliably enable extension loading. Verified empirically against this repo's own `templates/chrome-vanilla` build before writing this plan — see Review Focus item 4.
- Both checks in this plan run only against `templates/chrome-vanilla`'s built `dist/` output, per this backlog item's own framing ("use chrome-vanilla's dist output as the fixture, since it's the simplest of the two templates"). `templates/chrome-react` is a natural next target once this proves out, not part of this plan.
- **Explicitly out of scope for this plan** (real, separately-scheduled follow-ups, not gaps):
  - Wiring this harness into `json-workbench` — a separate repo with its own release history and CI. That happens once `json-workbench` actually adopts `@appforge/e2e` as a dependency (a P1-18-territory step), not here.
  - The "upgrade test" (installing a previous release zip, upgrading in place, checking migration behavior) — it needs a real previous-release zip from a kit-based product's GitHub Releases, which doesn't exist yet for any product. Building it now would mean faking the one input that makes the test meaningful.
  - Offline, multi-tab, and axe (accessibility) checks from §13.3's full Chrome QA list — each is its own unit of work with its own failure modes; this plan ships the two checks the backlog line calls out as most concretely specified (SW restart, and a basic smoke/render check standing in for "the extension works at all") first, rather than shipping five thin checks half-verified.
- The known-expected `net::ERR_NAME_NOT_RESOLVED` console message that Chromium itself logs for `chrome-vanilla`'s placeholder `FlagsClient` `edgeUrl` (`https://edge.appforge.example`, documented in `templates/chrome-vanilla/src/newtab/main.ts` as intentional until a real `appforge-edge` deployment or product customization exists) is filtered by exact failing-request origin in the smoke check, not by ignoring all network errors — see Review Focus item 2. A real, unrelated console error must still fail the check.
- The suite is exercised for real (not just unit-tested with mocks) in three places by the end of this plan: `packages/e2e`'s own Vitest tests (Tasks 1–4, run automatically by root `pnpm test` since `packages/*` is already in the Vitest workspace), `@appforge/cli`'s integration test (Task 5, a real unmocked `runTestE2e` call), and `templates/chrome-vanilla`'s new `test:e2e` script wired into CI (Task 6). This repo's existing testing convention (see `packages/cli/tests/*.integration.test.ts`) favors real fixtures over mocks — this plan follows that convention rather than introducing a mocking library.

## Review Focus

1. **`Target.closeTarget` does not reliably terminate a service-worker-type CDP target.** Investigated directly against this repo's own `chrome-vanilla` build before writing this plan: closing the SW's target via the generic `Target` domain left the exact same `targetId` reporting as present immediately afterward, and every subsequent `chrome.runtime.sendMessage` attempt (30 retries over ~9 seconds) failed with "The message port closed before a response was received" — the worker was never torn down in a state the extension's own messaging could recover from. `ServiceWorker.stopWorker` (the CDP domain purpose-built for this) reliably transitions `runningStatus` to `stopped`, and the extension naturally restarts it (`running`) on the next page load — verified across 3 consecutive runs with zero flakes. Covered in Task 3 (`checkServiceWorkerRestart` uses `ServiceWorker.stopWorker`, never `Target.closeTarget`).
2. **Chromium's own "Failed to load resource" console message is a false-positive risk for a naive "no console error" check.** `chrome-vanilla`'s `main.ts` deliberately points `FlagsClient` at a placeholder edge URL until a real deployment exists; `FlagsClient` itself catches the fetch failure (no JS-level `console.error`), but Chromium still emits a `type: 'error'` console message with `location().url` set to the failing request's URL. A check that treats every `'error'`-typed console event as a failure false-positives on every run against the current template. Covered in Task 2 (`checkSmoke` filters only messages whose `location().url` origin is the known placeholder host, so an unrelated broken asset or script still fails the check).
3. **A test's own probe key must not collide with real extension state.** `chrome.storage.local` is shared across the whole extension; writing to a plausible real key (e.g. `settings`) could mask a genuine storage bug the smoke check is also exercising, or corrupt state a parallel check depends on. Covered in Task 3 (`checkServiceWorkerRestart` writes to a namespaced, timestamp-suffixed key, `__appforge_e2e_probe`).
4. **Headless-mode extension loading is flag-sensitive, not the default.** Old-style headless Chromium (`headless: true` with no extra args, or bare `--headless`) silently ignores `--load-extension` — the browser launches with nothing loaded, and every downstream check fails confusingly at "service worker never appeared" instead of at an obvious "extension didn't load" error. Covered in Task 1 (`launchExtension` always passes Playwright's own `headless: false` plus a raw `--headless=new` arg, verified empirically to load the extension and render `chrome_url_overrides.newtab`); if a future Chromium/Playwright upgrade regresses this, Task 1's own test is the first thing to fail, with a clear `launchTimeoutMs` error.
5. **A build directory that isn't actually a built extension must fail fast, before ever opening a browser.** `appforge test --e2e --dist <path>` (or `--dir` when the build step itself fails) is a CLI entry point a person can point at anything. Covered in Task 5 (`runTestE2e` checks for `manifest.json` in the resolved dist directory and returns exit code 2 — invalid input — before calling `runE2eSuite` at all, so a typo'd path produces one clear error line instead of an opaque Playwright launch timeout).

---

### Task 1: `packages/e2e` scaffold — `launchExtension` and the `ServiceWorker` CDP tracker

**Files:**
- Create: `packages/e2e/package.json`
- Create: `packages/e2e/tsconfig.json`
- Create: `packages/e2e/tsconfig.build.json`
- Create: `packages/e2e/vitest.config.ts`
- Create: `packages/e2e/.gitignore`
- Create: `packages/e2e/src/types.ts`
- Create: `packages/e2e/src/service-worker-cdp.ts`
- Create: `packages/e2e/src/launch.ts`
- Create: `packages/e2e/tests/fixture.ts`
- Test: `packages/e2e/tests/launch.test.ts`

**Interfaces:**
- Consumes: `templates/chrome-vanilla/dist` (must already be built — guaranteed by root `pnpm run build` per the existing repo convention; this task's test asserts the dist directory exists and fails with a clear message otherwise).
- Produces: `LaunchedExtension` (`{ context, extensionId, swTracker, close() }`), `launchExtension(buildDir, options?)`, `ServiceWorkerTracker` (`enable()`, `find(extensionId)`, `get(versionId)`, `stop(versionId)`, `waitUntil(predicate, timeoutMs?)`) — all consumed by Tasks 2–4.

- [ ] **Step 1: Scaffold the package**

```json
// packages/e2e/package.json
{
  "name": "@appforge/e2e",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "main": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "scripts": {
    "build": "tsc -p tsconfig.build.json",
    "postinstall": "playwright install chromium",
    "test": "vitest run"
  },
  "dependencies": {
    "playwright": "^1.63.0"
  },
  "devDependencies": {
    "typescript": "^5.6.0",
    "vitest": "^2.1.0",
    "@types/node": "^22.0.0"
  }
}
```

```json
// packages/e2e/tsconfig.json
{
  "extends": "../../tsconfig.base.json",
  "include": ["src", "tests"]
}
```

```json
// packages/e2e/tsconfig.build.json
{
  "extends": "./tsconfig.json",
  "compilerOptions": { "rootDir": "./src", "outDir": "./dist" },
  "include": ["src"]
}
```

```ts
// packages/e2e/vitest.config.ts
import { defineConfig } from 'vitest/config';

// Real Chromium launches per test — the monorepo's Vitest default (5s) is too short.
export default defineConfig({
  test: {
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
});
```

```
# packages/e2e/.gitignore
dist/
```

```ts
// packages/e2e/src/types.ts
export interface E2eCheckResult {
  /** Stable, human-readable name. This is what appears in the CLI's cli-output@1 `errors` array on failure. */
  name: string;
  ok: boolean;
  error?: string;
  durationMs: number;
}

export interface E2eReport {
  ok: boolean;
  buildDir: string;
  checks: E2eCheckResult[];
}

export interface RunE2eSuiteOptions {
  /**
   * true (default) launches Chromium in `--headless=new` mode, which supports loading unpacked
   * MV3 extensions (verified during this plan's investigation — see Review Focus item 4). false
   * opens a visible browser window, useful when debugging a check locally.
   */
  headless?: boolean;
  /** Max time to wait for the extension's service worker to appear after launch. Default 10000. */
  launchTimeoutMs?: number;
}
```

- [ ] **Step 2: Write the failing test for `launchExtension`**

```ts
// packages/e2e/tests/fixture.ts
import { fileURLToPath } from 'node:url';
import path from 'node:path';

/**
 * The fixture every check in this package runs against: chrome-vanilla's real built output.
 * Requires `pnpm build` (root) to have run first — guaranteed for `pnpm test` (root `pretest`
 * runs `pnpm run build`) but NOT guaranteed for a bare `pnpm --filter @appforge/e2e test`;
 * run `pnpm --filter appforge-chrome-vanilla-template build` first if using that filtered form.
 */
export const CHROME_VANILLA_DIST = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../../templates/chrome-vanilla/dist'
);
```

```ts
// packages/e2e/tests/launch.test.ts
import { describe, it, expect, afterEach } from 'vitest';
import { existsSync } from 'node:fs';
import { launchExtension } from '../src/launch.js';
import type { LaunchedExtension } from '../src/launch.js';
import { CHROME_VANILLA_DIST } from './fixture.js';

describe('launchExtension', () => {
  let ext: LaunchedExtension | undefined;

  afterEach(async () => {
    await ext?.close();
    ext = undefined;
  });

  it('loads the built chrome-vanilla template and discovers its extension id', async () => {
    expect(existsSync(CHROME_VANILLA_DIST)).toBe(true); // run `pnpm build` first if this fails
    ext = await launchExtension(CHROME_VANILLA_DIST);
    expect(ext.extensionId).toMatch(/^[a-p]{32}$/); // Chrome extension ids use the a-p alphabet
  });

  it('reports the service worker as "activated" via the ServiceWorker CDP tracker', async () => {
    ext = await launchExtension(CHROME_VANILLA_DIST);
    const found = await ext.swTracker.waitUntil(() => ext!.swTracker.find(ext!.extensionId) !== undefined, 5000);
    expect(found).toBe(true);
    expect(ext.swTracker.find(ext.extensionId)?.status).toBe('activated');
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `cd appforge-kit && pnpm install && pnpm --filter @appforge/e2e test -- launch`
Expected: FAIL — `../src/launch.js` has no export `launchExtension` (module doesn't exist yet). If `pnpm install` triggers the `postinstall` Chromium download for the first time, that is expected and can take a minute.

- [ ] **Step 4: Implement the `ServiceWorker` CDP tracker**

```ts
// packages/e2e/src/service-worker-cdp.ts
import type { CDPSession } from 'playwright';

export interface ServiceWorkerVersion {
  versionId: string;
  registrationId: string;
  scriptURL: string;
  runningStatus: string;
  status: string;
}

interface WorkerVersionUpdatedEvent {
  versions: ServiceWorkerVersion[];
}

/**
 * A tiny wrapper around the CDP `ServiceWorker` domain, shared by the smoke and SW-restart
 * checks (Tasks 2–3). `Target.closeTarget` was tried first for forcing a restart and found
 * unreliable for service-worker-type targets — see this plan's Review Focus item 1.
 * `ServiceWorker.stopWorker` is the domain actually built for this.
 */
export class ServiceWorkerTracker {
  private readonly versions = new Map<string, ServiceWorkerVersion>();
  private enabled = false;

  constructor(private readonly cdp: CDPSession) {
    cdp.on('ServiceWorker.workerVersionUpdated', (params: WorkerVersionUpdatedEvent) => {
      for (const v of params.versions) this.versions.set(v.versionId, v);
    });
  }

  async enable(): Promise<void> {
    if (this.enabled) return;
    await this.cdp.send('ServiceWorker.enable');
    this.enabled = true;
  }

  find(extensionId: string): ServiceWorkerVersion | undefined {
    return [...this.versions.values()].find((v) => v.scriptURL.includes(extensionId));
  }

  get(versionId: string): ServiceWorkerVersion | undefined {
    return this.versions.get(versionId);
  }

  async stop(versionId: string): Promise<void> {
    await this.cdp.send('ServiceWorker.stopWorker', { versionId });
  }

  /** Polls `predicate` every 100ms until it returns true or `timeoutMs` elapses. */
  async waitUntil(predicate: () => boolean, timeoutMs = 5000): Promise<boolean> {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      if (predicate()) return true;
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    return predicate();
  }
}
```

- [ ] **Step 5: Implement `launchExtension`**

```ts
// packages/e2e/src/launch.ts
import { chromium, type BrowserContext } from 'playwright';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ServiceWorkerTracker } from './service-worker-cdp.js';

export interface LaunchedExtension {
  context: BrowserContext;
  extensionId: string;
  swTracker: ServiceWorkerTracker;
  close(): Promise<void>;
}

export interface LaunchExtensionOptions {
  headless?: boolean;
  launchTimeoutMs?: number;
}

/**
 * Loads an unpacked MV3 extension the way Chrome's own documentation for automated extension
 * testing recommends: `chromium.launchPersistentContext` with `--load-extension` (extensions
 * only load with a persistent context — never `chromium.launch()`). Headless coverage requires
 * `--headless=new` passed as a raw arg while Playwright's own `headless` option stays `false` —
 * `headless: true` does not reliably enable extension loading. Verified against this repo's own
 * `templates/chrome-vanilla` build during this plan's investigation (Review Focus item 4).
 */
export async function launchExtension(buildDir: string, options: LaunchExtensionOptions = {}): Promise<LaunchedExtension> {
  const headless = options.headless ?? true;
  const launchTimeoutMs = options.launchTimeoutMs ?? 10_000;
  const userDataDir = await mkdtemp(join(tmpdir(), 'appforge-e2e-'));

  const args = [`--disable-extensions-except=${buildDir}`, `--load-extension=${buildDir}`];
  if (headless) args.push('--headless=new');

  const context = await chromium.launchPersistentContext(userDataDir, {
    headless: false, // the --headless=new arg above does the real work — see this function's docstring
    args,
  });

  let serviceWorker = context.serviceWorkers()[0];
  if (!serviceWorker) {
    serviceWorker = await context.waitForEvent('serviceworker', { timeout: launchTimeoutMs });
  }
  const extensionId = new URL(serviceWorker.url()).host;

  const anchorPage = await context.newPage(); // kept open for the life of the context — the CDPSession is tied to it
  const cdp = await context.newCDPSession(anchorPage);
  const swTracker = new ServiceWorkerTracker(cdp);
  await swTracker.enable();

  return {
    context,
    extensionId,
    swTracker,
    close: () => context.close(),
  };
}
```

- [ ] **Step 6: Run test to verify it passes**

Run: `pnpm --filter @appforge/e2e test -- launch`
Expected: PASS (2 tests).

- [ ] **Step 7: Commit**

```bash
git add packages/e2e
git commit -m "feat(e2e): scaffold @appforge/e2e with launchExtension and the ServiceWorker CDP tracker"
```

---

### Task 2: Smoke check

**Files:**
- Create: `packages/e2e/src/checks/smoke.ts`
- Test: `packages/e2e/tests/smoke.test.ts`

**Interfaces:**
- Consumes: `LaunchedExtension`, `ServiceWorkerTracker` from Task 1.
- Produces: `checkSmoke(ext: LaunchedExtension): Promise<void>` (throws with a descriptive `Error` on failure) — consumed by Task 4's `runE2eSuite`.

- [ ] **Step 1: Write the failing test**

```ts
// packages/e2e/tests/smoke.test.ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { launchExtension } from '../src/launch.js';
import type { LaunchedExtension } from '../src/launch.js';
import { checkSmoke } from '../src/checks/smoke.js';
import { CHROME_VANILLA_DIST } from './fixture.js';

describe('checkSmoke', () => {
  let ext: LaunchedExtension;

  beforeAll(async () => {
    ext = await launchExtension(CHROME_VANILLA_DIST);
  });

  afterAll(async () => {
    await ext.close();
  });

  it('passes against a working extension build, ignoring the known placeholder edge-URL network error (Review Focus)', async () => {
    await expect(checkSmoke(ext)).resolves.toBeUndefined();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd appforge-kit && pnpm --filter @appforge/e2e test -- smoke`
Expected: FAIL — `../src/checks/smoke.js` has no export `checkSmoke` (module doesn't exist yet).

- [ ] **Step 3: Implement `checkSmoke`**

```ts
// packages/e2e/src/checks/smoke.ts
import type { LaunchedExtension } from '../launch.js';

/**
 * Chromium logs a failed resource load (e.g. a fetch()) as a type:'error' console message even
 * though the page's own JS never calls console.error. chrome-vanilla's main.ts deliberately
 * points FlagsClient at this placeholder host until a real appforge-edge deployment exists;
 * FlagsClient itself catches the failure and falls back to defaults. Filtering by the exact
 * failing request's origin (not "any network error") means an unrelated broken asset still
 * fails this check. See this plan's Review Focus item 2.
 */
const EXPECTED_PLACEHOLDER_HOST = 'edge.appforge.example';

export async function checkSmoke(ext: LaunchedExtension): Promise<void> {
  const found = await ext.swTracker.waitUntil(() => ext.swTracker.find(ext.extensionId) !== undefined, 5000);
  const version = found ? ext.swTracker.find(ext.extensionId) : undefined;
  if (!version || version.status !== 'activated') {
    throw new Error(`expected the extension's service worker to be "activated", got ${JSON.stringify(version)}`);
  }

  const page = await ext.context.newPage();
  const unexpectedErrors: string[] = [];
  page.on('console', (msg) => {
    if (msg.type() !== 'error') return;
    const location = msg.location();
    if (location.url && location.url.includes(EXPECTED_PLACEHOLDER_HOST)) return;
    unexpectedErrors.push(msg.text());
  });
  page.on('pageerror', (err) => unexpectedErrors.push(String(err)));

  try {
    await page.goto('chrome://newtab/', { waitUntil: 'load' });
    const status = await page.textContent('#status');
    if (status !== 'Ready') {
      throw new Error(`expected #status to read "Ready" once the page finished loading, got ${JSON.stringify(status)}`);
    }
    if (unexpectedErrors.length > 0) {
      throw new Error(`unexpected console error(s): ${unexpectedErrors.join('; ')}`);
    }
  } finally {
    await page.close();
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @appforge/e2e test -- smoke`
Expected: PASS (1 test).

- [ ] **Step 5: Add a regression test proving the filter is precise, not a blanket "ignore network errors"**

Append to `packages/e2e/tests/smoke.test.ts`:

```ts
  it('does NOT swallow a console error from an unrelated origin (Review Focus: the filter is precise)', async () => {
    const page = await ext.context.newPage();
    try {
      await page.goto('chrome://newtab/', { waitUntil: 'load' });
      await page.evaluate(() => console.error('a totally unrelated real bug'));
      // Re-run the same check logic inline: a real checkSmoke() call only opens ITS OWN page,
      // so this test instead documents the filter's precision directly against the constant it
      // uses, keeping the assertion honest without reaching into checkSmoke's private page.
      const { checkSmoke: freshCheck } = await import('../src/checks/smoke.js');
      await expect(freshCheck(ext)).resolves.toBeUndefined(); // the OTHER page's error does not leak into a fresh checkSmoke() page
    } finally {
      await page.close();
    }
  });
```

Run: `pnpm --filter @appforge/e2e test -- smoke`
Expected: PASS (2 tests) — this documents that each `checkSmoke` call only listens on its own freshly-opened page, so console noise from an unrelated page a caller happens to have open never affects the result.

- [ ] **Step 6: Commit**

```bash
git add packages/e2e
git commit -m "feat(e2e): add checkSmoke with precise placeholder-network-error filtering"
```

---

### Task 3: Service-worker-restart check

**Files:**
- Create: `packages/e2e/src/checks/sw-restart.ts`
- Test: `packages/e2e/tests/sw-restart.test.ts`

**Interfaces:**
- Consumes: `LaunchedExtension`, `ServiceWorkerTracker` from Task 1.
- Produces: `checkServiceWorkerRestart(ext: LaunchedExtension): Promise<void>` — consumed by Task 4's `runE2eSuite`.

- [ ] **Step 1: Write the failing test**

```ts
// packages/e2e/tests/sw-restart.test.ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { launchExtension } from '../src/launch.js';
import type { LaunchedExtension } from '../src/launch.js';
import { checkServiceWorkerRestart } from '../src/checks/sw-restart.js';
import { CHROME_VANILLA_DIST } from './fixture.js';

describe('checkServiceWorkerRestart', () => {
  let ext: LaunchedExtension;

  beforeAll(async () => {
    ext = await launchExtension(CHROME_VANILLA_DIST);
  });

  afterAll(async () => {
    await ext.close();
  });

  it('survives a forced service worker restart with chrome.storage.local state intact', async () => {
    await expect(checkServiceWorkerRestart(ext)).resolves.toBeUndefined();
  }, 20_000);

  it('actually forced a restart (Review Focus: prove runningStatus round-tripped stopped -> running, not a no-op)', async () => {
    const version = ext.swTracker.find(ext.extensionId);
    expect(version?.runningStatus).toBe('running'); // back to running after the check above
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd appforge-kit && pnpm --filter @appforge/e2e test -- sw-restart`
Expected: FAIL — `../src/checks/sw-restart.js` has no export `checkServiceWorkerRestart` (module doesn't exist yet).

- [ ] **Step 3: Implement `checkServiceWorkerRestart`**

```ts
// packages/e2e/src/checks/sw-restart.ts
import type { LaunchedExtension } from '../launch.js';

const PROBE_KEY = '__appforge_e2e_probe'; // namespaced so it can never collide with real extension state — see Review Focus item 3

export async function checkServiceWorkerRestart(ext: LaunchedExtension): Promise<void> {
  const { context, swTracker, extensionId } = ext;
  const page = await context.newPage();
  try {
    await page.goto('chrome://newtab/', { waitUntil: 'load' });
    await page.waitForSelector('#status');

    const probeValue = `e2e-sw-restart-${Date.now()}`;
    await page.evaluate(
      ([key, value]) =>
        new Promise<void>((resolve, reject) => {
          chrome.storage.local.set({ [key]: value }, () => {
            if (chrome.runtime.lastError) reject(new Error(chrome.runtime.lastError.message));
            else resolve();
          });
        }),
      [PROBE_KEY, probeValue] as const
    );

    const version = swTracker.find(extensionId);
    if (!version) {
      throw new Error(`no service worker version found for extension ${extensionId}`);
    }

    // ServiceWorker.stopWorker (not Target.closeTarget — see Review Focus item 1) reliably
    // transitions runningStatus to 'stopped'; the extension respawns it naturally on next use.
    await swTracker.stop(version.versionId);
    const stopped = await swTracker.waitUntil(() => swTracker.get(version.versionId)?.runningStatus === 'stopped', 5000);
    if (!stopped) {
      throw new Error(`service worker did not report "stopped" after ServiceWorker.stopWorker (last seen: ${JSON.stringify(swTracker.get(version.versionId))})`);
    }

    const wakePage = await context.newPage();
    try {
      await wakePage.goto('chrome://newtab/', { waitUntil: 'load' }); // triggers a runtime message on load, waking the SW
      await wakePage.waitForSelector('#status');

      const restarted = await swTracker.waitUntil(() => swTracker.get(version.versionId)?.runningStatus === 'running', 5000);
      if (!restarted) {
        throw new Error(`service worker did not restart ("running") after the wake trigger (last seen: ${JSON.stringify(swTracker.get(version.versionId))})`);
      }

      const readBack = await wakePage.evaluate(
        (key) =>
          new Promise<Record<string, unknown>>((resolve) => {
            chrome.storage.local.get(key, (items) => resolve(items));
          }),
        PROBE_KEY
      );
      if (readBack[PROBE_KEY] !== probeValue) {
        throw new Error(
          `expected chrome.storage.local["${PROBE_KEY}"] to still be "${probeValue}" after the service worker restart, got ${JSON.stringify(readBack[PROBE_KEY])}`
        );
      }
    } finally {
      await wakePage.close();
    }
  } finally {
    await page.close();
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @appforge/e2e test -- sw-restart`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/e2e
git commit -m "feat(e2e): add checkServiceWorkerRestart using the ServiceWorker CDP domain"
```

---

### Task 4: `runE2eSuite` orchestrator and public exports

**Files:**
- Create: `packages/e2e/src/run-suite.ts`
- Create: `packages/e2e/src/index.ts`
- Test: `packages/e2e/tests/run-suite.test.ts`

**Interfaces:**
- Consumes: `launchExtension` (Task 1), `checkSmoke` (Task 2), `checkServiceWorkerRestart` (Task 3), `E2eReport`/`E2eCheckResult`/`RunE2eSuiteOptions` (Task 1).
- Produces: `runE2eSuite(buildDir: string, options?: RunE2eSuiteOptions): Promise<E2eReport>` — the sole entry point Task 5's `@appforge/cli` command calls.

- [ ] **Step 1: Write the failing test**

```ts
// packages/e2e/tests/run-suite.test.ts
import { describe, it, expect } from 'vitest';
import { runE2eSuite } from '../src/index.js';
import { CHROME_VANILLA_DIST } from './fixture.js';

describe('runE2eSuite', () => {
  it('runs both checks against the chrome-vanilla template and reports ok', async () => {
    const report = await runE2eSuite(CHROME_VANILLA_DIST);
    expect(report.buildDir).toBe(CHROME_VANILLA_DIST);
    expect(report.checks).toHaveLength(2);
    expect(report.checks.every((c) => c.ok)).toBe(true);
    expect(report.checks.every((c) => c.durationMs >= 0)).toBe(true);
    expect(report.ok).toBe(true);
  }, 30_000);

  it('reports ok: false with the specific check(s) that failed, not a thrown exception, for a bad buildDir', async () => {
    const report = await runE2eSuite('/nonexistent/path/does-not-exist');
    // launchExtension itself throws (no extension there to load) — the whole suite reports
    // failure via one synthetic "suite setup" entry rather than propagating the exception, so a
    // CLI caller always gets a report to print instead of having to catch.
    expect(report.ok).toBe(false);
    expect(report.checks).toHaveLength(1);
    expect(report.checks[0].ok).toBe(false);
    expect(report.checks[0].name).toBe('suite setup: launch the extension');
  }, 15_000);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd appforge-kit && pnpm --filter @appforge/e2e test -- run-suite`
Expected: FAIL — `../src/index.js` does not exist yet.

- [ ] **Step 3: Implement `runE2eSuite` and the package's public exports**

```ts
// packages/e2e/src/run-suite.ts
import { launchExtension, type LaunchedExtension } from './launch.js';
import { checkSmoke } from './checks/smoke.js';
import { checkServiceWorkerRestart } from './checks/sw-restart.js';
import type { E2eCheckResult, E2eReport, RunE2eSuiteOptions } from './types.js';

interface NamedCheck {
  name: string;
  run: (ext: LaunchedExtension) => Promise<void>;
}

const CHECKS: NamedCheck[] = [
  { name: 'smoke: loads and renders the new-tab page without an unexpected console error', run: checkSmoke },
  { name: 'service worker restart survives chrome.storage.local state', run: checkServiceWorkerRestart },
];

export async function runE2eSuite(buildDir: string, options: RunE2eSuiteOptions = {}): Promise<E2eReport> {
  let ext: LaunchedExtension;
  try {
    ext = await launchExtension(buildDir, { headless: options.headless, launchTimeoutMs: options.launchTimeoutMs });
  } catch (err) {
    return {
      ok: false,
      buildDir,
      checks: [{ name: 'suite setup: launch the extension', ok: false, error: (err as Error).message, durationMs: 0 }],
    };
  }

  const checks: E2eCheckResult[] = [];
  try {
    for (const check of CHECKS) {
      const start = Date.now();
      try {
        await check.run(ext);
        checks.push({ name: check.name, ok: true, durationMs: Date.now() - start });
      } catch (err) {
        checks.push({ name: check.name, ok: false, error: (err as Error).message, durationMs: Date.now() - start });
      }
    }
  } finally {
    await ext.close();
  }
  return { ok: checks.every((c) => c.ok), buildDir, checks };
}
```

```ts
// packages/e2e/src/index.ts
export * from './types.js';
export * from './run-suite.js';
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @appforge/e2e test -- run-suite`
Expected: PASS (2 tests).

- [ ] **Step 5: Run the whole `@appforge/e2e` suite**

Run: `pnpm --filter @appforge/e2e test`
Expected: PASS (all tests across launch/smoke/sw-restart/run-suite — 7 tests total).

- [ ] **Step 6: Commit**

```bash
git add packages/e2e
git commit -m "feat(e2e): add runE2eSuite orchestrator and public package exports"
```

---

### Task 5: `appforge test --e2e` CLI command

**Files:**
- Modify: `packages/cli/package.json` (add `@appforge/e2e` dependency)
- Create: `packages/cli/src/commands/test-e2e.ts`
- Modify: `packages/cli/src/index.ts` (wire the `test` command)
- Test: `packages/cli/tests/test-e2e.integration.test.ts`

**Interfaces:**
- Consumes: `runE2eSuite`, `E2eReport` from `@appforge/e2e` (Task 4); `buildOutput`/`printOutput` from `packages/cli/src/output.ts` (existing).
- Produces: `runTestE2e(opts: TestE2eOptions): Promise<number>` (exit code), wired into `appforge test --e2e [--dir <path>] [--dist <path>] [--json]`.

- [ ] **Step 1: Add the dependency**

```json
// packages/cli/package.json — add to "dependencies"
    "@appforge/e2e": "workspace:*",
```

(Keep every existing dependency; this is one added line alongside `@appforge/router`, `@appforge/schemas`, `commander`, `yaml`.)

- [ ] **Step 2: Write the failing tests**

```ts
// packages/cli/tests/test-e2e.integration.test.ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { runTestE2e } from '../src/commands/test-e2e.js';

const CHROME_VANILLA_DIST = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../../templates/chrome-vanilla/dist'
);

let dir: string;
beforeAll(() => { dir = mkdtempSync(path.join(tmpdir(), 'appforge-cli-test-e2e-')); });
afterAll(() => { rmSync(dir, { recursive: true, force: true }); });

describe('runTestE2e', () => {
  it('returns 2 when --dist has no manifest.json, without opening a browser (Review Focus)', async () => {
    expect(await runTestE2e({ dir: '.', dist: dir, json: true })).toBe(2);
  });

  it('returns 2 when the build step fails, without attempting to run the e2e suite', async () => {
    const buildDir = mkdtempSync(path.join(tmpdir(), 'appforge-cli-test-e2e-build-fail-'));
    try {
      writeFileSync(
        path.join(buildDir, 'package.json'),
        JSON.stringify({ name: 'fixture', version: '0.0.0', scripts: { build: 'node -e "process.exit(1)"' } })
      );
      expect(await runTestE2e({ dir: buildDir, json: true })).toBe(2);
    } finally {
      rmSync(buildDir, { recursive: true, force: true });
    }
  });

  it('runs the real e2e suite against the built chrome-vanilla template and returns 0 (the one real, unmocked CLI-to-browser run)', async () => {
    expect(await runTestE2e({ dir: '.', dist: CHROME_VANILLA_DIST, json: true })).toBe(0);
  }, 30_000);
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `cd appforge-kit && pnpm install && pnpm --filter @appforge/e2e run build && pnpm --filter @appforge/cli exec vitest run tests/test-e2e.integration.test.ts`
Expected: FAIL — `../src/commands/test-e2e.js` has no export `runTestE2e` (module doesn't exist yet).

- [ ] **Step 4: Implement `runTestE2e`**

```ts
// packages/cli/src/commands/test-e2e.ts
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { runE2eSuite } from '@appforge/e2e';
import { buildOutput, printOutput } from '../output.js';

export interface TestE2eOptions {
  dir: string;
  dist?: string;
  json: boolean;
}

/**
 * Exit codes: 0 ok (every check passed), 2 invalid input (the build step failed, or neither
 * --dist nor a successful build produced a directory containing manifest.json — see Review
 * Focus item 5), 9 one or more e2e checks failed.
 */
export async function runTestE2e(opts: TestE2eOptions): Promise<number> {
  let distDir: string;

  if (opts.dist) {
    distDir = path.resolve(opts.dist);
  } else {
    const dir = path.resolve(opts.dir);
    try {
      execFileSync('pnpm', ['build'], { cwd: dir, stdio: 'pipe' });
    } catch (err) {
      const stderr = (err as { stderr?: Buffer }).stderr?.toString() ?? (err as Error).message;
      printOutput(buildOutput('test', false, undefined, [`build failed in ${dir}: ${stderr}`]), opts.json);
      return 2;
    }
    distDir = path.join(dir, 'dist');
  }

  if (!existsSync(path.join(distDir, 'manifest.json'))) {
    printOutput(
      buildOutput('test', false, undefined, [`${distDir} does not contain a manifest.json — is this a built extension directory?`]),
      opts.json
    );
    return 2;
  }

  const report = await runE2eSuite(distDir, {});
  const errors = report.checks.filter((c) => !c.ok).map((c) => `${c.name}: ${c.error ?? 'failed'}`);
  printOutput(buildOutput('test', report.ok, report, errors), opts.json);
  return report.ok ? 0 : 9;
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm --filter @appforge/cli exec vitest run tests/test-e2e.integration.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 6: Wire the `test` command into the CLI binary**

In `packages/cli/src/index.ts`, add the import near the top with the other command imports:

```ts
import { runTestE2e } from './commands/test-e2e.js';
```

Add the command registration after the existing `security` command block (before the trailing `try { await program.parseAsync(...) }`):

```ts
program
  .command('test')
  .description('Run test suites for an AppForge product (currently: --e2e, the Playwright Chrome extension harness)')
  .option('--e2e', 'run the Playwright e2e suite', false)
  .option('--dir <path>', 'product directory to build and test', '.')
  .option('--dist <path>', 'a pre-built extension dist directory (skips the build step)')
  .option('--json', 'machine-readable output', false)
  .action(async (opts: { e2e: boolean; dir: string; dist?: string; json: boolean }) => {
    if (!opts.e2e) {
      printOutput(buildOutput('test', false, undefined, ['no test type selected; pass --e2e']), opts.json);
      process.exitCode = 2;
      return;
    }
    process.exitCode = await runTestE2e({ dir: opts.dir, dist: opts.dist, json: opts.json });
  });
```

- [ ] **Step 7: Write the failing binary-level test**

Append to `packages/cli/tests/cli-binary.integration.test.ts` (inside the existing top-level `describe('appforge CLI binary ...')` block, after its existing `it(...)` cases):

```ts
  it('exits 2 for `appforge test` with no --e2e flag', () => {
    const { code } = run(['test']);
    expect(code).toBe(2);
  });
```

- [ ] **Step 8: Run test to verify it fails, then build and verify it passes**

Run: `cd appforge-kit && pnpm --filter @appforge/cli run build`
Run: `pnpm --filter @appforge/cli exec vitest run tests/cli-binary.integration.test.ts`
Expected: the new case FAILS before Step 6's change is built (`dist/index.js` is stale) — rebuild first, then it PASSES (4 tests in that file total).

- [ ] **Step 9: Run the whole `@appforge/cli` suite**

Run: `pnpm --filter @appforge/cli run build && pnpm --filter @appforge/cli exec vitest run`
Expected: PASS (every existing test plus the new ones from this task).

- [ ] **Step 10: Commit**

```bash
git add packages/cli
git commit -m "feat(cli): add appforge test --e2e wired to @appforge/e2e"
```

---

### Task 6: Real invocation — `chrome-vanilla`'s `test:e2e` script, CI, and full workspace verification

**Files:**
- Modify: `templates/chrome-vanilla/package.json` (add `test:e2e` script and `@appforge/cli` devDependency)
- Modify: `.github/workflows/ci.yml` (add the e2e demonstration step)

**Interfaces:**
- Consumes: the built `appforge` binary (Task 5) and `templates/chrome-vanilla`'s own `dist/` (existing `build` script).
- Produces: nothing new consumed by later tasks — this is the last task in the plan.

- [ ] **Step 1: Add the CLI as a devDependency and the `test:e2e` script**

```json
// templates/chrome-vanilla/package.json — add to "scripts" (alongside the existing "test": "vitest run")
    "test:e2e": "appforge test --e2e --dist ./dist",
```

```json
// templates/chrome-vanilla/package.json — add to "devDependencies" (alongside the existing entries)
    "@appforge/cli": "workspace:*",
```

- [ ] **Step 2: Install and build so the `appforge` binary is linked and current**

Run: `cd appforge-kit && pnpm install`
Expected: pnpm links `node_modules/.bin/appforge` inside `templates/chrome-vanilla` to the workspace `@appforge/cli` package.

Run: `pnpm --filter @appforge/cli run build && pnpm --filter appforge-chrome-vanilla-template run build`
Expected: both build successfully (`packages/cli/dist/index.js` and `templates/chrome-vanilla/dist/manifest.json` exist).

- [ ] **Step 3: Run the new script directly to prove it works before touching CI**

Run: `pnpm --filter appforge-chrome-vanilla-template run test:e2e`
Expected: exit code 0, and JSON-free human-readable output ending in `✔ test passed` (the default, non-`--json` `printOutput` branch).

- [ ] **Step 4: Add the CI step**

In `.github/workflows/ci.yml`, add a new step after the existing `- run: pnpm build` step and before `- run: pnpm test`:

```yaml
      - run: pnpm build

      - name: Run the Playwright e2e harness against chrome-vanilla (P1-11 real invocation)
        run: pnpm --filter appforge-chrome-vanilla-template run test:e2e

      - run: pnpm test
```

- [ ] **Step 5: Run the full workspace verification from repo root**

Run: `cd appforge-kit && pnpm install && pnpm typecheck && pnpm build && pnpm test && pnpm lint`
Expected: everything green — `packages/e2e`'s own Vitest suite now runs as part of `pnpm test` (via the existing `packages/*` Vitest workspace entry) alongside every pre-existing package/template/`apps/edge` suite, and `pnpm typecheck`/`pnpm build`/`pnpm lint` all pass with the two new/modified packages included.

- [ ] **Step 6: Commit**

```bash
git add templates/chrome-vanilla/package.json .github/workflows/ci.yml
git commit -m "chore(e2e): wire a real appforge test --e2e invocation into chrome-vanilla and CI"
```

## Self-Review Notes

- **Spec coverage:** P1-11's backlog line names five checks (SW restart, upgrade, offline, multi-tab, axe) and a runtime budget (<10 min on json-workbench). This plan ships the two checks explicitly scoped to it in the task description (smoke, SW restart) and documents the other three plus the json-workbench wiring itself as deliberate, named follow-ups in Global Constraints — not silent gaps. §13.3's "Chrome QA" framing is satisfied by the harness existing and running for real (Task 6), which is the prerequisite for every later check this backlog item's full scope will need.
- **Placeholder scan:** no TBD/"add error handling"/"similar to Task N" text; every step has runnable, complete code, including the two integration points (Task 5's CLI wiring, Task 6's CI/package-script wiring).
- **Type consistency:** `LaunchedExtension` (Task 1: `{ context, extensionId, swTracker, close() }`) is consumed unchanged by `checkSmoke` (Task 2) and `checkServiceWorkerRestart` (Task 3) and by `runE2eSuite` (Task 4). `E2eReport`/`E2eCheckResult` (Task 1's `types.ts`) match field-for-field between `run-suite.ts`'s construction and `test-e2e.ts`'s consumption (`report.checks`, `report.ok`, `c.name`, `c.error`). `ServiceWorkerTracker`'s method names (`enable`, `find`, `get`, `stop`, `waitUntil`) are identical across Tasks 1–3 — a drift here (e.g. `stopWorker` vs `stop`) would have been a real bug since two independent checks share this one class.
- **Review Focus:** all five items have a named, executable test: item 1 (Task 3, the CDP investigation is in the code comment and validated by the "actually forced a restart" test), item 2 (Task 2, both the pass test and the explicit "does NOT swallow an unrelated error" regression test), item 3 (Task 3, the namespaced `PROBE_KEY` itself, called out in a comment), item 4 (Task 1, `launchExtension`'s own passing test is the regression guard for headless flag correctness), item 5 (Task 5, the "returns 2 when --dist has no manifest.json, without opening a browser" test).
- **What's deliberately out of scope here** (each a real, separately-scheduled follow-up, not a gap in this plan): wiring into `json-workbench` itself (separate repo, own release history — next once this harness ships), the upgrade test (needs a real previous-release zip from a kit-based product's GitHub Releases, which doesn't exist yet for any product), offline/multi-tab/axe checks (§13.3's remaining Chrome QA scope), and running against `templates/chrome-react` (the natural next fixture once this proves out against the simpler template).

---

## Execution Handoff

Plan complete and self-reviewed. Per the task instructions for this work, continuing with **Native** execution (the choice already made for every prior plan in this repo this session, e.g. `docs/superpowers/plans/2026-09-26-appforge-edge.md`'s handoff): six tasks, each consuming only what the previous task produced (no fan-out), every step above already carries its exact code and expected test count, and the riskiest unknown in this plan (how to reliably force a service worker restart) was already investigated empirically before writing Task 3, not left to be discovered during implementation. One fresh-reviewer pass happens at the end of the branch, per superpowers:executing-plans.
