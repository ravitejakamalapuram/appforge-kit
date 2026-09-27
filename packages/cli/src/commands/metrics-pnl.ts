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

const COST_CATEGORIES: ReadonlySet<string> = new Set<Cost['category']>(['ai', 'infra', 'marketing', 'support', 'other']);

/**
 * Row-level validation so a malformed fixture fails loudly (exit 2) instead of computePnl summing
 * `undefined` into NaN (serialized as null money fields under ok:true), string-concatenating a
 * quoted amount, or silently dropping a cost whose category is misspelled.
 */
function validateFixtureRows(fixture: PnlFixture): string[] {
  const errors: string[] = [];
  const isObject = (row: unknown): row is Record<string, unknown> => typeof row === 'object' && row !== null && !Array.isArray(row);
  const requireString = (row: Record<string, unknown>, at: string, field: string) => {
    if (typeof row[field] !== 'string') errors.push(`${at}.${field} must be a string`);
  };
  const requireCents = (row: Record<string, unknown>, at: string, field: string) => {
    if (!Number.isInteger(row[field])) errors.push(`${at}.${field} must be an integer number of cents`);
  };

  fixture.revenue.forEach((row: unknown, i) => {
    const at = `revenue[${i}]`;
    if (!isObject(row)) {
      errors.push(`${at} must be an object`);
      return;
    }
    requireString(row, at, 'product_id');
    requireString(row, at, 'occurred_at');
    for (const field of ['gross_cents', 'fee_cents', 'refund_cents', 'tax_cents']) requireCents(row, at, field);
  });

  fixture.costs.forEach((row: unknown, i) => {
    const at = `costs[${i}]`;
    if (!isObject(row)) {
      errors.push(`${at} must be an object`);
      return;
    }
    if (row.product_id !== undefined) requireString(row, at, 'product_id');
    requireString(row, at, 'occurred_at');
    requireCents(row, at, 'amount_cents');
    if (typeof row.category !== 'string' || !COST_CATEGORIES.has(row.category)) {
      errors.push(`${at}.category must be one of ${[...COST_CATEGORIES].join('|')}`);
    }
  });

  return errors;
}

/**
 * Exit codes: 0 ok, 2 invalid input (unreadable/malformed --fixture, a fixture not shaped like
 * { revenue: [], costs: [] }, or any row missing/mistyping a required field), 14 data gap (zero
 * revenue AND zero cost rows match --product + --since after filtering).
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
  const rowErrors = validateFixtureRows(parsed);
  if (rowErrors.length > 0) {
    printOutput(buildOutput('metrics pnl', false, undefined, rowErrors.map((e) => `${opts.fixture}: ${e}`)), opts.json);
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
