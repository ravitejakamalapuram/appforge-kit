import { readFileSync } from 'node:fs';
import { computePnl, type Revenue, type Cost } from '@appforge/schemas';
import { buildOutput, printOutput } from '../output.js';

export interface MetricsPnlOptions {
  product: string;
  since: string;
  /**
   * Interim input source until P1-15 wires up real D1-backed revenue/cost ingestion: a JSON file
   * shaped `{ revenue: Revenue[], costs: Cost[] }`. Once P1-15 lands, this flag can stay as a
   * local-testing/offline escape hatch alongside a real `--product`-only mode that queries D1
   * directly through the edge, without changing computePnl's math at all.
   */
  fixture: string;
  json: boolean;
}

interface PnlFixture {
  revenue: Revenue[];
  costs: Cost[];
}

function isPnlFixture(value: unknown): value is PnlFixture {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Record<string, unknown>;
  return Array.isArray(v.revenue) && Array.isArray(v.costs);
}

/**
 * Exit codes: 0 ok, 2 invalid input (unreadable/malformed --fixture, or a fixture not shaped like
 * { revenue: [], costs: [] }), 14 data gap (zero revenue AND zero cost rows match --product +
 * --since after filtering).
 *
 * Filtering ruling: a Cost row with no product_id (a shared/portfolio-level cost per §21.1
 * "allocated share of shared runs") is excluded here — real shared-cost allocation is P1-15's
 * job once real ingestion exists. This command only reports directly product_id-attributed rows.
 */
export function runMetricsPnl(opts: MetricsPnlOptions): number {
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(opts.fixture, 'utf8'));
  } catch (err) {
    printOutput(buildOutput('metrics pnl', false, undefined, [`cannot read/parse ${opts.fixture}: ${(err as Error).message}`]), opts.json);
    return 2;
  }
  if (!isPnlFixture(parsed)) {
    printOutput(buildOutput('metrics pnl', false, undefined, [`${opts.fixture} must contain { revenue: Revenue[], costs: Cost[] }`]), opts.json);
    return 2;
  }

  const revenue = parsed.revenue.filter((r) => r.product_id === opts.product && r.occurred_at >= opts.since);
  const costs = parsed.costs.filter((c) => c.product_id === opts.product && c.occurred_at >= opts.since);

  if (revenue.length === 0 && costs.length === 0) {
    printOutput(
      buildOutput('metrics pnl', false, undefined, [
        `no revenue or cost rows for product "${opts.product}" since ${opts.since} in ${opts.fixture}`,
      ]),
      opts.json
    );
    return 14;
  }

  const pnl = computePnl(revenue, costs);
  printOutput(buildOutput('metrics pnl', true, { product: opts.product, since: opts.since, ...pnl }), opts.json);
  return 0;
}
