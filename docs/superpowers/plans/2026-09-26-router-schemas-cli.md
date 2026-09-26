# Router, Schemas & CLI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the deterministic, testable core of `appforge-kit` — the ModelRouter, the permissions/product schema validators, the permission-diff gate, and the product state-machine checker — as plain TypeScript with no external services, so it can be built and fully unit-tested before the Mac host, Paperclip, or any GitHub App exists.

**Architecture:** A pnpm monorepo (`appforge-kit`) with three packages: `@appforge/router` (pure `ModelRouter.select()`), `@appforge/schemas` (JSON Schema validation + the permission-diff and product-transition checkers), and `@appforge/cli` (a thin Commander wrapper exposing `appforge validate` and `appforge product-transition` with human and `--json` output). Every function is pure (no filesystem/network access below the CLI layer) so it is trivial to unit test.

**Tech Stack:** Node 22+, TypeScript (strict), pnpm workspaces, Vitest, `ajv` for JSON Schema validation, `commander` for the CLI, `yaml` for parsing `.appforge/*.yaml`.

**Spec:** `~/git-personal/.claude/appforge-ai-master-plan.md` (the AppForge AI master architecture plan) — specifically §7 (Model Routing), §10.2 (product state machine transition table), §13.2 (permissions.yaml + permission-diff gate), §29c (CLI contract), §29d (data models), §29f (`models.yaml`/`security.yaml` config shape).

This is Subsystem 1 of the AppForge factory. Later subsystems (Chrome templates, the edge Worker, the macOS host bootstrap, the credential broker) each get their own plan of this kind when their turn in the 90-day plan (§30) comes — this one was chosen first because it has zero external dependencies and the highest ratio of "genuinely testable code" to "infrastructure plumbing."

## Global Constraints

- Node ≥ 22.0 (matches §29g/§13.1 baseline); TypeScript `strict: true`; no `any` in exported function signatures.
- Every exported function in `@appforge/router` and `@appforge/schemas` is pure: given the same input, same output, no I/O. Filesystem/YAML reading happens only in `@appforge/cli`.
- No task-type union is hardcoded as a closed TypeScript enum for `taskType` — it stays `type TaskType = string`, because the deterministic-task list and code-task list are config-driven (`models.yaml`, §29f) and will grow without a code change. Only `Complexity` (`LOW|NORMAL|HIGH|CRITICAL`) and `ProductState` (§10.1's 17 states) are closed unions, because those are the two enums the rest of the master plan treats as fixed.
- Concrete model IDs and prices never appear in `@appforge/router` source — only in the `RouterConfig` object passed in by the caller (mirrors `models.yaml`, §29f), per §7.1's "never in agent files" rule.
- `appforge validate`/`appforge product-transition` exit codes follow the table in §29c exactly (0 ok, 2 invalid input, 3 validation failed, 8 transition not allowed, 9 deterministic task) — a task that changes an exit code updates §29c too.
- Every JSON Schema lives under `packages/schemas/schema/*.json` and is loaded, never inlined as a TS object literal, so it can be reused outside Node later (§9.1: "schemas/ (JSON Schemas for every YAML)").

## Review Focus

- Malformed/unreadable YAML passed to `appforge validate` — must exit 2 with a clear message, not throw an uncaught exception or exit 0.
- A high-risk permission expressed as a wildcard host pattern (`*://*/*`, `<all_urls>`) rather than an exact string match — `diffPermissions` must catch pattern matches, not just literal equality, or a wildcard slips past the high-risk gate silently.
- A transition requested between two valid `ProductState` values that have no direct edge in the table (e.g. `DISCOVERED → PRODUCTION`, skipping every gate) — must be explicitly rejected as "no transition defined," never accepted by accident via a loose lookup.
- `CRITICAL` tier selected but the caller's `RouterConfig` has no `independentReview` entry for it — a config-authoring mistake that must fail loudly (thrown error), never silently downgrade to a normal HIGH-tier call, since that would defeat the whole point of the second-vendor check in §7.1.
- Evidence recorded as an empty placeholder (`sources: []`, `problem: ""`) rather than actually missing — `canTransition`'s presence check must treat these as **not present**, or an agent could satisfy a gate by writing an empty value instead of real evidence.

---

### Task 1: Monorepo scaffold + `@appforge/router` package with `ModelRouter.select()`

**Files:**
- Create: `package.json` (pnpm workspace root, `"workspaces": ["packages/*"]`)
- Create: `pnpm-workspace.yaml`
- Create: `tsconfig.base.json` (`strict: true`, `target: ES2022`, `module: NodeNext`)
- Create: `vitest.config.ts` (workspace-wide, `test.projects: ['packages/*']`)
- Create: `packages/router/package.json` (name `@appforge/router`)
- Create: `packages/router/tsconfig.json` (extends base)
- Create: `packages/router/src/types.ts`
- Create: `packages/router/src/router.ts`
- Create: `packages/router/src/index.ts` (re-exports)
- Test: `packages/router/tests/router.test.ts`

**Interfaces:**
- Produces: `Complexity`, `TaskType`, `RouteRequest`, `RouteDecision`, `TierConfig`, `RouterConfig`, `ModelRouter` (interface), `TieredModelRouter` (class), `UseScriptError` (error class) — all from `@appforge/router`, consumed by Task 2 (CLI) and later by the real Paperclip integration (§7.3, not in this plan).

- [ ] **Step 1: Scaffold the workspace**

```json
// package.json
{
  "name": "appforge-kit",
  "private": true,
  "packageManager": "pnpm@9.0.0",
  "scripts": {
    "build": "pnpm -r build",
    "test": "vitest run",
    "typecheck": "pnpm -r exec tsc --noEmit"
  },
  "devDependencies": {
    "typescript": "^5.6.0",
    "vitest": "^2.1.0"
  }
}
```

```yaml
# pnpm-workspace.yaml
packages:
  - "packages/*"
```

```json
// tsconfig.base.json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "strict": true,
    "declaration": true,
    "outDir": "dist",
    "rootDir": "src",
    "esModuleInterop": true,
    "skipLibCheck": true
  }
}
```

```ts
// vitest.config.ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: { projects: ['packages/*'] },
});
```

Run: `pnpm install`
Expected: lockfile created, no packages yet to build.

- [ ] **Step 2: Write the failing test for the deterministic-task guard**

```ts
// packages/router/tests/router.test.ts
import { describe, it, expect } from 'vitest';
import { TieredModelRouter, UseScriptError, RouterConfig } from '../src/index.js';

const baseConfig: RouterConfig = {
  tiers: {
    LOW: { provider: 'anthropic', model: 'claude-haiku-x', maxTokens: 4000, timeoutSec: 300 },
    NORMAL: { provider: 'anthropic', model: 'claude-sonnet-x', maxTokens: 16000, timeoutSec: 1800 },
    HIGH: { provider: 'anthropic', model: 'claude-opus-x', maxTokens: 32000, timeoutSec: 3600 },
    CRITICAL: {
      provider: 'anthropic', model: 'claude-opus-x', maxTokens: 32000, timeoutSec: 3600,
      independentReview: { provider: 'openai', model: 'gpt-top-x' },
    },
  },
  deterministicTaskTypes: ['schema_validation', 'lint', 'permission_diff'],
  codeTaskTypes: ['implement_feature', 'fix_bug'],
  agentForTier: { LOW: 'builder', NORMAL: 'builder', HIGH: 'builder-high', CRITICAL: 'builder-high' },
};

describe('TieredModelRouter.select — deterministic task guard', () => {
  it('throws UseScriptError for a deterministic task type', () => {
    const router = new TieredModelRouter(baseConfig);
    expect(() =>
      router.select({ taskType: 'schema_validation', complexity: 'LOW', risk: 'low', budgetRemainingPct: 1, latency: 'batch' })
    ).toThrow(UseScriptError);
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `pnpm test -- router`
Expected: FAIL — `Cannot find module '../src/index.js'` (nothing implemented yet).

- [ ] **Step 4: Implement types and the router**

```ts
// packages/router/src/types.ts
export type Complexity = 'LOW' | 'NORMAL' | 'HIGH' | 'CRITICAL';

/** Deliberately an open string, not a closed union — see Global Constraints. */
export type TaskType = string;

export interface RouteRequest {
  taskType: TaskType;
  complexity: Complexity;
  risk: 'low' | 'med' | 'high';
  /** 0–1 fraction: remaining budget ÷ this agent's monthly budget. */
  budgetRemainingPct: number;
  latency: 'interactive' | 'batch';
}

export interface ModelRef {
  provider: string;
  model: string;
}

export interface RouteDecision {
  provider: string;
  model: string;
  reasoningLevel: 'low' | 'medium' | 'high';
  maxOutputTokens: number;
  timeoutSec: number;
  fallback?: ModelRef;
  independentReview?: ModelRef;
  adapterAgent: string;
}

export interface TierConfig extends ModelRef {
  fallback?: ModelRef;
  independentReview?: ModelRef;
  maxTokens: number;
  timeoutSec: number;
}

export interface RouterConfig {
  tiers: Record<Complexity, TierConfig>;
  deterministicTaskTypes: readonly string[];
  codeTaskTypes: readonly string[];
  agentForTier: Record<Complexity, string>;
}

export interface ModelRouter {
  select(request: RouteRequest): RouteDecision;
}
```

```ts
// packages/router/src/router.ts
import type { Complexity, ModelRouter, RouteDecision, RouteRequest, RouterConfig } from './types.js';

const TIER_ORDER: readonly Complexity[] = ['LOW', 'NORMAL', 'HIGH', 'CRITICAL'];
const BUDGET_DOWNGRADE_THRESHOLD_PCT = 0.2;

export class UseScriptError extends Error {
  constructor(public readonly taskType: string) {
    super(`Task type "${taskType}" is deterministic and must run as a script, not an LLM call.`);
    this.name = 'UseScriptError';
  }
}

function reasoningLevelFor(tier: Complexity): 'low' | 'medium' | 'high' {
  if (tier === 'LOW') return 'low';
  if (tier === 'NORMAL') return 'medium';
  return 'high';
}

export class TieredModelRouter implements ModelRouter {
  constructor(private readonly config: RouterConfig) {}

  select(request: RouteRequest): RouteDecision {
    if (this.config.deterministicTaskTypes.includes(request.taskType)) {
      throw new UseScriptError(request.taskType);
    }

    let tierIndex = TIER_ORDER.indexOf(request.complexity);
    if (tierIndex === -1) {
      throw new Error(`Unknown complexity tier: "${request.complexity}"`);
    }

    if (request.risk === 'high') {
      tierIndex = Math.max(tierIndex, TIER_ORDER.indexOf('HIGH'));
    }

    if (request.budgetRemainingPct < BUDGET_DOWNGRADE_THRESHOLD_PCT) {
      const isCodeTask = this.config.codeTaskTypes.includes(request.taskType);
      const floorIndex = isCodeTask ? TIER_ORDER.indexOf('NORMAL') : 0;
      tierIndex = Math.max(floorIndex, tierIndex - 1);
    }

    const tier = TIER_ORDER[tierIndex];
    const tierConfig = this.config.tiers[tier];

    const decision: RouteDecision = {
      provider: tierConfig.provider,
      model: tierConfig.model,
      reasoningLevel: reasoningLevelFor(tier),
      maxOutputTokens: tierConfig.maxTokens,
      timeoutSec: tierConfig.timeoutSec,
      adapterAgent: this.config.agentForTier[tier],
    };
    if (tierConfig.fallback) decision.fallback = tierConfig.fallback;

    if (tier === 'CRITICAL') {
      if (!tierConfig.independentReview) {
        throw new Error('CRITICAL tier is missing an independentReview entry in RouterConfig — refusing to route silently.');
      }
      decision.independentReview = tierConfig.independentReview;
    }

    return decision;
  }
}
```

```ts
// packages/router/src/index.ts
export * from './types.js';
export * from './router.js';
```

```json
// packages/router/package.json
{
  "name": "@appforge/router",
  "version": "0.1.0",
  "type": "module",
  "main": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "scripts": { "build": "tsc -p tsconfig.json" },
  "devDependencies": { "typescript": "^5.6.0" }
}
```

```json
// packages/router/tsconfig.json
{
  "extends": "../../tsconfig.base.json",
  "include": ["src"]
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm test -- router`
Expected: PASS (1 test).

- [ ] **Step 6: Add the remaining router behaviors as tests, then confirm they already pass**

Append to `packages/router/tests/router.test.ts`:

```ts
describe('TieredModelRouter.select — tier selection rules', () => {
  it('routes a LOW/low-risk/full-budget request to the LOW tier', () => {
    const router = new TieredModelRouter(baseConfig);
    const decision = router.select({ taskType: 'write_prd', complexity: 'LOW', risk: 'low', budgetRemainingPct: 1, latency: 'batch' });
    expect(decision.model).toBe('claude-haiku-x');
    expect(decision.adapterAgent).toBe('builder');
    expect(decision.independentReview).toBeUndefined();
  });

  it('bumps a NORMAL/high-risk request up to HIGH', () => {
    const router = new TieredModelRouter(baseConfig);
    const decision = router.select({ taskType: 'implement_feature', complexity: 'NORMAL', risk: 'high', budgetRemainingPct: 1, latency: 'interactive' });
    expect(decision.model).toBe('claude-opus-x');
    expect(decision.adapterAgent).toBe('builder-high');
  });

  it('downgrades a HIGH code task to NORMAL (not lower) when budget is low', () => {
    const router = new TieredModelRouter(baseConfig);
    const decision = router.select({ taskType: 'implement_feature', complexity: 'HIGH', risk: 'low', budgetRemainingPct: 0.1, latency: 'interactive' });
    expect(decision.model).toBe('claude-sonnet-x');
  });

  it('does not downgrade below LOW for a non-code task when budget is low', () => {
    const router = new TieredModelRouter(baseConfig);
    const decision = router.select({ taskType: 'marketing_copy', complexity: 'LOW', risk: 'low', budgetRemainingPct: 0.05, latency: 'batch' });
    expect(decision.model).toBe('claude-haiku-x');
  });

  it('attaches independentReview for CRITICAL', () => {
    const router = new TieredModelRouter(baseConfig);
    const decision = router.select({ taskType: 'security_review', complexity: 'CRITICAL', risk: 'high', budgetRemainingPct: 1, latency: 'batch' });
    expect(decision.independentReview).toEqual({ provider: 'openai', model: 'gpt-top-x' });
  });

  it('fails loudly if CRITICAL config has no independentReview (Review Focus)', () => {
    const brokenConfig: RouterConfig = {
      ...baseConfig,
      tiers: { ...baseConfig.tiers, CRITICAL: { provider: 'anthropic', model: 'claude-opus-x', maxTokens: 32000, timeoutSec: 3600 } },
    };
    const router = new TieredModelRouter(brokenConfig);
    expect(() =>
      router.select({ taskType: 'security_review', complexity: 'CRITICAL', risk: 'high', budgetRemainingPct: 1, latency: 'batch' })
    ).toThrow(/independentReview/);
  });

  it('throws on an unrecognized complexity value from untyped input (Review Focus)', () => {
    const router = new TieredModelRouter(baseConfig);
    const bad = { taskType: 'write_prd', complexity: 'URGENT' as unknown as Complexity, risk: 'low', budgetRemainingPct: 1, latency: 'batch' } as const;
    expect(() => router.select(bad)).toThrow(/Unknown complexity/);
  });
});
```

Run: `pnpm test -- router`
Expected: PASS (8 tests total).

- [ ] **Step 7: Commit**

```bash
git add package.json pnpm-workspace.yaml tsconfig.base.json \
        vitest.config.ts packages/router
git commit -m "feat(router): add TieredModelRouter with deterministic-task guard and tier rules"
```

---

### Task 2: `@appforge/schemas` — permissions.yaml JSON Schema + validator

**Files:**
- Create: `packages/schemas/package.json` (name `@appforge/schemas`)
- Create: `packages/schemas/tsconfig.json`
- Create: `packages/schemas/schema/permissions.schema.json`
- Create: `packages/schemas/src/validate-permissions.ts`
- Create: `packages/schemas/src/index.ts`
- Test: `packages/schemas/tests/validate-permissions.test.ts`

**Interfaces:**
- Consumes: nothing from Task 1.
- Produces: `ValidationResult { ok: boolean; errors: string[] }`, `validatePermissions(doc: unknown): ValidationResult` — consumed by Task 4 (CLI).

- [ ] **Step 1: Write the failing test**

```ts
// packages/schemas/tests/validate-permissions.test.ts
import { describe, it, expect } from 'vitest';
import { validatePermissions } from '../src/index.js';

const validDoc = {
  schema: 'appforge/permissions@1',
  permissions: [
    { permission: 'storage', required: true, reason: "Save the user's pipelines locally", data_access: ['user_content_local'], security_impact: 'low' },
  ],
};

describe('validatePermissions', () => {
  it('accepts a valid document', () => {
    expect(validatePermissions(validDoc)).toEqual({ ok: true, errors: [] });
  });

  it('rejects a document missing the schema field', () => {
    const { schema, ...rest } = validDoc;
    const result = validatePermissions(rest);
    expect(result.ok).toBe(false);
    expect(result.errors.length).toBeGreaterThan(0);
  });

  it('rejects a permission entry with an empty reason', () => {
    const doc = { ...validDoc, permissions: [{ ...validDoc.permissions[0], reason: '' }] };
    expect(validatePermissions(doc).ok).toBe(false);
  });

  it('rejects an invalid security_impact value', () => {
    const doc = { ...validDoc, permissions: [{ ...validDoc.permissions[0], security_impact: 'extreme' }] };
    expect(validatePermissions(doc).ok).toBe(false);
  });

  it('rejects a malformed top-level value (Review Focus: garbage input, not just missing fields)', () => {
    expect(validatePermissions('not an object').ok).toBe(false);
    expect(validatePermissions(null).ok).toBe(false);
    expect(validatePermissions(undefined).ok).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test -- schemas`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the schema and the minimal implementation**

```json
// packages/schemas/schema/permissions.schema.json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "$id": "https://appforge.dev/schema/permissions.schema.json",
  "type": "object",
  "required": ["schema", "permissions"],
  "additionalProperties": false,
  "properties": {
    "schema": { "const": "appforge/permissions@1" },
    "permissions": {
      "type": "array",
      "items": {
        "type": "object",
        "required": ["permission", "required", "reason", "data_access", "security_impact"],
        "additionalProperties": false,
        "properties": {
          "permission": { "type": "string", "minLength": 1 },
          "required": { "type": "boolean" },
          "reason": { "type": "string", "minLength": 1 },
          "data_access": { "type": "array", "items": { "type": "string" } },
          "security_impact": { "enum": ["low", "medium", "high"] }
        }
      }
    }
  }
}
```

```ts
// packages/schemas/src/validate-permissions.ts
import Ajv2020 from 'ajv/dist/2020.js';
import type { ErrorObject } from 'ajv';
import permissionsSchema from '../schema/permissions.schema.json' with { type: 'json' };

export interface ValidationResult {
  ok: boolean;
  errors: string[];
}

const ajv = new Ajv2020({ allErrors: true, strict: true });
const validateFn = ajv.compile(permissionsSchema);

function formatError(e: ErrorObject): string {
  const path = e.instancePath || '(root)';
  return `${path}: ${e.message}`;
}

export function validatePermissions(doc: unknown): ValidationResult {
  const ok = validateFn(doc);
  if (ok) return { ok: true, errors: [] };
  return { ok: false, errors: (validateFn.errors ?? []).map(formatError) };
}
```

```ts
// packages/schemas/src/index.ts
export * from './validate-permissions.js';
```

```json
// packages/schemas/package.json
{
  "name": "@appforge/schemas",
  "version": "0.1.0",
  "type": "module",
  "main": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "scripts": { "build": "tsc -p tsconfig.json" },
  "dependencies": { "ajv": "^8.17.0" },
  "devDependencies": { "typescript": "^5.6.0" }
}
```

```json
// packages/schemas/tsconfig.json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": { "resolveJsonModule": true },
  "include": ["src"]
}
```

Run: `pnpm install && pnpm test -- schemas`
Expected: PASS (5 tests).

- [ ] **Step 4: Commit**

```bash
git add packages/schemas
git commit -m "feat(schemas): add permissions.yaml JSON Schema and validator"
```

---

### Task 3: Permission-diff gate (manifest ⇔ permissions.yaml, high-risk detection)

**Files:**
- Create: `packages/schemas/src/permission-diff.ts`
- Modify: `packages/schemas/src/index.ts` (add export)
- Test: `packages/schemas/tests/permission-diff.test.ts`

**Interfaces:**
- Consumes: nothing new from Task 1/2.
- Produces: `PermissionDiffResult`, `diffPermissions(manifestPermissions, yamlPermissions, highRiskList, previousManifestPermissions?)` — consumed by Task 4 (CLI) and, later, by the `checks.yml` reusable workflow (§13.4, out of scope here).

- [ ] **Step 1: Write the failing test**

```ts
// packages/schemas/tests/permission-diff.test.ts
import { describe, it, expect } from 'vitest';
import { diffPermissions } from '../src/index.js';

const HIGH_RISK = ['cookies', 'history', 'webRequest', '<all_urls>', '*://*/*'];

describe('diffPermissions', () => {
  it('passes when manifest and yaml match exactly with no high-risk permissions', () => {
    const result = diffPermissions(['storage'], [{ permission: 'storage' }], HIGH_RISK);
    expect(result).toEqual({ ok: true, missingInYaml: [], missingInManifest: [], highRisk: [] });
  });

  it('flags a manifest permission that is not documented in yaml', () => {
    const result = diffPermissions(['storage', 'tabs'], [{ permission: 'storage' }], HIGH_RISK);
    expect(result.ok).toBe(false);
    expect(result.missingInYaml).toEqual(['tabs']);
  });

  it('flags a yaml entry for a permission the manifest does not request', () => {
    const result = diffPermissions(['storage'], [{ permission: 'storage' }, { permission: 'tabs' }], HIGH_RISK);
    expect(result.ok).toBe(false);
    expect(result.missingInManifest).toEqual(['tabs']);
  });

  it('flags a newly added exact-match high-risk permission', () => {
    const result = diffPermissions(['storage', 'cookies'], [{ permission: 'storage' }, { permission: 'cookies' }], HIGH_RISK, ['storage']);
    expect(result.ok).toBe(false);
    expect(result.highRisk).toEqual(['cookies']);
  });

  it('flags a newly added wildcard host permission matched by pattern (Review Focus)', () => {
    const result = diffPermissions(
      ['storage', '*://mail.google.com/*'],
      [{ permission: 'storage' }, { permission: '*://mail.google.com/*' }],
      HIGH_RISK,
      ['storage']
    );
    expect(result.ok).toBe(false);
    expect(result.highRisk).toEqual(['*://mail.google.com/*']);
  });

  it('does not re-flag a high-risk permission that already existed before this change', () => {
    const result = diffPermissions(['storage', 'cookies'], [{ permission: 'storage' }, { permission: 'cookies' }], HIGH_RISK, ['storage', 'cookies']);
    expect(result.highRisk).toEqual([]);
    expect(result.ok).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test -- schemas`
Expected: FAIL — `diffPermissions` not exported.

- [ ] **Step 3: Implement**

```ts
// packages/schemas/src/permission-diff.ts
export interface PermissionDiffResult {
  ok: boolean;
  missingInYaml: string[];
  missingInManifest: string[];
  highRisk: string[];
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function matchesHighRiskPattern(pattern: string, value: string): boolean {
  if (pattern === value) return true;
  if (pattern === '<all_urls>') return value === '<all_urls>';
  if (!pattern.includes('*')) return false;
  const regex = new RegExp('^' + pattern.split('*').map(escapeRegExp).join('.*') + '$');
  return regex.test(value);
}

function isHighRisk(permission: string, highRiskList: readonly string[]): boolean {
  return highRiskList.some((pattern) => matchesHighRiskPattern(pattern, permission));
}

export function diffPermissions(
  manifestPermissions: readonly string[],
  yamlPermissions: readonly { permission: string }[],
  highRiskList: readonly string[],
  previousManifestPermissions: readonly string[] = []
): PermissionDiffResult {
  const manifestSet = new Set(manifestPermissions);
  const yamlSet = new Set(yamlPermissions.map((p) => p.permission));
  const previousSet = new Set(previousManifestPermissions);

  const missingInYaml = [...manifestSet].filter((p) => !yamlSet.has(p));
  const missingInManifest = [...yamlSet].filter((p) => !manifestSet.has(p));
  const newlyAdded = [...manifestSet].filter((p) => !previousSet.has(p));
  const highRisk = newlyAdded.filter((p) => isHighRisk(p, highRiskList));

  return {
    ok: missingInYaml.length === 0 && missingInManifest.length === 0 && highRisk.length === 0,
    missingInYaml,
    missingInManifest,
    highRisk,
  };
}
```

```ts
// packages/schemas/src/index.ts  (append)
export * from './permission-diff.js';
```

Run: `pnpm test -- schemas`
Expected: PASS (11 tests total in this package).

- [ ] **Step 4: Commit**

```bash
git add packages/schemas
git commit -m "feat(schemas): add permission-diff gate with high-risk pattern matching"
```

---

### Task 4: Product state-machine transition checker

**Files:**
- Create: `packages/schemas/src/product-state.ts`
- Modify: `packages/schemas/src/index.ts` (add export)
- Test: `packages/schemas/tests/product-state.test.ts`

**Interfaces:**
- Consumes: nothing new.
- Produces: `ProductState`, `TransitionRule`, `TRANSITIONS`, `TransitionCheckResult`, `canTransition(from, to, evidence, hasApproval)` — consumed by Task 5 (CLI); `ProductState` is the same enum used in §29d's `Product` interface.

- [ ] **Step 1: Write the failing test**

```ts
// packages/schemas/tests/product-state.test.ts
import { describe, it, expect } from 'vitest';
import { canTransition } from '../src/index.js';

describe('canTransition', () => {
  it('allows DISCOVERED -> RESEARCHING with all required evidence present', () => {
    const result = canTransition('DISCOVERED', 'RESEARCHING', {
      opportunityId: 'OPP-0001', problem: 'x', targetUser: 'y', sources: ['a'],
    }, false);
    expect(result.ok).toBe(true);
    expect(result.missing).toEqual([]);
  });

  it('reports exactly which evidence keys are missing', () => {
    const result = canTransition('DISCOVERED', 'RESEARCHING', { opportunityId: 'OPP-0001' }, false);
    expect(result.ok).toBe(false);
    expect(result.missing).toEqual(expect.arrayContaining(['problem', 'targetUser', 'sources']));
  });

  it('treats an empty-array or empty-string evidence value as missing (Review Focus)', () => {
    const result = canTransition('DISCOVERED', 'RESEARCHING', {
      opportunityId: 'OPP-0001', problem: '', targetUser: 'y', sources: [],
    }, false);
    expect(result.missing).toEqual(expect.arrayContaining(['problem', 'sources']));
  });

  it('rejects a transition with no defined edge, e.g. skipping straight to PRODUCTION (Review Focus)', () => {
    const result = canTransition('DISCOVERED', 'PRODUCTION', {}, true);
    expect(result.ok).toBe(false);
    expect(result.missing[0]).toMatch(/no transition defined/);
  });

  it('requires a verified approval for VALIDATING -> APPROVED even with full evidence', () => {
    const evidence = { scoreSheet: {}, evidenceSources: ['a', 'b', 'c'], mvpScope: '2 weeks', slotPlan: 'free slot' };
    const withoutApproval = canTransition('VALIDATING', 'APPROVED', evidence, false);
    expect(withoutApproval.ok).toBe(false);
    expect(withoutApproval.missing).toContain('approval');

    const withApproval = canTransition('VALIDATING', 'APPROVED', evidence, true);
    expect(withApproval.ok).toBe(true);
  });

  it('allows a transition that needs no evidence and no approval, e.g. APPROVED -> DESIGNING', () => {
    expect(canTransition('APPROVED', 'DESIGNING', {}, false).ok).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test -- schemas`
Expected: FAIL — `canTransition` not exported.

- [ ] **Step 3: Implement**

```ts
// packages/schemas/src/product-state.ts
export type ProductState =
  | 'DISCOVERED' | 'RESEARCHING' | 'VALIDATING' | 'APPROVED' | 'DESIGNING'
  | 'BUILDING' | 'TESTING' | 'SECURITY_REVIEW' | 'RELEASE_CANDIDATE'
  | 'HUMAN_APPROVAL' | 'BETA' | 'PRODUCTION' | 'GROWTH' | 'MAINTENANCE'
  | 'PAUSED' | 'SUNSET' | 'ARCHIVED';

export interface TransitionRule {
  from: ProductState;
  to: ProductState;
  requiredEvidence: readonly string[];
  requiresApproval: boolean;
}

export const TRANSITIONS: readonly TransitionRule[] = [
  { from: 'DISCOVERED', to: 'RESEARCHING', requiredEvidence: ['opportunityId', 'problem', 'targetUser', 'sources'], requiresApproval: false },
  { from: 'RESEARCHING', to: 'VALIDATING', requiredEvidence: ['disproofAnswers', 'competitorsChecked'], requiresApproval: false },
  { from: 'VALIDATING', to: 'APPROVED', requiredEvidence: ['scoreSheet', 'evidenceSources', 'mvpScope', 'slotPlan'], requiresApproval: true },
  { from: 'APPROVED', to: 'DESIGNING', requiredEvidence: [], requiresApproval: false },
  { from: 'DESIGNING', to: 'BUILDING', requiredEvidence: ['prd', 'architecture', 'permissionsYaml', 'dataClassification', 'acceptanceCriteria'], requiresApproval: false },
  { from: 'BUILDING', to: 'TESTING', requiredEvidence: ['ciGreen'], requiresApproval: false },
  { from: 'TESTING', to: 'SECURITY_REVIEW', requiredEvidence: ['qaEvidenceComplete'], requiresApproval: false },
  { from: 'SECURITY_REVIEW', to: 'RELEASE_CANDIDATE', requiredEvidence: ['securityScanClean'], requiresApproval: false },
  { from: 'RELEASE_CANDIDATE', to: 'HUMAN_APPROVAL', requiredEvidence: ['rcChecklist', 'storeListingDiff', 'privacyDiff', 'changelog'], requiresApproval: false },
  { from: 'HUMAN_APPROVAL', to: 'BETA', requiredEvidence: ['approvalId'], requiresApproval: true },
  { from: 'HUMAN_APPROVAL', to: 'PRODUCTION', requiredEvidence: ['approvalId'], requiresApproval: true },
  { from: 'BETA', to: 'PRODUCTION', requiredEvidence: ['betaMetricsOk'], requiresApproval: false },
  { from: 'PRODUCTION', to: 'GROWTH', requiredEvidence: ['analystReadout'], requiresApproval: false },
  { from: 'PRODUCTION', to: 'MAINTENANCE', requiredEvidence: ['analystReadout'], requiresApproval: false },
  { from: 'GROWTH', to: 'MAINTENANCE', requiredEvidence: [], requiresApproval: false },
  { from: 'MAINTENANCE', to: 'GROWTH', requiredEvidence: [], requiresApproval: false },
  { from: 'GROWTH', to: 'PAUSED', requiredEvidence: ['killPolicySheet'], requiresApproval: true },
  { from: 'MAINTENANCE', to: 'PAUSED', requiredEvidence: ['killPolicySheet'], requiresApproval: true },
  { from: 'PAUSED', to: 'MAINTENANCE', requiredEvidence: [], requiresApproval: false },
  { from: 'PAUSED', to: 'SUNSET', requiredEvidence: ['killPolicySheet'], requiresApproval: true },
  { from: 'SUNSET', to: 'ARCHIVED', requiredEvidence: [], requiresApproval: false },
];

export interface TransitionCheckResult {
  ok: boolean;
  missing: string[];
  rule?: TransitionRule;
}

function isPresent(value: unknown): boolean {
  if (value === undefined || value === null) return false;
  if (typeof value === 'string') return value.trim().length > 0;
  if (Array.isArray(value)) return value.length > 0;
  return true;
}

export function canTransition(
  from: ProductState,
  to: ProductState,
  evidence: Record<string, unknown>,
  hasApproval: boolean
): TransitionCheckResult {
  const rule = TRANSITIONS.find((r) => r.from === from && r.to === to);
  if (!rule) {
    return { ok: false, missing: [`no transition defined from ${from} to ${to}`] };
  }
  const missing = rule.requiredEvidence.filter((key) => !isPresent(evidence[key]));
  if (rule.requiresApproval && !hasApproval) missing.push('approval');
  return { ok: missing.length === 0, missing, rule };
}
```

```ts
// packages/schemas/src/index.ts  (append)
export * from './product-state.js';
```

Run: `pnpm test -- schemas`
Expected: PASS (17 tests total in this package).

- [ ] **Step 4: Commit**

```bash
git add packages/schemas
git commit -m "feat(schemas): add product state-machine transition checker"
```

---

### Task 5: `@appforge/cli` — `appforge validate` and `appforge product-transition`

**Files:**
- Create: `packages/cli/package.json` (name `@appforge/cli`, bin `appforge`)
- Create: `packages/cli/tsconfig.json`
- Create: `packages/cli/src/output.ts`
- Create: `packages/cli/src/commands/validate.ts`
- Create: `packages/cli/src/commands/product-transition.ts`
- Create: `packages/cli/src/index.ts`
- Test: `packages/cli/tests/output.test.ts`
- Test: `packages/cli/tests/cli.integration.test.ts`

**Interfaces:**
- Consumes: `validatePermissions` from `@appforge/schemas` (Task 2), `canTransition`/`ProductState` from `@appforge/schemas` (Task 4).
- Produces: the `appforge` binary; the `CliOutput<T>` shape (`schema: 'cli-output@1'`) referenced by §29c — this is the first concrete implementation of that contract, so any later CLI command must reuse `printResult` rather than inventing its own output shape.

- [ ] **Step 1: Write the failing test for the shared output formatter**

```ts
// packages/cli/tests/output.test.ts
import { describe, it, expect, vi } from 'vitest';
import { buildOutput } from '../src/output.js';

describe('buildOutput (cli-output@1 contract)', () => {
  it('includes the schema tag and command name on success', () => {
    const out = buildOutput('validate', true, { checked: 1 });
    expect(out).toEqual({ schema: 'cli-output@1', ok: true, command: 'validate', data: { checked: 1 }, errors: [] });
  });

  it('carries errors on failure with no data field required', () => {
    const out = buildOutput('validate', false, undefined, ['(root): must have required property schema']);
    expect(out.ok).toBe(false);
    expect(out.errors).toEqual(['(root): must have required property schema']);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test -- cli`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the output helper and the two commands**

```ts
// packages/cli/src/output.ts
export interface CliOutput<T> {
  schema: 'cli-output@1';
  ok: boolean;
  command: string;
  data?: T;
  errors: string[];
}

export function buildOutput<T>(command: string, ok: boolean, data?: T, errors: string[] = []): CliOutput<T> {
  return { schema: 'cli-output@1', ok, command, data, errors };
}

export function printOutput<T>(output: CliOutput<T>, json: boolean): void {
  if (json) {
    process.stdout.write(JSON.stringify(output) + '\n');
    return;
  }
  if (output.ok) {
    console.log(`✔ ${output.command} passed`);
  } else {
    console.error(`✘ ${output.command} failed`);
    for (const err of output.errors) console.error(`  - ${err}`);
  }
}
```

```ts
// packages/cli/src/commands/validate.ts
import { readFileSync } from 'node:fs';
import { parse as parseYaml } from 'yaml';
import { validatePermissions } from '@appforge/schemas';
import { buildOutput, printOutput } from '../output.js';

export interface ValidateOptions {
  file: string;
  json: boolean;
}

/** Exit codes: 0 ok, 2 invalid input (unreadable/unparseable file), 3 schema validation failed. */
export function runValidate(opts: ValidateOptions): number {
  let doc: unknown;
  try {
    doc = parseYaml(readFileSync(opts.file, 'utf8'));
  } catch (err) {
    printOutput(buildOutput('validate', false, undefined, [`cannot read/parse ${opts.file}: ${(err as Error).message}`]), opts.json);
    return 2;
  }
  const result = validatePermissions(doc);
  printOutput(buildOutput('validate', result.ok, undefined, result.errors), opts.json);
  return result.ok ? 0 : 3;
}
```

```ts
// packages/cli/src/commands/product-transition.ts
import { readFileSync } from 'node:fs';
import { canTransition, type ProductState } from '@appforge/schemas';
import { buildOutput, printOutput } from '../output.js';

export interface ProductTransitionOptions {
  from: ProductState;
  to: ProductState;
  evidenceFile?: string;
  approved: boolean;
  json: boolean;
}

/** Exit codes: 0 ok, 2 invalid input (unreadable evidence file when one was given), 8 transition not allowed. */
export function runProductTransition(opts: ProductTransitionOptions): number {
  let evidence: Record<string, unknown> = {};
  if (opts.evidenceFile) {
    try {
      evidence = JSON.parse(readFileSync(opts.evidenceFile, 'utf8'));
    } catch (err) {
      printOutput(buildOutput('product-transition', false, undefined, [`cannot read/parse ${opts.evidenceFile}: ${(err as Error).message}`]), opts.json);
      return 2;
    }
  }
  const result = canTransition(opts.from, opts.to, evidence, opts.approved);
  printOutput(buildOutput('product-transition', result.ok, { rule: result.rule }, result.missing), opts.json);
  return result.ok ? 0 : 8;
}
```

```ts
// packages/cli/src/index.ts
#!/usr/bin/env node
import { Command } from 'commander';
import { runValidate } from './commands/validate.js';
import { runProductTransition } from './commands/product-transition.js';
import type { ProductState } from '@appforge/schemas';

const program = new Command();
program.name('appforge').version('0.1.0');

program
  .command('validate')
  .description("Validate .appforge/permissions.yaml against the appforge/permissions@1 schema")
  .option('--file <path>', 'path to permissions.yaml', '.appforge/permissions.yaml')
  .option('--json', 'machine-readable output', false)
  .action((opts: { file: string; json: boolean }) => {
    process.exitCode = runValidate(opts);
  });

program
  .command('product-transition')
  .description('Check whether a product state transition is allowed')
  .requiredOption('--from <state>', 'current product state')
  .requiredOption('--to <state>', 'target product state')
  .option('--evidence <path>', 'JSON file of evidence flags')
  .option('--approved', 'a board approval has been verified for this transition', false)
  .option('--json', 'machine-readable output', false)
  .action((opts: { from: string; to: string; evidence?: string; approved: boolean; json: boolean }) => {
    process.exitCode = runProductTransition({
      from: opts.from as ProductState,
      to: opts.to as ProductState,
      evidenceFile: opts.evidence,
      approved: opts.approved,
      json: opts.json,
    });
  });

program.parseAsync(process.argv);
```

```json
// packages/cli/package.json
{
  "name": "@appforge/cli",
  "version": "0.1.0",
  "type": "module",
  "bin": { "appforge": "./dist/index.js" },
  "scripts": { "build": "tsc -p tsconfig.json" },
  "dependencies": {
    "@appforge/router": "workspace:*",
    "@appforge/schemas": "workspace:*",
    "commander": "^12.1.0",
    "yaml": "^2.5.0"
  },
  "devDependencies": { "typescript": "^5.6.0" }
}
```

```json
// packages/cli/tsconfig.json
{
  "extends": "../../tsconfig.base.json",
  "include": ["src"]
}
```

Run: `pnpm install && pnpm test -- cli`
Expected: PASS (2 tests) for `output.test.ts`; `runValidate`/`runProductTransition` are exported but not yet exercised end-to-end — that's Step 4.

- [ ] **Step 4: Write and pass the integration tests (Review Focus: malformed YAML, no-edge transition)**

```ts
// packages/cli/tests/cli.integration.test.ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { runValidate } from '../src/commands/validate.js';
import { runProductTransition } from '../src/commands/product-transition.js';

let dir: string;
beforeAll(() => { dir = mkdtempSync(path.join(tmpdir(), 'appforge-cli-test-')); });
afterAll(() => { rmSync(dir, { recursive: true, force: true }); });

describe('runValidate', () => {
  it('returns 0 for a valid permissions.yaml', () => {
    const file = path.join(dir, 'valid.yaml');
    writeFileSync(file, [
      'schema: appforge/permissions@1',
      'permissions:',
      '  - permission: storage',
      '    required: true',
      "    reason: \"Save the user's pipelines locally\"",
      '    data_access: [user_content_local]',
      '    security_impact: low',
    ].join('\n'));
    expect(runValidate({ file, json: true })).toBe(0);
  });

  it('returns 2 for malformed YAML, not a crash (Review Focus)', () => {
    const file = path.join(dir, 'broken.yaml');
    writeFileSync(file, 'schema: [unclosed');
    expect(runValidate({ file, json: true })).toBe(2);
  });

  it('returns 3 for well-formed YAML that fails the schema', () => {
    const file = path.join(dir, 'invalid.yaml');
    writeFileSync(file, 'schema: appforge/permissions@1\npermissions: []\nextra: not-allowed');
    expect(runValidate({ file, json: true })).toBe(3);
  });
});

describe('runProductTransition', () => {
  it('returns 8 for a transition with no defined edge (Review Focus)', () => {
    expect(runProductTransition({ from: 'DISCOVERED', to: 'PRODUCTION', approved: true, json: true })).toBe(8);
  });

  it('returns 0 for an allowed transition with an evidence file', () => {
    const file = path.join(dir, 'evidence.json');
    writeFileSync(file, JSON.stringify({ opportunityId: 'OPP-0001', problem: 'x', targetUser: 'y', sources: ['a'] }));
    expect(runProductTransition({ from: 'DISCOVERED', to: 'RESEARCHING', evidenceFile: file, approved: false, json: true })).toBe(0);
  });
});
```

Run: `pnpm test -- cli`
Expected: PASS (7 tests total in this package; 26 across the whole monorepo).

- [ ] **Step 5: Wire up the workspace build and typecheck, then commit**

Run: `pnpm typecheck && pnpm build && pnpm test`
Expected: all three succeed; `packages/cli/dist/index.js` exists and is executable.

```bash
git add packages/cli
git commit -m "feat(cli): add appforge validate and appforge product-transition (cli-output@1)"
```

## Self-Review Notes

- **Spec coverage:** §7.2's three routing rules (risk escalation, budget downgrade with a code-task floor, CRITICAL independent review) each have a passing test in Task 1. §13.2's manifest⇔yaml equality and high-risk-on-addition rules are both covered in Task 3, including the wildcard-pattern case the plain-English spec implies but doesn't spell out mechanically. §10.2's "no skipping" rule and "empty evidence counts as missing" are both covered in Task 4.
- **Placeholder scan:** no TBD/"add error handling"/"similar to Task N" text anywhere above; every step has runnable code.
- **Type consistency:** `ProductState` in Task 4 matches §29d's `Product.state` field exactly (same 17 values, same spelling); `RouteRequest`/`RouteDecision`/`ModelRouter` in Task 1 match §7.2 after the `budgetRemainingPct` fix propagated there. `Complexity`, `TierConfig`, and `RouterConfig` are new (not previously spelled out field-by-field in §7) but are consistent with the narrative in §7.1/§7.3 (tiers keyed by `LOW|NORMAL|HIGH|CRITICAL`, one `RouterConfig` mirroring `models.yaml`).
- **Review Focus:** all five items each have a named test (search "Review Focus" in the test code above) rather than being left as prose.
- **What's deliberately out of scope here** (later subsystems, each gets its own plan when its turn comes per §30): reading real `models.yaml`/`security.yaml` from disk into a `RouterConfig`/high-risk list (trivial glue once this exists, folded into P1-06); wiring this CLI into Paperclip agent runs (§7.3, needs Paperclip live first); the `appforge security scan` and e2e/QA commands (§13.4, need a real extension fixture); publishing `@appforge/*` to npm (§29c, needs the GitHub org/npm token decision).

---

**Execution:** Native (chosen by the founder 2026-09-26) — implemented inline in one session task-by-task, per superpowers:executing-plans, with one fresh whole-branch review at the end.

---
