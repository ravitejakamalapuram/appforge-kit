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
