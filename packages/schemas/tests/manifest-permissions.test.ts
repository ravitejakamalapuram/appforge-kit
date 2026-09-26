import { describe, it, expect } from 'vitest';
import { extractManifestPermissions } from '../src/index.js';

describe('extractManifestPermissions', () => {
  it('flattens permissions, host_permissions, optional_permissions, and optional_host_permissions', () => {
    const manifest = {
      permissions: ['storage', 'alarms'],
      host_permissions: ['https://api.example.com/*'],
      optional_permissions: ['clipboardRead'],
      optional_host_permissions: ['*://*.example.com/*'],
    };
    expect(extractManifestPermissions(manifest)).toEqual([
      'storage', 'alarms', 'https://api.example.com/*', 'clipboardRead', '*://*.example.com/*',
    ]);
  });

  it('returns an empty array when a manifest has no permission fields at all', () => {
    expect(extractManifestPermissions({})).toEqual([]);
  });

  it('ignores a non-array permission field instead of crashing on a malformed manifest', () => {
    expect(extractManifestPermissions({ permissions: 'storage' })).toEqual([]);
  });

  it('handles a manifest with only permissions and no host permissions (the common new-tab-extension shape)', () => {
    expect(extractManifestPermissions({ permissions: ['storage'] })).toEqual(['storage']);
  });
});
