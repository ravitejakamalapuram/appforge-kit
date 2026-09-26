import { describe, it, expect } from 'vitest';
import { checkContentSecurityPolicy } from '../src/csp-check.js';

const VANILLA_TEMPLATE_MANIFEST = {
  manifest_version: 3,
  name: 'AppForge Chrome Template (Vanilla)',
  version: '0.1.0',
  background: { service_worker: 'service-worker-loader.js', type: 'module' },
  chrome_url_overrides: { newtab: 'src/newtab/index.html' },
  permissions: ['storage'],
  content_security_policy: { extension_pages: "script-src 'self'; object-src 'self'" },
};

describe('checkContentSecurityPolicy', () => {
  it('passes a manifest shaped like this repo\'s real chrome-vanilla template build (Review Focus: no false positive)', () => {
    expect(checkContentSecurityPolicy(VANILLA_TEMPLATE_MANIFEST)).toEqual({ ok: true, errors: [] });
  });

  it('passes a minimal manifest with no content_security_policy, background, or content_scripts at all', () => {
    expect(checkContentSecurityPolicy({ manifest_version: 3, name: 'x', version: '1.0.0' })).toEqual({ ok: true, errors: [] });
  });

  it('rejects unsafe-eval in content_security_policy.extension_pages', () => {
    const result = checkContentSecurityPolicy({
      ...VANILLA_TEMPLATE_MANIFEST,
      content_security_policy: { extension_pages: "script-src 'self' 'unsafe-eval'" },
    });
    expect(result.ok).toBe(false);
    expect(result.errors[0]).toContain('unsafe-eval');
  });

  it('rejects unsafe-inline in content_security_policy.extension_pages', () => {
    const result = checkContentSecurityPolicy({
      ...VANILLA_TEMPLATE_MANIFEST,
      content_security_policy: { extension_pages: "script-src 'self' 'unsafe-inline'" },
    });
    expect(result.ok).toBe(false);
    expect(result.errors[0]).toContain('unsafe-inline');
  });

  it('rejects unsafe-eval in content_security_policy.sandbox', () => {
    const result = checkContentSecurityPolicy({
      ...VANILLA_TEMPLATE_MANIFEST,
      content_security_policy: { extension_pages: "script-src 'self'", sandbox: "sandbox allow-scripts; script-src 'self' 'unsafe-eval'" },
    });
    expect(result.ok).toBe(false);
    expect(result.errors.some((e) => e.includes('sandbox') && e.includes('unsafe-eval'))).toBe(true);
  });

  it('rejects a remote background.service_worker, but allows the real relative one (Review Focus: no false positive)', () => {
    expect(checkContentSecurityPolicy(VANILLA_TEMPLATE_MANIFEST).ok).toBe(true);
    const remote = checkContentSecurityPolicy({
      ...VANILLA_TEMPLATE_MANIFEST,
      background: { service_worker: 'https://evil.example.com/sw.js' },
    });
    expect(remote.ok).toBe(false);
    expect(remote.errors[0]).toContain('background.service_worker');
  });

  it('rejects a protocol-relative remote content_scripts[].js entry', () => {
    const result = checkContentSecurityPolicy({
      ...VANILLA_TEMPLATE_MANIFEST,
      content_scripts: [{ matches: ['<all_urls>'], js: ['//evil.example.com/inject.js'] }],
    });
    expect(result.ok).toBe(false);
    expect(result.errors[0]).toContain('content_scripts[0].js');
  });

  it('allows a relative content_scripts[].js entry', () => {
    const result = checkContentSecurityPolicy({
      ...VANILLA_TEMPLATE_MANIFEST,
      content_scripts: [{ matches: ['<all_urls>'], js: ['content.js'] }],
    });
    expect(result).toEqual({ ok: true, errors: [] });
  });

  it('accumulates multiple errors instead of stopping at the first', () => {
    const result = checkContentSecurityPolicy({
      ...VANILLA_TEMPLATE_MANIFEST,
      content_security_policy: { extension_pages: "script-src 'unsafe-eval'" },
      background: { service_worker: 'http://evil.example.com/sw.js' },
    });
    expect(result.ok).toBe(false);
    expect(result.errors).toHaveLength(2);
  });

  it('rejects a non-object manifest instead of crashing', () => {
    expect(checkContentSecurityPolicy(null)).toEqual({ ok: false, errors: ['manifest must be a JSON object'] });
    expect(checkContentSecurityPolicy('nope')).toEqual({ ok: false, errors: ['manifest must be a JSON object'] });
  });

  it('does not crash on a malformed content_scripts entry (not an object, or js missing)', () => {
    expect(checkContentSecurityPolicy({ ...VANILLA_TEMPLATE_MANIFEST, content_scripts: ['not-an-object', {}] })).toEqual({ ok: true, errors: [] });
  });
});
