import { describe, it, expect } from 'vitest';
import {
  formatCents,
  buildScalePauseRecommendations,
  buildDailyReportSections,
  renderDailyReportText,
  buildWeeklyReportSections,
  renderWeeklyReportText,
  computeContributionTrend,
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
