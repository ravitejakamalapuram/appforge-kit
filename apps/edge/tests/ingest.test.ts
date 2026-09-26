import { describe, it, expect, beforeEach } from 'vitest';
import { env, SELF } from 'cloudflare:test';
import { applySchema } from './test-helpers.js';
import { isAuthorized } from '../src/handlers/ingest.js';

beforeEach(async () => {
  await applySchema(env.DB);
});

describe('isAuthorized', () => {
  it('rejects when the configured admin token is empty (Review finding: fail-open on a missing secret)', () => {
    const request = new Request('https://example.com', { headers: { Authorization: 'Bearer undefined' } });
    expect(isAuthorized(request, '')).toBe(false);
  });

  it('rejects "Bearer undefined" even when the configured token happens to be unset (same finding, direct repro)', () => {
    const request = new Request('https://example.com', { headers: { Authorization: `Bearer ${undefined}` } });
    expect(isAuthorized(request, undefined as unknown as string)).toBe(false);
  });

  it('accepts a real configured token presented correctly', () => {
    const request = new Request('https://example.com', { headers: { Authorization: 'Bearer a-real-32-char-or-longer-token-value' } });
    expect(isAuthorized(request, 'a-real-32-char-or-longer-token-value')).toBe(true);
  });
});

// Hardcoded (matches .dev.vars), not read from env.INGEST_ADMIN_TOKEN — a test that reads its
// expected token from the same binding the server checks against would still pass even if that
// binding were empty/unset, since both sides would agree on "nothing". See the isAuthorized
// unit tests above for why that mattered here.
const VALID_TOKEN = 'dev-only-placeholder-token';

async function post(source: string, body: unknown, token: string = VALID_TOKEN) {
  return SELF.fetch(`https://example.com/v1/ingest/${source}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify(body),
  });
}

describe('POST /v1/ingest/:source', () => {
  it('rejects a request without a valid admin bearer token (Review Focus)', async () => {
    const response = await post(
      'cws_csv',
      [{ product: 'json-workbench', date: '2026-09-01', name: 'installs', value: 12 }],
      'wrong-token'
    );
    expect(response.status).toBe(401);
  });

  it('upserts rows into metrics_daily for an authorized request', async () => {
    const response = await post('cws_csv', [{ product: 'json-workbench', date: '2026-09-01', name: 'installs', value: 12 }]);
    expect(response.status).toBe(202);
    expect(await response.json()).toEqual({ upserted: 1 });
    const row = await env.DB.prepare('SELECT value FROM metrics_daily WHERE product = ? AND date = ?')
      .bind('json-workbench', '2026-09-01')
      .first();
    expect(row?.value).toBe(12);
  });

  it('re-running the same ingest updates the value instead of duplicating the row', async () => {
    await post('cws_csv', [{ product: 'json-workbench', date: '2026-09-01', name: 'installs', value: 12 }]);
    await post('cws_csv', [{ product: 'json-workbench', date: '2026-09-01', name: 'installs', value: 20 }]);
    const { results } = await env.DB.prepare('SELECT value FROM metrics_daily WHERE product = ? AND date = ?')
      .bind('json-workbench', '2026-09-01')
      .all();
    expect(results).toHaveLength(1);
    expect((results[0] as { value: number }).value).toBe(20);
  });

  it('drops an invalid row (bad date format) without failing the whole request', async () => {
    const response = await post('cws_csv', [{ product: 'json-workbench', date: 'not-a-date', name: 'installs', value: 12 }]);
    expect(response.status).toBe(202);
    expect(await response.json()).toEqual({ upserted: 0 });
  });
});
