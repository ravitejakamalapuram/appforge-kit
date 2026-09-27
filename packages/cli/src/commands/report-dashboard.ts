import { writeFileSync } from 'node:fs';
import { gatherReportData, EdgeRequestError, type PnlFixtureRows } from '../report-data.js';
import { loadPnlFixture } from '../pnl-fixture.js';
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
      printOutput(buildOutput('report dashboard', false, undefined, loaded.errors), opts.json);
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
