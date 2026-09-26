import { readFileSync } from 'node:fs';
import { checkContentSecurityPolicy } from '@appforge/schemas';
import { buildOutput, printOutput } from '../output.js';

export interface SecurityCspOptions {
  manifestFile: string;
  json: boolean;
}

/** Exit codes: 0 ok, 2 invalid input (unreadable/malformed manifest), 7 CSP/remote-script findings. */
export function runSecurityCsp(opts: SecurityCspOptions): number {
  let manifest: unknown;
  try {
    manifest = JSON.parse(readFileSync(opts.manifestFile, 'utf8'));
  } catch (err) {
    printOutput(
      buildOutput('security-csp', false, undefined, [`cannot read/parse manifest ${opts.manifestFile}: ${(err as Error).message}`]),
      opts.json
    );
    return 2;
  }
  const result = checkContentSecurityPolicy(manifest);
  printOutput(buildOutput('security-csp', result.ok, result, result.errors), opts.json);
  return result.ok ? 0 : 7;
}
