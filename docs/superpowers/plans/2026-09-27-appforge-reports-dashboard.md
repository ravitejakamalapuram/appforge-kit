# AppForge Reports + Dashboard (P1-17) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
>
> **Execution method for this plan: Native/inline (superpowers:executing-plans).** Pre-decided for this dispatch (small, sequential, low-risk subsystem; no subagent tool available in this context).

**Goal:** Add `appforge report daily|weekly|dashboard` — deterministic founder reports (§29b) built from the same edge metrics/P&L/anomaly data sources `appforge metrics show|pnl|anomalies` (P1-16) already expose, with every section the underlying data doesn't yet support (incidents, opportunities, approvals, product-state, experiments) rendered as an explicit "no data" empty state rather than fabricated numbers.

**Architecture:** A new `packages/cli/src/report-data.ts` gathers per-product data (`EdgeClient.getMetrics` for the metric series + `detectAnomalies` for winners/risks + `computePnl` over an optional `--pnl-fixture` for revenue/contribution/AI-cost) into a `ReportData` structure, reusing P1-16's `EdgeClient`, `computePnl`, and `detectAnomalies` rather than re-implementing them. `packages/cli/src/report-sections.ts` turns `ReportData` into plain-object "sections" (`DailyReportSections`, `WeeklyReportSections`) plus human-readable text renderers matching the §29b templates, and a deterministic scale/pause recommendation derived from real P&L contribution numbers (a simplified stand-in for the full §22 kill/scale policy, which needs portfolio-state and retention data this repo doesn't have yet). `packages/cli/src/html-template.ts` provides `escapeHtml` and `renderDashboardHtml`, a dependency-free template-string HTML page. Three new command modules wire this behind the existing `cli-output@1` contract for `--json`, and print the human-readable rendered text directly to stdout otherwise (the whole point of these commands is a report a founder reads, not just a pass/fail line).

**Tech Stack:** TypeScript, Commander 12, Vitest 2.x (`packages/cli`, covered by the root `vitest.workspace.ts`), Node 22 (no new dependencies — dashboard HTML is a template string, not a framework).

**Spec:** `~/git-personal/.claude/appforge-ai-master-plan.md` §29b (Founder Dashboard & Reports — daily/weekly templates, dashboard panels), §29c (`appforge report daily|weekly|dashboard` CLI contract row), §22 (portfolio kill/scale policy — only partially implementable today, see Global Constraints), §21.1 (P&L, already implemented as `computePnl`). Prior art: `packages/cli/src/commands/metrics-show.ts`, `metrics-pnl.ts`, `metrics-anomalies.ts` (P1-16, merged as PR #11, commit `607a0217`) and `packages/cli/src/edge-client.ts`.

## Global Constraints

- Do NOT rebuild `EdgeClient`, `computePnl`, or `detectAnomalies` — import and reuse them exactly as P1-16 left them (`packages/cli/src/edge-client.ts`, `@appforge/schemas`).
- Follow the `cli-output@1` contract exactly for `--json` mode on all three commands (`buildOutput`/`printOutput` from `packages/cli/src/output.ts`). `report daily`/`report weekly` print the full human-readable report text to stdout in non-`--json` mode (not just a pass/fail line — a founder reads this). `report dashboard` writes HTML to `--out` and only ever prints the normal `printOutput` pass/fail-style confirmation (its real output is the file).
- Exit codes already taken in this CLI: `0` ok, `2` invalid input, `3` schema validation failed, `4` tests failed, `6` security findings, `7` CSP/remote-script findings, `8` transition not allowed, `14` data gap, `17` edge request failed. These new commands use only `0`, `2`, and `17` — **never `14`**: a report with every section honestly empty is a successfully generated report (`ok: true`), not a data-gap failure. This is a deliberate ruling, not an oversight — document it in each command's own doc comment.
- Data sources that do not exist anywhere in this repo yet — incidents, opportunity backlog, Paperclip approvals, portfolio/product state, experiments, AI cost by tier/agent — must render as an explicit "no data (X not wired up yet)" string in both the human text and (as a `null`/empty-array field, never a fabricated number) in the JSON `data` payload. Never invent a plausible-looking number for these.
- "PRODUCTS TO SCALE / TO PAUSE" is a deliberately simplified proxy for §22's full kill/scale policy (which needs WAU history, D30 retention, and portfolio state — none of which exist here yet): pause if `pnl.contributionCents < 0`, scale if `pnl.contributionMargin !== null && pnl.contributionMargin > 0.5`, otherwise no recommendation for that product. State this simplification in the code and in the PR description.
- `--product` is a repeatable option (commander's `collect` accumulator pattern with a `[]` default), validated at the command layer (`opts.product.length === 0` → exit 2) rather than via `requiredOption` (a `requiredOption` with a default array is never "missing" from commander's point of view, so the runtime check is the actual enforcement — same pattern `appforge test`'s `--e2e` check already uses).
- `gatherReportData` must de-duplicate the requested product list (`[...new Set(products)]`) before fetching/aggregating, so accidentally passing the same `--product` twice never double-counts revenue/contribution in portfolio totals.
- `report daily`/`report weekly` fetch each product's full metric history from the edge (no `from` filter) so `detectAnomalies`'s trailing window has real history to work with; `--since` only scopes the `--pnl-fixture` row filtering (revenue/contribution/AI-cost window), exactly like `metrics pnl`'s existing `--since` semantics.
- Config resolution for edge calls matches `metrics show`/`metrics anomalies` exactly: `--edge-url`/`--edge-token` flags fall back to `APPFORGE_EDGE_URL`/`APPFORGE_EDGE_TOKEN`; missing either → exit `2`.
- `report dashboard`'s HTML must escape every interpolated string (product ids, metric names, error text) via `escapeHtml` — the page opens in a real browser, and product ids are operator-supplied strings, not a trusted enum.
- Money fields are integer cents throughout (matching `computePnl`); `formatCents(cents: number | null): string` renders `"no data"` for `null` and `"$X.XX"` otherwise — never render a bare `0` or `$0.00` for a genuinely-missing data source (that reads as "revenue actually is zero", not "we don't know").
- Verification before declaring done: `pnpm install && pnpm typecheck && pnpm build && pnpm test && pnpm lint` from repo root, all green.

## Review Focus

- **A requested product has zero metric rows at all** (brand-new product, nothing ingested yet) — must not crash or drop the whole report; that product's `latestByMetric`/`anomalies` are simply empty, and the report still renders for the other products plus an honest per-product "no data" note.
- **The edge rejects the token or is unreachable** while gathering data for any requested product — must surface as exit `17` with a clear message, not a silently-empty "successful" report.
- **`--pnl-fixture` is omitted entirely** — COMPANY HEALTH's revenue/contribution/AI-cost fields and the scale/pause recommendations must render as `null`/"no data", never a fabricated `$0.00` that reads as "we checked and it's zero".
- **`report dashboard`'s generated HTML must escape interpolated values** — a product id or metric name containing `<`, `>`, `&`, or quotes must not break the page's HTML structure or inject a tag.
- **The same `--product` is passed twice** — must not double-count that product's revenue/contribution in the aggregated portfolio totals (`portfolioPnl`) or list it twice in the per-product sections.

---

## File Structure

New files:

- `packages/cli/src/report-data.ts` — `ReportAnomaly`, `ProductReportData`, `ReportData`, `PnlFixtureRows` types + `gatherReportData(opts, deps?): Promise<ReportData>`.
- `packages/cli/tests/report-data.test.ts`
- `packages/cli/src/report-sections.ts` — `formatCents`, `ScalePauseRecommendation`, `buildScalePauseRecommendations`, `DailyReportSections`, `buildDailyReportSections`, `renderDailyReportText`, `WeeklyReportSections`, `buildWeeklyReportSections`, `renderWeeklyReportText`, `TrendPoint`, `computeContributionTrend`.
- `packages/cli/tests/report-sections.test.ts`
- `packages/cli/src/html-template.ts` — `escapeHtml`, `renderDashboardHtml`.
- `packages/cli/tests/html-template.test.ts`
- `packages/cli/src/commands/report-daily.ts` — `runReportDaily(opts, deps?)`.
- `packages/cli/tests/report-daily.integration.test.ts`
- `packages/cli/src/commands/report-weekly.ts` — `runReportWeekly(opts, deps?)`.
- `packages/cli/tests/report-weekly.integration.test.ts`
- `packages/cli/src/commands/report-dashboard.ts` — `runReportDashboard(opts, deps?)`.
- `packages/cli/tests/report-dashboard.integration.test.ts`
- `packages/cli/tests/report-pnl-fixture.json` — shared fixture reused across the three integration test files.

Modified files:

- `packages/cli/src/index.ts` — add the `report` command group (`daily`, `weekly`, `dashboard` subcommands) plus a shared `collect` accumulator helper for repeatable `--product`.

---

### Task 1: `gatherReportData` — shared per-product data gathering

**Files:**
- Create: `packages/cli/src/report-data.ts`
- Create: `packages/cli/tests/report-data.test.ts`

**Interfaces:**
- Consumes: `EdgeClient`, `EdgeRequestError`, `type EdgeFetcher`, `type MetricRow` from `./edge-client.js`; `computePnl`, `detectAnomalies`, `type Revenue`, `type Cost`, `type PnlResult` from `@appforge/schemas`.
- Produces (for Tasks 2, 3, 5, 7):
  ```ts
  export interface ReportAnomaly {
    product: string;
    name: string;
    date: string;
    value: number;
    trailingMean: number;
    trailingStdDev: number;
    zScore: number;
    direction: 'up' | 'down';
  }
  export interface ProductReportData {
    product: string;
    latestByMetric: Record<string, { date: string; value: number }>;
    anomalies: ReportAnomaly[];
    pnl: PnlResult | null; // null = no --pnl-fixture rows matched this product
  }
  export interface ReportData {
    products: ProductReportData[];
    portfolioPnl: PnlResult | null; // computePnl across every matched row for every requested product
  }
  export interface PnlFixtureRows { revenue: Revenue[]; costs: Cost[]; }
  export interface GatherReportDataOptions {
    products: string[];
    since?: string;
    edgeUrl: string;
    edgeToken: string;
    pnlRows?: PnlFixtureRows;
  }
  export interface GatherReportDataDeps { fetcher?: EdgeFetcher; }
  export async function gatherReportData(opts: GatherReportDataOptions, deps?: GatherReportDataDeps): Promise<ReportData>;
  ```
  Throws `EdgeRequestError` (propagated from `EdgeClient.getMetrics`) on any transport/auth failure — callers catch it, same pattern as `metrics-show.ts`/`metrics-anomalies.ts`.

- [ ] **Step 1: Write the failing test**

Create `packages/cli/tests/report-data.test.ts`:

```ts
import { describe, it, expect, vi } from 'vitest';
import { gatherReportData } from '../src/report-data.js';
import type { EdgeFetcher, MetricRow } from '../src/edge-client.js';

function dailyRows(product: string, name: string, values: number[], startDate = '2026-09-01'): MetricRow[] {
  const start = new Date(startDate + 'T00:00:00Z');
  return values.map((value, i) => {
    const d = new Date(start);
    d.setUTCDate(d.getUTCDate() + i);
    return { product, date: d.toISOString().slice(0, 10), name, value, source: 'cws_csv' };
  });
}

function fetcherFor(byProduct: Record<string, MetricRow[]>): EdgeFetcher {
  return {
    fetch: vi.fn(async (url: string) => {
      const u = new URL(url);
      const product = u.searchParams.get('product') ?? '';
      return { ok: true, status: 200, json: async () => ({ metrics: byProduct[product] ?? [] }) };
    }),
  };
}

const BASE = { edgeUrl: 'https://edge.example.com', edgeToken: 'dev-only-placeholder-token' };

describe('gatherReportData', () => {
  it('returns empty latestByMetric/anomalies (not a crash) for a product with zero metric rows (Review Focus)', async () => {
    const fetcher = fetcherFor({});
    const data = await gatherReportData({ ...BASE, products: ['new-product'] }, { fetcher });
    expect(data.products).toEqual([{ product: 'new-product', latestByMetric: {}, anomalies: [], pnl: null }]);
    expect(data.portfolioPnl).toBeNull();
  });

  it('records the latest value per metric name, keeping the chronologically last row', async () => {
    const fetcher = fetcherFor({ p1: dailyRows('p1', 'installs', [10, 12, 15]) });
    const data = await gatherReportData({ ...BASE, products: ['p1'] }, { fetcher });
    expect(data.products[0].latestByMetric.installs).toEqual({ date: '2026-09-03', value: 15 });
  });

  it('flags an up-direction anomaly as a winner signal and a down-direction one as a risk signal', async () => {
    const spike = dailyRows('p1', 'installs', [10, 10, 11, 9, 10, 10, 100]);
    const drop = dailyRows('p1', 'wau', [50, 51, 49, 50, 52, 50, 5]);
    const fetcher = fetcherFor({ p1: [...spike, ...drop] });
    const data = await gatherReportData({ ...BASE, products: ['p1'] }, { fetcher });
    const byName = Object.fromEntries(data.products[0].anomalies.map((a) => [a.name, a]));
    expect(byName.installs.direction).toBe('up');
    expect(byName.wau.direction).toBe('down');
  });

  it('computes per-product pnl from --pnl-fixture rows filtered by product and since', async () => {
    const fetcher = fetcherFor({});
    const pnlRows = {
      revenue: [{ id: 'r1', product_id: 'p1', provider: 'gumroad', gross_cents: 1000, fee_cents: 90, refund_cents: 0, tax_cents: 0, currency: 'usd', occurred_at: '2026-09-05' }],
      costs: [{ id: 'c1', product_id: 'p1', category: 'ai' as const, amount_cents: 100, occurred_at: '2026-09-05' }],
    };
    const data = await gatherReportData({ ...BASE, products: ['p1'], since: '2026-09-01', pnlRows }, { fetcher });
    expect(data.products[0].pnl).toMatchObject({ grossRevenueCents: 1000, aiCostCents: 100 });
    expect(data.portfolioPnl).toMatchObject({ grossRevenueCents: 1000, aiCostCents: 100 });
  });

  it('leaves pnl null for a product with no matching --pnl-fixture rows, even when other products have data (Review Focus)', async () => {
    const fetcher = fetcherFor({});
    const pnlRows = {
      revenue: [{ id: 'r1', product_id: 'p1', provider: 'gumroad', gross_cents: 1000, fee_cents: 0, refund_cents: 0, tax_cents: 0, currency: 'usd', occurred_at: '2026-09-05' }],
      costs: [],
    };
    const data = await gatherReportData({ ...BASE, products: ['p1', 'p2'], pnlRows }, { fetcher });
    expect(data.products.find((p) => p.product === 'p1')?.pnl).not.toBeNull();
    expect(data.products.find((p) => p.product === 'p2')?.pnl).toBeNull();
  });

  it('leaves pnl null and portfolioPnl null everywhere when no --pnl-fixture is given at all (Review Focus: no fabricated zero)', async () => {
    const fetcher = fetcherFor({});
    const data = await gatherReportData({ ...BASE, products: ['p1'] }, { fetcher });
    expect(data.products[0].pnl).toBeNull();
    expect(data.portfolioPnl).toBeNull();
  });

  it('de-duplicates a product passed twice so portfolio totals are not double-counted (Review Focus)', async () => {
    const fetcher = fetcherFor({});
    const pnlRows = {
      revenue: [{ id: 'r1', product_id: 'p1', provider: 'gumroad', gross_cents: 1000, fee_cents: 0, refund_cents: 0, tax_cents: 0, currency: 'usd', occurred_at: '2026-09-05' }],
      costs: [],
    };
    const data = await gatherReportData({ ...BASE, products: ['p1', 'p1'], pnlRows }, { fetcher });
    expect(data.products).toHaveLength(1);
    expect(data.portfolioPnl?.grossRevenueCents).toBe(1000);
  });

  it('propagates EdgeRequestError from a failed edge request instead of swallowing it (Review Focus)', async () => {
    const fetcher: EdgeFetcher = { fetch: vi.fn(async () => ({ ok: false, status: 401, json: async () => ({}) })) };
    await expect(gatherReportData({ ...BASE, products: ['p1'] }, { fetcher })).rejects.toMatchObject({ status: 401 });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @appforge/cli exec vitest run tests/report-data.test.ts`
Expected: FAIL — `Cannot find module '../src/report-data.js'`

- [ ] **Step 3: Write minimal implementation**

Create `packages/cli/src/report-data.ts`:

```ts
import { EdgeClient, EdgeRequestError, type EdgeFetcher, type MetricRow } from './edge-client.js';
import { computePnl, detectAnomalies, type Revenue, type Cost, type PnlResult } from '@appforge/schemas';

export { EdgeRequestError };

export interface ReportAnomaly {
  product: string;
  name: string;
  date: string;
  value: number;
  trailingMean: number;
  trailingStdDev: number;
  zScore: number;
  direction: 'up' | 'down';
}

export interface ProductReportData {
  product: string;
  latestByMetric: Record<string, { date: string; value: number }>;
  anomalies: ReportAnomaly[];
  pnl: PnlResult | null;
}

export interface ReportData {
  products: ProductReportData[];
  portfolioPnl: PnlResult | null;
}

export interface PnlFixtureRows {
  revenue: Revenue[];
  costs: Cost[];
}

export interface GatherReportDataOptions {
  products: string[];
  since?: string;
  edgeUrl: string;
  edgeToken: string;
  pnlRows?: PnlFixtureRows;
}

export interface GatherReportDataDeps {
  fetcher?: EdgeFetcher;
}

// Not shared with metrics-anomalies.ts's own private groupByName: that command is already
// shipped/tested (P1-16) and this grouping is ~8 lines, so a cross-file extraction wasn't worth
// touching merged, working code for.
function groupByName(rows: MetricRow[]): Map<string, MetricRow[]> {
  const groups = new Map<string, MetricRow[]>();
  for (const row of rows) {
    const group = groups.get(row.name);
    if (group) group.push(row);
    else groups.set(row.name, [row]);
  }
  return groups;
}

/**
 * Fetches each requested product's full metric history (no `from` filter — `detectAnomalies`'s
 * trailing window needs real prior history) and, if `pnlRows` is given, computes a per-product and
 * portfolio-wide `computePnl` over the rows matching that product and `since`. A product with zero
 * metric rows is not an error: it comes back with an empty `latestByMetric`/`anomalies` (Review
 * Focus: brand-new products must not break the whole report). `pnl` is `null` — never a
 * fabricated all-zero `PnlResult` — for a product with no `pnlRows` at all, or with rows but none
 * matching this product/since. Input `products` is de-duplicated first so a repeated `--product`
 * flag never double-counts revenue/contribution in `portfolioPnl`.
 */
export async function gatherReportData(opts: GatherReportDataOptions, deps: GatherReportDataDeps = {}): Promise<ReportData> {
  const client = new EdgeClient({ edgeUrl: opts.edgeUrl, edgeToken: opts.edgeToken, fetcher: deps.fetcher });
  const uniqueProducts = [...new Set(opts.products)];

  const products: ProductReportData[] = [];
  const allRevenue: Revenue[] = [];
  const allCosts: Cost[] = [];

  for (const product of uniqueProducts) {
    const rows = await client.getMetrics({ product });

    const latestByMetric: Record<string, { date: string; value: number }> = {};
    const anomalies: ReportAnomaly[] = [];
    for (const [name, seriesRows] of groupByName(rows)) {
      const sorted = [...seriesRows].sort((a, b) => a.date.localeCompare(b.date));
      const last = sorted[sorted.length - 1];
      latestByMetric[name] = { date: last.date, value: last.value };
      for (const r of detectAnomalies(sorted.map((row) => ({ date: row.date, value: row.value })))) {
        if (r.isAnomaly) {
          anomalies.push({
            product,
            name,
            date: r.date,
            value: r.value,
            trailingMean: r.trailingMean,
            trailingStdDev: r.trailingStdDev,
            zScore: r.zScore,
            direction: r.value >= r.trailingMean ? 'up' : 'down',
          });
        }
      }
    }

    let pnl: PnlResult | null = null;
    if (opts.pnlRows) {
      const revenue = opts.pnlRows.revenue.filter((r) => r.product_id === product && (!opts.since || r.occurred_at >= opts.since));
      const costs = opts.pnlRows.costs.filter((c) => c.product_id === product && (!opts.since || c.occurred_at >= opts.since));
      if (revenue.length > 0 || costs.length > 0) {
        pnl = computePnl(revenue, costs);
        allRevenue.push(...revenue);
        allCosts.push(...costs);
      }
    }

    products.push({ product, latestByMetric, anomalies, pnl });
  }

  const portfolioPnl = allRevenue.length > 0 || allCosts.length > 0 ? computePnl(allRevenue, allCosts) : null;

  return { products, portfolioPnl };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @appforge/cli exec vitest run tests/report-data.test.ts`
Expected: PASS (all 8 tests)

- [ ] **Step 5: Commit**

```bash
git add packages/cli/src/report-data.ts packages/cli/tests/report-data.test.ts
git commit -m "$(cat <<'EOF'
feat(cli): add gatherReportData for appforge report (P1-17)

Reuses EdgeClient/computePnl/detectAnomalies from P1-16 rather than
re-implementing them; de-dupes products and never fabricates a pnl
value for a product with no matching fixture rows.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 2: `report-sections.ts` — daily sections + scale/pause recommendation

**Files:**
- Create: `packages/cli/src/report-sections.ts`
- Create: `packages/cli/tests/report-sections.test.ts`

**Interfaces:**
- Consumes: `type ReportData`, `type ProductReportData`, `type ReportAnomaly`, `type PnlFixtureRows` from `../report-data.js` — wait, same directory, so `./report-data.js`.
- Produces (for Task 3 and Task 4/5):
  ```ts
  export function formatCents(cents: number | null): string;
  export interface ScalePauseRecommendation { product: string; recommendation: 'scale' | 'pause'; reason: string; }
  export function buildScalePauseRecommendations(products: ProductReportData[]): ScalePauseRecommendation[];
  export interface DailyReportSections {
    since: string | null;
    productsTracked: number;
    revenueCents: number | null;
    contributionCents: number | null;
    aiCostCents: number | null;
    winners: ReportAnomaly[];
    risks: ReportAnomaly[];
    scalePause: ScalePauseRecommendation[];
    productsMissingPnl: string[];
  }
  export function buildDailyReportSections(data: ReportData, since?: string): DailyReportSections;
  export function renderDailyReportText(sections: DailyReportSections): string;
  ```

- [ ] **Step 1: Write the failing test**

Create `packages/cli/tests/report-sections.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import {
  formatCents,
  buildScalePauseRecommendations,
  buildDailyReportSections,
  renderDailyReportText,
} from '../src/report-sections.js';
import type { ReportData, ProductReportData, ReportAnomaly } from '../src/report-data.js';

describe('formatCents', () => {
  it('renders "no data" for null (Review Focus: never a fabricated $0.00)', () => {
    expect(formatCents(null)).toBe('no data');
  });
  it('renders positive cents as dollars', () => {
    expect(formatCents(150)).toBe('$1.50');
  });
  it('renders negative cents with a leading minus', () => {
    expect(formatCents(-150)).toBe('-$1.50');
  });
  it('renders exactly zero as $0.00 (a real computed zero, distinct from null)', () => {
    expect(formatCents(0)).toBe('$0.00');
  });
});

function product(overrides: Partial<ProductReportData>): ProductReportData {
  return { product: 'p1', latestByMetric: {}, anomalies: [], pnl: null, ...overrides };
}

describe('buildScalePauseRecommendations', () => {
  it('recommends pause for negative contribution', () => {
    const recs = buildScalePauseRecommendations([
      product({ pnl: { grossRevenueCents: 100, refundsCents: 0, paymentFeesCents: 0, netRevenueCents: 100, aiCostCents: 200, infrastructureCents: 0, marketingCents: 0, supportCents: 0, otherVariableCents: 0, contributionCents: -100, contributionMargin: -1 } }),
    ]);
    expect(recs).toEqual([{ product: 'p1', recommendation: 'pause', reason: expect.stringContaining('negative') }]);
  });

  it('recommends scale for contribution margin above 50%', () => {
    const recs = buildScalePauseRecommendations([
      product({ pnl: { grossRevenueCents: 1000, refundsCents: 0, paymentFeesCents: 0, netRevenueCents: 1000, aiCostCents: 100, infrastructureCents: 0, marketingCents: 0, supportCents: 0, otherVariableCents: 0, contributionCents: 900, contributionMargin: 0.9 } }),
    ]);
    expect(recs).toEqual([{ product: 'p1', recommendation: 'scale', reason: expect.stringContaining('50%') }]);
  });

  it('gives no recommendation for a product with modest positive contribution and no pnl at all', () => {
    const recs = buildScalePauseRecommendations([
      product({ pnl: { grossRevenueCents: 1000, refundsCents: 0, paymentFeesCents: 0, netRevenueCents: 1000, aiCostCents: 100, infrastructureCents: 0, marketingCents: 0, supportCents: 0, otherVariableCents: 0, contributionCents: 200, contributionMargin: 0.2 } }),
      product({ product: 'p2', pnl: null }),
    ]);
    expect(recs).toEqual([]);
  });
});

describe('buildDailyReportSections / renderDailyReportText', () => {
  it('splits anomalies into winners (up) and risks (down) across products', () => {
    const winner: ReportAnomaly = { product: 'p1', name: 'installs', date: '2026-09-07', value: 100, trailingMean: 10, trailingStdDev: 1, zScore: 90, direction: 'up' };
    const risk: ReportAnomaly = { product: 'p2', name: 'wau', date: '2026-09-07', value: 5, trailingMean: 50, trailingStdDev: 1, zScore: 45, direction: 'down' };
    const data: ReportData = { products: [product({ product: 'p1', anomalies: [winner] }), product({ product: 'p2', anomalies: [risk] })], portfolioPnl: null };
    const sections = buildDailyReportSections(data);
    expect(sections.winners).toEqual([winner]);
    expect(sections.risks).toEqual([risk]);
  });

  it('reports revenue/contribution/aiCost as null (not zero) when portfolioPnl is null (Review Focus)', () => {
    const data: ReportData = { products: [product({})], portfolioPnl: null };
    const sections = buildDailyReportSections(data);
    expect(sections.revenueCents).toBeNull();
    expect(sections.contributionCents).toBeNull();
    expect(sections.aiCostCents).toBeNull();
  });

  it('lists products with no pnl data by name (honesty note)', () => {
    const data: ReportData = { products: [product({ product: 'p1', pnl: null }), product({ product: 'p2', pnl: { grossRevenueCents: 1, refundsCents: 0, paymentFeesCents: 0, netRevenueCents: 1, aiCostCents: 0, infrastructureCents: 0, marketingCents: 0, supportCents: 0, otherVariableCents: 0, contributionCents: 1, contributionMargin: 1 } })], portfolioPnl: null };
    const sections = buildDailyReportSections(data);
    expect(sections.productsMissingPnl).toEqual(['p1']);
  });

  it('renders every §29b section header, with honest empty-state text for sections with no data source', () => {
    const data: ReportData = { products: [], portfolioPnl: null };
    const text = renderDailyReportText(buildDailyReportSections(data));
    expect(text).toContain('COMPANY HEALTH');
    expect(text).toContain('WINNERS');
    expect(text).toContain('RISKS');
    expect(text).toContain('INCIDENTS');
    expect(text).toContain('no data');
    expect(text).toContain('NEW OPPORTUNITIES');
    expect(text).toContain('PRODUCTS TO SCALE / TO PAUSE');
    expect(text).toContain('FOUNDER DECISIONS REQUIRED');
  });

  it('renders "no anomalies detected" (not an empty string) when there are no winners/risks', () => {
    const text = renderDailyReportText(buildDailyReportSections({ products: [], portfolioPnl: null }));
    expect(text).toMatch(/WINNERS\s+no anomalies detected/);
    expect(text).toMatch(/RISKS\s+no anomalies detected/);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @appforge/cli exec vitest run tests/report-sections.test.ts`
Expected: FAIL — `Cannot find module '../src/report-sections.js'`

- [ ] **Step 3: Write minimal implementation**

Create `packages/cli/src/report-sections.ts`:

```ts
import type { ReportData, ProductReportData, ReportAnomaly } from './report-data.js';

/** "no data" for null (a genuinely-missing data source) — never a fabricated "$0.00". */
export function formatCents(cents: number | null): string {
  if (cents === null) return 'no data';
  const sign = cents < 0 ? '-' : '';
  const abs = Math.abs(cents);
  return `${sign}$${(abs / 100).toFixed(2)}`;
}

export interface ScalePauseRecommendation {
  product: string;
  recommendation: 'scale' | 'pause';
  reason: string;
}

/**
 * Deliberately simplified stand-in for §22's full kill/scale policy, which needs WAU history over
 * 30/60/90 days, D30 retention cohorts, and portfolio state — none of which this repo tracks yet.
 * Uses only the real, already-computed `computePnl` numbers: pause if contribution is negative,
 * scale if contribution margin exceeds 50%. A product with no pnl data or a middling margin gets
 * no recommendation at all (never "none" padding — the list is only actionable signals).
 */
export function buildScalePauseRecommendations(products: ProductReportData[]): ScalePauseRecommendation[] {
  const recs: ScalePauseRecommendation[] = [];
  for (const p of products) {
    if (!p.pnl) continue;
    if (p.pnl.contributionCents < 0) {
      recs.push({ product: p.product, reason: `contribution is negative (${formatCents(p.pnl.contributionCents)})`, recommendation: 'pause' });
    } else if (p.pnl.contributionMargin !== null && p.pnl.contributionMargin > 0.5) {
      recs.push({ product: p.product, reason: `contribution margin ${(p.pnl.contributionMargin * 100).toFixed(0)}% > 50%`, recommendation: 'scale' });
    }
  }
  return recs;
}

export interface DailyReportSections {
  since: string | null;
  productsTracked: number;
  revenueCents: number | null;
  contributionCents: number | null;
  aiCostCents: number | null;
  winners: ReportAnomaly[];
  risks: ReportAnomaly[];
  scalePause: ScalePauseRecommendation[];
  productsMissingPnl: string[];
}

export function buildDailyReportSections(data: ReportData, since?: string): DailyReportSections {
  return {
    since: since ?? null,
    productsTracked: data.products.length,
    revenueCents: data.portfolioPnl ? data.portfolioPnl.netRevenueCents : null,
    contributionCents: data.portfolioPnl ? data.portfolioPnl.contributionCents : null,
    aiCostCents: data.portfolioPnl ? data.portfolioPnl.aiCostCents : null,
    winners: data.products.flatMap((p) => p.anomalies.filter((a) => a.direction === 'up')),
    risks: data.products.flatMap((p) => p.anomalies.filter((a) => a.direction === 'down')),
    scalePause: buildScalePauseRecommendations(data.products),
    productsMissingPnl: data.products.filter((p) => !p.pnl).map((p) => p.product),
  };
}

function renderAnomalyList(anomalies: ReportAnomaly[], verb: string): string {
  if (anomalies.length === 0) return 'no anomalies detected';
  return anomalies.map((a) => `${a.product}: ${a.name} ${verb} ${a.value} (mean ${a.trailingMean.toFixed(1)}) on ${a.date}`).join('; ');
}

export function renderDailyReportText(sections: DailyReportSections): string {
  const sinceLabel = sections.since ? ` since ${sections.since}` : '';
  const lines: string[] = [
    `COMPANY HEALTH  Revenue${sinceLabel}: ${formatCents(sections.revenueCents)}  Contribution${sinceLabel}: ${formatCents(sections.contributionCents)}  AI spend${sinceLabel}: ${formatCents(sections.aiCostCents)}  Products tracked: ${sections.productsTracked}`,
    `WINNERS         ${renderAnomalyList(sections.winners, 'up to')}`,
    `RISKS           ${renderAnomalyList(sections.risks, 'down to')}`,
    'INCIDENTS       no data (incident tracking not wired up yet)',
    'NEW OPPORTUNITIES no data (opportunity backlog not wired up yet)',
    `PRODUCTS TO SCALE / TO PAUSE  ${sections.scalePause.length === 0 ? 'no recommendations (insufficient P&L signal)' : sections.scalePause.map((r) => `${r.product}: ${r.recommendation} (${r.reason})`).join('; ')}`,
    'FOUNDER DECISIONS REQUIRED    no data (Paperclip approvals not wired up yet)',
  ];
  if (sections.productsMissingPnl.length > 0) {
    lines.push(`(note: no P&L data available for: ${sections.productsMissingPnl.join(', ')})`);
  }
  return lines.join('\n');
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @appforge/cli exec vitest run tests/report-sections.test.ts`
Expected: PASS (all 11 tests)

- [ ] **Step 5: Commit**

```bash
git add packages/cli/src/report-sections.ts packages/cli/tests/report-sections.test.ts
git commit -m "$(cat <<'EOF'
feat(cli): add daily report sections + scale/pause recommendation

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 3: `appforge report daily`

**Files:**
- Create: `packages/cli/src/commands/report-daily.ts`
- Create: `packages/cli/tests/report-pnl-fixture.json`
- Create: `packages/cli/tests/report-daily.integration.test.ts`
- Modify: `packages/cli/src/index.ts`

**Interfaces:**
- Consumes: `gatherReportData`, `type PnlFixtureRows` from `../report-data.js`; `buildDailyReportSections`, `renderDailyReportText` from `../report-sections.js`; `EdgeRequestError`, `type EdgeFetcher` from `../edge-client.js`; `buildOutput`, `printOutput` from `../output.js`.
- Produces:
  ```ts
  export interface ReportDailyOptions {
    product: string[];
    since?: string;
    edgeUrl?: string;
    edgeToken?: string;
    pnlFixture?: string;
    json: boolean;
  }
  export interface ReportDailyDeps { fetcher?: EdgeFetcher; }
  export async function runReportDaily(opts: ReportDailyOptions, deps?: ReportDailyDeps): Promise<number>;
  ```
  Exit codes: `0` ok, `2` invalid input (no `--product`, no edge URL/token, malformed `--pnl-fixture`), `17` edge request failed.

Create `packages/cli/tests/report-pnl-fixture.json` (reused by Tasks 3, 5, 7):

```json
{
  "revenue": [
    { "id": "r1", "product_id": "json-workbench", "provider": "gumroad", "gross_cents": 1000, "fee_cents": 90, "refund_cents": 0, "tax_cents": 0, "currency": "usd", "occurred_at": "2026-09-05" },
    { "id": "r2", "product_id": "json-workbench", "provider": "gumroad", "gross_cents": 500, "fee_cents": 45, "refund_cents": 500, "tax_cents": 0, "currency": "usd", "occurred_at": "2026-09-12" }
  ],
  "costs": [
    { "id": "c1", "product_id": "json-workbench", "category": "ai", "amount_cents": 120, "occurred_at": "2026-09-01" },
    { "id": "c2", "product_id": "json-workbench", "category": "infra", "amount_cents": 25, "occurred_at": "2026-09-01" }
  ]
}
```

- [ ] **Step 1: Write the failing test**

Create `packages/cli/tests/report-daily.integration.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { runReportDaily } from '../src/commands/report-daily.js';
import type { EdgeFetcher } from '../src/edge-client.js';

const FIXTURE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), './report-pnl-fixture.json');

const EDGE_ENV_VARS = ['APPFORGE_EDGE_URL', 'APPFORGE_EDGE_TOKEN'] as const;
const saved: Record<string, string | undefined> = {};
beforeEach(() => { for (const k of EDGE_ENV_VARS) { saved[k] = process.env[k]; delete process.env[k]; } });
afterEach(() => { for (const k of EDGE_ENV_VARS) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; } });

function emptyFetcher(): EdgeFetcher {
  return { fetch: vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ metrics: [] }) })) };
}

const BASE = { product: ['json-workbench'], edgeUrl: 'https://edge.example.com', edgeToken: 'dev-only-placeholder-token', json: true };

function captureStdout(fn: () => Promise<number>): Promise<{ code: number; stdout: string }> {
  const chunks: string[] = [];
  const original = console.log;
  const originalWrite = process.stdout.write.bind(process.stdout);
  console.log = ((chunk: string) => { chunks.push(String(chunk)); }) as typeof console.log;
  process.stdout.write = ((chunk: string) => { chunks.push(String(chunk)); return true; }) as typeof process.stdout.write;
  return fn().then((code) => {
    console.log = original;
    process.stdout.write = originalWrite;
    return { code, stdout: chunks.join('\n') };
  });
}

describe('runReportDaily', () => {
  it('returns 2 when no --product is given', async () => {
    const code = await runReportDaily({ ...BASE, product: [] }, { fetcher: emptyFetcher() });
    expect(code).toBe(2);
  });

  it('returns 2 when neither --edge-url nor APPFORGE_EDGE_URL is set', async () => {
    const code = await runReportDaily({ ...BASE, edgeUrl: undefined }, { fetcher: emptyFetcher() });
    expect(code).toBe(2);
  });

  it('returns 2 for a malformed --pnl-fixture file', async () => {
    const code = await runReportDaily({ ...BASE, pnlFixture: path.join(path.dirname(FIXTURE), 'does-not-exist.json') }, { fetcher: emptyFetcher() });
    expect(code).toBe(2);
  });

  it('returns 0 and a JSON cli-output@1 payload with honest empty sections when a product has zero metrics and no --pnl-fixture (Review Focus)', async () => {
    const { code, stdout } = await captureStdout(() => runReportDaily(BASE, { fetcher: emptyFetcher() }));
    expect(code).toBe(0);
    const output = JSON.parse(stdout);
    expect(output).toMatchObject({ schema: 'cli-output@1', ok: true, command: 'report daily' });
    expect(output.data.revenueCents).toBeNull();
    expect(output.data.winners).toEqual([]);
  });

  it('returns 0 and includes real pnl numbers when --pnl-fixture matches the product', async () => {
    const { code, stdout } = await captureStdout(() => runReportDaily({ ...BASE, since: '2026-09-01', pnlFixture: FIXTURE }, { fetcher: emptyFetcher() }));
    expect(code).toBe(0);
    const output = JSON.parse(stdout);
    expect(output.data.contributionCents).toBe(1500 - 500 - 135 - 120 - 25);
  });

  it('prints the human-readable §29b-shaped report text (not just pass/fail) in non-JSON mode', async () => {
    const { code, stdout } = await captureStdout(() => runReportDaily({ ...BASE, json: false }, { fetcher: emptyFetcher() }));
    expect(code).toBe(0);
    expect(stdout).toContain('COMPANY HEALTH');
    expect(stdout).toContain('FOUNDER DECISIONS REQUIRED');
  });

  it('returns 17 when the edge rejects the token, not a false-positive successful report (Review Focus)', async () => {
    const fetcher: EdgeFetcher = { fetch: vi.fn(async () => ({ ok: false, status: 401, json: async () => ({}) })) };
    const code = await runReportDaily(BASE, { fetcher });
    expect(code).toBe(17);
  });

  it('falls back to APPFORGE_EDGE_URL/APPFORGE_EDGE_TOKEN when flags are absent', async () => {
    process.env.APPFORGE_EDGE_URL = 'https://edge.example.com';
    process.env.APPFORGE_EDGE_TOKEN = 'dev-only-placeholder-token';
    const code = await runReportDaily({ product: ['json-workbench'], json: true }, { fetcher: emptyFetcher() });
    expect(code).toBe(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @appforge/cli exec vitest run tests/report-daily.integration.test.ts`
Expected: FAIL — `Cannot find module '../src/commands/report-daily.js'`

- [ ] **Step 3: Write minimal implementation**

Create `packages/cli/src/commands/report-daily.ts`:

```ts
import { readFileSync } from 'node:fs';
import { gatherReportData, EdgeRequestError, type PnlFixtureRows } from '../report-data.js';
import { buildDailyReportSections, renderDailyReportText } from '../report-sections.js';
import type { EdgeFetcher } from '../edge-client.js';
import { buildOutput, printOutput } from '../output.js';

export interface ReportDailyOptions {
  product: string[];
  since?: string;
  edgeUrl?: string;
  edgeToken?: string;
  pnlFixture?: string;
  json: boolean;
}

export interface ReportDailyDeps {
  fetcher?: EdgeFetcher;
}

function isPnlFixture(value: unknown): value is PnlFixtureRows {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Record<string, unknown>;
  return Array.isArray(v.revenue) && Array.isArray(v.costs);
}

function loadPnlFixture(filePath: string): { ok: true; rows: PnlFixtureRows } | { ok: false; error: string } {
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(filePath, 'utf8'));
  } catch (err) {
    return { ok: false, error: `cannot read/parse ${filePath}: ${(err as Error).message}` };
  }
  if (!isPnlFixture(parsed)) {
    return { ok: false, error: `${filePath} must contain { revenue: Revenue[], costs: Cost[] }` };
  }
  return { ok: true, rows: parsed };
}

/**
 * Deterministic daily founder report (§29b): COMPANY HEALTH / WINNERS / RISKS / INCIDENTS /
 * NEW OPPORTUNITIES / PRODUCTS TO SCALE-PAUSE / FOUNDER DECISIONS REQUIRED. No LLM call anywhere —
 * every section is either computed from real edge metrics/P&L data or an explicit "no data" state
 * for a data source (incidents, opportunities, approvals) this repo doesn't have yet.
 *
 * Exit codes: 0 ok (a report with every section honestly empty is still a successfully generated
 * report, never a failure), 2 invalid input (no --product, no edge URL/token resolvable, or a
 * malformed --pnl-fixture), 17 edge request failed (non-2xx or transport failure for any product).
 */
export async function runReportDaily(opts: ReportDailyOptions, deps: ReportDailyDeps = {}): Promise<number> {
  if (opts.product.length === 0) {
    printOutput(buildOutput('report daily', false, undefined, ['at least one --product is required']), opts.json);
    return 2;
  }

  const edgeUrl = opts.edgeUrl ?? process.env.APPFORGE_EDGE_URL;
  const edgeToken = opts.edgeToken ?? process.env.APPFORGE_EDGE_TOKEN;
  if (!edgeUrl) {
    printOutput(buildOutput('report daily', false, undefined, ['no edge URL: pass --edge-url or set APPFORGE_EDGE_URL']), opts.json);
    return 2;
  }
  if (!edgeToken) {
    printOutput(buildOutput('report daily', false, undefined, ['no edge token: pass --edge-token or set APPFORGE_EDGE_TOKEN']), opts.json);
    return 2;
  }

  let pnlRows: PnlFixtureRows | undefined;
  if (opts.pnlFixture) {
    const loaded = loadPnlFixture(opts.pnlFixture);
    if (!loaded.ok) {
      printOutput(buildOutput('report daily', false, undefined, [loaded.error]), opts.json);
      return 2;
    }
    pnlRows = loaded.rows;
  }

  let data;
  try {
    data = await gatherReportData({ products: opts.product, since: opts.since, edgeUrl, edgeToken, pnlRows }, { fetcher: deps.fetcher });
  } catch (err) {
    const message = err instanceof EdgeRequestError ? err.message : (err as Error).message;
    printOutput(buildOutput('report daily', false, undefined, [message]), opts.json);
    return 17;
  }

  const sections = buildDailyReportSections(data, opts.since);

  if (opts.json) {
    printOutput(buildOutput('report daily', true, sections), true);
  } else {
    console.log(renderDailyReportText(sections));
  }
  return 0;
}
```

Modify `packages/cli/src/index.ts`:

1. Add near the other command imports:
```ts
import { runReportDaily } from './commands/report-daily.js';
```

2. Add a shared repeatable-option accumulator near the top (after `program.exitOverride();`):
```ts
function collect(value: string, previous: string[]): string[] {
  return previous.concat([value]);
}
```

3. Add after the `metrics` command group's subcommands, before `program.command('test')`:
```ts
const report = program.command('report').description('Generate founder reports (§29b) from edge metrics/P&L data');

report
  .command('daily')
  .description('Deterministic daily founder report (COMPANY HEALTH / WINNERS / RISKS / INCIDENTS / NEW OPPORTUNITIES / PRODUCTS TO SCALE-PAUSE / FOUNDER DECISIONS REQUIRED)')
  .option('--product <id>', 'product id (repeatable)', collect, [] as string[])
  .option('--since <date>', 'only include P&L rows on/after this date (YYYY-MM-DD)')
  .option('--edge-url <url>', 'edge base URL (falls back to APPFORGE_EDGE_URL)')
  .option('--edge-token <token>', 'edge bearer token (falls back to APPFORGE_EDGE_TOKEN)')
  .option('--pnl-fixture <path>', 'path to a JSON file: { revenue: Revenue[], costs: Cost[] } (interim input until P1-15)')
  .option('--json', 'machine-readable output', false)
  .action(async (opts: { product: string[]; since?: string; edgeUrl?: string; edgeToken?: string; pnlFixture?: string; json: boolean }) => {
    process.exitCode = await runReportDaily(opts);
  });
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @appforge/cli exec vitest run tests/report-daily.integration.test.ts`
Expected: PASS (all 8 tests)

- [ ] **Step 5: Commit**

```bash
git add packages/cli/src/commands/report-daily.ts packages/cli/tests/report-daily.integration.test.ts packages/cli/tests/report-pnl-fixture.json packages/cli/src/index.ts
git commit -m "$(cat <<'EOF'
feat(cli): add appforge report daily

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 4: `report-sections.ts` — weekly sections

**Files:**
- Modify: `packages/cli/src/report-sections.ts`
- Modify: `packages/cli/tests/report-sections.test.ts`

**Interfaces:**
- Consumes: same as Task 2, plus `buildScalePauseRecommendations` (already in this file).
- Produces (for Task 5):
  ```ts
  export interface WeeklyProductRow {
    product: string;
    wau: number | null;
    d7Retention: number | null;
    d30Retention: number | null;
    revenueCents: number | null;
    contributionCents: number | null;
  }
  export interface WeeklyReportSections {
    since: string | null;
    portfolio: WeeklyProductRow[];
    totalRevenueCents: number | null;
    totalContributionCents: number | null;
    totalAiCostCents: number | null;
    risks: ReportAnomaly[];
    scalePause: ScalePauseRecommendation[];
    nextWeekPriorities: string[]; // capped at 5
    productsMissingPnl: string[];
  }
  export function buildWeeklyReportSections(data: ReportData, since: string): WeeklyReportSections;
  export function renderWeeklyReportText(sections: WeeklyReportSections): string;
  ```

- [ ] **Step 1: Write the failing test**

Append to `packages/cli/tests/report-sections.test.ts`:

```ts
import { buildWeeklyReportSections, renderWeeklyReportText } from '../src/report-sections.js';

describe('buildWeeklyReportSections / renderWeeklyReportText', () => {
  it('builds a portfolio row per product using the latest wau/retention metric values, "no data" when a metric name is absent', () => {
    const data: ReportData = {
      products: [
        product({ product: 'p1', latestByMetric: { wau: { date: '2026-09-07', value: 120 } }, pnl: { grossRevenueCents: 1000, refundsCents: 0, paymentFeesCents: 0, netRevenueCents: 1000, aiCostCents: 100, infrastructureCents: 0, marketingCents: 0, supportCents: 0, otherVariableCents: 0, contributionCents: 900, contributionMargin: 0.9 } }),
      ],
      portfolioPnl: null,
    };
    const sections = buildWeeklyReportSections(data, '2026-09-01');
    expect(sections.portfolio).toEqual([
      { product: 'p1', wau: 120, d7Retention: null, d30Retention: null, revenueCents: 1000, contributionCents: 900 },
    ]);
  });

  it('caps nextWeekPriorities at 5, prioritizing scale/pause recommendations then top risks', () => {
    const products: ProductReportData[] = Array.from({ length: 7 }, (_, i) => product({
      product: `p${i}`,
      anomalies: [{ product: `p${i}`, name: 'wau', date: '2026-09-07', value: 1, trailingMean: 10, trailingStdDev: 1, zScore: 9, direction: 'down' }],
    }));
    const sections = buildWeeklyReportSections({ products, portfolioPnl: null }, '2026-09-01');
    expect(sections.nextWeekPriorities.length).toBeLessThanOrEqual(5);
  });

  it('renders the weekly template sections including empty-state notes for unwired data sources', () => {
    const text = renderWeeklyReportText(buildWeeklyReportSections({ products: [], portfolioPnl: null }, '2026-09-01'));
    expect(text).toContain('PORTFOLIO PERFORMANCE');
    expect(text).toContain('EXPERIMENTS');
    expect(text).toContain('no data (experiment tracking not wired up yet)');
    expect(text).toContain('NEXT WEEK PRIORITIES');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @appforge/cli exec vitest run tests/report-sections.test.ts`
Expected: FAIL — `Cannot find module` for `buildWeeklyReportSections`/`renderWeeklyReportText` (named export not found)

- [ ] **Step 3: Write minimal implementation**

Append to `packages/cli/src/report-sections.ts`:

```ts
export interface WeeklyProductRow {
  product: string;
  wau: number | null;
  d7Retention: number | null;
  d30Retention: number | null;
  revenueCents: number | null;
  contributionCents: number | null;
}

export interface WeeklyReportSections {
  since: string | null;
  portfolio: WeeklyProductRow[];
  totalRevenueCents: number | null;
  totalContributionCents: number | null;
  totalAiCostCents: number | null;
  risks: ReportAnomaly[];
  scalePause: ScalePauseRecommendation[];
  nextWeekPriorities: string[];
  productsMissingPnl: string[];
}

/**
 * §29b's weekly board report table. `wau`/`d7Retention`/`d30Retention` come from the edge metric
 * series named exactly `wau`/`d7_retention`/`d30_retention` — a product that never ingested a
 * series under that name renders `null` ("no data"), not `0`. `nextWeekPriorities` is derived
 * (never hand-authored) from the same scale/pause recommendation and risk-anomaly data as the
 * rest of the report, capped at 5 per §29b, recommendations first.
 */
export function buildWeeklyReportSections(data: ReportData, since: string): WeeklyReportSections {
  const portfolio: WeeklyProductRow[] = data.products.map((p) => ({
    product: p.product,
    wau: p.latestByMetric['wau']?.value ?? null,
    d7Retention: p.latestByMetric['d7_retention']?.value ?? null,
    d30Retention: p.latestByMetric['d30_retention']?.value ?? null,
    revenueCents: p.pnl ? p.pnl.netRevenueCents : null,
    contributionCents: p.pnl ? p.pnl.contributionCents : null,
  }));

  const risks = data.products.flatMap((p) => p.anomalies.filter((a) => a.direction === 'down'));
  const scalePause = buildScalePauseRecommendations(data.products);

  const priorities: string[] = [];
  for (const rec of scalePause) {
    priorities.push(`${rec.recommendation === 'pause' ? 'Consider pausing' : 'Consider scaling'} ${rec.product} (${rec.reason})`);
  }
  for (const risk of risks) {
    if (priorities.length >= 5) break;
    priorities.push(`Investigate ${risk.product} ${risk.name} decline (${risk.value} vs mean ${risk.trailingMean.toFixed(1)})`);
  }

  return {
    since,
    portfolio,
    totalRevenueCents: data.portfolioPnl ? data.portfolioPnl.netRevenueCents : null,
    totalContributionCents: data.portfolioPnl ? data.portfolioPnl.contributionCents : null,
    totalAiCostCents: data.portfolioPnl ? data.portfolioPnl.aiCostCents : null,
    risks,
    scalePause,
    nextWeekPriorities: priorities.slice(0, 5),
    productsMissingPnl: data.products.filter((p) => !p.pnl).map((p) => p.product),
  };
}

export function renderWeeklyReportText(sections: WeeklyReportSections): string {
  const lines: string[] = ['PORTFOLIO PERFORMANCE', 'product | wau | d7_retention | d30_retention | revenue | contribution'];
  for (const row of sections.portfolio) {
    lines.push(
      `${row.product} | ${row.wau ?? 'no data'} | ${row.d7Retention ?? 'no data'} | ${row.d30Retention ?? 'no data'} | ${formatCents(row.revenueCents)} | ${formatCents(row.contributionCents)}`
    );
  }
  lines.push(
    '',
    `REVENUE  ${formatCents(sections.totalRevenueCents)}`,
    `CONTRIBUTION  ${formatCents(sections.totalContributionCents)}`,
    `COSTS (AI)  ${formatCents(sections.totalAiCostCents)}`,
    'GROWTH  see per-product anomalies below (no dedicated WAU-slope tracking yet)',
    'LAUNCHES  no data (product-state tracking not wired up yet)',
    'KILLS  no data (product-state tracking not wired up yet)',
    'EXPERIMENTS  no data (experiment tracking not wired up yet)',
    'AI EFFICIENCY  no data (per-tier cost/success tracking not wired up yet)',
    'INCIDENTS + POSTMORTEMS  no data (incident tracking not wired up yet)',
    `STRATEGIC RISKS  ${renderAnomalyList(sections.risks, 'down to')}`,
    `NEXT WEEK PRIORITIES (max 5)  ${sections.nextWeekPriorities.length === 0 ? 'none identified' : sections.nextWeekPriorities.map((p, i) => `${i + 1}. ${p}`).join('  ')}`
  );
  if (sections.productsMissingPnl.length > 0) {
    lines.push(`(note: no P&L data available for: ${sections.productsMissingPnl.join(', ')})`);
  }
  return lines.join('\n');
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @appforge/cli exec vitest run tests/report-sections.test.ts`
Expected: PASS (all 14 tests)

- [ ] **Step 5: Commit**

```bash
git add packages/cli/src/report-sections.ts packages/cli/tests/report-sections.test.ts
git commit -m "$(cat <<'EOF'
feat(cli): add weekly report sections (§29b portfolio table)

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 5: `appforge report weekly`

**Files:**
- Create: `packages/cli/src/commands/report-weekly.ts`
- Create: `packages/cli/tests/report-weekly.integration.test.ts`
- Modify: `packages/cli/src/index.ts`

**Interfaces:**
- Consumes: `gatherReportData`, `EdgeRequestError`, `type PnlFixtureRows` from `../report-data.js`; `buildWeeklyReportSections`, `renderWeeklyReportText` from `../report-sections.js`; `type EdgeFetcher` from `../edge-client.js`; `buildOutput`, `printOutput` from `../output.js`.
- Produces:
  ```ts
  export interface ReportWeeklyOptions {
    product: string[];
    since: string;
    edgeUrl?: string;
    edgeToken?: string;
    pnlFixture?: string;
    json: boolean;
  }
  export interface ReportWeeklyDeps { fetcher?: EdgeFetcher; }
  export async function runReportWeekly(opts: ReportWeeklyOptions, deps?: ReportWeeklyDeps): Promise<number>;
  ```
  Exit codes: same table as `report daily` (`0`, `2`, `17`). `--since` is required here (the weekly report is inherently a period report), unlike `report daily`'s optional `--since`.

- [ ] **Step 1: Write the failing test**

Create `packages/cli/tests/report-weekly.integration.test.ts`:

```ts
import { describe, it, expect, vi } from 'vitest';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { runReportWeekly } from '../src/commands/report-weekly.js';
import type { EdgeFetcher } from '../src/edge-client.js';

const FIXTURE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), './report-pnl-fixture.json');

function emptyFetcher(): EdgeFetcher {
  return { fetch: vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ metrics: [] }) })) };
}

const BASE = { product: ['json-workbench'], since: '2026-09-01', edgeUrl: 'https://edge.example.com', edgeToken: 'dev-only-placeholder-token', json: true };

function captureStdout(fn: () => Promise<number>): Promise<{ code: number; stdout: string }> {
  const chunks: string[] = [];
  const originalWrite = process.stdout.write.bind(process.stdout);
  process.stdout.write = ((chunk: string) => { chunks.push(String(chunk)); return true; }) as typeof process.stdout.write;
  const originalLog = console.log;
  console.log = ((chunk: string) => { chunks.push(String(chunk)); }) as typeof console.log;
  return fn().then((code) => {
    process.stdout.write = originalWrite;
    console.log = originalLog;
    return { code, stdout: chunks.join('\n') };
  });
}

describe('runReportWeekly', () => {
  it('returns 2 when no --product is given', async () => {
    const code = await runReportWeekly({ ...BASE, product: [] }, { fetcher: emptyFetcher() });
    expect(code).toBe(2);
  });

  it('returns 2 when no edge URL is resolvable', async () => {
    const code = await runReportWeekly({ ...BASE, edgeUrl: undefined }, { fetcher: emptyFetcher() });
    expect(code).toBe(2);
  });

  it('returns 0 with an honest empty portfolio table entry when a product has no metrics/pnl data', async () => {
    const { code, stdout } = await captureStdout(() => runReportWeekly(BASE, { fetcher: emptyFetcher() }));
    expect(code).toBe(0);
    const output = JSON.parse(stdout);
    expect(output.data.portfolio).toEqual([{ product: 'json-workbench', wau: null, d7Retention: null, d30Retention: null, revenueCents: null, contributionCents: null }]);
  });

  it('includes real revenue/contribution numbers from --pnl-fixture', async () => {
    const { stdout } = await captureStdout(() => runReportWeekly({ ...BASE, pnlFixture: FIXTURE }, { fetcher: emptyFetcher() }));
    const output = JSON.parse(stdout);
    expect(output.data.portfolio[0].revenueCents).toBe(865);
  });

  it('prints the human-readable weekly report text in non-JSON mode', async () => {
    const { stdout } = await captureStdout(() => runReportWeekly({ ...BASE, json: false }, { fetcher: emptyFetcher() }));
    expect(stdout).toContain('PORTFOLIO PERFORMANCE');
    expect(stdout).toContain('NEXT WEEK PRIORITIES');
  });

  it('returns 17 when the edge rejects the token', async () => {
    const fetcher: EdgeFetcher = { fetch: vi.fn(async () => ({ ok: false, status: 401, json: async () => ({}) })) };
    const code = await runReportWeekly(BASE, { fetcher });
    expect(code).toBe(17);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @appforge/cli exec vitest run tests/report-weekly.integration.test.ts`
Expected: FAIL — `Cannot find module '../src/commands/report-weekly.js'`

- [ ] **Step 3: Write minimal implementation**

Create `packages/cli/src/commands/report-weekly.ts` (mirrors `report-daily.ts`; `--since` is required, not optional):

```ts
import { readFileSync } from 'node:fs';
import { gatherReportData, EdgeRequestError, type PnlFixtureRows } from '../report-data.js';
import { buildWeeklyReportSections, renderWeeklyReportText } from '../report-sections.js';
import type { EdgeFetcher } from '../edge-client.js';
import { buildOutput, printOutput } from '../output.js';

export interface ReportWeeklyOptions {
  product: string[];
  since: string;
  edgeUrl?: string;
  edgeToken?: string;
  pnlFixture?: string;
  json: boolean;
}

export interface ReportWeeklyDeps {
  fetcher?: EdgeFetcher;
}

function isPnlFixture(value: unknown): value is PnlFixtureRows {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Record<string, unknown>;
  return Array.isArray(v.revenue) && Array.isArray(v.costs);
}

function loadPnlFixture(filePath: string): { ok: true; rows: PnlFixtureRows } | { ok: false; error: string } {
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(filePath, 'utf8'));
  } catch (err) {
    return { ok: false, error: `cannot read/parse ${filePath}: ${(err as Error).message}` };
  }
  if (!isPnlFixture(parsed)) {
    return { ok: false, error: `${filePath} must contain { revenue: Revenue[], costs: Cost[] }` };
  }
  return { ok: true, rows: parsed };
}

/**
 * Weekly board report (§29b): per-product portfolio table (WAU/D7/D30/revenue/contribution), AI
 * cost, growth/risk signals, launches/kills/experiments/AI-efficiency/incidents as honest "no
 * data" states (not wired up in this repo yet), next-week priorities derived from real scale/pause
 * + risk signals (capped at 5). No LLM call anywhere — deterministic from edge metrics/P&L data.
 *
 * Exit codes: 0 ok, 2 invalid input (no --product, no edge URL/token, malformed --pnl-fixture),
 * 17 edge request failed.
 */
export async function runReportWeekly(opts: ReportWeeklyOptions, deps: ReportWeeklyDeps = {}): Promise<number> {
  if (opts.product.length === 0) {
    printOutput(buildOutput('report weekly', false, undefined, ['at least one --product is required']), opts.json);
    return 2;
  }

  const edgeUrl = opts.edgeUrl ?? process.env.APPFORGE_EDGE_URL;
  const edgeToken = opts.edgeToken ?? process.env.APPFORGE_EDGE_TOKEN;
  if (!edgeUrl) {
    printOutput(buildOutput('report weekly', false, undefined, ['no edge URL: pass --edge-url or set APPFORGE_EDGE_URL']), opts.json);
    return 2;
  }
  if (!edgeToken) {
    printOutput(buildOutput('report weekly', false, undefined, ['no edge token: pass --edge-token or set APPFORGE_EDGE_TOKEN']), opts.json);
    return 2;
  }

  let pnlRows: PnlFixtureRows | undefined;
  if (opts.pnlFixture) {
    const loaded = loadPnlFixture(opts.pnlFixture);
    if (!loaded.ok) {
      printOutput(buildOutput('report weekly', false, undefined, [loaded.error]), opts.json);
      return 2;
    }
    pnlRows = loaded.rows;
  }

  let data;
  try {
    data = await gatherReportData({ products: opts.product, since: opts.since, edgeUrl, edgeToken, pnlRows }, { fetcher: deps.fetcher });
  } catch (err) {
    const message = err instanceof EdgeRequestError ? err.message : (err as Error).message;
    printOutput(buildOutput('report weekly', false, undefined, [message]), opts.json);
    return 17;
  }

  const sections = buildWeeklyReportSections(data, opts.since);

  if (opts.json) {
    printOutput(buildOutput('report weekly', true, sections), true);
  } else {
    console.log(renderWeeklyReportText(sections));
  }
  return 0;
}
```

Modify `packages/cli/src/index.ts`:

1. Add import: `import { runReportWeekly } from './commands/report-weekly.js';`
2. Add after the `report daily` subcommand:
```ts
report
  .command('weekly')
  .description('Weekly board report: per-product portfolio table, costs, growth/risk signals, next-week priorities (§29b)')
  .option('--product <id>', 'product id (repeatable)', collect, [] as string[])
  .requiredOption('--since <date>', 'period start date (YYYY-MM-DD, inclusive)')
  .option('--edge-url <url>', 'edge base URL (falls back to APPFORGE_EDGE_URL)')
  .option('--edge-token <token>', 'edge bearer token (falls back to APPFORGE_EDGE_TOKEN)')
  .option('--pnl-fixture <path>', 'path to a JSON file: { revenue: Revenue[], costs: Cost[] } (interim input until P1-15)')
  .option('--json', 'machine-readable output', false)
  .action(async (opts: { product: string[]; since: string; edgeUrl?: string; edgeToken?: string; pnlFixture?: string; json: boolean }) => {
    process.exitCode = await runReportWeekly(opts);
  });
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @appforge/cli exec vitest run tests/report-weekly.integration.test.ts`
Expected: PASS (all 6 tests)

- [ ] **Step 5: Commit**

```bash
git add packages/cli/src/commands/report-weekly.ts packages/cli/tests/report-weekly.integration.test.ts packages/cli/src/index.ts
git commit -m "$(cat <<'EOF'
feat(cli): add appforge report weekly

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 6: `html-template.ts` — `escapeHtml` + `renderDashboardHtml` + contribution trend

**Files:**
- Create: `packages/cli/src/html-template.ts`
- Create: `packages/cli/tests/html-template.test.ts`
- Modify: `packages/cli/src/report-sections.ts` (add `computeContributionTrend`)
- Modify: `packages/cli/tests/report-sections.test.ts`

**Interfaces:**
- Consumes: `formatCents`, `type DailyReportSections` from `./report-sections.js`; `computePnl`, `type Revenue`, `type Cost` from `@appforge/schemas` (for `computeContributionTrend`, added to `report-sections.ts`).
- Produces (for Task 7):
  ```ts
  // html-template.ts
  export function escapeHtml(value: string): string;
  export function renderDashboardHtml(daily: DailyReportSections, trend: TrendPoint[], opts: { generatedAt: string; aiBudgetCents: number }): string;

  // report-sections.ts addition
  export interface TrendPoint { date: string; contributionCents: number; }
  export function computeContributionTrend(pnlRows: PnlFixtureRows | undefined, products: string[], since?: string): TrendPoint[];
  ```

- [ ] **Step 1: Write the failing test**

Create `packages/cli/tests/html-template.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { escapeHtml, renderDashboardHtml } from '../src/html-template.js';
import { buildDailyReportSections } from '../src/report-sections.js';
import type { ReportData } from '../src/report-data.js';

describe('escapeHtml', () => {
  it('escapes <, >, &, ", and \' (Review Focus: dashboard opens in a real browser)', () => {
    expect(escapeHtml(`<script>alert('x')</script>&"`)).toBe('&lt;script&gt;alert(&#39;x&#39;)&lt;/script&gt;&amp;&quot;');
  });
  it('leaves a plain string unchanged', () => {
    expect(escapeHtml('json-workbench')).toBe('json-workbench');
  });
});

describe('renderDashboardHtml', () => {
  it('produces a full HTML document with the generated timestamp and every panel heading', () => {
    const data: ReportData = { products: [], portfolioPnl: null };
    const html = renderDashboardHtml(buildDailyReportSections(data), [], { generatedAt: '2026-09-27T00:00:00.000Z', aiBudgetCents: 10000 });
    expect(html).toMatch(/^<!doctype html>/);
    expect(html).toContain('2026-09-27T00:00:00.000Z');
    expect(html).toContain('Company Health');
    expect(html).toContain('Contribution Trend');
    expect(html).toContain('Pending Approvals');
    expect(html).toContain('no data (Paperclip approvals not wired up yet)');
  });

  it('escapes a malicious product id/metric name embedded in a winner anomaly instead of injecting a tag (Review Focus)', () => {
    const data: ReportData = {
      products: [{
        product: '<img src=x onerror=alert(1)>',
        latestByMetric: {},
        anomalies: [{ product: '<img src=x onerror=alert(1)>', name: 'installs', date: '2026-09-07', value: 1, trailingMean: 1, trailingStdDev: 1, zScore: 1, direction: 'up' }],
        pnl: null,
      }],
      portfolioPnl: null,
    };
    const html = renderDashboardHtml(buildDailyReportSections(data), [], { generatedAt: '2026-09-27T00:00:00.000Z', aiBudgetCents: 10000 });
    expect(html).not.toContain('<img src=x onerror=alert(1)>');
    expect(html).toContain('&lt;img src=x onerror=alert(1)&gt;');
  });

  it('renders a real trend table row when a contribution trend point is given', () => {
    const html = renderDashboardHtml(buildDailyReportSections({ products: [], portfolioPnl: null }), [{ date: '2026-09-05', contributionCents: 250 }], { generatedAt: 'x', aiBudgetCents: 10000 });
    expect(html).toContain('2026-09-05');
    expect(html).toContain('$2.50');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @appforge/cli exec vitest run tests/html-template.test.ts`
Expected: FAIL — `Cannot find module '../src/html-template.js'`

- [ ] **Step 3: Write minimal implementation**

Append to `packages/cli/src/report-sections.ts`:

```ts
import { computePnl } from '@appforge/schemas';
import type { PnlFixtureRows } from './report-data.js';

export interface TrendPoint {
  date: string;
  contributionCents: number;
}

/**
 * Buckets the requested products' matching --pnl-fixture rows by calendar date (occurred_at's
 * date portion) and runs computePnl per day, for the §29b "contribution (30d, trend)" dashboard
 * panel. Returns [] (not a fabricated flat line) when there is no --pnl-fixture at all, or none of
 * its rows match these products/since.
 */
export function computeContributionTrend(pnlRows: PnlFixtureRows | undefined, products: string[], since?: string): TrendPoint[] {
  if (!pnlRows) return [];
  const productSet = new Set(products);
  const revenue = pnlRows.revenue.filter((r) => productSet.has(r.product_id) && (!since || r.occurred_at >= since));
  const costs = pnlRows.costs.filter((c) => c.product_id !== undefined && productSet.has(c.product_id) && (!since || c.occurred_at >= since));

  const dates = new Set<string>();
  for (const r of revenue) dates.add(r.occurred_at.slice(0, 10));
  for (const c of costs) dates.add(c.occurred_at.slice(0, 10));

  return [...dates].sort().map((date) => {
    const dayRevenue = revenue.filter((r) => r.occurred_at.slice(0, 10) === date);
    const dayCosts = costs.filter((c) => c.occurred_at.slice(0, 10) === date);
    return { date, contributionCents: computePnl(dayRevenue, dayCosts).contributionCents };
  });
}
```

Create `packages/cli/src/html-template.ts`:

```ts
import type { DailyReportSections } from './report-sections.js';
import { formatCents, type TrendPoint } from './report-sections.js';

/** Escapes the five HTML-significant characters. Every interpolated string in renderDashboardHtml goes through this — the page opens in a real browser, and product ids/metric names are operator-supplied, not a trusted enum. */
export function escapeHtml(value: string): string {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function renderTrendTable(trend: TrendPoint[]): string {
  if (trend.length === 0) {
    return '<p class="empty">no data (no --pnl-fixture rows in the requested since-window)</p>';
  }
  const rows = trend
    .map((t) => `<tr><td>${escapeHtml(t.date)}</td><td>${escapeHtml(formatCents(t.contributionCents))}</td></tr>`)
    .join('');
  return `<table><thead><tr><th>Date</th><th>Contribution</th></tr></thead><tbody>${rows}</tbody></table>`;
}

function renderAnomalyPanel(items: DailyReportSections['winners'], verb: string): string {
  if (items.length === 0) return '<p class="empty">no anomalies detected</p>';
  const lis = items
    .map((a) => `<li>${escapeHtml(a.product)}: ${escapeHtml(a.name)} ${verb} ${a.value} (mean ${a.trailingMean.toFixed(1)}) on ${escapeHtml(a.date)}</li>`)
    .join('');
  return `<ul>${lis}</ul>`;
}

function renderScalePausePanel(items: DailyReportSections['scalePause']): string {
  if (items.length === 0) return '<p class="empty">no recommendations (insufficient P&amp;L signal)</p>';
  const lis = items.map((r) => `<li>${escapeHtml(r.product)}: ${escapeHtml(r.recommendation)} (${escapeHtml(r.reason)})</li>`).join('');
  return `<ul>${lis}</ul>`;
}

/**
 * Renders the §29b founder dashboard as a single dependency-free static HTML page (a template
 * string, not a frontend framework — this monorepo has none currently). Every interpolated value
 * goes through escapeHtml first (Review Focus: product ids/metric names are operator-supplied).
 * "MRR" from §29b's panel list is intentionally not shown: this repo has no subscription/recurring
 * revenue modeling, so labeling a period P&L snapshot "MRR" would misrepresent it — the Company
 * Health panel instead shows net revenue/contribution/AI-cost-vs-budget for the requested period.
 */
export function renderDashboardHtml(
  daily: DailyReportSections,
  trend: TrendPoint[],
  opts: { generatedAt: string; aiBudgetCents: number }
): string {
  const budgetPct = daily.aiCostCents === null ? null : Math.round((daily.aiCostCents / opts.aiBudgetCents) * 100);

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>AppForge Founder Dashboard</title>
<style>
  body { font-family: system-ui, sans-serif; margin: 2rem; background: #0b0e14; color: #e6e6e6; }
  .panel { background: #151a24; border-radius: 8px; padding: 1rem 1.5rem; margin-bottom: 1.5rem; }
  h1 { font-size: 1.5rem; }
  h2 { font-size: 1.1rem; margin-top: 0; color: #8fd3ff; }
  table { border-collapse: collapse; width: 100%; }
  th, td { text-align: left; padding: 0.25rem 0.75rem; border-bottom: 1px solid #2a3040; }
  .empty { color: #8a8f9c; font-style: italic; }
  .stat { display: inline-block; margin-right: 2rem; }
  .stat .label { display: block; color: #8a8f9c; font-size: 0.8rem; }
  .stat .value { font-size: 1.3rem; }
</style>
</head>
<body>
<h1>AppForge Founder Dashboard</h1>
<p class="empty">generated ${escapeHtml(opts.generatedAt)}${daily.since ? ` &middot; since ${escapeHtml(daily.since)}` : ''}</p>

<div class="panel">
  <h2>Company Health</h2>
  <div class="stat"><span class="label">Net revenue</span><span class="value">${escapeHtml(formatCents(daily.revenueCents))}</span></div>
  <div class="stat"><span class="label">Contribution</span><span class="value">${escapeHtml(formatCents(daily.contributionCents))}</span></div>
  <div class="stat"><span class="label">AI cost vs budget</span><span class="value">${escapeHtml(formatCents(daily.aiCostCents))} / ${escapeHtml(formatCents(opts.aiBudgetCents))}${budgetPct === null ? '' : ` (${budgetPct}%)`}</span></div>
  <div class="stat"><span class="label">Products tracked</span><span class="value">${daily.productsTracked}</span></div>
</div>

<div class="panel"><h2>Contribution Trend</h2>${renderTrendTable(trend)}</div>
<div class="panel"><h2>Winners</h2>${renderAnomalyPanel(daily.winners, 'up to')}</div>
<div class="panel"><h2>Risks</h2>${renderAnomalyPanel(daily.risks, 'down to')}</div>
<div class="panel"><h2>Products to Scale / Pause</h2>${renderScalePausePanel(daily.scalePause)}</div>
<div class="panel"><h2>Pending Approvals</h2><p class="empty">no data (Paperclip approvals not wired up yet)</p></div>
</body>
</html>
`;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @appforge/cli exec vitest run tests/html-template.test.ts tests/report-sections.test.ts`
Expected: PASS (all tests, including new `computeContributionTrend` coverage — add the following cases to `report-sections.test.ts` before running):

Append to `packages/cli/tests/report-sections.test.ts`:

```ts
import { computeContributionTrend } from '../src/report-sections.js';

describe('computeContributionTrend', () => {
  it('returns [] when no --pnl-fixture is given (Review Focus: no fabricated flat line)', () => {
    expect(computeContributionTrend(undefined, ['p1'])).toEqual([]);
  });

  it('buckets by date and computes contribution per day for the requested products only', () => {
    const pnlRows = {
      revenue: [
        { id: 'r1', product_id: 'p1', provider: 'gumroad', gross_cents: 1000, fee_cents: 0, refund_cents: 0, tax_cents: 0, currency: 'usd', occurred_at: '2026-09-05' },
        { id: 'r2', product_id: 'other', provider: 'gumroad', gross_cents: 9999, fee_cents: 0, refund_cents: 0, tax_cents: 0, currency: 'usd', occurred_at: '2026-09-05' },
      ],
      costs: [{ id: 'c1', product_id: 'p1', category: 'ai' as const, amount_cents: 100, occurred_at: '2026-09-05' }],
    };
    expect(computeContributionTrend(pnlRows, ['p1'])).toEqual([{ date: '2026-09-05', contributionCents: 900 }]);
  });
});
```

- [ ] **Step 5: Commit**

```bash
git add packages/cli/src/html-template.ts packages/cli/tests/html-template.test.ts packages/cli/src/report-sections.ts packages/cli/tests/report-sections.test.ts
git commit -m "$(cat <<'EOF'
feat(cli): add dashboard HTML template + contribution trend

Dependency-free template string, escapes every interpolated value.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 7: `appforge report dashboard`

**Files:**
- Create: `packages/cli/src/commands/report-dashboard.ts`
- Create: `packages/cli/tests/report-dashboard.integration.test.ts`
- Modify: `packages/cli/src/index.ts`

**Interfaces:**
- Consumes: `gatherReportData`, `EdgeRequestError`, `type PnlFixtureRows` from `../report-data.js`; `buildDailyReportSections` from `../report-sections.js`; `computeContributionTrend` from `../report-sections.js`; `renderDashboardHtml` from `../html-template.js`; `type EdgeFetcher` from `../edge-client.js`; `buildOutput`, `printOutput` from `../output.js`.
- Produces:
  ```ts
  export interface ReportDashboardOptions {
    product: string[];
    since?: string;
    edgeUrl?: string;
    edgeToken?: string;
    pnlFixture?: string;
    aiBudgetCents: number;
    out: string;
    json: boolean;
  }
  export interface ReportDashboardDeps { fetcher?: EdgeFetcher; now?: () => Date; }
  export async function runReportDashboard(opts: ReportDashboardOptions, deps?: ReportDashboardDeps): Promise<number>;
  ```
  Exit codes: `0` ok, `2` invalid input (no `--product`, no edge URL/token, malformed `--pnl-fixture`, unwritable `--out` path), `17` edge request failed. On success, JSON mode prints `{ok: true, data: {path}}`; non-JSON mode prints the usual `printOutput` confirmation line (the real output is the file at `--out`, not stdout).

- [ ] **Step 1: Write the failing test**

Create `packages/cli/tests/report-dashboard.integration.test.ts`:

```ts
import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, readFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { runReportDashboard } from '../src/commands/report-dashboard.js';
import type { EdgeFetcher } from '../src/edge-client.js';

const FIXTURE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), './report-pnl-fixture.json');

let dir: string;
beforeAll(() => { dir = mkdtempSync(path.join(tmpdir(), 'appforge-cli-report-dashboard-')); });
afterAll(() => { rmSync(dir, { recursive: true, force: true }); });

function emptyFetcher(): EdgeFetcher {
  return { fetch: vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ metrics: [] }) })) };
}

const FIXED_NOW = () => new Date('2026-09-27T12:00:00.000Z');

describe('runReportDashboard', () => {
  it('returns 2 when no --product is given', async () => {
    const out = path.join(dir, 'a.html');
    const code = await runReportDashboard({ product: [], out, aiBudgetCents: 10000, json: true }, { fetcher: emptyFetcher(), now: FIXED_NOW });
    expect(code).toBe(2);
    expect(existsSync(out)).toBe(false);
  });

  it('writes a full HTML page to --out and returns 0 with a cli-output@1 {path} confirmation in --json mode', async () => {
    const out = path.join(dir, 'dashboard.html');
    const code = await runReportDashboard(
      { product: ['json-workbench'], since: '2026-09-01', pnlFixture: FIXTURE, out, aiBudgetCents: 10000, json: true },
      { fetcher: emptyFetcher(), now: FIXED_NOW }
    );
    expect(code).toBe(0);
    expect(existsSync(out)).toBe(true);
    const html = readFileSync(out, 'utf8');
    expect(html).toMatch(/^<!doctype html>/);
    expect(html).toContain('2026-09-27T12:00:00.000Z');
    expect(html).toContain('$8.65'); // net revenue from the shared fixture
  });

  it('returns 17 when the edge rejects the token and writes no file', async () => {
    const out = path.join(dir, 'should-not-exist.html');
    const fetcher: EdgeFetcher = { fetch: vi.fn(async () => ({ ok: false, status: 401, json: async () => ({}) })) };
    const code = await runReportDashboard({ product: ['json-workbench'], out, aiBudgetCents: 10000, json: true }, { fetcher, now: FIXED_NOW });
    expect(code).toBe(17);
    expect(existsSync(out)).toBe(false);
  });

  it('returns 2 for a malformed --pnl-fixture', async () => {
    const out = path.join(dir, 'b.html');
    const code = await runReportDashboard(
      { product: ['json-workbench'], pnlFixture: path.join(dir, 'nope.json'), out, aiBudgetCents: 10000, json: true },
      { fetcher: emptyFetcher(), now: FIXED_NOW }
    );
    expect(code).toBe(2);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @appforge/cli exec vitest run tests/report-dashboard.integration.test.ts`
Expected: FAIL — `Cannot find module '../src/commands/report-dashboard.js'`

- [ ] **Step 3: Write minimal implementation**

Create `packages/cli/src/commands/report-dashboard.ts`:

```ts
import { readFileSync, writeFileSync } from 'node:fs';
import { gatherReportData, EdgeRequestError, type PnlFixtureRows } from '../report-data.js';
import { buildDailyReportSections, computeContributionTrend } from '../report-sections.js';
import { renderDashboardHtml } from '../html-template.js';
import type { EdgeFetcher } from '../edge-client.js';
import { buildOutput, printOutput } from '../output.js';

export interface ReportDashboardOptions {
  product: string[];
  since?: string;
  edgeUrl?: string;
  edgeToken?: string;
  pnlFixture?: string;
  aiBudgetCents: number;
  out: string;
  json: boolean;
}

export interface ReportDashboardDeps {
  fetcher?: EdgeFetcher;
  /** Injected only by tests; the real CLI defaults to the real clock. */
  now?: () => Date;
}

function isPnlFixture(value: unknown): value is PnlFixtureRows {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Record<string, unknown>;
  return Array.isArray(v.revenue) && Array.isArray(v.costs);
}

function loadPnlFixture(filePath: string): { ok: true; rows: PnlFixtureRows } | { ok: false; error: string } {
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(filePath, 'utf8'));
  } catch (err) {
    return { ok: false, error: `cannot read/parse ${filePath}: ${(err as Error).message}` };
  }
  if (!isPnlFixture(parsed)) {
    return { ok: false, error: `${filePath} must contain { revenue: Revenue[], costs: Cost[] }` };
  }
  return { ok: true, rows: parsed };
}

/**
 * Generates the §29b static founder dashboard HTML page and writes it to --out. Plain
 * dependency-free template string (packages/cli/src/html-template.ts) — no frontend framework.
 * Not itself a cli-output@1 payload (its real output is the HTML file), but still prints a
 * cli-output@1 {ok, data: {path}} confirmation, always in --json mode and as the normal
 * printOutput pass/fail line otherwise.
 *
 * Exit codes: 0 ok, 2 invalid input (no --product, no edge URL/token, malformed --pnl-fixture, or
 * --out is not writable), 17 edge request failed.
 */
export async function runReportDashboard(opts: ReportDashboardOptions, deps: ReportDashboardDeps = {}): Promise<number> {
  if (opts.product.length === 0) {
    printOutput(buildOutput('report dashboard', false, undefined, ['at least one --product is required']), opts.json);
    return 2;
  }

  const edgeUrl = opts.edgeUrl ?? process.env.APPFORGE_EDGE_URL;
  const edgeToken = opts.edgeToken ?? process.env.APPFORGE_EDGE_TOKEN;
  if (!edgeUrl) {
    printOutput(buildOutput('report dashboard', false, undefined, ['no edge URL: pass --edge-url or set APPFORGE_EDGE_URL']), opts.json);
    return 2;
  }
  if (!edgeToken) {
    printOutput(buildOutput('report dashboard', false, undefined, ['no edge token: pass --edge-token or set APPFORGE_EDGE_TOKEN']), opts.json);
    return 2;
  }

  let pnlRows: PnlFixtureRows | undefined;
  if (opts.pnlFixture) {
    const loaded = loadPnlFixture(opts.pnlFixture);
    if (!loaded.ok) {
      printOutput(buildOutput('report dashboard', false, undefined, [loaded.error]), opts.json);
      return 2;
    }
    pnlRows = loaded.rows;
  }

  let data;
  try {
    data = await gatherReportData({ products: opts.product, since: opts.since, edgeUrl, edgeToken, pnlRows }, { fetcher: deps.fetcher });
  } catch (err) {
    const message = err instanceof EdgeRequestError ? err.message : (err as Error).message;
    printOutput(buildOutput('report dashboard', false, undefined, [message]), opts.json);
    return 17;
  }

  const sections = buildDailyReportSections(data, opts.since);
  const trend = computeContributionTrend(pnlRows, opts.product, opts.since);
  const generatedAt = (deps.now ?? (() => new Date()))().toISOString();
  const html = renderDashboardHtml(sections, trend, { generatedAt, aiBudgetCents: opts.aiBudgetCents });

  try {
    writeFileSync(opts.out, html, 'utf8');
  } catch (err) {
    printOutput(buildOutput('report dashboard', false, undefined, [`cannot write ${opts.out}: ${(err as Error).message}`]), opts.json);
    return 2;
  }

  printOutput(buildOutput('report dashboard', true, { path: opts.out }), opts.json);
  return 0;
}
```

Modify `packages/cli/src/index.ts`:

1. Add import: `import { runReportDashboard } from './commands/report-dashboard.js';`
2. Add after the `report weekly` subcommand:
```ts
report
  .command('dashboard')
  .description('Generate a static HTML founder dashboard page (§29b) from edge metrics/P&L data')
  .option('--product <id>', 'product id (repeatable)', collect, [] as string[])
  .requiredOption('--out <path>', 'output HTML file path')
  .option('--since <date>', 'only include P&L rows on/after this date (YYYY-MM-DD)')
  .option('--edge-url <url>', 'edge base URL (falls back to APPFORGE_EDGE_URL)')
  .option('--edge-token <token>', 'edge bearer token (falls back to APPFORGE_EDGE_TOKEN)')
  .option('--pnl-fixture <path>', 'path to a JSON file: { revenue: Revenue[], costs: Cost[] } (interim input until P1-15)')
  .option('--ai-budget-cents <cents>', 'AI spend budget for the period, in cents', '10000')
  .option('--json', 'machine-readable output', false)
  .action(async (opts: { product: string[]; out: string; since?: string; edgeUrl?: string; edgeToken?: string; pnlFixture?: string; aiBudgetCents: string; json: boolean }) => {
    process.exitCode = await runReportDashboard({ ...opts, aiBudgetCents: Number(opts.aiBudgetCents) });
  });
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @appforge/cli exec vitest run tests/report-dashboard.integration.test.ts`
Expected: PASS (all 4 tests)

- [ ] **Step 5: Commit**

```bash
git add packages/cli/src/commands/report-dashboard.ts packages/cli/tests/report-dashboard.integration.test.ts packages/cli/src/index.ts
git commit -m "$(cat <<'EOF'
feat(cli): add appforge report dashboard

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 8: Full verification

**Files:** none (verification only).

- [ ] **Step 1:** Run `pnpm install` from repo root.
- [ ] **Step 2:** Run `pnpm typecheck` from repo root. Fix any type errors surfaced across `packages/cli`.
- [ ] **Step 3:** Run `pnpm build` from repo root.
- [ ] **Step 4:** Run `pnpm test` from repo root. All suites (including `apps/edge`'s isolated Vitest-4 suite) must pass.
- [ ] **Step 5:** Run `pnpm lint` from repo root.
- [ ] **Step 6:** Manually smoke-test the built binary once:
```bash
node packages/cli/dist/index.js report daily --product json-workbench --edge-url https://example.invalid --edge-token t --json
```
Expected: exits non-zero with an edge-request error (no real edge running) — confirms the binary wiring (commander → `runReportDaily`) works end-to-end, not just the unit-level `run*` functions.
- [ ] **Step 7:** Commit any fixes from this task with a descriptive message (only if verification surfaced something to fix — otherwise skip committing).
