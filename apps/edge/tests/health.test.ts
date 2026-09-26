import { describe, it, expect } from 'vitest';
import { SELF } from 'cloudflare:test';

describe('GET /__health', () => {
  it('returns ok: true', async () => {
    const response = await SELF.fetch('https://example.com/__health');
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true });
  });

  it('returns 404 for an unknown path', async () => {
    const response = await SELF.fetch('https://example.com/nope');
    expect(response.status).toBe(404);
  });
});
