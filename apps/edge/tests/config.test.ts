import { describe, it, expect, beforeEach } from 'vitest';
import { env, SELF } from 'cloudflare:test';
import { applySchema } from './test-helpers.js';

beforeEach(async () => {
  await applySchema(env.DB);
});

describe('GET /v1/config/:product', () => {
  it('returns an empty object when no config row exists for the product', async () => {
    const response = await SELF.fetch('https://example.com/v1/config/json-workbench');
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({});
  });

  it('returns the stored config JSON for the product', async () => {
    await env.DB.prepare(
      `INSERT INTO product_config (product, config, updated_at) VALUES (?, ?, ?)`
    ).bind('json-workbench', JSON.stringify({ paywallEnabled: false }), new Date().toISOString()).run();
    const response = await SELF.fetch('https://example.com/v1/config/json-workbench');
    expect(await response.json()).toEqual({ paywallEnabled: false });
  });
});
