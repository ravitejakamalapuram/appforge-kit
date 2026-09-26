const PERMISSION_FIELDS = ['permissions', 'host_permissions', 'optional_permissions', 'optional_host_permissions'] as const;

/**
 * Flattens a Chrome MV3 manifest's four permission-bearing fields (required and optional,
 * API and host permissions) into one ordered list, for feeding into `diffPermissions`.
 * Manifest parsing is deliberately kept separate from `diffPermissions` itself (which stays a
 * flat-list diff) so other manifest shapes (e.g. Android) can supply their own extractor later.
 */
export function extractManifestPermissions(manifest: unknown): string[] {
  if (typeof manifest !== 'object' || manifest === null) return [];
  const doc = manifest as Record<string, unknown>;
  const result: string[] = [];
  for (const field of PERMISSION_FIELDS) {
    const value = doc[field];
    if (Array.isArray(value)) {
      for (const entry of value) {
        if (typeof entry === 'string') result.push(entry);
      }
    }
  }
  return result;
}
