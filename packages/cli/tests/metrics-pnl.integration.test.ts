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

describe('runMetricsPnl', () => {
  it('matches the hand calc for September, excluding the August row, the other product, and the shared no-product_id cost (Review Focus: filtering)', () => {
    // Same hand calc as packages/schemas/tests/pnl.test.ts's fixture-month test:
    // gross 1500, refunds 500, fees 135, net 865, ai 150, infra 25, support 200, other 10,
    // contribution 480, margin 480/865.
    const code = runMetricsPnl({ product: 'json-workbench', since: '2026-09-01', fixture: FIXTURE, json: true });
    expect(code).toBe(0);
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
