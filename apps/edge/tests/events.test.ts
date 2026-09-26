import { describe, it, expect, beforeEach } from 'vitest';
import { env, SELF } from 'cloudflare:test';
import { applySchema } from './test-helpers.js';

function envelope(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    v: 1, product: 'json-workbench', app_version: '0.2.0', env: 'dev',
    install_id: 'install-1', session_id: 'session-1', ts: 1_700_000_000_000,
    event: 'feature_used', props: { feature: 'pipeline_run', ok: true }, seq: 0,
    ...overrides,
  };
}

async function post(body: unknown) {
  return SELF.fetch('https://example.com/v1/events', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'CF-Connecting-IP': '203.0.113.1' },
    body: JSON.stringify(body),
  });
}

beforeEach(async () => {
  await applySchema(env.DB);
});

describe('POST /v1/events', () => {
  it('accepts a valid batch and writes it to events_raw', async () => {
    const response = await post([envelope()]);
    expect(response.status).toBe(202);
    expect(await response.json()).toEqual({ accepted: 1 });
    const row = await env.DB.prepare('SELECT * FROM events_raw WHERE install_id = ?').bind('install-1').first();
    expect(row?.event).toBe('feature_used');
  });

  it('replaying the exact same batch twice does not double-count (Review Focus: idempotent retry)', async () => {
    await post([envelope()]);
    await post([envelope()]);
    const { results } = await env.DB.prepare('SELECT * FROM events_raw WHERE install_id = ?').bind('install-1').all();
    expect(results).toHaveLength(1);
  });

  it('drops an event whose name is not in the product allowlist, without erroring the batch (Review Focus)', async () => {
    const response = await post([envelope({ event: 'totally_made_up_event' })]);
    expect(response.status).toBe(202);
    expect(await response.json()).toEqual({ accepted: 0 });
    const { results } = await env.DB.prepare('SELECT * FROM events_raw').all();
    expect(results).toHaveLength(0);
  });

  it('strips an undeclared prop before writing, keeping only allowlisted ones (Review Focus)', async () => {
    await post([envelope({ props: { feature: 'pipeline_run', ok: true, secret_debug_info: 'leaked' } })]);
    const row = await env.DB.prepare('SELECT props FROM events_raw WHERE install_id = ?').bind('install-1').first();
    expect(JSON.parse(row!.props as string)).toEqual({ feature: 'pipeline_run', ok: true });
  });

  it('rejects a batch over the 50-event limit with 400, not a silent truncation (Review Focus)', async () => {
    const batch = Array.from({ length: 51 }, (_, i) => envelope({ seq: i }));
    const response = await post(batch);
    expect(response.status).toBe(400);
    const { results } = await env.DB.prepare('SELECT * FROM events_raw').all();
    expect(results).toHaveLength(0);
  });

  it('returns 400 for malformed JSON instead of crashing (Review Focus)', async () => {
    const response = await SELF.fetch('https://example.com/v1/events', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{not json',
    });
    expect(response.status).toBe(400);
  });

  it('returns 400 when the body is not an array', async () => {
    const response = await post(envelope());
    expect(response.status).toBe(400);
  });

  it('returns 429 once the per-IP rate limit is exceeded, at the exact boundary (Review finding: the limiter is a module-level singleton shared across every test in this file, and every other test above also posts from 203.0.113.1 — a distinct IP here is required for this test to prove anything about the actual 60/min threshold rather than just "eventually, some 429 happens")', async () => {
    const ip = '203.0.113.42';
    async function postFrom(body: unknown) {
      return SELF.fetch('https://example.com/v1/events', {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'CF-Connecting-IP': ip },
        body: JSON.stringify(body),
      });
    }
    let lastStatus = 0;
    for (let i = 0; i < 60; i++) {
      lastStatus = (await postFrom([envelope({ install_id: 'rate-limit-test', seq: i })])).status;
    }
    expect(lastStatus).toBe(202);
    const response = await postFrom([envelope({ install_id: 'rate-limit-test', seq: 60 })]);
    expect(response.status).toBe(429);
  });
});
