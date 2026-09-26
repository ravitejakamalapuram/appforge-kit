import { describe, it, expect } from 'vitest';
import { getAllowlist, filterProps } from '../src/allowlist.js';

describe('allowlist', () => {
  it('returns the json-workbench allowlist', () => {
    const allowlist = getAllowlist('json-workbench');
    expect(allowlist?.allowedEvents.has('feature_used')).toBe(true);
  });

  it('returns undefined for an unknown product', () => {
    expect(getAllowlist('nonexistent-product')).toBeUndefined();
  });

  it('filterProps keeps only allowlisted keys for a known event', () => {
    const allowlist = getAllowlist('json-workbench')!;
    const filtered = filterProps('feature_used', { feature: 'pipeline_run', ok: true, extra: 'drop-me' }, allowlist);
    expect(filtered).toEqual({ feature: 'pipeline_run', ok: true });
  });

  it('filterProps returns {} for an event with no declared props', () => {
    const allowlist = getAllowlist('json-workbench')!;
    expect(filterProps('app_installed', { anything: 1 }, allowlist)).toEqual({});
  });

  it('filterProps drops an allowlisted key whose value is a non-primitive (Review finding: unbounded/nested prop values)', () => {
    const allowlist = getAllowlist('json-workbench')!;
    const filtered = filterProps('feature_used', { feature: { nested: 'object' }, ok: true }, allowlist);
    expect(filtered).toEqual({ ok: true });
  });

  it('filterProps drops an allowlisted string value longer than 500 characters (Review finding)', () => {
    const allowlist = getAllowlist('json-workbench')!;
    const filtered = filterProps('feature_used', { feature: 'x'.repeat(501), ok: true }, allowlist);
    expect(filtered).toEqual({ ok: true });
  });

  it('filterProps keeps a string value at exactly the 500-character limit', () => {
    const allowlist = getAllowlist('json-workbench')!;
    const filtered = filterProps('feature_used', { feature: 'x'.repeat(500), ok: true }, allowlist);
    expect(filtered).toEqual({ feature: 'x'.repeat(500), ok: true });
  });
});
