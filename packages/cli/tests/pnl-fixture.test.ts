import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { loadPnlFixture } from '../src/pnl-fixture.js';

let dir: string;
beforeAll(() => { dir = mkdtempSync(path.join(tmpdir(), 'appforge-cli-pnl-fixture-')); });
afterAll(() => { rmSync(dir, { recursive: true, force: true }); });

function write(name: string, content: string): string {
  const file = path.join(dir, name);
  writeFileSync(file, content);
  return file;
}

describe('loadPnlFixture', () => {
  it('returns ok:true with the parsed rows for a valid fixture', () => {
    const file = write(
      'valid.json',
      JSON.stringify({
        revenue: [{ id: 'r1', product_id: 'p', provider: 'gumroad', gross_cents: 100, fee_cents: 0, refund_cents: 0, tax_cents: 0, currency: 'usd', occurred_at: '2026-09-01' }],
        costs: [],
      })
    );
    const result = loadPnlFixture(file);
    expect(result.ok).toBe(true);
  });

  it('returns ok:false for a nonexistent file', () => {
    const result = loadPnlFixture(path.join(dir, 'nope.json'));
    expect(result.ok).toBe(false);
  });

  it('returns ok:false for malformed JSON', () => {
    const file = write('bad.json', '{not valid json');
    const result = loadPnlFixture(file);
    expect(result.ok).toBe(false);
  });

  it('returns ok:false for a fixture not shaped like { revenue, costs }', () => {
    const file = write('wrong-shape.json', JSON.stringify({ notRevenue: [] }));
    const result = loadPnlFixture(file);
    expect(result.ok).toBe(false);
  });

  it('rejects a cost row with a string amount_cents instead of silently letting computePnl string-concatenate it (Critical finding reproduction)', () => {
    const file = write(
      'string-amount.json',
      JSON.stringify({ revenue: [], costs: [{ id: 'c1', product_id: 'p', category: 'ai', amount_cents: '120', occurred_at: '2026-09-01' }] })
    );
    const result = loadPnlFixture(file);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.join('\n')).toMatch(/costs\[0\]\.amount_cents/);
    }
  });

  it('rejects a cost row with an unknown category', () => {
    const file = write(
      'bad-category.json',
      JSON.stringify({ revenue: [], costs: [{ id: 'c1', product_id: 'p', category: 'Infra', amount_cents: 120, occurred_at: '2026-09-01' }] })
    );
    const result = loadPnlFixture(file);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.join('\n')).toMatch(/costs\[0\]\.category/);
    }
  });

  it('rejects a revenue row missing a required numeric field', () => {
    const file = write(
      'missing-field.json',
      JSON.stringify({ revenue: [{ id: 'r1', product_id: 'p', provider: 'gumroad', fee_cents: 0, refund_cents: 0, tax_cents: 0, currency: 'usd', occurred_at: '2026-09-01' }], costs: [] })
    );
    const result = loadPnlFixture(file);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.join('\n')).toMatch(/revenue\[0\]\.gross_cents/);
    }
  });
});
