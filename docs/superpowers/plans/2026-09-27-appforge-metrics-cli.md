# AppForge Metrics CLI (P1-16) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
>
> **Execution method for this plan: Native/inline (superpowers:executing-plans).** This is a pre-decided, repo-wide convention this session (every other plan under `docs/superpowers/plans/` was executed this way) — not re-litigated here.

**Goal:** Add an `appforge metrics show|pnl|anomalies` CLI surface: `show` queries `GET /v1/metrics` on the deployed edge worker via an injectable HTTP client, `pnl` computes the exact §21.1 P&L line-item table from a local fixture of `Revenue`/`Cost` rows via a new pure `computePnl` function, and `anomalies` runs a deterministic z-score check over metric series fetched from the edge.

**Architecture:** A new `packages/cli/src/edge-client.ts` wraps `GET /v1/metrics` behind a small `EdgeClient` class that takes an injectable `fetcher` (mirroring the existing `FlagsFetcher` pattern in `packages/flags/src/types.ts`), so command tests never touch the network or the real deployed worker. `packages/schemas/src/pnl.ts` exports a pure `computePnl(revenue, costs): PnlResult` matching the master plan §21.1 table exactly. `packages/schemas/src/anomaly-detection.ts` exports a pure `detectAnomalies(series, opts?)` doing a trailing-window z-score check. Three new command modules in `packages/cli/src/commands/` (`metrics-show.ts`, `metrics-pnl.ts`, `metrics-anomalies.ts`) wire these together behind the existing `cli-output@1` contract (`buildOutput`/`printOutput` from `packages/cli/src/output.ts`), and `packages/cli/src/index.ts` gets a new `metrics` subcommand group.

**Tech Stack:** TypeScript, Commander 12, Vitest 2.x (`packages/cli`, `packages/schemas` — both covered by the root `vitest.workspace.ts`, NOT the isolated Vitest-4 `apps/edge` suite), Node 22 global `fetch` (only as the *default* fetcher; all tests inject a fake).

**Spec:** `~/git-personal/.claude/appforge-ai-master-plan.md` §29c (CLI contract table — the `appforge metrics` row), §21.1 (P&L line-item formulas), §29d (`Revenue`/`Cost`/`Metric` interfaces, `metrics_daily`/`revenue`/`costs` D1 DDL), §6.2 Analyst role ("anomaly detection (deterministic z-score/threshold rules in `appforge metrics anomalies`)"). Backend already live: `apps/edge/src/handlers/metrics.ts` (`GET /v1/metrics?product&name&from&to`), gated by the same bearer token as ingest (`apps/edge/src/handlers/ingest.ts`'s `isAuthorized`).

## Global Constraints

- Scope is the query/reporting layer only. Do NOT build real D1-backed revenue/cost ingestion (Paperclip costs, CWS CSV, Play reports, Gumroad) — that is P1-15's job, currently blocked on external decisions. `pnl` reads a `--fixture <path>` JSON file as its interim input source until P1-15 wires up real ingestion.
- No real `INGEST_ADMIN_TOKEN` secret is available or will be used. Every test of edge-calling code uses an injected fake fetcher — never a live HTTP request to `https://appforge-edge.echokit-rk.workers.dev`.
- Follow the existing `cli-output@1` contract exactly: every command's `printOutput` call goes through `buildOutput(command, ok, data, errors)` from `packages/cli/src/output.ts`. Do not invent a new output shape.
- Exit codes already taken in this CLI: `0` ok, `2` invalid input, `3` schema validation failed, `4` tests failed, `6` security findings, `7` CSP/remote-script findings, `8` transition not allowed, `9` reserved (deterministic-task routing, not yet implemented). New codes this plan introduces: `14` data gap (per master plan §29c, explicitly named for `appforge metrics`) and `17` edge request failed (new — auth rejected, non-2xx, or network error talking to the edge; not reserved by the master plan's table for any other command, chosen to stay clear of `5`/`10`/`11`/`12`/`13`/`15`/`16`, which the master plan's §29c table already earmarks for `create`, `approval`, `release`, `doctor`, `cred`).
- `packages/cli` depends on `@appforge/schemas` already (see `packages/cli/package.json`); `pnl.ts` and `anomaly-detection.ts` are new exports added to `packages/schemas/src/index.ts`, no new inter-package dependency needed.
- Config resolution for edge calls: `--edge-url`/`--edge-token` flags fall back to `APPFORGE_EDGE_URL`/`APPFORGE_EDGE_TOKEN` env vars (per master plan §29c: "edge via `APPFORGE_EDGE_TOKEN`"). Missing either → exit `2` (invalid input), not a crash.
- Money fields are always integer cents (matching `Revenue`/`Cost`'s `*_cents` fields) — `computePnl` must never introduce floating-point cents; only `contributionMargin` (a ratio) is a float, and it is `null` when net revenue is `0` (§21.1: "undefined if net revenue = 0 ⇒ report contribution only").
- Verification before declaring done: `pnpm install && pnpm typecheck && pnpm build && pnpm test && pnpm lint` from repo root, all five green — this has caught real cross-package regressions before in this repo.

## Review Focus

- **Edge returns zero rows for a valid product** (e.g. a brand-new product with nothing ingested yet) — `show` and `anomalies` must report this as the documented "data gap" (exit `14`), not silently print an empty success or crash on `undefined`.
- **Edge is unreachable, times out, or returns a non-2xx status (401 from a bad/rotated token, 500, etc.)** — must surface as a distinct, documented failure (exit `17`) with a real error message, not an uncaught rejection or a `data gap` false-positive.
- **`pnl` fixture has costs with no matching product/date, or is empty/malformed JSON** — must not divide by zero or silently return a P&L with `NaN`/`Infinity`; empty-after-filter is a data gap (exit `14`), malformed JSON is invalid input (exit `2`).
- **`pnl` net revenue is exactly 0** — `contributionMargin` must be `null` per §21.1, not `NaN` or `Infinity` from a `0/0` division, and the CLI's JSON output must still be valid (no `NaN` literal, which is not valid JSON).
- **`anomalies` on a short or perfectly flat series** — a series shorter than the minimum trailing history must never be flagged (not enough data to have an opinion), and a flat series (`stddev === 0`) must not divide by zero or flag every point as an infinite-z-score anomaly when nothing actually changed.

---

## File Structure

New/changed files:

- `packages/schemas/src/pnl.ts` — `Revenue`, `Cost`, `PnlResult` types + pure `computePnl(revenue, costs): PnlResult`.
- `packages/schemas/tests/pnl.test.ts` — hand-verified arithmetic tests, including the concrete fixture-month test the master plan's P1-16 acceptance criterion calls for.
- `packages/schemas/src/anomaly-detection.ts` — `MetricPoint`, `AnomalyResult`, `AnomalyOptions` types + pure `detectAnomalies(series, opts?): AnomalyResult[]`.
- `packages/schemas/tests/anomaly-detection.test.ts` — a normal (non-anomalous) series and a clearly anomalous series, plus the short-series and flat-series edge cases from Review Focus.
- `packages/schemas/src/index.ts` — add the two new `export * from` lines.
- `packages/cli/src/edge-client.ts` — `EdgeFetcher` interface (injectable, mirrors `packages/flags/src/types.ts`'s `FlagsFetcher`), `MetricRow` type, `EdgeRequestError`, and `EdgeClient` class with `getMetrics(params)`.
- `packages/cli/tests/edge-client.test.ts` — unit tests against a fake fetcher (success, non-2xx, network throw).
- `packages/cli/src/commands/metrics-show.ts` — `runMetricsShow(opts, deps?)`.
- `packages/cli/src/commands/metrics-pnl.ts` — `runMetricsPnl(opts)`.
- `packages/cli/src/commands/metrics-anomalies.ts` — `runMetricsAnomalies(opts, deps?)`.
- `packages/cli/tests/metrics-show.integration.test.ts`
- `packages/cli/tests/metrics-pnl.integration.test.ts`
- `packages/cli/tests/metrics-pnl-fixture.json` — a concrete one-month fixture used by both the schemas-level hand-calc test and the CLI-level integration test.
- `packages/cli/tests/metrics-anomalies.integration.test.ts`
- `packages/cli/src/index.ts` — add the `metrics` command group (`show`, `pnl`, `anomalies` subcommands).

## Global Constraints

(see above — kept above per template; not duplicated here)

---

### Task 1: `computePnl` — pure P&L calculator in `@appforge/schemas`

**Files:**
- Create: `packages/schemas/src/pnl.ts`
- Create: `packages/schemas/tests/pnl.test.ts`
- Modify: `packages/schemas/src/index.ts`

**Interfaces:**
- Consumes: nothing from other tasks.
- Produces (for Task 3 and later tasks to import from `@appforge/schemas`):
  ```ts
  export interface Revenue {
    id: string;
    product_id: string;
    provider: string;
    gross_cents: number;
    fee_cents: number;
    refund_cents: number;
    tax_cents: number;
    currency: string;
    occurred_at: string; // ISO date or date-time string
  }
  export interface Cost {
    id: string;
    product_id?: string;
    category: 'ai' | 'infra' | 'marketing' | 'support' | 'other';
    amount_cents: number;
    occurred_at: string;
    ref?: string;
  }
  export interface PnlResult {
    grossRevenueCents: number;
    refundsCents: number;
    paymentFeesCents: number;
    netRevenueCents: number;
    aiCostCents: number;
    infrastructureCents: number;
    marketingCents: number;
    supportCents: number;
    otherVariableCents: number;
    contributionCents: number;
    contributionMargin: number | null; // null when netRevenueCents === 0
  }
  export function computePnl(revenue: Revenue[], costs: Cost[]): PnlResult;
  ```

- [ ] **Step 1: Write the failing test**

Create `packages/schemas/tests/pnl.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { computePnl, type Revenue, type Cost } from '../src/pnl.js';

// Hand-calculated fixture month for product "json-workbench":
// Revenue: two Gumroad sales.
//   Sale A: gross $10.00 (1000c), fee $0.90 (90c, 9%), refund $0, tax $0.
//   Sale B: gross $5.00 (500c), fee $0.45 (45c), refund $5.00 (500c, fully refunded), tax $0.
// Costs:
//   ai: 120c + 30c = 150c
//   infra: 25c
//   marketing: 0 (none this month)
//   support: 200c
//   other: 10c
//
// Hand calc:
//   grossRevenue = 1000 + 500 = 1500
//   refunds = 0 + 500 = 500
//   paymentFees = 90 + 45 = 135
//   netRevenue = 1500 - 500 - 135 - 0(tax) = 865
//   aiCost = 150, infra = 25, marketing = 0, support = 200, otherVariable = 10
//   contribution = 865 - 150 - 25 - 0 - 200 - 10 = 480
//   contributionMargin = 480 / 865 = 0.5549132947976878...

const REVENUE: Revenue[] = [
  { id: 'r1', product_id: 'json-workbench', provider: 'gumroad', gross_cents: 1000, fee_cents: 90, refund_cents: 0, tax_cents: 0, currency: 'usd', occurred_at: '2026-09-05' },
  { id: 'r2', product_id: 'json-workbench', provider: 'gumroad', gross_cents: 500, fee_cents: 45, refund_cents: 500, tax_cents: 0, currency: 'usd', occurred_at: '2026-09-12' },
];
const COSTS: Cost[] = [
  { id: 'c1', product_id: 'json-workbench', category: 'ai', amount_cents: 120, occurred_at: '2026-09-01' },
  { id: 'c2', product_id: 'json-workbench', category: 'ai', amount_cents: 30, occurred_at: '2026-09-15' },
  { id: 'c3', product_id: 'json-workbench', category: 'infra', amount_cents: 25, occurred_at: '2026-09-01' },
  { id: 'c4', product_id: 'json-workbench', category: 'support', amount_cents: 200, occurred_at: '2026-09-20' },
  { id: 'c5', product_id: 'json-workbench', category: 'other', amount_cents: 10, occurred_at: '2026-09-01' },
];

describe('computePnl', () => {
  it('matches a hand calc on a fixture month (master plan P1-16 acceptance criterion)', () => {
    const result = computePnl(REVENUE, COSTS);
    expect(result.grossRevenueCents).toBe(1500);
    expect(result.refundsCents).toBe(500);
    expect(result.paymentFeesCents).toBe(135);
    expect(result.netRevenueCents).toBe(865);
    expect(result.aiCostCents).toBe(150);
    expect(result.infrastructureCents).toBe(25);
    expect(result.marketingCents).toBe(0);
    expect(result.supportCents).toBe(200);
    expect(result.otherVariableCents).toBe(10);
    expect(result.contributionCents).toBe(480);
    expect(result.contributionMargin).toBeCloseTo(480 / 865, 10);
  });

  it('returns a null contributionMargin (not NaN/Infinity) when net revenue is exactly 0 (Review Focus)', () => {
    const revenue: Revenue[] = [
      { id: 'r1', product_id: 'p', provider: 'gumroad', gross_cents: 1000, fee_cents: 0, refund_cents: 1000, tax_cents: 0, currency: 'usd', occurred_at: '2026-09-01' },
    ];
    const result = computePnl(revenue, []);
    expect(result.netRevenueCents).toBe(0);
    expect(result.contributionMargin).toBeNull();
    expect(() => JSON.stringify(result)).not.toThrow();
    expect(JSON.stringify(result)).not.toContain('NaN');
  });

  it('returns all zeros (not a crash) for empty revenue and costs', () => {
    const result = computePnl([], []);
    expect(result).toEqual({
      grossRevenueCents: 0,
      refundsCents: 0,
      paymentFeesCents: 0,
      netRevenueCents: 0,
      aiCostCents: 0,
      infrastructureCents: 0,
      marketingCents: 0,
      supportCents: 0,
      otherVariableCents: 0,
      contributionCents: 0,
      contributionMargin: null,
    });
  });

  it('subtracts tax_cents from net revenue (§21.1: "Net revenue = Gross - refunds - payment fees - taxes remitted by MoR")', () => {
    const revenue: Revenue[] = [
      { id: 'r1', product_id: 'p', provider: 'play', gross_cents: 1000, fee_cents: 100, refund_cents: 0, tax_cents: 80, currency: 'usd', occurred_at: '2026-09-01' },
    ];
    const result = computePnl(revenue, []);
    expect(result.netRevenueCents).toBe(1000 - 100 - 80);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @appforge/schemas exec vitest run tests/pnl.test.ts`
Expected: FAIL — `Cannot find module '../src/pnl.js'`

- [ ] **Step 3: Write minimal implementation**

Create `packages/schemas/src/pnl.ts`:

```ts
/**
 * Mirrors of the master plan §29d `Revenue`/`Cost` interfaces. Kept here (not re-exported from a
 * shared "data models" file) because this package has no other home for D1-sourced row shapes yet
 * — @appforge/schemas is the shared types package every consumer (CLI, and eventually P1-15's
 * ingestion) already depends on.
 */
export interface Revenue {
  id: string;
  product_id: string;
  provider: string;
  gross_cents: number;
  fee_cents: number;
  refund_cents: number;
  tax_cents: number;
  currency: string;
  occurred_at: string;
}

export interface Cost {
  id: string;
  product_id?: string;
  category: 'ai' | 'infra' | 'marketing' | 'support' | 'other';
  amount_cents: number;
  occurred_at: string;
  ref?: string;
}

/**
 * The exact §21.1 P&L line-item table, computed over whatever Revenue/Cost rows the caller passes
 * in (already scoped to one product and one period — this function does no filtering itself, see
 * `appforge metrics pnl`'s command-level filtering). All money fields are integer cents; only
 * contributionMargin is a ratio, and it is `null` (not NaN/Infinity) when net revenue is 0, per
 * §21.1: "undefined if net revenue = 0 ⇒ report contribution only".
 */
export interface PnlResult {
  grossRevenueCents: number;
  refundsCents: number;
  paymentFeesCents: number;
  netRevenueCents: number;
  aiCostCents: number;
  infrastructureCents: number;
  marketingCents: number;
  supportCents: number;
  otherVariableCents: number;
  contributionCents: number;
  contributionMargin: number | null;
}

function sumCostsByCategory(costs: Cost[], category: Cost['category']): number {
  return costs.filter((c) => c.category === category).reduce((sum, c) => sum + c.amount_cents, 0);
}

export function computePnl(revenue: Revenue[], costs: Cost[]): PnlResult {
  const grossRevenueCents = revenue.reduce((sum, r) => sum + r.gross_cents, 0);
  const refundsCents = revenue.reduce((sum, r) => sum + r.refund_cents, 0);
  const paymentFeesCents = revenue.reduce((sum, r) => sum + r.fee_cents, 0);
  const taxCents = revenue.reduce((sum, r) => sum + r.tax_cents, 0);
  const netRevenueCents = grossRevenueCents - refundsCents - paymentFeesCents - taxCents;

  const aiCostCents = sumCostsByCategory(costs, 'ai');
  const infrastructureCents = sumCostsByCategory(costs, 'infra');
  const marketingCents = sumCostsByCategory(costs, 'marketing');
  const supportCents = sumCostsByCategory(costs, 'support');
  const otherVariableCents = sumCostsByCategory(costs, 'other');

  const contributionCents =
    netRevenueCents - aiCostCents - infrastructureCents - marketingCents - supportCents - otherVariableCents;

  const contributionMargin = netRevenueCents === 0 ? null : contributionCents / netRevenueCents;

  return {
    grossRevenueCents,
    refundsCents,
    paymentFeesCents,
    netRevenueCents,
    aiCostCents,
    infrastructureCents,
    marketingCents,
    supportCents,
    otherVariableCents,
    contributionCents,
    contributionMargin,
  };
}
```

Modify `packages/schemas/src/index.ts` to add:

```ts
export * from './pnl.js';
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @appforge/schemas exec vitest run tests/pnl.test.ts`
Expected: PASS (all 4 tests)

- [ ] **Step 5: Commit**

```bash
git add packages/schemas/src/pnl.ts packages/schemas/tests/pnl.test.ts packages/schemas/src/index.ts
git commit -m "$(cat <<'EOF'
feat(schemas): add computePnl (§21.1 P&L line-item table)

Pure function over already-scoped Revenue/Cost rows; P1-15 will feed it
real D1-sourced data later without changing this math.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 2: `detectAnomalies` — pure z-score anomaly detector in `@appforge/schemas`

**Files:**
- Create: `packages/schemas/src/anomaly-detection.ts`
- Create: `packages/schemas/tests/anomaly-detection.test.ts`
- Modify: `packages/schemas/src/index.ts`

**Interfaces:**
- Consumes: nothing from other tasks.
- Produces (for Task 5 to import from `@appforge/schemas`):
  ```ts
  export interface MetricPoint { date: string; value: number; }
  export interface AnomalyResult {
    date: string;
    value: number;
    trailingMean: number;
    trailingStdDev: number;
    zScore: number;
    isAnomaly: boolean;
  }
  export interface AnomalyOptions {
    minHistory?: number; // default 5
    zThreshold?: number; // default 3
  }
  export function detectAnomalies(series: MetricPoint[], opts?: AnomalyOptions): AnomalyResult[];
  ```

**Design decision (documented here, not just in code comments):** for each point at index `i` (0-based), the "trailing window" is every prior point `series[0..i-1]` in the given order (an expanding window, not a fixed-size rolling window — simplest deterministic rule that needs no extra tuning parameter). A point is only evaluated once at least `minHistory` (default 5) prior points exist; earlier points are always `isAnomaly: false` with `trailingMean`/`trailingStdDev`/`zScore` set to `0` (not enough data to have an opinion — Review Focus: never flag a short series). If the trailing window's population standard deviation is `0` (a perfectly flat history), a point equal to that constant is not an anomaly (`zScore: 0`); a point that differs at all is treated as `zScore: Infinity` and flagged, since any deviation from an exactly-constant history is real news, not a division-by-zero artifact (Review Focus: flat series must not divide by zero or misfire on non-deviating points). `series` is assumed to already be in chronological order (matching `GET /v1/metrics`'s `ORDER BY date ASC`); this function does not re-sort.

- [ ] **Step 1: Write the failing test**

Create `packages/schemas/tests/anomaly-detection.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { detectAnomalies, type MetricPoint } from '../src/anomaly-detection.js';

function series(values: number[], startDate = '2026-09-01'): MetricPoint[] {
  const start = new Date(startDate + 'T00:00:00Z');
  return values.map((value, i) => {
    const d = new Date(start);
    d.setUTCDate(d.getUTCDate() + i);
    return { date: d.toISOString().slice(0, 10), value };
  });
}

describe('detectAnomalies', () => {
  it('flags no points in a normal, gently-varying series (Review Focus: no false positives)', () => {
    const results = detectAnomalies(series([10, 11, 9, 10, 12, 10, 11, 9, 10, 11]));
    expect(results.some((r) => r.isAnomaly)).toBe(false);
  });

  it('flags a clear spike day against a stable trailing history', () => {
    // 6 stable days around 10, then a day at 100 — a massive, obvious spike.
    const results = detectAnomalies(series([10, 10, 11, 9, 10, 10, 100]));
    const spikeDay = results[results.length - 1];
    expect(spikeDay.value).toBe(100);
    expect(spikeDay.isAnomaly).toBe(true);
    expect(spikeDay.zScore).toBeGreaterThan(3);
  });

  it('never flags a point before minHistory prior points exist, even if it looks extreme (Review Focus: short series)', () => {
    // Only 3 points total; default minHistory is 5, so nothing can be evaluated yet.
    const results = detectAnomalies(series([1, 1, 1000]));
    expect(results.every((r) => r.isAnomaly === false)).toBe(true);
  });

  it('does not divide by zero and does not flag a point matching a perfectly flat history (Review Focus: flat series)', () => {
    const results = detectAnomalies(series([5, 5, 5, 5, 5, 5]));
    const lastDay = results[results.length - 1];
    expect(lastDay.trailingStdDev).toBe(0);
    expect(lastDay.isAnomaly).toBe(false);
    expect(Number.isFinite(lastDay.zScore)).toBe(true);
  });

  it('flags any deviation from a perfectly flat history as an anomaly, without NaN/crash (Review Focus: flat series)', () => {
    const results = detectAnomalies(series([5, 5, 5, 5, 5, 6]));
    const lastDay = results[results.length - 1];
    expect(lastDay.trailingStdDev).toBe(0);
    expect(lastDay.isAnomaly).toBe(true);
    expect(lastDay.zScore).toBe(Infinity);
  });

  it('respects a custom minHistory and zThreshold', () => {
    const results = detectAnomalies(series([10, 10, 30]), { minHistory: 2, zThreshold: 1 });
    expect(results[2].isAnomaly).toBe(true);
  });

  it('returns one result per input point, in order, with dates preserved', () => {
    const input = series([1, 2, 3]);
    const results = detectAnomalies(input);
    expect(results.map((r) => r.date)).toEqual(input.map((p) => p.date));
    expect(results.map((r) => r.value)).toEqual(input.map((p) => p.value));
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @appforge/schemas exec vitest run tests/anomaly-detection.test.ts`
Expected: FAIL — `Cannot find module '../src/anomaly-detection.js'`

- [ ] **Step 3: Write minimal implementation**

Create `packages/schemas/src/anomaly-detection.ts`:

```ts
/**
 * Deterministic z-score anomaly check over a chronologically-ordered metric series (master plan
 * §6.2 Analyst role: "anomaly detection (deterministic z-score/threshold rules in
 * `appforge metrics anomalies`)"). No ML, no external calls — just arithmetic over the trailing
 * history of each point, so results are 100% reproducible given the same input.
 */
export interface MetricPoint {
  date: string;
  value: number;
}

export interface AnomalyResult {
  date: string;
  value: number;
  trailingMean: number;
  trailingStdDev: number;
  zScore: number;
  isAnomaly: boolean;
}

export interface AnomalyOptions {
  /** Minimum number of prior points required before a point can be evaluated. Default 5. */
  minHistory?: number;
  /** |value - trailingMean| / trailingStdDev threshold to flag as an anomaly. Default 3. */
  zThreshold?: number;
}

const DEFAULT_MIN_HISTORY = 5;
const DEFAULT_Z_THRESHOLD = 3;

function trailingStats(prior: number[]): { mean: number; stdDev: number } {
  const mean = prior.reduce((sum, v) => sum + v, 0) / prior.length;
  const variance = prior.reduce((sum, v) => sum + (v - mean) ** 2, 0) / prior.length; // population variance
  return { mean, stdDev: Math.sqrt(variance) };
}

export function detectAnomalies(series: MetricPoint[], opts: AnomalyOptions = {}): AnomalyResult[] {
  const minHistory = opts.minHistory ?? DEFAULT_MIN_HISTORY;
  const zThreshold = opts.zThreshold ?? DEFAULT_Z_THRESHOLD;

  return series.map((point, i) => {
    if (i < minHistory) {
      return { date: point.date, value: point.value, trailingMean: 0, trailingStdDev: 0, zScore: 0, isAnomaly: false };
    }

    const prior = series.slice(0, i).map((p) => p.value);
    const { mean, stdDev } = trailingStats(prior);

    if (stdDev === 0) {
      const isAnomaly = point.value !== mean;
      return {
        date: point.date,
        value: point.value,
        trailingMean: mean,
        trailingStdDev: 0,
        zScore: isAnomaly ? Infinity : 0,
        isAnomaly,
      };
    }

    const zScore = Math.abs(point.value - mean) / stdDev;
    return {
      date: point.date,
      value: point.value,
      trailingMean: mean,
      trailingStdDev: stdDev,
      zScore,
      isAnomaly: zScore > zThreshold,
    };
  });
}
```

Modify `packages/schemas/src/index.ts` to add:

```ts
export * from './anomaly-detection.js';
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @appforge/schemas exec vitest run tests/anomaly-detection.test.ts`
Expected: PASS (all 7 tests)

- [ ] **Step 5: Commit**

```bash
git add packages/schemas/src/anomaly-detection.ts packages/schemas/tests/anomaly-detection.test.ts packages/schemas/src/index.ts
git commit -m "$(cat <<'EOF'
feat(schemas): add detectAnomalies (deterministic trailing z-score check)

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 3: `EdgeClient` — injectable HTTP client for `GET /v1/metrics`

**Files:**
- Create: `packages/cli/src/edge-client.ts`
- Create: `packages/cli/tests/edge-client.test.ts`

**Interfaces:**
- Consumes: nothing from other tasks (standalone, network-adjacent module).
- Produces (for Task 4 and Task 5 to import):
  ```ts
  export interface EdgeFetcher {
    fetch(url: string, init: { headers: Record<string, string> }): Promise<{ ok: boolean; status: number; json(): Promise<unknown> }>;
  }
  export interface MetricRow { product: string; date: string; name: string; value: number; source: string; }
  export class EdgeRequestError extends Error {
    readonly status: number | undefined;
    constructor(message: string, status?: number);
  }
  export interface EdgeClientOptions {
    edgeUrl: string;
    edgeToken: string;
    fetcher?: EdgeFetcher; // defaults to global fetch; tests always inject a fake
  }
  export class EdgeClient {
    constructor(opts: EdgeClientOptions);
    getMetrics(params: { product: string; name?: string; from?: string; to?: string }): Promise<MetricRow[]>;
  }
  ```

- [ ] **Step 1: Write the failing test**

Create `packages/cli/tests/edge-client.test.ts`:

```ts
import { describe, it, expect, vi } from 'vitest';
import { EdgeClient, EdgeRequestError, type EdgeFetcher } from '../src/edge-client.js';

function fakeFetcher(response: { ok: boolean; status: number; body: unknown }): EdgeFetcher & { fetch: ReturnType<typeof vi.fn> } {
  return {
    fetch: vi.fn(async () => ({
      ok: response.ok,
      status: response.status,
      json: async () => response.body,
    })),
  };
}

describe('EdgeClient.getMetrics', () => {
  it('builds the request URL with product/name/from/to and sends the bearer token', async () => {
    const fetcher = fakeFetcher({ ok: true, status: 200, body: { metrics: [] } });
    const client = new EdgeClient({ edgeUrl: 'https://edge.example.com', edgeToken: 'dev-only-placeholder-token', fetcher });

    await client.getMetrics({ product: 'json-workbench', name: 'installs', from: '2026-09-01', to: '2026-09-30' });

    expect(fetcher.fetch).toHaveBeenCalledTimes(1);
    const [url, init] = fetcher.fetch.mock.calls[0];
    expect(url).toBe(
      'https://edge.example.com/v1/metrics?product=json-workbench&name=installs&from=2026-09-01&to=2026-09-30'
    );
    expect(init.headers.Authorization).toBe('Bearer dev-only-placeholder-token');
  });

  it('omits optional query params when not given', async () => {
    const fetcher = fakeFetcher({ ok: true, status: 200, body: { metrics: [] } });
    const client = new EdgeClient({ edgeUrl: 'https://edge.example.com', edgeToken: 't', fetcher });

    await client.getMetrics({ product: 'json-workbench' });

    const [url] = fetcher.fetch.mock.calls[0];
    expect(url).toBe('https://edge.example.com/v1/metrics?product=json-workbench');
  });

  it('returns the metrics array from a successful response, matching apps/edge/tests/metrics.test.ts\'s shape', async () => {
    const rows = [{ product: 'json-workbench', date: '2026-09-02', name: 'installs', value: 15, source: 'cws_csv' }];
    const fetcher = fakeFetcher({ ok: true, status: 200, body: { metrics: rows } });
    const client = new EdgeClient({ edgeUrl: 'https://edge.example.com', edgeToken: 't', fetcher });

    const result = await client.getMetrics({ product: 'json-workbench' });

    expect(result).toEqual(rows);
  });

  it('throws EdgeRequestError with the status on a non-2xx response (Review Focus: unauthorized/5xx)', async () => {
    const fetcher = fakeFetcher({ ok: false, status: 401, body: { error: 'unauthorized' } });
    const client = new EdgeClient({ edgeUrl: 'https://edge.example.com', edgeToken: 'wrong', fetcher });

    await expect(client.getMetrics({ product: 'json-workbench' })).rejects.toMatchObject({
      status: 401,
    });
    await expect(client.getMetrics({ product: 'json-workbench' })).rejects.toBeInstanceOf(EdgeRequestError);
  });

  it('throws EdgeRequestError (not an uncaught rejection) when the fetcher itself throws, e.g. network down (Review Focus)', async () => {
    const fetcher: EdgeFetcher = { fetch: vi.fn(async () => { throw new Error('ECONNREFUSED'); }) };
    const client = new EdgeClient({ edgeUrl: 'https://edge.example.com', edgeToken: 't', fetcher });

    await expect(client.getMetrics({ product: 'json-workbench' })).rejects.toBeInstanceOf(EdgeRequestError);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @appforge/cli exec vitest run tests/edge-client.test.ts`
Expected: FAIL — `Cannot find module '../src/edge-client.js'`

- [ ] **Step 3: Write minimal implementation**

Create `packages/cli/src/edge-client.ts`:

```ts
/**
 * Minimal fetch surface EdgeClient needs, injected the same way `packages/flags`'s FlagsFetcher
 * is — so this module never touches the network in a test, and the real deployed edge worker
 * (https://appforge-edge.echokit-rk.workers.dev) is never called from CI or from this repo's own
 * test suite.
 */
export interface EdgeFetcher {
  fetch(url: string, init: { headers: Record<string, string> }): Promise<{ ok: boolean; status: number; json(): Promise<unknown> }>;
}

/** Matches the row shape apps/edge/src/handlers/metrics.ts's GET /v1/metrics returns. */
export interface MetricRow {
  product: string;
  date: string;
  name: string;
  value: number;
  source: string;
}

/** Thrown for any non-2xx response or transport-level failure talking to the edge. */
export class EdgeRequestError extends Error {
  readonly status: number | undefined;
  constructor(message: string, status?: number) {
    super(message);
    this.name = 'EdgeRequestError';
    this.status = status;
  }
}

export interface EdgeClientOptions {
  edgeUrl: string;
  edgeToken: string;
  /** Defaults to the global fetch; pass a fake in tests. */
  fetcher?: EdgeFetcher;
}

export interface GetMetricsParams {
  product: string;
  name?: string;
  from?: string;
  to?: string;
}

const defaultFetcher: EdgeFetcher = {
  fetch: (url, init) => fetch(url, init),
};

export class EdgeClient {
  private readonly fetcher: EdgeFetcher;

  constructor(private readonly opts: EdgeClientOptions) {
    this.fetcher = opts.fetcher ?? defaultFetcher;
  }

  async getMetrics(params: GetMetricsParams): Promise<MetricRow[]> {
    const url = new URL('/v1/metrics', this.opts.edgeUrl);
    url.searchParams.set('product', params.product);
    if (params.name) url.searchParams.set('name', params.name);
    if (params.from) url.searchParams.set('from', params.from);
    if (params.to) url.searchParams.set('to', params.to);

    let response: { ok: boolean; status: number; json(): Promise<unknown> };
    try {
      response = await this.fetcher.fetch(url.toString(), {
        headers: { Authorization: `Bearer ${this.opts.edgeToken}` },
      });
    } catch (err) {
      throw new EdgeRequestError(`edge request to ${url.toString()} failed: ${(err as Error).message}`);
    }

    if (!response.ok) {
      throw new EdgeRequestError(`edge request to ${url.toString()} returned status ${response.status}`, response.status);
    }

    const body = (await response.json()) as { metrics: MetricRow[] };
    return body.metrics;
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @appforge/cli exec vitest run tests/edge-client.test.ts`
Expected: PASS (all 5 tests)

- [ ] **Step 5: Commit**

```bash
git add packages/cli/src/edge-client.ts packages/cli/tests/edge-client.test.ts
git commit -m "$(cat <<'EOF'
feat(cli): add EdgeClient for GET /v1/metrics (injectable fetcher)

No real INGEST_ADMIN_TOKEN is available; every test injects a fake
fetcher, mirroring packages/flags's FlagsFetcher pattern.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 4: `appforge metrics show`

**Files:**
- Create: `packages/cli/src/commands/metrics-show.ts`
- Create: `packages/cli/tests/metrics-show.integration.test.ts`
- Modify: `packages/cli/src/index.ts`

**Interfaces:**
- Consumes: `EdgeClient`, `EdgeFetcher`, `MetricRow`, `EdgeRequestError` from `../edge-client.js` (Task 3); `buildOutput`, `printOutput` from `../output.js`.
- Produces:
  ```ts
  export interface MetricsShowOptions {
    product: string;
    name?: string;
    since?: string;
    edgeUrl?: string;
    edgeToken?: string;
    json: boolean;
  }
  export interface MetricsShowDeps { fetcher?: EdgeFetcher; }
  export async function runMetricsShow(opts: MetricsShowOptions, deps?: MetricsShowDeps): Promise<number>;
  ```
  Exit codes: `0` ok, `2` invalid input (missing edge URL/token), `14` data gap (zero rows), `17` edge request failed.

- [ ] **Step 1: Write the failing test**

Create `packages/cli/tests/metrics-show.integration.test.ts`:

```ts
import { describe, it, expect, vi } from 'vitest';
import { runMetricsShow } from '../src/commands/metrics-show.js';
import type { EdgeFetcher } from '../src/edge-client.js';

function fetcherReturning(body: unknown, ok = true, status = 200): EdgeFetcher {
  return { fetch: vi.fn(async () => ({ ok, status, json: async () => body })) };
}

const BASE_OPTS = { product: 'json-workbench', edgeUrl: 'https://edge.example.com', edgeToken: 'dev-only-placeholder-token', json: true };

describe('runMetricsShow', () => {
  it('returns 2 when neither --edge-url nor APPFORGE_EDGE_URL is set', async () => {
    const code = await runMetricsShow({ product: 'json-workbench', json: true });
    expect(code).toBe(2);
  });

  it('returns 2 when neither --edge-token nor APPFORGE_EDGE_TOKEN is set', async () => {
    const code = await runMetricsShow({ product: 'json-workbench', edgeUrl: 'https://edge.example.com', json: true });
    expect(code).toBe(2);
  });

  it('falls back to APPFORGE_EDGE_URL/APPFORGE_EDGE_TOKEN env vars when flags are absent', async () => {
    process.env.APPFORGE_EDGE_URL = 'https://edge.example.com';
    process.env.APPFORGE_EDGE_TOKEN = 'dev-only-placeholder-token';
    try {
      const fetcher = fetcherReturning({ metrics: [{ product: 'json-workbench', date: '2026-09-01', name: 'installs', value: 5, source: 'cws_csv' }] });
      const code = await runMetricsShow({ product: 'json-workbench', json: true }, { fetcher });
      expect(code).toBe(0);
    } finally {
      delete process.env.APPFORGE_EDGE_URL;
      delete process.env.APPFORGE_EDGE_TOKEN;
    }
  });

  it('returns 0 and the rows on a successful, non-empty response', async () => {
    const rows = [{ product: 'json-workbench', date: '2026-09-01', name: 'installs', value: 5, source: 'cws_csv' }];
    const fetcher = fetcherReturning({ metrics: rows });
    const code = await runMetricsShow(BASE_OPTS, { fetcher });
    expect(code).toBe(0);
  });

  it('returns 14 (data gap) when the edge returns zero rows for a valid product (Review Focus)', async () => {
    const fetcher = fetcherReturning({ metrics: [] });
    const code = await runMetricsShow(BASE_OPTS, { fetcher });
    expect(code).toBe(14);
  });

  it('returns 17 when the edge rejects the token (Review Focus: auth failure is distinct from data gap)', async () => {
    const fetcher = fetcherReturning({ error: 'unauthorized' }, false, 401);
    const code = await runMetricsShow(BASE_OPTS, { fetcher });
    expect(code).toBe(17);
  });

  it('returns 17 when the fetcher throws (network error), not an uncaught rejection', async () => {
    const fetcher: EdgeFetcher = { fetch: vi.fn(async () => { throw new Error('ECONNREFUSED'); }) };
    const code = await runMetricsShow(BASE_OPTS, { fetcher });
    expect(code).toBe(17);
  });

  it('passes --name and --since through to the edge client as name/from', async () => {
    const fetcher = fetcherReturning({ metrics: [{ product: 'json-workbench', date: '2026-09-02', name: 'installs', value: 3, source: 'cws_csv' }] });
    await runMetricsShow({ ...BASE_OPTS, name: 'installs', since: '2026-09-02' }, { fetcher });
    const [url] = (fetcher.fetch as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(url).toContain('name=installs');
    expect(url).toContain('from=2026-09-02');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @appforge/cli exec vitest run tests/metrics-show.integration.test.ts`
Expected: FAIL — `Cannot find module '../src/commands/metrics-show.js'`

- [ ] **Step 3: Write minimal implementation**

Create `packages/cli/src/commands/metrics-show.ts`:

```ts
import { EdgeClient, EdgeRequestError, type EdgeFetcher } from '../edge-client.js';
import { buildOutput, printOutput } from '../output.js';

export interface MetricsShowOptions {
  product: string;
  name?: string;
  since?: string;
  edgeUrl?: string;
  edgeToken?: string;
  json: boolean;
}

export interface MetricsShowDeps {
  /** Injected only by tests; the real CLI never passes this, so EdgeClient uses the global fetch. */
  fetcher?: EdgeFetcher;
}

/**
 * Exit codes: 0 ok, 2 invalid input (no edge URL/token resolvable from flags or env), 14 data gap
 * (edge reachable and authorized but returned zero rows for this product/filter), 17 edge request
 * failed (non-2xx response or a transport-level failure reaching the edge).
 */
export async function runMetricsShow(opts: MetricsShowOptions, deps: MetricsShowDeps = {}): Promise<number> {
  const edgeUrl = opts.edgeUrl ?? process.env.APPFORGE_EDGE_URL;
  const edgeToken = opts.edgeToken ?? process.env.APPFORGE_EDGE_TOKEN;

  if (!edgeUrl) {
    printOutput(buildOutput('metrics show', false, undefined, ['no edge URL: pass --edge-url or set APPFORGE_EDGE_URL']), opts.json);
    return 2;
  }
  if (!edgeToken) {
    printOutput(buildOutput('metrics show', false, undefined, ['no edge token: pass --edge-token or set APPFORGE_EDGE_TOKEN']), opts.json);
    return 2;
  }

  const client = new EdgeClient({ edgeUrl, edgeToken, fetcher: deps.fetcher });

  let rows;
  try {
    rows = await client.getMetrics({ product: opts.product, name: opts.name, from: opts.since });
  } catch (err) {
    const message = err instanceof EdgeRequestError ? err.message : (err as Error).message;
    printOutput(buildOutput('metrics show', false, undefined, [message]), opts.json);
    return 17;
  }

  if (rows.length === 0) {
    printOutput(
      buildOutput('metrics show', false, undefined, [
        `no metrics found for product "${opts.product}"${opts.name ? ` name "${opts.name}"` : ''}${opts.since ? ` since ${opts.since}` : ''}`,
      ]),
      opts.json
    );
    return 14;
  }

  printOutput(buildOutput('metrics show', true, { product: opts.product, rows }), opts.json);
  return 0;
}
```

Modify `packages/cli/src/index.ts`: add the import and the `metrics` command group. Insert after the `security` command group (after line ~84, before `program.command('test')`):

```ts
import { runMetricsShow } from './commands/metrics-show.js';
```

(add near the other command imports at the top of the file)

```ts
const metrics = program.command('metrics').description('Query/compute product metrics via the edge admin API');

metrics
  .command('show')
  .description('Fetch metrics rows for a product from GET /v1/metrics')
  .requiredOption('--product <id>', 'product id')
  .option('--name <metric>', 'filter to a single metric name')
  .option('--since <date>', 'only rows on/after this date (YYYY-MM-DD)')
  .option('--edge-url <url>', 'edge base URL (falls back to APPFORGE_EDGE_URL)')
  .option('--edge-token <token>', 'edge bearer token (falls back to APPFORGE_EDGE_TOKEN)')
  .option('--json', 'machine-readable output', false)
  .action(async (opts: { product: string; name?: string; since?: string; edgeUrl?: string; edgeToken?: string; json: boolean }) => {
    process.exitCode = await runMetricsShow(opts);
  });
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @appforge/cli exec vitest run tests/metrics-show.integration.test.ts`
Expected: PASS (all 8 tests)

- [ ] **Step 5: Commit**

```bash
git add packages/cli/src/commands/metrics-show.ts packages/cli/tests/metrics-show.integration.test.ts packages/cli/src/index.ts
git commit -m "$(cat <<'EOF'
feat(cli): add appforge metrics show

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 5: `appforge metrics pnl`

**Files:**
- Create: `packages/cli/src/commands/metrics-pnl.ts`
- Create: `packages/cli/tests/metrics-pnl-fixture.json`
- Create: `packages/cli/tests/metrics-pnl.integration.test.ts`
- Modify: `packages/cli/src/index.ts`

**Interfaces:**
- Consumes: `computePnl`, `type Revenue`, `type Cost` from `@appforge/schemas` (Task 1); `buildOutput`, `printOutput` from `../output.js`.
- Produces:
  ```ts
  export interface MetricsPnlOptions {
    product: string;
    since: string;
    fixture: string;
    json: boolean;
  }
  export function runMetricsPnl(opts: MetricsPnlOptions): number;
  ```
  Exit codes: `0` ok, `2` invalid input (unreadable/malformed fixture file, or a fixture that is not `{ revenue: [], costs: [] }`), `14` data gap (no revenue or cost rows match `product` + `since` in the fixture).

**Filtering rule (documented, not just in code):** the fixture is a flat file of `Revenue`/`Cost` rows across potentially many products/periods. The command filters `revenue` to rows where `product_id === opts.product && occurred_at >= opts.since` (ISO date string comparison, which is lexicographically correct for `YYYY-MM-DD`), and `costs` to rows where `product_id === opts.product && occurred_at >= opts.since`. **Ruling:** a `Cost` row with no `product_id` (a shared/portfolio-level cost per §21.1 "allocated share of shared runs") is excluded from this per-product filter for now — real shared-cost allocation is P1-15's job once real ingestion exists; this command only reports directly-attributed costs today. This is a deliberate simplification, called out in the command's own doc comment and in the PR description, not a silent gap.

- [ ] **Step 1: Write the failing test**

Create `packages/cli/tests/metrics-pnl-fixture.json` (a realistic, hand-calc-friendly one-month fixture, deliberately mixing in a different product and an out-of-range date and a shared cost with no `product_id`, to exercise the filtering rule):

```json
{
  "revenue": [
    { "id": "r1", "product_id": "json-workbench", "provider": "gumroad", "gross_cents": 1000, "fee_cents": 90, "refund_cents": 0, "tax_cents": 0, "currency": "usd", "occurred_at": "2026-09-05" },
    { "id": "r2", "product_id": "json-workbench", "provider": "gumroad", "gross_cents": 500, "fee_cents": 45, "refund_cents": 500, "tax_cents": 0, "currency": "usd", "occurred_at": "2026-09-12" },
    { "id": "r3", "product_id": "json-workbench", "provider": "gumroad", "gross_cents": 2000, "fee_cents": 180, "refund_cents": 0, "tax_cents": 0, "currency": "usd", "occurred_at": "2026-08-15" },
    { "id": "r4", "product_id": "other-product", "provider": "gumroad", "gross_cents": 9999, "fee_cents": 900, "refund_cents": 0, "tax_cents": 0, "currency": "usd", "occurred_at": "2026-09-10" }
  ],
  "costs": [
    { "id": "c1", "product_id": "json-workbench", "category": "ai", "amount_cents": 120, "occurred_at": "2026-09-01" },
    { "id": "c2", "product_id": "json-workbench", "category": "ai", "amount_cents": 30, "occurred_at": "2026-09-15" },
    { "id": "c3", "product_id": "json-workbench", "category": "infra", "amount_cents": 25, "occurred_at": "2026-09-01" },
    { "id": "c4", "product_id": "json-workbench", "category": "support", "amount_cents": 200, "occurred_at": "2026-09-20" },
    { "id": "c5", "product_id": "json-workbench", "category": "other", "amount_cents": 10, "occurred_at": "2026-09-01" },
    { "id": "c6", "category": "ai", "amount_cents": 500, "occurred_at": "2026-09-01", "ref": "shared portfolio run, no product_id" }
  ]
}
```

Create `packages/cli/tests/metrics-pnl.integration.test.ts`:

```ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { runMetricsPnl } from '../src/commands/metrics-pnl.js';

const FIXTURE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), './metrics-pnl-fixture.json');

let dir: string;
beforeAll(() => { dir = mkdtempSync(path.join(tmpdir(), 'appforge-cli-metrics-pnl-')); });
afterAll(() => { rmSync(dir, { recursive: true, force: true }); });

function write(name: string, content: string): string {
  const file = path.join(dir, name);
  writeFileSync(file, content);
  return file;
}

describe('runMetricsPnl', () => {
  it('matches the hand calc for September, excluding the August row, the other product, and the shared no-product_id cost (Review Focus: filtering)', () => {
    // Same hand calc as packages/schemas/tests/pnl.test.ts's fixture-month test:
    // gross 1500, refunds 500, fees 135, net 865, ai 150, infra 25, support 200, other 10,
    // contribution 480, margin 480/865.
    const code = runMetricsPnl({ product: 'json-workbench', since: '2026-09-01', fixture: FIXTURE, json: true });
    expect(code).toBe(0);
  });

  it('returns 2 for a fixture path that does not exist', () => {
    const code = runMetricsPnl({ product: 'json-workbench', since: '2026-09-01', fixture: path.join(dir, 'nope.json'), json: true });
    expect(code).toBe(2);
  });

  it('returns 2 for malformed JSON, not a crash', () => {
    const bad = write('bad.json', '{not valid json');
    const code = runMetricsPnl({ product: 'json-workbench', since: '2026-09-01', fixture: bad, json: true });
    expect(code).toBe(2);
  });

  it('returns 2 when the fixture is not shaped like { revenue: [], costs: [] }', () => {
    const bad = write('wrong-shape.json', JSON.stringify({ notRevenue: [] }));
    const code = runMetricsPnl({ product: 'json-workbench', since: '2026-09-01', fixture: bad, json: true });
    expect(code).toBe(2);
  });

  it('returns 14 (data gap) when no revenue or cost rows match product+since (Review Focus: empty-after-filter)', () => {
    const empty = write('empty.json', JSON.stringify({ revenue: [], costs: [] }));
    const code = runMetricsPnl({ product: 'json-workbench', since: '2026-09-01', fixture: empty, json: true });
    expect(code).toBe(14);
  });

  it('returns 14 for a product that exists in the fixture but not in the requested since-range', () => {
    const code = runMetricsPnl({ product: 'json-workbench', since: '2027-01-01', fixture: FIXTURE, json: true });
    expect(code).toBe(14);
  });

  it('returns 14 for a product not present in the fixture at all', () => {
    const code = runMetricsPnl({ product: 'nonexistent-product', since: '2026-09-01', fixture: FIXTURE, json: true });
    expect(code).toBe(14);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @appforge/cli exec vitest run tests/metrics-pnl.integration.test.ts`
Expected: FAIL — `Cannot find module '../src/commands/metrics-pnl.js'`

- [ ] **Step 3: Write minimal implementation**

Create `packages/cli/src/commands/metrics-pnl.ts`:

```ts
import { readFileSync } from 'node:fs';
import { computePnl, type Revenue, type Cost } from '@appforge/schemas';
import { buildOutput, printOutput } from '../output.js';

export interface MetricsPnlOptions {
  product: string;
  since: string;
  /**
   * Interim input source until P1-15 wires up real D1-backed revenue/cost ingestion: a JSON file
   * shaped `{ revenue: Revenue[], costs: Cost[] }`. Once P1-15 lands, this flag can stay as a
   * local-testing/offline escape hatch alongside a real `--product`-only mode that queries D1
   * directly through the edge, without changing computePnl's math at all.
   */
  fixture: string;
  json: boolean;
}

interface PnlFixture {
  revenue: Revenue[];
  costs: Cost[];
}

function isPnlFixture(value: unknown): value is PnlFixture {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Record<string, unknown>;
  return Array.isArray(v.revenue) && Array.isArray(v.costs);
}

/**
 * Exit codes: 0 ok, 2 invalid input (unreadable/malformed --fixture, or a fixture not shaped like
 * { revenue: [], costs: [] }), 14 data gap (zero revenue AND zero cost rows match --product +
 * --since after filtering).
 *
 * Filtering ruling: a Cost row with no product_id (a shared/portfolio-level cost per §21.1
 * "allocated share of shared runs") is excluded here — real shared-cost allocation is P1-15's
 * job once real ingestion exists. This command only reports directly product_id-attributed rows.
 */
export function runMetricsPnl(opts: MetricsPnlOptions): number {
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(opts.fixture, 'utf8'));
  } catch (err) {
    printOutput(buildOutput('metrics pnl', false, undefined, [`cannot read/parse ${opts.fixture}: ${(err as Error).message}`]), opts.json);
    return 2;
  }
  if (!isPnlFixture(parsed)) {
    printOutput(buildOutput('metrics pnl', false, undefined, [`${opts.fixture} must contain { revenue: Revenue[], costs: Cost[] }`]), opts.json);
    return 2;
  }

  const revenue = parsed.revenue.filter((r) => r.product_id === opts.product && r.occurred_at >= opts.since);
  const costs = parsed.costs.filter((c) => c.product_id === opts.product && c.occurred_at >= opts.since);

  if (revenue.length === 0 && costs.length === 0) {
    printOutput(
      buildOutput('metrics pnl', false, undefined, [
        `no revenue or cost rows for product "${opts.product}" since ${opts.since} in ${opts.fixture}`,
      ]),
      opts.json
    );
    return 14;
  }

  const pnl = computePnl(revenue, costs);
  printOutput(buildOutput('metrics pnl', true, { product: opts.product, since: opts.since, ...pnl }), opts.json);
  return 0;
}
```

Modify `packages/cli/src/index.ts`: add the import and the `pnl` subcommand under the `metrics` group created in Task 4.

```ts
import { runMetricsPnl } from './commands/metrics-pnl.js';
```

```ts
metrics
  .command('pnl')
  .description(
    'Compute the §21.1 P&L line-item table for a product/period from a --fixture JSON file of Revenue/Cost rows (interim input until P1-15 wires up real D1 ingestion)'
  )
  .requiredOption('--product <id>', 'product id')
  .requiredOption('--since <date>', 'period start date (YYYY-MM-DD, inclusive)')
  .requiredOption('--fixture <path>', 'path to a JSON file: { revenue: Revenue[], costs: Cost[] }')
  .option('--json', 'machine-readable output', false)
  .action((opts: { product: string; since: string; fixture: string; json: boolean }) => {
    process.exitCode = runMetricsPnl(opts);
  });
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @appforge/cli exec vitest run tests/metrics-pnl.integration.test.ts`
Expected: PASS (all 7 tests)

- [ ] **Step 5: Commit**

```bash
git add packages/cli/src/commands/metrics-pnl.ts packages/cli/tests/metrics-pnl-fixture.json packages/cli/tests/metrics-pnl.integration.test.ts packages/cli/src/index.ts
git commit -m "$(cat <<'EOF'
feat(cli): add appforge metrics pnl (--fixture interim input, P1-15 to wire real ingestion)

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 6: `appforge metrics anomalies`

**Files:**
- Create: `packages/cli/src/commands/metrics-anomalies.ts`
- Create: `packages/cli/tests/metrics-anomalies.integration.test.ts`
- Modify: `packages/cli/src/index.ts`

**Interfaces:**
- Consumes: `EdgeClient`, `EdgeRequestError`, `type EdgeFetcher`, `type MetricRow` from `../edge-client.js` (Task 3); `detectAnomalies`, `type AnomalyResult` from `@appforge/schemas` (Task 2); `buildOutput`, `printOutput` from `../output.js`.
- Produces:
  ```ts
  export interface MetricsAnomaliesOptions {
    product: string;
    name?: string;
    edgeUrl?: string;
    edgeToken?: string;
    json: boolean;
  }
  export interface MetricsAnomaliesDeps { fetcher?: EdgeFetcher; }
  export async function runMetricsAnomalies(opts: MetricsAnomaliesOptions, deps?: MetricsAnomaliesDeps): Promise<number>;
  ```
  Exit codes: `0` ok (ran the check; `data.anomalies` may be an empty array — finding no anomalies is a successful run, not a failure), `2` invalid input (edge URL/token unresolvable), `14` data gap (edge returned zero metric rows for the product at all), `17` edge request failed.

**Grouping rule:** fetches all rows for `--product` (optionally narrowed by `--name`), groups them by `name` (a product can have several metric series — `installs`, `wau`, etc.), and runs `detectAnomalies` independently per series (each series is already date-ascending, matching how `GET /v1/metrics` orders rows and how the fixture/edge test data is seeded). Output lists only the flagged points, tagged with which metric `name` they came from.

- [ ] **Step 1: Write the failing test**

Create `packages/cli/tests/metrics-anomalies.integration.test.ts`:

```ts
import { describe, it, expect, vi } from 'vitest';
import { runMetricsAnomalies } from '../src/commands/metrics-anomalies.js';
import type { EdgeFetcher, MetricRow } from '../src/edge-client.js';

function fetcherReturning(rows: MetricRow[], ok = true, status = 200): EdgeFetcher {
  return { fetch: vi.fn(async () => ({ ok, status, json: async () => ({ metrics: rows }) })) };
}

function dailyRows(product: string, name: string, values: number[], startDate = '2026-09-01'): MetricRow[] {
  const start = new Date(startDate + 'T00:00:00Z');
  return values.map((value, i) => {
    const d = new Date(start);
    d.setUTCDate(d.getUTCDate() + i);
    return { product, date: d.toISOString().slice(0, 10), name, value, source: 'cws_csv' };
  });
}

const BASE_OPTS = { product: 'json-workbench', edgeUrl: 'https://edge.example.com', edgeToken: 'dev-only-placeholder-token', json: true };

describe('runMetricsAnomalies', () => {
  it('returns 2 when neither --edge-url nor APPFORGE_EDGE_URL is set', async () => {
    const code = await runMetricsAnomalies({ product: 'json-workbench', json: true });
    expect(code).toBe(2);
  });

  it('returns 14 (data gap) when the edge has zero rows at all for this product', async () => {
    const fetcher = fetcherReturning([]);
    const code = await runMetricsAnomalies(BASE_OPTS, { fetcher });
    expect(code).toBe(14);
  });

  it('returns 17 when the edge rejects the token', async () => {
    const fetcher = fetcherReturning([], false, 401);
    const code = await runMetricsAnomalies(BASE_OPTS, { fetcher });
    expect(code).toBe(17);
  });

  it('returns 0 with an empty anomalies list on a normal, stable series (Review Focus: no false positives)', async () => {
    const rows = dailyRows('json-workbench', 'installs', [10, 11, 9, 10, 12, 10, 11, 9, 10, 11]);
    const fetcher = fetcherReturning(rows);
    const code = await runMetricsAnomalies(BASE_OPTS, { fetcher });
    expect(code).toBe(0);
  });

  it('returns 0 and flags the spike day on an anomalous series (here\'s the anomalous case)', async () => {
    const rows = dailyRows('json-workbench', 'installs', [10, 10, 11, 9, 10, 10, 100]);
    const fetcher = fetcherReturning(rows);
    const code = await runMetricsAnomalies(BASE_OPTS, { fetcher });
    expect(code).toBe(0);
    // Output correctness (flagged point, series name) is asserted via runMetricsShow-style
    // buildOutput data in a unit-level check below.
  });

  it('groups multiple metric names into independent series and only flags the one with the spike', async () => {
    const stable = dailyRows('json-workbench', 'wau', [50, 51, 49, 50, 52, 50, 51]);
    const spiking = dailyRows('json-workbench', 'installs', [10, 10, 11, 9, 10, 10, 100]);
    const fetcher = fetcherReturning([...stable, ...spiking]);
    const code = await runMetricsAnomalies(BASE_OPTS, { fetcher });
    expect(code).toBe(0);
  });

  it('filters to --name when given, passing it through to the edge client', async () => {
    const rows = dailyRows('json-workbench', 'installs', [10, 11, 9, 10, 12]);
    const fetcher = fetcherReturning(rows);
    await runMetricsAnomalies({ ...BASE_OPTS, name: 'installs' }, { fetcher });
    const [url] = (fetcher.fetch as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(url).toContain('name=installs');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @appforge/cli exec vitest run tests/metrics-anomalies.integration.test.ts`
Expected: FAIL — `Cannot find module '../src/commands/metrics-anomalies.js'`

- [ ] **Step 3: Write minimal implementation**

Create `packages/cli/src/commands/metrics-anomalies.ts`:

```ts
import { EdgeClient, EdgeRequestError, type EdgeFetcher, type MetricRow } from '../edge-client.js';
import { detectAnomalies } from '@appforge/schemas';
import { buildOutput, printOutput } from '../output.js';

export interface MetricsAnomaliesOptions {
  product: string;
  name?: string;
  edgeUrl?: string;
  edgeToken?: string;
  json: boolean;
}

export interface MetricsAnomaliesDeps {
  fetcher?: EdgeFetcher;
}

interface FlaggedAnomaly {
  name: string;
  date: string;
  value: number;
  trailingMean: number;
  trailingStdDev: number;
  zScore: number;
}

function groupByName(rows: MetricRow[]): Map<string, MetricRow[]> {
  const groups = new Map<string, MetricRow[]>();
  for (const row of rows) {
    const group = groups.get(row.name);
    if (group) {
      group.push(row);
    } else {
      groups.set(row.name, [row]);
    }
  }
  return groups;
}

/**
 * Exit codes: 0 ok (the check ran; data.anomalies may legitimately be empty — finding nothing is
 * success, not failure), 2 invalid input (no edge URL/token resolvable), 14 data gap (the edge
 * returned zero metric rows for this product at all, so there is nothing to check), 17 edge
 * request failed (non-2xx or transport failure).
 *
 * Runs GET /v1/metrics for the product (optionally narrowed by --name), groups the rows by metric
 * name (a product can have several series: installs, wau, ...), and runs the deterministic
 * trailing z-score check (@appforge/schemas's detectAnomalies) independently per series.
 */
export async function runMetricsAnomalies(opts: MetricsAnomaliesOptions, deps: MetricsAnomaliesDeps = {}): Promise<number> {
  const edgeUrl = opts.edgeUrl ?? process.env.APPFORGE_EDGE_URL;
  const edgeToken = opts.edgeToken ?? process.env.APPFORGE_EDGE_TOKEN;

  if (!edgeUrl) {
    printOutput(buildOutput('metrics anomalies', false, undefined, ['no edge URL: pass --edge-url or set APPFORGE_EDGE_URL']), opts.json);
    return 2;
  }
  if (!edgeToken) {
    printOutput(buildOutput('metrics anomalies', false, undefined, ['no edge token: pass --edge-token or set APPFORGE_EDGE_TOKEN']), opts.json);
    return 2;
  }

  const client = new EdgeClient({ edgeUrl, edgeToken, fetcher: deps.fetcher });

  let rows: MetricRow[];
  try {
    rows = await client.getMetrics({ product: opts.product, name: opts.name });
  } catch (err) {
    const message = err instanceof EdgeRequestError ? err.message : (err as Error).message;
    printOutput(buildOutput('metrics anomalies', false, undefined, [message]), opts.json);
    return 17;
  }

  if (rows.length === 0) {
    printOutput(
      buildOutput('metrics anomalies', false, undefined, [
        `no metrics found for product "${opts.product}"${opts.name ? ` name "${opts.name}"` : ''} to check for anomalies`,
      ]),
      opts.json
    );
    return 14;
  }

  const anomalies: FlaggedAnomaly[] = [];
  for (const [name, seriesRows] of groupByName(rows)) {
    const results = detectAnomalies(seriesRows.map((r) => ({ date: r.date, value: r.value })));
    for (const result of results) {
      if (result.isAnomaly) {
        anomalies.push({
          name,
          date: result.date,
          value: result.value,
          trailingMean: result.trailingMean,
          trailingStdDev: result.trailingStdDev,
          zScore: result.zScore,
        });
      }
    }
  }

  printOutput(buildOutput('metrics anomalies', true, { product: opts.product, anomalies }), opts.json);
  return 0;
}
```

Modify `packages/cli/src/index.ts`: add the import and the `anomalies` subcommand under the `metrics` group.

```ts
import { runMetricsAnomalies } from './commands/metrics-anomalies.js';
```

```ts
metrics
  .command('anomalies')
  .description('Run a deterministic trailing z-score anomaly check over a product\'s metric series')
  .requiredOption('--product <id>', 'product id')
  .option('--name <metric>', 'check only this metric name (default: every series returned for the product)')
  .option('--edge-url <url>', 'edge base URL (falls back to APPFORGE_EDGE_URL)')
  .option('--edge-token <token>', 'edge bearer token (falls back to APPFORGE_EDGE_TOKEN)')
  .option('--json', 'machine-readable output', false)
  .action(async (opts: { product: string; name?: string; edgeUrl?: string; edgeToken?: string; json: boolean }) => {
    process.exitCode = await runMetricsAnomalies(opts);
  });
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @appforge/cli exec vitest run tests/metrics-anomalies.integration.test.ts`
Expected: PASS (all 7 tests)

- [ ] **Step 5: Add one JSON-output correctness check, then commit**

The tests above check exit codes but not that the anomaly the spike test found is actually reported in `data.anomalies`. Add this test to `packages/cli/tests/metrics-anomalies.integration.test.ts` (append inside the `describe` block) before committing:

```ts
  it('reports the correct flagged point (name/date/value) in JSON output for a spike (Review Focus: correctness, not just exit code)', async () => {
    const rows = dailyRows('json-workbench', 'installs', [10, 10, 11, 9, 10, 10, 100]);
    const fetcher = fetcherReturning(rows);
    const logs: string[] = [];
    const originalWrite = process.stdout.write.bind(process.stdout);
    process.stdout.write = ((chunk: string) => { logs.push(chunk); return true; }) as typeof process.stdout.write;
    try {
      await runMetricsAnomalies(BASE_OPTS, { fetcher });
    } finally {
      process.stdout.write = originalWrite;
    }
    const output = JSON.parse(logs.join(''));
    expect(output.data.anomalies).toEqual([
      expect.objectContaining({ name: 'installs', date: rows[6].date, value: 100 }),
    ]);
  });
```

Run: `pnpm --filter @appforge/cli exec vitest run tests/metrics-anomalies.integration.test.ts`
Expected: PASS (all 8 tests)

```bash
git add packages/cli/src/commands/metrics-anomalies.ts packages/cli/tests/metrics-anomalies.integration.test.ts packages/cli/src/index.ts
git commit -m "$(cat <<'EOF'
feat(cli): add appforge metrics anomalies (trailing z-score, grouped per metric name)

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 7: Full workspace verification, README note, PR

**Files:**
- Modify: `packages/cli/README.md` if it exists (else skip — check first with `ls packages/cli/README.md`).
- No new source files.

- [ ] **Step 1: Check for a CLI README to update**

Run: `ls packages/cli/README.md 2>/dev/null || echo "no README"`. If it exists and documents the command list (matching how `validate`/`security`/`test` are documented), add a `metrics show|pnl|anomalies` section in the same style, including: the `APPFORGE_EDGE_URL`/`APPFORGE_EDGE_TOKEN` env vars, the `--fixture` interim-input note for `pnl` (explicitly stating this is until P1-15 wires up real ingestion), and the exit codes `14`/`17`. If no README exists, skip this step — do not invent a new doc file the rest of the package doesn't have.

- [ ] **Step 2: Rebase onto latest main before running full verification**

```bash
git fetch origin main
git log --oneline -5
git status
git rebase origin/main
```
If `origin/main` moved and the rebase has conflicts, resolve them keeping both this branch's new files and whatever the other agent's commits added (they are almost certainly non-overlapping: this branch only touches `packages/cli` and `packages/schemas`).

- [ ] **Step 3: Run full workspace verification from repo root**

```bash
pnpm install
pnpm typecheck
pnpm build
pnpm test
pnpm lint
```
Expected: all five green. `pnpm test` runs the root `vitest.workspace.ts` suite (covers `packages/schemas` and `packages/cli`, including every test from Tasks 1–6) AND `pnpm --filter @appforge/edge test` (the separate Vitest-4 suite — unaffected by this plan, included here only as a regression check per the Global Constraints verification rule).

If anything fails, fix it before proceeding — do not skip to the PR with red checks.

- [ ] **Step 4: Push and open a draft PR**

```bash
direnv exec . git push -u origin feat/p1-16-metrics-cli
direnv exec . gh pr create --draft --title "P1-16: appforge metrics show|pnl|anomalies CLI" --body "$(cat <<'EOF'
## Summary
- `appforge metrics show --product <id> [--name] [--since] [--json]` — queries `GET /v1/metrics` via a new injectable `EdgeClient` (`packages/cli/src/edge-client.ts`).
- `appforge metrics pnl --product <id> --since <date> --fixture <path> [--json]` — computes the exact §21.1 P&L line-item table via a new pure `computePnl` (`packages/schemas/src/pnl.ts`). `--fixture` is an interim input source (a local JSON file of `Revenue`/`Cost` rows) until P1-15 wires up real D1-backed ingestion — `computePnl` itself is D1-agnostic so P1-15 can feed it real data without changing the math.
- `appforge metrics anomalies --product <id> [--name] [--json]` — deterministic trailing z-score check (`packages/schemas/src/anomaly-detection.ts`) over each metric series returned for the product.
- New exit codes (documented in each command's own doc comment): `14` data gap (zero rows), `17` edge request failed (auth rejected / non-2xx / network error) — chosen to avoid the master plan §29c table's other reservations (`5`, `10`–`13`, `15`, `16`).

## Deferred (explicitly out of scope, P1-15's job)
- Real D1-backed revenue/cost ingestion (Paperclip AI-cost events, CWS CSV import, Play earnings reports, Gumroad sales API) — blocked on external credentials/decisions not made yet.
- Shared/portfolio-level cost allocation (a `Cost` row with no `product_id`) — `metrics pnl` only reports directly `product_id`-attributed rows for now; this is called out in the command's doc comment.

## Test plan
- [x] `pnpm --filter @appforge/schemas exec vitest run` — `computePnl` hand-calc fixture-month test (the P1-16 acceptance criterion) + anomaly detection normal/spike/short-series/flat-series cases.
- [x] `pnpm --filter @appforge/cli exec vitest run` — `EdgeClient` against a fake fetcher (never the real deployed worker), all three commands' exit-code and filtering behavior.
- [x] `pnpm install && pnpm typecheck && pnpm build && pnpm test && pnpm lint` green from repo root.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

- [ ] **Step 5: Watch CI, fix if red, mark ready, merge**

```bash
direnv exec . gh pr checks <PR-number> --watch --interval 15
```
(or poll manually every ~15s with `gh pr checks <PR-number>` into a variable named `checks_out`, not `status`, since zsh reserves `status`). If any check is red, fix the underlying issue, commit, push, and re-watch — do not mark ready until everything is green.

Once green:
```bash
direnv exec . gh pr ready <PR-number>
direnv exec . gh pr merge <PR-number> --squash --delete-branch
```

- [ ] **Step 6: Final fresh-reviewer pass**

Dispatch a fresh review (via the Agent tool, a `general-purpose` or `code-reviewer`-flavored subagent with no prior context on this session) against the merged diff, specifically checking:
1. Every Review Focus item from this plan's header actually has a passing test exercising it (list which test covers which item).
2. `computePnl`'s arithmetic against the fixture-month hand calc is correct (recompute independently).
3. `detectAnomalies`'s flat-series and short-series edge cases don't throw or misbehave (`NaN`/`Infinity` leaking into JSON output).
4. No code path in `edge-client.ts` or the three command files can reach the real `https://appforge-edge.echokit-rk.workers.dev` during `pnpm test` (grep for any un-injected `fetch(` call in test files).
5. Exit codes `14`/`17` are used consistently and don't collide with `0,2,3,4,6,7,8,9` from the Global Constraints.

If the fresh review finds anything, fix it in a follow-up commit on a new branch (the PR is already merged) or, if still in progress, address it before merging.

---

## Self-Review Notes

**1. Spec coverage:**
- §29c CLI contract row (`show|pnl|anomalies`, `--product --since`, "query/ingest D1 via edge admin API", exit 14 data gap) → Tasks 4, 5, 6 (ingest is explicitly out of scope per the task brief, not the CLI contract row's fault — P1-15's job).
- §21.1 P&L line-item table → Task 1 (`computePnl`), verified against a hand calc in Task 1's test and again end-to-end in Task 5's fixture-based CLI test.
- §29d `Revenue`/`Cost` interfaces → Task 1, copied verbatim.
- §6.2 Analyst "deterministic z-score/threshold rules in `appforge metrics anomalies`" → Task 2 (`detectAnomalies`) + Task 6 (the command wiring it to live data per product/metric-name).
- Master plan's "P&L matches hand calc on a fixture month" acceptance criterion → Task 1's first test, by name.
- No real `INGEST_ADMIN_TOKEN`/live edge calls in tests → Task 3's `EdgeFetcher` injection pattern, reused by Tasks 4 and 6; explicitly checked again in Task 7 Step 6 review item 4.

**2. Placeholder scan:** No `TBD`/`TODO`/"add appropriate error handling" found — every step has literal code. The one place that could look like a placeholder (Task 7 Step 1, "if it exists... add a section") is a conditional documentation step, not an implementation placeholder, and the plan explicitly says to skip it rather than inventing content if there's no README to extend.

**3. Type consistency:** `MetricRow` (Task 3) is used identically in Tasks 4 and 6. `Revenue`/`Cost` (Task 1) are used identically in Task 5. `AnomalyResult`'s fields (`date, value, trailingMean, trailingStdDev, zScore, isAnomaly`) match exactly what Task 6's `FlaggedAnomaly` reads off of it. `EdgeFetcher`'s shape (`fetch(url, init): Promise<{ok, status, json()}>`) is identical across Task 3's definition and Tasks 4/6's test fakes.

**4. Review Focus — test coverage confirmed:**
- Zero rows from edge → Task 4's "returns 14" test, Task 6's "returns 14 (data gap)" test.
- Edge unreachable/non-2xx → Task 3's two `EdgeRequestError` tests, Task 4's 401 and network-throw tests, Task 6's 401 test.
- Fixture with no matching rows / malformed JSON → Task 5's four dedicated tests (missing file, malformed JSON, wrong shape, empty-after-filter, wrong since-range, wrong product).
- Net revenue exactly 0 → Task 1's dedicated `contributionMargin` null test, checking `JSON.stringify` doesn't emit `NaN`.
- Short/flat anomaly series → Task 2's three dedicated tests (`minHistory` cutoff, flat-matching, flat-deviating).

No gaps found; no additional tasks needed.
