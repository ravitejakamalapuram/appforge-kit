import { describe, it, expect, beforeEach } from 'vitest';
import { env, SELF } from 'cloudflare:test';
import { applySchema } from './test-helpers.js';

beforeEach(async () => {
  await applySchema(env.DB);
});

async function post(body: unknown) {
  return SELF.fetch('https://example.com/v1/feedback', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'CF-Connecting-IP': '203.0.113.5' },
    body: JSON.stringify(body),
  });
}

describe('POST /v1/feedback', () => {
  it('accepts valid feedback and stores a hash of the text, not the text itself', async () => {
    const response = await post({ product: 'json-workbench', source: 'in_app', rating: 4, text: 'Love the diff view!' });
    expect(response.status).toBe(202);
    const { id } = (await response.json()) as { id: string };
    const row = await env.DB.prepare('SELECT * FROM feedback WHERE id = ?').bind(id).first();
    expect(row?.product).toBe('json-workbench');
    expect(row?.text_hash).not.toBe('Love the diff view!');
    expect(String(row?.text_hash)).toHaveLength(64);
  });

  it('returns 400 when text is missing', async () => {
    const response = await post({ product: 'json-workbench', source: 'in_app', rating: 4 });
    expect(response.status).toBe(400);
  });

  it('returns 400 for malformed JSON', async () => {
    const response = await SELF.fetch('https://example.com/v1/feedback', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{bad',
    });
    expect(response.status).toBe(400);
  });

  it('returns 400 for a rating outside 1-5 (Review finding: rating had no range check)', async () => {
    const response = await post({ product: 'json-workbench', source: 'in_app', rating: 0, text: 'hi' });
    expect(response.status).toBe(400);
  });

  it('returns 400 for a product name longer than 64 characters (Review finding: unbounded field sizes)', async () => {
    const response = await post({ product: 'x'.repeat(65), source: 'in_app', rating: 4, text: 'hi' });
    expect(response.status).toBe(400);
  });

  it('returns 400 for feedback text longer than 2000 characters', async () => {
    const response = await post({ product: 'json-workbench', source: 'in_app', rating: 4, text: 'x'.repeat(2001) });
    expect(response.status).toBe(400);
  });
});
