import { formatCents, type DailyReportSections, type TrendPoint } from './report-sections.js';

/**
 * Escapes the five HTML-significant characters. Every interpolated string in renderDashboardHtml
 * goes through this — the page opens in a real browser, and product ids/metric names are
 * operator-supplied, not a trusted enum.
 */
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
