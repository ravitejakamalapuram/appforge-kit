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
