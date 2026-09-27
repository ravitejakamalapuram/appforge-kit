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
