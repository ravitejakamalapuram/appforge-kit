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
