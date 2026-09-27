import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { runMetricsPnl } from '../src/commands/metrics-pnl.js';

const FIXTURE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), './metrics-pnl-fixture.json');

let dir: string;
beforeAll(() => { dir = mkdtempSync(path.join(tmpdir(), 'appforge-cli-metrics-pnl-')); });
afterAll(() => { rmSync(dir, { recursive: true, force: true }); });

function write(name: string, content: string): string {
  const file = path.join(dir, name);
  writeFileSync(file, content);
  return file;
}

function captureStdout(fn: () => number): { code: number; output: { ok: boolean; command: string; data?: Record<string, unknown>; errors: string[] } } {
  const chunks: string[] = [];
  const originalWrite = process.stdout.write.bind(process.stdout);
  process.stdout.write = ((chunk: string) => { chunks.push(chunk); return true; }) as typeof process.stdout.write;
  let code: number;
  try {
    code = fn();
  } finally {
    process.stdout.write = originalWrite;
  }
  return { code, output: JSON.parse(chunks.join('')) };
}

describe('runMetricsPnl', () => {
  it('matches the hand calc for September, excluding the August row, the other product, and the shared no-product_id cost (Review Focus: filtering)', () => {
    // Same hand calc as packages/schemas/tests/pnl.test.ts's fixture-month test:
    // gross 1500, refunds 500, fees 135, net 865, ai 150, infra 25, support 200, other 10,
    // contribution 480, margin 480/865. If the August row (r3, 2000c) leaked in, gross would be
    // 3500; if other-product (r4) leaked in, gross would include 9999; if the shared no-product_id
    // cost (c6, 500c ai) leaked in, ai would be 650.
    const { code, output } = captureStdout(() =>
      runMetricsPnl({ product: 'json-workbench', since: '2026-09-01', fixture: FIXTURE, json: true })
    );
    expect(code).toBe(0);
    expect(output).toMatchObject({ ok: true, command: 'metrics pnl', errors: [] });
    expect(output.data).toMatchObject({
      product: 'json-workbench',
      since: '2026-09-01',
      grossRevenueCents: 1500,
      refundsCents: 500,
      paymentFeesCents: 135,
      netRevenueCents: 865,
      aiCostCents: 150,
      infrastructureCents: 25,
      marketingCents: 0,
      supportCents: 200,
      otherVariableCents: 10,
      contributionCents: 480,
    });
    expect(output.data?.contributionMargin).toBeCloseTo(480 / 865, 10);
  });

  it('returns 2 with a clear cli-output@1 error (not ok:true with null money fields) when a revenue row is missing a required numeric field', () => {
    const bad = write('missing-field.json', JSON.stringify({
      revenue: [{ id: 'r1', product_id: 'json-workbench', provider: 'gumroad', fee_cents: 0, refund_cents: 0, tax_cents: 0, currency: 'usd', occurred_at: '2026-09-02' }],
      costs: [],
    }));
    const { code, output } = captureStdout(() =>
      runMetricsPnl({ product: 'json-workbench', since: '2026-09-01', fixture: bad, json: true })
    );
    expect(code).toBe(2);
    expect(output.ok).toBe(false);
    expect(output.command).toBe('metrics pnl');
    expect(output.errors.join('\n')).toMatch(/revenue\[0\]\.gross_cents/);
  });

  it('returns 2 when a money field is a string (would otherwise string-concatenate in the sum)', () => {
    const bad = write('string-amount.json', JSON.stringify({
      revenue: [],
      costs: [{ id: 'c1', product_id: 'json-workbench', category: 'ai', amount_cents: '120', occurred_at: '2026-09-02' }],
    }));
    const { code, output } = captureStdout(() =>
      runMetricsPnl({ product: 'json-workbench', since: '2026-09-01', fixture: bad, json: true })
    );
    expect(code).toBe(2);
    expect(output.errors.join('\n')).toMatch(/costs\[0\]\.amount_cents/);
  });

  it('returns 2 for a cost row with an unknown category instead of silently dropping it from every line', () => {
    const bad = write('bad-category.json', JSON.stringify({
      revenue: [],
      costs: [{ id: 'c1', product_id: 'json-workbench', category: 'Infra', amount_cents: 120, occurred_at: '2026-09-02' }],
    }));
    const { code, output } = captureStdout(() =>
      runMetricsPnl({ product: 'json-workbench', since: '2026-09-01', fixture: bad, json: true })
    );
    expect(code).toBe(2);
    expect(output.errors.join('\n')).toMatch(/costs\[0\]\.category/);
  });

  it('returns 2 with a metrics pnl error (not a TypeError) when a row is null', () => {
    const bad = write('null-row.json', JSON.stringify({ revenue: [null], costs: [] }));
    const { code, output } = captureStdout(() =>
      runMetricsPnl({ product: 'json-workbench', since: '2026-09-01', fixture: bad, json: true })
    );
    expect(code).toBe(2);
    expect(output.command).toBe('metrics pnl');
    expect(output.errors.join('\n')).toMatch(/revenue\[0\]/);
  });

  it('returns 2 for a fixture path that does not exist', () => {
    const code = runMetricsPnl({ product: 'json-workbench', since: '2026-09-01', fixture: path.join(dir, 'nope.json'), json: true });
    expect(code).toBe(2);
  });

  it('returns 2 for malformed JSON, not a crash', () => {
    const bad = write('bad.json', '{not valid json');
    const code = runMetricsPnl({ product: 'json-workbench', since: '2026-09-01', fixture: bad, json: true });
    expect(code).toBe(2);
  });

  it('returns 2 when the fixture is not shaped like { revenue: [], costs: [] }', () => {
    const bad = write('wrong-shape.json', JSON.stringify({ notRevenue: [] }));
    const code = runMetricsPnl({ product: 'json-workbench', since: '2026-09-01', fixture: bad, json: true });
    expect(code).toBe(2);
  });

  it('returns 14 (data gap) when no revenue or cost rows match product+since (Review Focus: empty-after-filter)', () => {
    const empty = write('empty.json', JSON.stringify({ revenue: [], costs: [] }));
    const code = runMetricsPnl({ product: 'json-workbench', since: '2026-09-01', fixture: empty, json: true });
    expect(code).toBe(14);
  });

  it('returns 14 for a product that exists in the fixture but not in the requested since-range', () => {
    const code = runMetricsPnl({ product: 'json-workbench', since: '2027-01-01', fixture: FIXTURE, json: true });
    expect(code).toBe(14);
  });

  it('returns 14 for a product not present in the fixture at all', () => {
    const code = runMetricsPnl({ product: 'nonexistent-product', since: '2026-09-01', fixture: FIXTURE, json: true });
    expect(code).toBe(14);
  });
});
