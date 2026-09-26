export interface PermissionDiffResult {
  ok: boolean;
  missingInYaml: string[];
  missingInManifest: string[];
  highRisk: string[];
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function matchesHighRiskPattern(pattern: string, value: string): boolean {
  if (pattern === value) return true;
  if (pattern === '<all_urls>') return value === '<all_urls>';
  if (!pattern.includes('*')) return false;
  const regex = new RegExp('^' + pattern.split('*').map(escapeRegExp).join('.*') + '$');
  return regex.test(value);
}

function isHighRisk(permission: string, highRiskList: readonly string[]): boolean {
  return highRiskList.some((pattern) => matchesHighRiskPattern(pattern, permission));
}

export function diffPermissions(
  manifestPermissions: readonly string[],
  yamlPermissions: readonly { permission: string }[],
  highRiskList: readonly string[],
  previousManifestPermissions: readonly string[] = []
): PermissionDiffResult {
  const manifestSet = new Set(manifestPermissions);
  const yamlSet = new Set(yamlPermissions.map((p) => p.permission));
  const previousSet = new Set(previousManifestPermissions);

  const missingInYaml = [...manifestSet].filter((p) => !yamlSet.has(p));
  const missingInManifest = [...yamlSet].filter((p) => !manifestSet.has(p));
  const newlyAdded = [...manifestSet].filter((p) => !previousSet.has(p));
  const highRisk = newlyAdded.filter((p) => isHighRisk(p, highRiskList));

  return {
    ok: missingInYaml.length === 0 && missingInManifest.length === 0 && highRisk.length === 0,
    missingInYaml,
    missingInManifest,
    highRisk,
  };
}
