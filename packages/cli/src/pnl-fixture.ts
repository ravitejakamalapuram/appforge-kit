import { readFileSync } from 'node:fs';
import type { Revenue, Cost } from '@appforge/schemas';

/**
 * Shared `{ revenue: Revenue[], costs: Cost[] }` fixture file format used by every command that
 * takes `--pnl-fixture`/`--fixture` as an interim P&L data source until P1-15 wires up real D1
 * ingestion (`metrics pnl`, `report daily|weekly|dashboard`). Row-level validation lives here once
 * so a malformed row (a string amount, an unknown cost category, a missing required field) fails
 * loudly with exit 2 everywhere this shape is read, instead of `computePnl` silently summing
 * `undefined` into `NaN` or string-concatenating a quoted amount in some callers but not others.
 */
export interface PnlFixtureRows {
  revenue: Revenue[];
  costs: Cost[];
}

function isPnlFixture(value: unknown): value is PnlFixtureRows {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Record<string, unknown>;
  return Array.isArray(v.revenue) && Array.isArray(v.costs);
}

const COST_CATEGORIES: ReadonlySet<string> = new Set<Cost['category']>(['ai', 'infra', 'marketing', 'support', 'other']);

function validateFixtureRows(fixture: PnlFixtureRows): string[] {
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
 * Reads and fully validates a `--pnl-fixture`/`--fixture` file: JSON parse, top-level shape, and
 * per-row field validation (see `validateFixtureRows`). Returns every problem found, not just the
 * first, so a caller can report them all in one pass.
 */
export function loadPnlFixture(filePath: string): { ok: true; rows: PnlFixtureRows } | { ok: false; errors: string[] } {
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(filePath, 'utf8'));
  } catch (err) {
    return { ok: false, errors: [`cannot read/parse ${filePath}: ${(err as Error).message}`] };
  }
  if (!isPnlFixture(parsed)) {
    return { ok: false, errors: [`${filePath} must contain { revenue: Revenue[], costs: Cost[] }`] };
  }
  const rowErrors = validateFixtureRows(parsed);
  if (rowErrors.length > 0) {
    return { ok: false, errors: rowErrors.map((e) => `${filePath}: ${e}`) };
  }
  return { ok: true, rows: parsed };
}
