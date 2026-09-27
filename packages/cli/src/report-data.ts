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
