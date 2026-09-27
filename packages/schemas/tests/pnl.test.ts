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
