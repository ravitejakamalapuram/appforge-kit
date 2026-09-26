import { readFileSync } from 'node:fs';
import { parse as parseYaml } from 'yaml';
import {
  validatePermissions,
  diffPermissions,
  extractManifestPermissions,
  DEFAULT_HIGH_RISK_PERMISSIONS,
} from '@appforge/schemas';
import { buildOutput, printOutput } from '../output.js';

export interface SecurityPermissionsOptions {
  manifestFile: string;
  permissionsFile: string;
  securityFile?: string;
  previousManifestFile?: string;
  json: boolean;
}

function readJsonFile(filePath: string): unknown {
  return JSON.parse(readFileSync(filePath, 'utf8'));
}

/**
 * Exit codes: 0 ok, 2 invalid input (unreadable/malformed manifest, permissions.yaml, or
 * security.yaml — including a permissions.yaml that fails its own schema), 6 findings
 * (an undocumented/unused permission, or a newly added high-risk permission).
 */
export function runSecurityPermissions(opts: SecurityPermissionsOptions): number {
  let manifest: unknown;
  try {
    manifest = readJsonFile(opts.manifestFile);
  } catch (err) {
    printOutput(buildOutput('security-permissions', false, undefined, [`cannot read/parse manifest ${opts.manifestFile}: ${(err as Error).message}`]), opts.json);
    return 2;
  }

  let permissionsDoc: unknown;
  try {
    permissionsDoc = parseYaml(readFileSync(opts.permissionsFile, 'utf8'));
  } catch (err) {
    printOutput(buildOutput('security-permissions', false, undefined, [`cannot read/parse ${opts.permissionsFile}: ${(err as Error).message}`]), opts.json);
    return 2;
  }
  const schemaResult = validatePermissions(permissionsDoc);
  if (!schemaResult.ok) {
    printOutput(buildOutput('security-permissions', false, undefined, schemaResult.errors), opts.json);
    return 2;
  }
  const yamlPermissions = (permissionsDoc as { permissions: { permission: string }[] }).permissions;

  let highRiskList: readonly string[] = DEFAULT_HIGH_RISK_PERMISSIONS;
  if (opts.securityFile) {
    let securityDoc: unknown;
    try {
      securityDoc = parseYaml(readFileSync(opts.securityFile, 'utf8'));
    } catch (err) {
      printOutput(buildOutput('security-permissions', false, undefined, [`cannot read/parse ${opts.securityFile}: ${(err as Error).message}`]), opts.json);
      return 2;
    }
    const list = (securityDoc as { high_risk_permissions?: unknown }).high_risk_permissions;
    highRiskList = Array.isArray(list) ? list : DEFAULT_HIGH_RISK_PERMISSIONS;
  }

  let previousManifest: unknown = {};
  if (opts.previousManifestFile) {
    try {
      previousManifest = readJsonFile(opts.previousManifestFile);
    } catch (err) {
      printOutput(buildOutput('security-permissions', false, undefined, [`cannot read/parse ${opts.previousManifestFile}: ${(err as Error).message}`]), opts.json);
      return 2;
    }
  }

  const manifestPermissions = extractManifestPermissions(manifest);
  const previousManifestPermissions = extractManifestPermissions(previousManifest);
  const result = diffPermissions(manifestPermissions, yamlPermissions, highRiskList, previousManifestPermissions);

  const errors = [
    ...result.missingInYaml.map((p) => `manifest requests "${p}" but it is not documented in permissions.yaml`),
    ...result.missingInManifest.map((p) => `permissions.yaml documents "${p}" but the manifest does not request it`),
    ...result.highRisk.map((p) => `"${p}" is a newly added high-risk permission — needs board approval before this can ship`),
  ];
  printOutput(buildOutput('security-permissions', result.ok, result, errors), opts.json);
  return result.ok ? 0 : 6;
}
