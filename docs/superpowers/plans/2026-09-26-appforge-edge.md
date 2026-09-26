# appforge-edge (Cloudflare Worker + D1) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build `apps/edge`, a Cloudflare Worker backed by D1, that gives every AppForge product a single telemetry/config/feedback backend — plus the client-side `@appforge/telemetry` package extensions use to queue and batch events to it — per the master plan's P1-10 backlog item.

**Architecture:** A new `apps/edge` app inside the existing `appforge-kit` pnpm monorepo (reusing its CI, tsconfig base, and vitest workspace rather than a new repo). The Worker is plain TypeScript with a hand-rolled router (no framework — five endpoints don't need one), backed by one D1 database. `@appforge/telemetry` is a new pure, dependency-injected package (same DI pattern as `@appforge/storage`/`@appforge/messaging`) that queues events client-side; it does not itself call `fetch` — the extension's own code drains the queue and posts the batch, keeping the package testable without a network mock. Worker tests run against a real (locally-simulated) D1 database via `@cloudflare/vitest-pool-workers`, not against a live Cloudflare account — no network calls or cost during TDD.

**Tech Stack:** TypeScript (strict), Cloudflare Workers, D1, `wrangler` 4.x, `@cloudflare/vitest-pool-workers`, Vitest 2.x (existing monorepo pin), pnpm workspaces.

**Spec:** `~/git-personal/.claude/appforge-ai-master-plan.md` — specifically §13.1 (`@appforge/telemetry` description), §16.3 (data classification / allowlisted telemetry props), §18b (event taxonomy, envelope shape, analytics architecture), §21.1/§29d (D1 data models, `events_raw`/`metrics_daily`/`feedback` DDL), §29e (`Analytics` API contract: `POST /v1/events` batch ≤ 50, `GET /v1/metrics`, `POST /v1/ingest/{source}`), §29f (`analytics.yaml` allowlist shape), §28 (Cloudflare Workers/D1/R2 free tier, "verify limits P1-10"), backlog item P1-10.

## Global Constraints

- Node ≥ 22.0, TypeScript `strict: true` (matches the rest of the monorepo, `tsconfig.base.json`).
- `apps/edge` is a new pnpm workspace member — add `"apps/*"` to `pnpm-workspace.yaml` and to `vitest.workspace.ts`'s project list before anything else, or its tests never run under root `pnpm test`.
- The D1 schema for this plan covers only the tables its own endpoints use: `events_raw`, `metrics_daily`, `feedback`, `product_config`. The remaining §29d tables (`releases`, `incidents`, `revenue`, `costs`, `ai_usage`, `product_state_log`) belong to later backlog items (P1-13 release gating, P1-15 economics ingestion) and are out of scope — adding empty unused tables now is scope creep the master plan's own principles (§3.3 "do we need it now?") argue against.
- Schema lives once, as `SCHEMA_STATEMENTS: readonly string[]` in `apps/edge/src/schema.ts` (plain TS, not a `.sql` file) — Workers (and the `@cloudflare/vitest-pool-workers` runtime that simulates them) have no real filesystem, so a `.sql` file read at runtime would not work. Both the test helper and the one-time real-database migration script import this same constant, so there is exactly one place the schema is written.
- Every POST endpoint must return `400` for malformed JSON or a body that fails validation, never let an uncaught exception reach the Workers runtime (which turns it into an opaque `1101` error indistinguishable from an edge outage).
- `POST /v1/events` enforces the §29e batch cap of **≤ 50** events per request; a bigger batch is rejected outright (`400`), not silently truncated — the client needs to learn to split it, not lose events without knowing.
- Telemetry props are allowlisted per event, per product (§16.3: "props allowlisted per product in `analytics.yaml`; edge drops others"). An unlisted event or prop is dropped, never written to D1 and never returned as an error — a stray prop is normally a client bug or probe, not something worth surfacing to the sender.
- `POST /v1/ingest/:source` is the only endpoint that can write arbitrary metric values; it is gated by a bearer token (`INGEST_ADMIN_TOKEN`), checked with plain string equality against an `Authorization: Bearer <token>` header — no session state, no cookies, matching the "public write-only ingress, bearer-scoped admin ingress" split in §18/§29e.
- **Ruling (recorded here so later tasks don't re-litigate it):** the master plan's §18/§28 language about separate staging/prod D1 namespaces is deferred until a real product actually points at this Worker (P1-18). This plan builds one Worker, one D1 database, no environment split — the smallest thing that is honestly useful today. Splitting environments later is a `wrangler.toml` `[env.*]` addition, not a rewrite.
- Rate limiting on `/v1/events` and `/v1/feedback` is a **per-isolate, in-memory sliding window** (`RateLimiter` in Task 3), not a distributed limiter — Cloudflare Workers has no free-tier Durable Objects, and a D1-backed limiter would cost a write per request for no real benefit at current traffic. This is a recorded design choice, not an oversight: the upgrade path if abuse ever appears is Cloudflare's dashboard-level Rate Limiting Rules (a config change, not a code change).
- If `pnpm install` reports a peer-dependency conflict between the root's pinned `vitest@^2.1.0` and `@cloudflare/vitest-pool-workers`, resolve it by adjusting the `vitest`/`@cloudflare/vitest-pool-workers` version pins together (whichever combination `pnpm install` accepts cleanly) rather than fighting the installer — record the actual versions used in the Task 2 ledger entry.

## Review Focus

- **Replayed batch (network retry).** A client resends the exact same `/v1/events` batch after a timeout it never saw the response to. The row count in `events_raw` must not double — idempotency is the whole point of the `(install_id, seq)` primary key plus `INSERT OR IGNORE`. Covered in Task 3.
- **Undeclared event or prop.** A batch contains an event name or a prop key the product's allowlist doesn't list (a client bug, a stale build, or a probe). It must be dropped silently — not written verbatim, not rejected with an error that tells a prober what's allowed. Covered in Task 3.
- **Unauthorized ingest.** A `POST /v1/ingest/:source` call arrives with no `Authorization` header or the wrong token. Since this endpoint can write arbitrary metric rows, it must return `401`, not silently accept the write — this is the one endpoint in this plan that isn't meant to be public. Covered in Task 5.
- **Oversized batch.** A batch of more than 50 events (§29e's stated cap) arrives. It must be rejected with `400` and nothing written, not silently truncated to 50 and accepted — a silent truncation would look like data loss without an error, the worst of both outcomes. Covered in Task 3.
- **Malformed body on any POST endpoint.** Not-quite-JSON, an array where an object was expected, or vice versa. Every POST handler must return `400`, never let `request.json()` or a validation step throw uncaught into the Workers runtime. Covered in Tasks 3, 4, and 5.

---

### Task 1: `@appforge/telemetry` — client-side event queue

**Files:**
- Create: `packages/telemetry/package.json`
- Create: `packages/telemetry/tsconfig.json`
- Create: `packages/telemetry/tsconfig.build.json`
- Create: `packages/telemetry/src/types.ts`
- Create: `packages/telemetry/src/queue.ts`
- Create: `packages/telemetry/src/index.ts`
- Test: `packages/telemetry/tests/queue.test.ts`

**Interfaces:**
- Consumes: `ChromeStorageArea`, `VersionedStorage` from `@appforge/storage` (already built, P1-08).
- Produces: `EventEnvelope`, `TelemetryQueueOptions`, `TelemetryQueue` — the envelope shape matches §18b exactly (`v`, `product`, `app_version`, `env`, `install_id`, `session_id`, `ts`, `event`, `props`, `seq`) and is what Task 3's `validateEnvelope` on the Worker side parses. `TelemetryQueue.drain()` is what a later extension's background script calls before POSTing to `/v1/events` (that POST call itself is out of scope here — this package only queues and hands back envelopes).

- [ ] **Step 1: Scaffold the package**

```json
// packages/telemetry/package.json
{
  "name": "@appforge/telemetry",
  "version": "0.1.0",
  "type": "module",
  "main": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "scripts": { "build": "tsc -p tsconfig.build.json" },
  "dependencies": { "@appforge/storage": "workspace:*" },
  "devDependencies": { "typescript": "^5.6.0" }
}
```

```json
// packages/telemetry/tsconfig.json
{
  "extends": "../../tsconfig.base.json",
  "include": ["src", "tests"]
}
```

```json
// packages/telemetry/tsconfig.build.json
{
  "extends": "./tsconfig.json",
  "compilerOptions": { "rootDir": "./src", "outDir": "./dist" },
  "include": ["src"]
}
```

```ts
// packages/telemetry/src/types.ts
/** The wire envelope sent to appforge-edge POST /v1/events (master plan §18b, taxonomy@1). */
export interface EventEnvelope {
  v: 1;
  product: string;
  app_version: string;
  env: 'dev' | 'staging' | 'prod';
  install_id: string;
  session_id: string;
  ts: number;
  event: string;
  props: Record<string, unknown>;
  seq: number;
}

export interface TelemetryQueueOptions {
  product: string;
  appVersion: string;
  env: 'dev' | 'staging' | 'prod';
  installId: string;
  sessionId: string;
  /** Oldest events are dropped once the queue holds this many (default 500, per §18b). */
  maxQueueSize?: number;
  now?: () => number;
}
```

- [ ] **Step 2: Write the failing test**

```ts
// packages/telemetry/tests/queue.test.ts
import { describe, it, expect } from 'vitest';
import type { ChromeStorageArea } from '@appforge/storage';
import { TelemetryQueue } from '../src/index.js';

function fakeArea(initial: Record<string, unknown> = {}): ChromeStorageArea {
  const store: Record<string, unknown> = { ...initial };
  return {
    async get(key: string) {
      return key in store ? { [key]: store[key] } : {};
    },
    async set(items: Record<string, unknown>) {
      Object.assign(store, items);
    },
    async remove(key: string) {
      delete store[key];
    },
  };
}

const BASE_OPTIONS = {
  product: 'json-workbench',
  appVersion: '0.2.0',
  env: 'dev' as const,
  installId: 'install-abc',
  sessionId: 'session-1',
};

describe('TelemetryQueue', () => {
  it('enqueues an event with seq 0 on a fresh queue', async () => {
    const queue = new TelemetryQueue(fakeArea(), { ...BASE_OPTIONS, now: () => 1000 });
    const envelope = await queue.enqueue('feature_used', { feature: 'pipeline_run' });
    expect(envelope).toEqual({
      v: 1, product: 'json-workbench', app_version: '0.2.0', env: 'dev',
      install_id: 'install-abc', session_id: 'session-1', ts: 1000,
      event: 'feature_used', props: { feature: 'pipeline_run' }, seq: 0,
    });
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `cd appforge-kit && pnpm install && pnpm --filter @appforge/telemetry test`
Expected: FAIL — `../src/index.js` has no export `TelemetryQueue` (module doesn't exist yet).

- [ ] **Step 4: Implement the queue**

```ts
// packages/telemetry/src/queue.ts
import { VersionedStorage, type ChromeStorageArea } from '@appforge/storage';
import type { EventEnvelope, TelemetryQueueOptions } from './types.js';

interface QueuedState {
  seq: number;
  events: EventEnvelope[];
}

const DEFAULT_MAX_QUEUE_SIZE = 500;
const STORAGE_KEY = 'appforge_telemetry_queue';
const STORAGE_VERSION = 1;

export class TelemetryQueue {
  private readonly storage: VersionedStorage<QueuedState>;
  private readonly maxQueueSize: number;
  private readonly now: () => number;

  constructor(area: ChromeStorageArea, private readonly options: TelemetryQueueOptions) {
    this.maxQueueSize = options.maxQueueSize ?? DEFAULT_MAX_QUEUE_SIZE;
    this.now = options.now ?? Date.now;
    this.storage = new VersionedStorage<QueuedState>(area, STORAGE_KEY, STORAGE_VERSION, [], { seq: 0, events: [] });
  }

  async enqueue(event: string, props: Record<string, unknown> = {}): Promise<EventEnvelope> {
    const state = await this.storage.get();
    const envelope: EventEnvelope = {
      v: 1,
      product: this.options.product,
      app_version: this.options.appVersion,
      env: this.options.env,
      install_id: this.options.installId,
      session_id: this.options.sessionId,
      ts: this.now(),
      event,
      props,
      seq: state.seq,
    };
    const events = [...state.events, envelope].slice(-this.maxQueueSize);
    await this.storage.set({ seq: state.seq + 1, events });
    return envelope;
  }

  async size(): Promise<number> {
    return (await this.storage.get()).events.length;
  }

  /** Returns the queued envelopes and clears the queue; the seq counter is preserved. */
  async drain(): Promise<EventEnvelope[]> {
    const state = await this.storage.get();
    await this.storage.set({ seq: state.seq, events: [] });
    return state.events;
  }
}
```

```ts
// packages/telemetry/src/index.ts
export * from './types.js';
export * from './queue.js';
```

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm --filter @appforge/telemetry test`
Expected: PASS (1 test).

- [ ] **Step 6: Add the remaining behaviors as tests, then confirm they pass**

Append to `packages/telemetry/tests/queue.test.ts`:

```ts
  it('defaults props to an empty object when none are given', async () => {
    const queue = new TelemetryQueue(fakeArea(), BASE_OPTIONS);
    const envelope = await queue.enqueue('app_installed');
    expect(envelope.props).toEqual({});
  });

  it('increments seq on each enqueue', async () => {
    const queue = new TelemetryQueue(fakeArea(), BASE_OPTIONS);
    const first = await queue.enqueue('a');
    const second = await queue.enqueue('b');
    expect(first.seq).toBe(0);
    expect(second.seq).toBe(1);
  });

  it('persists the seq counter across queue instances backed by the same storage (Review Focus: survives a restart)', async () => {
    const area = fakeArea();
    await new TelemetryQueue(area, BASE_OPTIONS).enqueue('a');
    const reopened = new TelemetryQueue(area, BASE_OPTIONS);
    const envelope = await reopened.enqueue('b');
    expect(envelope.seq).toBe(1);
  });

  it('caps the queue at maxQueueSize, dropping the oldest event', async () => {
    const queue = new TelemetryQueue(fakeArea(), { ...BASE_OPTIONS, maxQueueSize: 2 });
    await queue.enqueue('a');
    await queue.enqueue('b');
    await queue.enqueue('c');
    const drained = await queue.drain();
    expect(drained.map((e) => e.event)).toEqual(['b', 'c']);
  });

  it('drain clears the queue so a second drain returns empty, but keeps the seq counter', async () => {
    const queue = new TelemetryQueue(fakeArea(), BASE_OPTIONS);
    await queue.enqueue('a');
    const first = await queue.drain();
    const second = await queue.drain();
    expect(first).toHaveLength(1);
    expect(second).toEqual([]);
    const next = await queue.enqueue('b');
    expect(next.seq).toBe(1);
  });

  it('starts fresh without throwing when storage has nothing stored yet', async () => {
    const queue = new TelemetryQueue(fakeArea(), BASE_OPTIONS);
    expect(await queue.size()).toBe(0);
  });
```

Run: `pnpm --filter @appforge/telemetry test`
Expected: PASS (7 tests total).

- [ ] **Step 7: Commit**

```bash
git add packages/telemetry
git commit -m "feat(telemetry): add TelemetryQueue client-side event queue"
```

---

### Task 2: `apps/edge` scaffold — workspace wiring, D1 schema, health check

**Files:**
- Modify: `pnpm-workspace.yaml` (add `apps/*`)
- Modify: `vitest.workspace.ts` (add `apps/*`)
- Create: `apps/edge/package.json`
- Create: `apps/edge/wrangler.toml`
- Create: `apps/edge/tsconfig.json`
- Create: `apps/edge/vitest.config.ts`
- Create: `apps/edge/.gitignore`
- Create: `apps/edge/src/schema.ts`
- Create: `apps/edge/src/index.ts`
- Create: `apps/edge/tests/test-helpers.ts`
- Test: `apps/edge/tests/health.test.ts`

**Interfaces:**
- Consumes: nothing from Task 1.
- Produces: `Env` interface (`DB`, `APPFORGE_ENV`, `INGEST_ADMIN_TOKEN`), `SCHEMA_STATEMENTS`, `applySchema(db)` test helper — all consumed by Tasks 3–5.

- [ ] **Step 1: Wire the new workspace member**

```yaml
# pnpm-workspace.yaml
packages:
  - "packages/*"
  - "templates/*"
  - "apps/*"
```

```ts
// vitest.workspace.ts
import { defineWorkspace } from 'vitest/config';

export default defineWorkspace(['packages/*', 'templates/*', 'apps/*']);
```

- [ ] **Step 2: Scaffold the app**

```json
// apps/edge/package.json
{
  "name": "@appforge/edge",
  "private": true,
  "version": "0.1.0",
  "type": "module",
  "scripts": {
    "dev": "wrangler dev",
    "deploy": "wrangler deploy",
    "db:migrate": "node --experimental-strip-types scripts/apply-schema.ts",
    "test": "vitest run"
  },
  "devDependencies": {
    "wrangler": "^4.87.0",
    "@cloudflare/vitest-pool-workers": "^0.22.0",
    "@cloudflare/workers-types": "^5.20260926.1",
    "typescript": "^5.6.0",
    "vitest": "^2.1.0"
  }
}
```

```toml
# apps/edge/wrangler.toml
name = "appforge-edge"
main = "src/index.ts"
compatibility_date = "2026-01-01"
compatibility_flags = ["nodejs_compat"]

[[d1_databases]]
binding = "DB"
database_name = "appforge-edge-db"
database_id = "REPLACE_AFTER_WRANGLER_D1_CREATE"

[vars]
APPFORGE_ENV = "dev"
# Placeholder until `wrangler secret put INGEST_ADMIN_TOKEN` is run before any real ingest
# traffic (Task 6) — fine for local dev and for the Miniflare-simulated tests in this plan,
# which never touch a real Cloudflare account.
INGEST_ADMIN_TOKEN = "dev-only-placeholder-token"
```

```json
// apps/edge/tsconfig.json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "types": ["@cloudflare/workers-types", "@cloudflare/vitest-pool-workers"]
  },
  "include": ["src", "tests"]
}
```

```ts
// apps/edge/vitest.config.ts
import { defineWorkersConfig } from '@cloudflare/vitest-pool-workers/config';

export default defineWorkersConfig({
  test: {
    poolOptions: {
      workers: {
        wrangler: { configPath: './wrangler.toml' },
      },
    },
  },
});
```

```
# apps/edge/.gitignore
.wrangler/
.dev.vars
```

```ts
// apps/edge/src/schema.ts
/**
 * D1 schema (master plan §29d, scoped to what this plan's endpoints use — see Global
 * Constraints). Single source for both tests (env.DB.exec, via tests/test-helpers.ts) and the
 * one-time real-database migration (scripts/apply-schema.ts, Task 6).
 */
export const SCHEMA_STATEMENTS: readonly string[] = [
  `CREATE TABLE IF NOT EXISTS events_raw (
    install_id TEXT NOT NULL,
    seq INTEGER NOT NULL,
    product TEXT NOT NULL,
    app_version TEXT,
    env TEXT NOT NULL,
    event TEXT NOT NULL,
    props TEXT,
    ts INTEGER NOT NULL,
    received_at INTEGER NOT NULL,
    PRIMARY KEY (install_id, seq)
  )`,
  `CREATE INDEX IF NOT EXISTS ev_prod_ts ON events_raw(product, ts)`,
  `CREATE TABLE IF NOT EXISTS metrics_daily (
    product TEXT,
    date TEXT,
    name TEXT,
    value REAL,
    source TEXT,
    PRIMARY KEY (product, date, name, source)
  )`,
  `CREATE TABLE IF NOT EXISTS feedback (
    id TEXT PRIMARY KEY,
    product TEXT,
    source TEXT,
    rating INTEGER,
    text_hash TEXT,
    category TEXT,
    cluster_key TEXT,
    created_at TEXT
  )`,
  `CREATE TABLE IF NOT EXISTS product_config (
    product TEXT PRIMARY KEY,
    config TEXT NOT NULL,
    updated_at TEXT NOT NULL
  )`,
];
```

```ts
// apps/edge/tests/test-helpers.ts
import type { D1Database } from '@cloudflare/workers-types';
import { SCHEMA_STATEMENTS } from '../src/schema.js';

export async function applySchema(db: D1Database): Promise<void> {
  for (const statement of SCHEMA_STATEMENTS) {
    await db.exec(statement);
  }
}
```

- [ ] **Step 3: Write the failing test for the health check**

```ts
// apps/edge/tests/health.test.ts
import { describe, it, expect } from 'vitest';
import { SELF } from 'cloudflare:test';

describe('GET /__health', () => {
  it('returns ok: true', async () => {
    const response = await SELF.fetch('https://example.com/__health');
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true });
  });
});
```

- [ ] **Step 4: Run test to verify it fails**

Run: `cd appforge-kit && pnpm install && pnpm --filter @appforge/edge test`
Expected: FAIL. If `pnpm install` itself reports a peer-dependency conflict between `vitest` and `@cloudflare/vitest-pool-workers`, resolve per Global Constraints (adjust the version pins together) before continuing — record what you landed on in this task's ledger line. Once install succeeds, the test should fail with a routing/connection error (`src/index.ts` has no default export yet), not a dependency error.

- [ ] **Step 5: Implement the health check**

```ts
// apps/edge/src/index.ts
export interface Env {
  DB: D1Database;
  APPFORGE_ENV: string;
  INGEST_ADMIN_TOKEN: string;
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === '/__health') {
      return Response.json({ ok: true });
    }

    return new Response('Not found', { status: 404 });
  },
};
```

- [ ] **Step 6: Run test to verify it passes, then add the 404 case**

Run: `pnpm --filter @appforge/edge test`
Expected: PASS (1 test).

Append to `apps/edge/tests/health.test.ts`:

```ts
  it('returns 404 for an unknown path', async () => {
    const response = await SELF.fetch('https://example.com/nope');
    expect(response.status).toBe(404);
  });
```

Run: `pnpm --filter @appforge/edge test`
Expected: PASS (2 tests).

- [ ] **Step 7: Commit**

```bash
git add pnpm-workspace.yaml vitest.workspace.ts apps/edge
git commit -m "feat(edge): scaffold appforge-edge Worker with D1 schema and health check"
```

---

### Task 3: `POST /v1/events` — validation, allowlist enforcement, idempotent write, rate limit

**Files:**
- Create: `apps/edge/src/validate-envelope.ts`
- Create: `apps/edge/src/allowlist.ts`
- Create: `apps/edge/src/rate-limiter.ts`
- Create: `apps/edge/src/handlers/events.ts`
- Modify: `apps/edge/src/index.ts` (wire the route)
- Test: `apps/edge/tests/events.test.ts`
- Test: `apps/edge/tests/rate-limiter.test.ts`

**Interfaces:**
- Consumes: `Env`, `SCHEMA_STATEMENTS`/`applySchema` from Task 2. `EventEnvelope`'s field names from Task 1 (this handler parses the same wire shape `@appforge/telemetry` produces, though it re-validates independently since it cannot trust the network).
- Produces: `validateEnvelope`, `getAllowlist`, `filterProps`, `RateLimiter`, `handleEvents` — `RateLimiter` is reused as-is by Task 4's `/v1/feedback` handler.

- [ ] **Step 1: Write the failing test for envelope validation**

```ts
// apps/edge/tests/validate-envelope.test.ts
import { describe, it, expect } from 'vitest';
import { validateEnvelope } from '../src/validate-envelope.js';

const VALID = {
  v: 1, product: 'json-workbench', app_version: '0.2.0', env: 'dev',
  install_id: 'install-1', session_id: 'session-1', ts: 1_700_000_000_000,
  event: 'feature_used', props: { feature: 'pipeline_run' }, seq: 0,
};

describe('validateEnvelope', () => {
  it('accepts a well-formed envelope', () => {
    expect(validateEnvelope(VALID)).toEqual(VALID);
  });

  it('defaults props to {} when missing', () => {
    const { props, ...rest } = VALID;
    expect(validateEnvelope(rest)?.props).toEqual({});
  });

  it('rejects a non-object input', () => {
    expect(validateEnvelope('nope')).toBeNull();
    expect(validateEnvelope(null)).toBeNull();
  });

  it('rejects a missing or empty install_id', () => {
    expect(validateEnvelope({ ...VALID, install_id: '' })).toBeNull();
    const { install_id, ...rest } = VALID;
    expect(validateEnvelope(rest)).toBeNull();
  });

  it('rejects a non-integer or negative seq', () => {
    expect(validateEnvelope({ ...VALID, seq: 1.5 })).toBeNull();
    expect(validateEnvelope({ ...VALID, seq: -1 })).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd appforge-kit && pnpm --filter @appforge/edge test -- validate-envelope`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `validateEnvelope`**

```ts
// apps/edge/src/validate-envelope.ts
export interface ValidEnvelope {
  v: 1;
  product: string;
  app_version: string;
  env: string;
  install_id: string;
  session_id: string;
  ts: number;
  event: string;
  props: Record<string, unknown>;
  seq: number;
}

export function validateEnvelope(input: unknown): ValidEnvelope | null {
  if (typeof input !== 'object' || input === null) return null;
  const e = input as Record<string, unknown>;
  if (e.v !== 1) return null;
  if (typeof e.product !== 'string' || e.product.length === 0) return null;
  if (typeof e.app_version !== 'string') return null;
  if (typeof e.env !== 'string') return null;
  if (typeof e.install_id !== 'string' || e.install_id.length === 0) return null;
  if (typeof e.session_id !== 'string') return null;
  if (typeof e.ts !== 'number' || !Number.isFinite(e.ts)) return null;
  if (typeof e.event !== 'string' || e.event.length === 0) return null;
  if (typeof e.seq !== 'number' || !Number.isInteger(e.seq) || e.seq < 0) return null;
  const props = typeof e.props === 'object' && e.props !== null ? (e.props as Record<string, unknown>) : {};
  return {
    v: 1,
    product: e.product,
    app_version: e.app_version,
    env: e.env,
    install_id: e.install_id,
    session_id: e.session_id,
    ts: e.ts,
    event: e.event,
    props,
    seq: e.seq,
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @appforge/edge test -- validate-envelope`
Expected: PASS (5 tests).

- [ ] **Step 5: Write the failing test for the allowlist**

```ts
// apps/edge/tests/allowlist.test.ts
import { describe, it, expect } from 'vitest';
import { getAllowlist, filterProps } from '../src/allowlist.js';

describe('allowlist', () => {
  it('returns the json-workbench allowlist', () => {
    const allowlist = getAllowlist('json-workbench');
    expect(allowlist?.allowedEvents.has('feature_used')).toBe(true);
  });

  it('returns undefined for an unknown product', () => {
    expect(getAllowlist('nonexistent-product')).toBeUndefined();
  });

  it('filterProps keeps only allowlisted keys for a known event', () => {
    const allowlist = getAllowlist('json-workbench')!;
    const filtered = filterProps('feature_used', { feature: 'pipeline_run', ok: true, extra: 'drop-me' }, allowlist);
    expect(filtered).toEqual({ feature: 'pipeline_run', ok: true });
  });

  it('filterProps returns {} for an event with no declared props', () => {
    const allowlist = getAllowlist('json-workbench')!;
    expect(filterProps('app_installed', { anything: 1 }, allowlist)).toEqual({});
  });
});
```

- [ ] **Step 6: Run test to verify it fails**

Run: `pnpm --filter @appforge/edge test -- allowlist`
Expected: FAIL — module not found.

- [ ] **Step 7: Implement the allowlist**

```ts
// apps/edge/src/allowlist.ts
/**
 * Per-product event/prop allowlist (master plan §29f analytics.yaml, §16.3 data classification).
 * Events or props not listed here are silently dropped, never written to D1 — see Review Focus.
 */
export interface ProductAllowlist {
  allowedEvents: ReadonlySet<string>;
  allowedProps: Readonly<Record<string, ReadonlySet<string>>>;
}

const PRODUCTS: Readonly<Record<string, ProductAllowlist>> = {
  'json-workbench': {
    allowedEvents: new Set([
      'app_installed',
      'app_updated',
      'onboarding_completed',
      'feature_used',
      'feature_failed',
      'review_prompt_shown',
      'crosspromo_clicked',
    ]),
    allowedProps: {
      feature_used: new Set(['feature', 'ok']),
    },
  },
};

export function getAllowlist(product: string): ProductAllowlist | undefined {
  return PRODUCTS[product];
}

export function filterProps(
  event: string,
  props: Record<string, unknown>,
  allowlist: ProductAllowlist
): Record<string, unknown> {
  const allowed = allowlist.allowedProps[event];
  if (!allowed) return {};
  const filtered: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(props)) {
    if (allowed.has(key)) filtered[key] = value;
  }
  return filtered;
}
```

- [ ] **Step 8: Run test to verify it passes**

Run: `pnpm --filter @appforge/edge test -- allowlist`
Expected: PASS (4 tests).

- [ ] **Step 9: Write the failing test for the rate limiter**

```ts
// apps/edge/tests/rate-limiter.test.ts
import { describe, it, expect } from 'vitest';
import { RateLimiter } from '../src/rate-limiter.js';

describe('RateLimiter', () => {
  it('allows requests up to the limit within the window', () => {
    const limiter = new RateLimiter(2, 60_000, () => 0);
    expect(limiter.allow('ip-1')).toBe(true);
    expect(limiter.allow('ip-1')).toBe(true);
  });

  it('rejects a request once the limit is exceeded within the window', () => {
    const limiter = new RateLimiter(2, 60_000, () => 0);
    limiter.allow('ip-1');
    limiter.allow('ip-1');
    expect(limiter.allow('ip-1')).toBe(false);
  });

  it('tracks each key independently', () => {
    const limiter = new RateLimiter(1, 60_000, () => 0);
    expect(limiter.allow('ip-1')).toBe(true);
    expect(limiter.allow('ip-2')).toBe(true);
  });

  it('allows again once the window has passed', () => {
    let now = 0;
    const limiter = new RateLimiter(1, 1000, () => now);
    expect(limiter.allow('ip-1')).toBe(true);
    expect(limiter.allow('ip-1')).toBe(false);
    now = 1001;
    expect(limiter.allow('ip-1')).toBe(true);
  });
});
```

- [ ] **Step 10: Run test to verify it fails**

Run: `pnpm --filter @appforge/edge test -- rate-limiter`
Expected: FAIL — module not found.

- [ ] **Step 11: Implement the rate limiter**

```ts
// apps/edge/src/rate-limiter.ts
/**
 * Per-isolate sliding-window limiter. Not shared across edge locations or isolate restarts —
 * a deliberate "cheapest reliable implementation" choice (see Global Constraints); Cloudflare
 * dashboard Rate Limiting Rules are the upgrade path if abuse ever needs a global view.
 */
export class RateLimiter {
  private readonly hits = new Map<string, number[]>();

  constructor(
    private readonly maxRequests: number,
    private readonly windowMs: number,
    private readonly now: () => number = Date.now
  ) {}

  allow(key: string): boolean {
    const now = this.now();
    const windowStart = now - this.windowMs;
    const existing = (this.hits.get(key) ?? []).filter((t) => t > windowStart);
    if (existing.length >= this.maxRequests) {
      this.hits.set(key, existing);
      return false;
    }
    existing.push(now);
    this.hits.set(key, existing);
    return true;
  }
}
```

- [ ] **Step 12: Run test to verify it passes**

Run: `pnpm --filter @appforge/edge test -- rate-limiter`
Expected: PASS (4 tests).

- [ ] **Step 13: Write the failing tests for `POST /v1/events`**

```ts
// apps/edge/tests/events.test.ts
import { describe, it, expect, beforeEach } from 'vitest';
import { env, SELF } from 'cloudflare:test';
import { applySchema } from './test-helpers.js';

function envelope(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    v: 1, product: 'json-workbench', app_version: '0.2.0', env: 'dev',
    install_id: 'install-1', session_id: 'session-1', ts: 1_700_000_000_000,
    event: 'feature_used', props: { feature: 'pipeline_run', ok: true }, seq: 0,
    ...overrides,
  };
}

async function post(body: unknown) {
  return SELF.fetch('https://example.com/v1/events', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'CF-Connecting-IP': '203.0.113.1' },
    body: JSON.stringify(body),
  });
}

beforeEach(async () => {
  await applySchema(env.DB);
});

describe('POST /v1/events', () => {
  it('accepts a valid batch and writes it to events_raw', async () => {
    const response = await post([envelope()]);
    expect(response.status).toBe(202);
    expect(await response.json()).toEqual({ accepted: 1 });
    const row = await env.DB.prepare('SELECT * FROM events_raw WHERE install_id = ?').bind('install-1').first();
    expect(row?.event).toBe('feature_used');
  });

  it('replaying the exact same batch twice does not double-count (Review Focus: idempotent retry)', async () => {
    await post([envelope()]);
    await post([envelope()]);
    const { results } = await env.DB.prepare('SELECT * FROM events_raw WHERE install_id = ?').bind('install-1').all();
    expect(results).toHaveLength(1);
  });

  it('drops an event whose name is not in the product allowlist, without erroring the batch (Review Focus)', async () => {
    const response = await post([envelope({ event: 'totally_made_up_event' })]);
    expect(response.status).toBe(202);
    expect(await response.json()).toEqual({ accepted: 0 });
    const { results } = await env.DB.prepare('SELECT * FROM events_raw').all();
    expect(results).toHaveLength(0);
  });

  it('strips an undeclared prop before writing, keeping only allowlisted ones (Review Focus)', async () => {
    await post([envelope({ props: { feature: 'pipeline_run', ok: true, secret_debug_info: 'leaked' } })]);
    const row = await env.DB.prepare('SELECT props FROM events_raw WHERE install_id = ?').bind('install-1').first();
    expect(JSON.parse(row!.props as string)).toEqual({ feature: 'pipeline_run', ok: true });
  });

  it('rejects a batch over the 50-event limit with 400, not a silent truncation (Review Focus)', async () => {
    const batch = Array.from({ length: 51 }, (_, i) => envelope({ seq: i }));
    const response = await post(batch);
    expect(response.status).toBe(400);
    const { results } = await env.DB.prepare('SELECT * FROM events_raw').all();
    expect(results).toHaveLength(0);
  });

  it('returns 400 for malformed JSON instead of crashing (Review Focus)', async () => {
    const response = await SELF.fetch('https://example.com/v1/events', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{not json',
    });
    expect(response.status).toBe(400);
  });

  it('returns 400 when the body is not an array', async () => {
    const response = await post(envelope());
    expect(response.status).toBe(400);
  });

  it('returns 429 once the per-IP rate limit is exceeded', async () => {
    for (let i = 0; i < 60; i++) {
      await post([envelope({ seq: i })]);
    }
    const response = await post([envelope({ seq: 60 })]);
    expect(response.status).toBe(429);
  });
});
```

- [ ] **Step 14: Run test to verify it fails**

Run: `pnpm --filter @appforge/edge test -- events`
Expected: FAIL — `/v1/events` currently 404s (route not wired).

- [ ] **Step 15: Implement the handler and wire the route**

```ts
// apps/edge/src/handlers/events.ts
import type { D1Database } from '@cloudflare/workers-types';
import { validateEnvelope } from '../validate-envelope.js';
import { getAllowlist, filterProps } from '../allowlist.js';

const MAX_BATCH_SIZE = 50;

export async function handleEvents(request: Request, db: D1Database): Promise<Response> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: 'invalid JSON body' }, { status: 400 });
  }
  if (!Array.isArray(body)) {
    return Response.json({ error: 'body must be an array of event envelopes' }, { status: 400 });
  }
  if (body.length === 0) {
    return Response.json({ error: 'body must contain at least one event' }, { status: 400 });
  }
  if (body.length > MAX_BATCH_SIZE) {
    return Response.json({ error: `batch exceeds the ${MAX_BATCH_SIZE}-event limit` }, { status: 400 });
  }

  const receivedAt = Date.now();
  let accepted = 0;
  for (const raw of body) {
    const envelope = validateEnvelope(raw);
    if (!envelope) continue; // a malformed entry is dropped, not fatal for the whole batch
    const allowlist = getAllowlist(envelope.product);
    if (!allowlist || !allowlist.allowedEvents.has(envelope.event)) continue;
    const props = filterProps(envelope.event, envelope.props, allowlist);
    await db
      .prepare(
        `INSERT OR IGNORE INTO events_raw (install_id, seq, product, app_version, env, event, props, ts, received_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .bind(
        envelope.install_id,
        envelope.seq,
        envelope.product,
        envelope.app_version,
        envelope.env,
        envelope.event,
        JSON.stringify(props),
        envelope.ts,
        receivedAt
      )
      .run();
    accepted++;
  }
  return Response.json({ accepted }, { status: 202 });
}
```

```ts
// apps/edge/src/index.ts
import { handleEvents } from './handlers/events.js';
import { RateLimiter } from './rate-limiter.js';

export interface Env {
  DB: D1Database;
  APPFORGE_ENV: string;
  INGEST_ADMIN_TOKEN: string;
}

const eventsLimiter = new RateLimiter(60, 60_000); // 60 req/min/IP — generous for batched clients

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === '/__health') {
      return Response.json({ ok: true });
    }

    if (url.pathname === '/v1/events' && request.method === 'POST') {
      const ip = request.headers.get('CF-Connecting-IP') ?? 'unknown';
      if (!eventsLimiter.allow(ip)) {
        return Response.json({ error: 'rate limit exceeded' }, { status: 429 });
      }
      return handleEvents(request, env.DB);
    }

    return new Response('Not found', { status: 404 });
  },
};
```

- [ ] **Step 16: Run test to verify it passes**

Run: `pnpm --filter @appforge/edge test -- events`
Expected: PASS (8 tests).

- [ ] **Step 17: Commit**

```bash
git add apps/edge
git commit -m "feat(edge): add POST /v1/events with idempotent write, allowlist, rate limit"
```

---

### Task 4: `GET /v1/metrics` and `POST /v1/feedback`

**Files:**
- Create: `apps/edge/src/handlers/metrics.ts`
- Create: `apps/edge/src/handlers/feedback.ts`
- Modify: `apps/edge/src/index.ts` (wire both routes)
- Test: `apps/edge/tests/metrics.test.ts`
- Test: `apps/edge/tests/feedback.test.ts`

**Interfaces:**
- Consumes: `Env`, `applySchema` from Task 2; `RateLimiter` from Task 3.
- Produces: `handleGetMetrics`, `handleFeedback` — no later task in this plan depends on these directly, but P1-15/P1-16 (economics ingestion, `appforge metrics` CLI) will call `GET /v1/metrics` the same way these tests do.

- [ ] **Step 1: Write the failing tests for `GET /v1/metrics`**

```ts
// apps/edge/tests/metrics.test.ts
import { describe, it, expect, beforeEach } from 'vitest';
import { env, SELF } from 'cloudflare:test';
import { applySchema } from './test-helpers.js';

beforeEach(async () => {
  await applySchema(env.DB);
  await env.DB.prepare(
    `INSERT INTO metrics_daily (product, date, name, value, source) VALUES (?, ?, ?, ?, ?)`
  ).bind('json-workbench', '2026-09-01', 'installs', 12, 'cws_csv').run();
  await env.DB.prepare(
    `INSERT INTO metrics_daily (product, date, name, value, source) VALUES (?, ?, ?, ?, ?)`
  ).bind('json-workbench', '2026-09-02', 'installs', 15, 'cws_csv').run();
});

describe('GET /v1/metrics', () => {
  it('returns metrics rows for the requested product', async () => {
    const response = await SELF.fetch('https://example.com/v1/metrics?product=json-workbench');
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.metrics).toHaveLength(2);
  });

  it('filters by name and date range', async () => {
    const response = await SELF.fetch(
      'https://example.com/v1/metrics?product=json-workbench&name=installs&from=2026-09-02'
    );
    const body = await response.json();
    expect(body.metrics).toEqual([
      { product: 'json-workbench', date: '2026-09-02', name: 'installs', value: 15, source: 'cws_csv' },
    ]);
  });

  it('returns 400 when product is missing', async () => {
    const response = await SELF.fetch('https://example.com/v1/metrics');
    expect(response.status).toBe(400);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd appforge-kit && pnpm --filter @appforge/edge test -- metrics`
Expected: FAIL — `/v1/metrics` 404s.

- [ ] **Step 3: Implement and wire `GET /v1/metrics`**

```ts
// apps/edge/src/handlers/metrics.ts
import type { D1Database } from '@cloudflare/workers-types';

export async function handleGetMetrics(url: URL, db: D1Database): Promise<Response> {
  const product = url.searchParams.get('product');
  if (!product) {
    return Response.json({ error: 'product is required' }, { status: 400 });
  }
  const name = url.searchParams.get('name');
  const from = url.searchParams.get('from');
  const to = url.searchParams.get('to');

  let query = 'SELECT product, date, name, value, source FROM metrics_daily WHERE product = ?';
  const bindings: unknown[] = [product];
  if (name) {
    query += ' AND name = ?';
    bindings.push(name);
  }
  if (from) {
    query += ' AND date >= ?';
    bindings.push(from);
  }
  if (to) {
    query += ' AND date <= ?';
    bindings.push(to);
  }
  query += ' ORDER BY date ASC';

  const { results } = await db.prepare(query).bind(...bindings).all();
  return Response.json({ metrics: results });
}
```

In `apps/edge/src/index.ts`, add the import and route (inside `fetch`, before the final `return new Response('Not found', ...)`):

```ts
import { handleGetMetrics } from './handlers/metrics.js';
// ...
    if (url.pathname === '/v1/metrics' && request.method === 'GET') {
      return handleGetMetrics(url, env.DB);
    }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @appforge/edge test -- metrics`
Expected: PASS (3 tests).

- [ ] **Step 5: Write the failing tests for `POST /v1/feedback`**

```ts
// apps/edge/tests/feedback.test.ts
import { describe, it, expect, beforeEach } from 'vitest';
import { env, SELF } from 'cloudflare:test';
import { applySchema } from './test-helpers.js';

beforeEach(async () => {
  await applySchema(env.DB);
});

async function post(body: unknown) {
  return SELF.fetch('https://example.com/v1/feedback', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'CF-Connecting-IP': '203.0.113.5' },
    body: JSON.stringify(body),
  });
}

describe('POST /v1/feedback', () => {
  it('accepts valid feedback and stores a hash of the text, not the text itself', async () => {
    const response = await post({ product: 'json-workbench', source: 'in_app', rating: 4, text: 'Love the diff view!' });
    expect(response.status).toBe(202);
    const { id } = await response.json();
    const row = await env.DB.prepare('SELECT * FROM feedback WHERE id = ?').bind(id).first();
    expect(row?.product).toBe('json-workbench');
    expect(row?.text_hash).not.toBe('Love the diff view!');
    expect(String(row?.text_hash)).toHaveLength(64);
  });

  it('returns 400 when text is missing', async () => {
    const response = await post({ product: 'json-workbench', source: 'in_app', rating: 4 });
    expect(response.status).toBe(400);
  });

  it('returns 400 for malformed JSON', async () => {
    const response = await SELF.fetch('https://example.com/v1/feedback', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{bad',
    });
    expect(response.status).toBe(400);
  });
});
```

- [ ] **Step 6: Run test to verify it fails**

Run: `pnpm --filter @appforge/edge test -- feedback`
Expected: FAIL — `/v1/feedback` 404s.

- [ ] **Step 7: Implement and wire `POST /v1/feedback`**

```ts
// apps/edge/src/handlers/feedback.ts
import type { D1Database } from '@cloudflare/workers-types';

interface FeedbackInput {
  product: unknown;
  source: unknown;
  rating: unknown;
  text: unknown;
}

function validateFeedback(input: unknown): { product: string; source: string; rating: number | null; text: string } | null {
  if (typeof input !== 'object' || input === null) return null;
  const f = input as FeedbackInput;
  if (typeof f.product !== 'string' || f.product.length === 0) return null;
  if (typeof f.source !== 'string' || f.source.length === 0) return null;
  if (typeof f.text !== 'string' || f.text.length === 0) return null;
  const rating = typeof f.rating === 'number' && Number.isFinite(f.rating) ? f.rating : null;
  return { product: f.product, source: f.source, rating, text: f.text };
}

async function sha256Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export async function handleFeedback(request: Request, db: D1Database): Promise<Response> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: 'invalid JSON body' }, { status: 400 });
  }
  const feedback = validateFeedback(body);
  if (!feedback) {
    return Response.json({ error: 'product, source, and text are required' }, { status: 400 });
  }
  const id = crypto.randomUUID();
  const textHash = await sha256Hex(feedback.text);
  // Raw text is deliberately not persisted here — a 90-day raw-text table for the weekly
  // feedback classifier is P2-02's job, not this plan's. text_hash exists now as a dedup key.
  await db
    .prepare(
      `INSERT INTO feedback (id, product, source, rating, text_hash, category, cluster_key, created_at)
       VALUES (?, ?, ?, ?, ?, NULL, NULL, ?)`
    )
    .bind(id, feedback.product, feedback.source, feedback.rating, textHash, new Date().toISOString())
    .run();
  return Response.json({ id }, { status: 202 });
}
```

In `apps/edge/src/index.ts`:

```ts
import { handleFeedback } from './handlers/feedback.js';

const feedbackLimiter = new RateLimiter(30, 60_000);
// ...
    if (url.pathname === '/v1/feedback' && request.method === 'POST') {
      const ip = request.headers.get('CF-Connecting-IP') ?? 'unknown';
      if (!feedbackLimiter.allow(ip)) {
        return Response.json({ error: 'rate limit exceeded' }, { status: 429 });
      }
      return handleFeedback(request, env.DB);
    }
```

- [ ] **Step 8: Run test to verify it passes**

Run: `pnpm --filter @appforge/edge test -- feedback`
Expected: PASS (3 tests).

- [ ] **Step 9: Commit**

```bash
git add apps/edge
git commit -m "feat(edge): add GET /v1/metrics and POST /v1/feedback"
```

---

### Task 5: `GET /v1/config/:product` and admin-gated `POST /v1/ingest/:source`

**Files:**
- Create: `apps/edge/src/handlers/config.ts`
- Create: `apps/edge/src/handlers/ingest.ts`
- Modify: `apps/edge/src/index.ts` (wire both routes)
- Test: `apps/edge/tests/config.test.ts`
- Test: `apps/edge/tests/ingest.test.ts`

**Interfaces:**
- Consumes: `Env`, `applySchema` from Task 2.
- Produces: `handleGetConfig`, `handleIngest`, `isAuthorized` — `GET /v1/config/:product` is what `@appforge/flags` (an already-existing kit package from P1-08) will eventually fetch from in a real extension; wiring that fetch call itself is out of scope here.

- [ ] **Step 1: Write the failing tests for `GET /v1/config/:product`**

```ts
// apps/edge/tests/config.test.ts
import { describe, it, expect, beforeEach } from 'vitest';
import { env, SELF } from 'cloudflare:test';
import { applySchema } from './test-helpers.js';

beforeEach(async () => {
  await applySchema(env.DB);
});

describe('GET /v1/config/:product', () => {
  it('returns an empty object when no config row exists for the product', async () => {
    const response = await SELF.fetch('https://example.com/v1/config/json-workbench');
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({});
  });

  it('returns the stored config JSON for the product', async () => {
    await env.DB.prepare(
      `INSERT INTO product_config (product, config, updated_at) VALUES (?, ?, ?)`
    ).bind('json-workbench', JSON.stringify({ paywallEnabled: false }), new Date().toISOString()).run();
    const response = await SELF.fetch('https://example.com/v1/config/json-workbench');
    expect(await response.json()).toEqual({ paywallEnabled: false });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd appforge-kit && pnpm --filter @appforge/edge test -- config`
Expected: FAIL — `/v1/config/:product` 404s.

- [ ] **Step 3: Implement and wire `GET /v1/config/:product`**

```ts
// apps/edge/src/handlers/config.ts
import type { D1Database } from '@cloudflare/workers-types';

export async function handleGetConfig(product: string, db: D1Database): Promise<Response> {
  const row = await db
    .prepare('SELECT config FROM product_config WHERE product = ?')
    .bind(product)
    .first<{ config: string }>();
  if (!row) return Response.json({});
  return Response.json(JSON.parse(row.config));
}
```

In `apps/edge/src/index.ts`:

```ts
import { handleGetConfig } from './handlers/config.js';
// ...
    const configMatch = url.pathname.match(/^\/v1\/config\/([^/]+)$/);
    if (configMatch && request.method === 'GET') {
      return handleGetConfig(decodeURIComponent(configMatch[1]), env.DB);
    }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @appforge/edge test -- config`
Expected: PASS (2 tests).

- [ ] **Step 5: Write the failing tests for `POST /v1/ingest/:source`**

```ts
// apps/edge/tests/ingest.test.ts
import { describe, it, expect, beforeEach } from 'vitest';
import { env, SELF } from 'cloudflare:test';
import { applySchema } from './test-helpers.js';

beforeEach(async () => {
  await applySchema(env.DB);
});

async function post(source: string, body: unknown, token = env.INGEST_ADMIN_TOKEN) {
  return SELF.fetch(`https://example.com/v1/ingest/${source}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify(body),
  });
}

describe('POST /v1/ingest/:source', () => {
  it('rejects a request without a valid admin bearer token (Review Focus)', async () => {
    const response = await post(
      'cws_csv',
      [{ product: 'json-workbench', date: '2026-09-01', name: 'installs', value: 12 }],
      'wrong-token'
    );
    expect(response.status).toBe(401);
  });

  it('upserts rows into metrics_daily for an authorized request', async () => {
    const response = await post('cws_csv', [{ product: 'json-workbench', date: '2026-09-01', name: 'installs', value: 12 }]);
    expect(response.status).toBe(202);
    expect(await response.json()).toEqual({ upserted: 1 });
    const row = await env.DB.prepare('SELECT value FROM metrics_daily WHERE product = ? AND date = ?')
      .bind('json-workbench', '2026-09-01')
      .first();
    expect(row?.value).toBe(12);
  });

  it('re-running the same ingest updates the value instead of duplicating the row', async () => {
    await post('cws_csv', [{ product: 'json-workbench', date: '2026-09-01', name: 'installs', value: 12 }]);
    await post('cws_csv', [{ product: 'json-workbench', date: '2026-09-01', name: 'installs', value: 20 }]);
    const { results } = await env.DB.prepare('SELECT value FROM metrics_daily WHERE product = ? AND date = ?')
      .bind('json-workbench', '2026-09-01')
      .all();
    expect(results).toHaveLength(1);
    expect((results[0] as { value: number }).value).toBe(20);
  });

  it('drops an invalid row (bad date format) without failing the whole request', async () => {
    const response = await post('cws_csv', [{ product: 'json-workbench', date: 'not-a-date', name: 'installs', value: 12 }]);
    expect(response.status).toBe(202);
    expect(await response.json()).toEqual({ upserted: 0 });
  });
});
```

- [ ] **Step 6: Run test to verify it fails**

Run: `pnpm --filter @appforge/edge test -- ingest`
Expected: FAIL — `/v1/ingest/:source` 404s.

- [ ] **Step 7: Implement and wire `POST /v1/ingest/:source`**

```ts
// apps/edge/src/handlers/ingest.ts
import type { D1Database } from '@cloudflare/workers-types';

interface MetricRowInput {
  product: unknown;
  date: unknown;
  name: unknown;
  value: unknown;
}

function validateRow(input: unknown): { product: string; date: string; name: string; value: number } | null {
  if (typeof input !== 'object' || input === null) return null;
  const r = input as MetricRowInput;
  if (typeof r.product !== 'string' || r.product.length === 0) return null;
  if (typeof r.date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(r.date)) return null;
  if (typeof r.name !== 'string' || r.name.length === 0) return null;
  if (typeof r.value !== 'number' || !Number.isFinite(r.value)) return null;
  return { product: r.product, date: r.date, name: r.name, value: r.value };
}

export function isAuthorized(request: Request, adminToken: string): boolean {
  const header = request.headers.get('Authorization') ?? '';
  return header === `Bearer ${adminToken}`;
}

export async function handleIngest(request: Request, source: string, db: D1Database): Promise<Response> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: 'invalid JSON body' }, { status: 400 });
  }
  if (!Array.isArray(body)) {
    return Response.json({ error: 'body must be an array of metric rows' }, { status: 400 });
  }
  let upserted = 0;
  for (const raw of body) {
    const row = validateRow(raw);
    if (!row) continue;
    await db
      .prepare(
        `INSERT INTO metrics_daily (product, date, name, value, source) VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(product, date, name, source) DO UPDATE SET value = excluded.value`
      )
      .bind(row.product, row.date, row.name, row.value, source)
      .run();
    upserted++;
  }
  return Response.json({ upserted }, { status: 202 });
}
```

In `apps/edge/src/index.ts`:

```ts
import { handleIngest, isAuthorized } from './handlers/ingest.js';
// ...
    const ingestMatch = url.pathname.match(/^\/v1\/ingest\/([^/]+)$/);
    if (ingestMatch && request.method === 'POST') {
      if (!isAuthorized(request, env.INGEST_ADMIN_TOKEN)) {
        return Response.json({ error: 'unauthorized' }, { status: 401 });
      }
      return handleIngest(request, decodeURIComponent(ingestMatch[1]), env.DB);
    }
```

- [ ] **Step 8: Run test to verify it passes**

Run: `pnpm --filter @appforge/edge test -- ingest`
Expected: PASS (4 tests).

- [ ] **Step 9: Run the whole workspace test suite**

Run: `cd appforge-kit && pnpm install && pnpm typecheck && pnpm build && pnpm test && pnpm lint`
Expected: everything green, including the pre-existing `packages/*` and `templates/*` suites — this is the first time `apps/edge` and `packages/telemetry` run as part of the full workspace command, not just filtered.

- [ ] **Step 10: Commit**

```bash
git add apps/edge
git commit -m "feat(edge): add GET /v1/config/:product and admin-gated POST /v1/ingest/:source"
```

---

### Task 6: Create the real D1 database, deploy, and verify free-tier headroom

This task is operational, not TDD — it takes what Tasks 1–5 built and puts one real instance of it on Cloudflare, using the account confirmed reachable earlier in this session (`wrangler whoami` → `Raviteja369.k@gmail.com's Account`, id `e08ac904468d19ea525b3005cc54888b`).

**Files:**
- Create: `apps/edge/scripts/apply-schema.ts`
- Modify: `apps/edge/wrangler.toml` (real `database_id`)
- Modify: `apps/edge/README.md` (new file — deploy/verify notes)

- [ ] **Step 1: Create the D1 database**

Run: `cd appforge-kit/apps/edge && pnpm exec wrangler d1 create appforge-edge-db`
Expected: JSON/table output containing a `database_id`. Copy it.

- [ ] **Step 2: Wire the real database id**

Edit `apps/edge/wrangler.toml`, replacing `REPLACE_AFTER_WRANGLER_D1_CREATE` with the id from Step 1.

- [ ] **Step 3: Write the migration script**

```ts
// apps/edge/scripts/apply-schema.ts
// Applies src/schema.ts's SCHEMA_STATEMENTS to a real D1 database via wrangler.
// Usage: node --experimental-strip-types scripts/apply-schema.ts [--remote]
import { execFileSync } from 'node:child_process';
import { SCHEMA_STATEMENTS } from '../src/schema.js';

const extraArgs = process.argv.slice(2);
for (const statement of SCHEMA_STATEMENTS) {
  execFileSync('wrangler', ['d1', 'execute', 'appforge-edge-db', '--command', statement, ...extraArgs], {
    stdio: 'inherit',
  });
}
```

- [ ] **Step 4: Apply the schema to the real database**

Run: `pnpm --filter @appforge/edge run db:migrate -- --remote`
Expected: five `wrangler d1 execute` invocations, each reporting success.

- [ ] **Step 5: Deploy the Worker**

Run: `pnpm --filter @appforge/edge run deploy`
Expected: a `*.workers.dev` URL in the output. Note it for Step 6.

- [ ] **Step 6: Smoke-test the real deployment**

Run: `curl -s https://<the-workers.dev-url>/__health`
Expected: `{"ok":true}`.

Run:
```bash
curl -s -X POST https://<the-workers.dev-url>/v1/events \
  -H 'content-type: application/json' \
  -d '[{"v":1,"product":"json-workbench","app_version":"0.2.0","env":"prod","install_id":"smoke-test","session_id":"s1","ts":1700000000000,"event":"app_installed","props":{},"seq":0}]'
```
Expected: `{"accepted":1}`.

- [ ] **Step 7: Set the real admin ingest token as a secret (replacing the dev placeholder)**

Run: `pnpm exec wrangler secret put INGEST_ADMIN_TOKEN` (paste a freshly generated random token when prompted — e.g. from `openssl rand -hex 32` run locally, not pasted into any chat transcript).
Expected: `wrangler` confirms the secret was uploaded. This overrides the `[vars]` placeholder in `wrangler.toml` for the deployed Worker only — local tests keep using the placeholder from `wrangler.toml`, which is fine since they never touch the real account.

- [ ] **Step 8: Check free-tier headroom**

Run: `pnpm exec wrangler d1 info appforge-edge-db`
Expected: row-count and storage figures far below D1's free-tier limits (§28: "≈100k rows written/day, 5 GB" — a single smoke-test row is not a real signal, but this confirms the command works so the same check can be repeated once a real product sends traffic, per §28's "verify limits P1-10" note).

- [ ] **Step 9: Write the README**

```markdown
// apps/edge/README.md
# appforge-edge

Cloudflare Worker + D1 backend for AppForge products: telemetry ingest, remote config,
feedback, and metrics. See the master plan §18b/§29d/§29e.

## Endpoints

- `GET /__health` — liveness check.
- `POST /v1/events` — batch event ingest (≤ 50 events/request), idempotent on `(install_id, seq)`,
  allowlist-enforced per product (see `src/allowlist.ts`).
- `GET /v1/metrics?product&name&from&to` — query `metrics_daily`.
- `POST /v1/feedback` — store user feedback (text is hashed, not retained raw — see `src/handlers/feedback.ts`).
- `GET /v1/config/:product` — remote config JSON for `@appforge/flags`.
- `POST /v1/ingest/:source` — admin-gated (`Authorization: Bearer <INGEST_ADMIN_TOKEN>`) upsert into `metrics_daily`.

## Local development

```bash
pnpm install
pnpm --filter @appforge/edge test    # runs against a local, Miniflare-simulated D1 — no network
pnpm --filter @appforge/edge dev     # wrangler dev, also local
```

## Deploying

```bash
pnpm --filter @appforge/edge run db:migrate -- --remote   # once, or after a schema change
pnpm --filter @appforge/edge run deploy
```

## Deliberately out of scope (see the P1-10 plan's Global Constraints)

- Separate staging/prod D1 databases — one database until a real product depends on this Worker.
- `releases`, `incidents`, `revenue`, `costs`, `ai_usage`, `product_state_log` tables — later backlog items (P1-13, P1-15).
- Raw feedback text storage / the weekly feedback classifier — P2-02.
- CI-driven deploys — deploys are manual (`wrangler deploy`) until a product's release actually depends on this Worker being current.
```

- [ ] **Step 10: Commit**

```bash
git add apps/edge/wrangler.toml apps/edge/scripts apps/edge/README.md
git commit -m "chore(edge): create real D1 database, deploy, document endpoints"
```

## Self-Review Notes

- **Spec coverage:** §18b's envelope shape and event taxonomy are implemented exactly in Task 1 (`EventEnvelope`) and re-validated independently in Task 3 (`validateEnvelope`). §29e's `Analytics` contract (`POST /v1/events` batch ≤ 50, `GET /v1/metrics`, `POST /v1/ingest/{source}`) is covered in Tasks 3–5; `GET /v1/config/:product` is the one addition beyond the literal `Analytics` interface, taken from §29e's endpoint table row for `/v1/config`. §16.3's allowlist-drops-undeclared-props rule is covered by Task 3's allowlist tests. §29d's D1 tables are implemented for the four this plan's endpoints touch; the rest are explicitly deferred (Global Constraints) rather than silently skipped.
- **Placeholder scan:** no TBD/"add error handling"/"similar to Task N" text; every step has runnable code, including the operational Task 6 steps (each names its exact command and expected output).
- **Type consistency:** `Env` (Task 2) is imported unchanged by every handler in Tasks 3–5 via `env.DB`/`env.INGEST_ADMIN_TOKEN`. `ValidEnvelope`'s field names match `EventEnvelope` from Task 1 field-for-field (`v`, `product`, `app_version`, `env`, `install_id`, `session_id`, `ts`, `event`, `props`, `seq`) — a naming drift between the two would have been a real bug, since the Worker parses exactly what the client package produces.
- **Review Focus:** all five items have a named test each (search "Review Focus" in the test code above): idempotent replay and undeclared-event/prop dropping in Task 3, oversized batch in Task 3, unauthorized ingest in Task 5, malformed JSON across Tasks 3/4/5.
- **What's deliberately out of scope here** (each a real, separately-scheduled backlog item, not a gap in this plan): CI-driven Worker deploys and a staging/prod D1 split (wire in once P1-18's JSON Workbench factory run actually needs this Worker live); the `releases`/`incidents`/`revenue`/`costs`/`ai_usage`/`product_state_log` D1 tables (P1-13, P1-15); the weekly feedback classifier and raw-text retention (P2-02); wiring `@appforge/telemetry`'s `drain()` output into an actual `fetch` POST call from inside a real extension (the next time a product adopts the kit's telemetry package, starting with JSON Workbench per P1-18).

---

## Execution Handoff

Plan complete and self-reviewed. Continuing with **Native** execution (as chosen for Subsystem 1 and used for every P1 task since): the six tasks are sequential, each only consumes exports the previous one produced (no fan-out), and every step above already has its exact code and expected test count — a wrong turn here is a two-minute test failure caught by TDD, not a production incident, since nothing depends on this Worker yet. One fresh-reviewer pass happens at the end of the branch, per superpowers:executing-plans.
