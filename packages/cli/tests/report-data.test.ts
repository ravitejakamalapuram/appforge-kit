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
