import { describe, it, expect } from 'vitest';
import { diffPermissions } from '../src/index.js';

const HIGH_RISK = ['cookies', 'history', 'webRequest', '<all_urls>', '*://*/*'];

describe('diffPermissions', () => {
  it('passes when manifest and yaml match exactly with no high-risk permissions', () => {
    const result = diffPermissions(['storage'], [{ permission: 'storage' }], HIGH_RISK);
    expect(result).toEqual({ ok: true, missingInYaml: [], missingInManifest: [], highRisk: [] });
  });

  it('flags a manifest permission that is not documented in yaml', () => {
    const result = diffPermissions(['storage', 'tabs'], [{ permission: 'storage' }], HIGH_RISK);
    expect(result.ok).toBe(false);
    expect(result.missingInYaml).toEqual(['tabs']);
  });

  it('flags a yaml entry for a permission the manifest does not request', () => {
    const result = diffPermissions(['storage'], [{ permission: 'storage' }, { permission: 'tabs' }], HIGH_RISK);
    expect(result.ok).toBe(false);
    expect(result.missingInManifest).toEqual(['tabs']);
  });

  it('flags a newly added exact-match high-risk permission', () => {
    const result = diffPermissions(['storage', 'cookies'], [{ permission: 'storage' }, { permission: 'cookies' }], HIGH_RISK, ['storage']);
    expect(result.ok).toBe(false);
    expect(result.highRisk).toEqual(['cookies']);
  });

  it('flags a newly added wildcard host permission matched by pattern (Review Focus)', () => {
    const result = diffPermissions(
      ['storage', '*://mail.google.com/*'],
      [{ permission: 'storage' }, { permission: '*://mail.google.com/*' }],
      HIGH_RISK,
      ['storage']
    );
    expect(result.ok).toBe(false);
    expect(result.highRisk).toEqual(['*://mail.google.com/*']);
  });

  it('does not re-flag a high-risk permission that already existed before this change', () => {
    const result = diffPermissions(['storage', 'cookies'], [{ permission: 'storage' }, { permission: 'cookies' }], HIGH_RISK, ['storage', 'cookies']);
    expect(result.highRisk).toEqual([]);
    expect(result.ok).toBe(true);
  });
});
