import { readFileSync } from 'node:fs';
import { parse as parseYaml } from 'yaml';
import { validatePermissions } from '@appforge/schemas';
import { buildOutput, printOutput } from '../output.js';

export interface ValidateOptions {
  file: string;
  json: boolean;
}

/** Exit codes: 0 ok, 2 invalid input (unreadable/unparseable file), 3 schema validation failed. */
export function runValidate(opts: ValidateOptions): number {
  let doc: unknown;
  try {
    doc = parseYaml(readFileSync(opts.file, 'utf8'));
  } catch (err) {
    printOutput(buildOutput('validate', false, undefined, [`cannot read/parse ${opts.file}: ${(err as Error).message}`]), opts.json);
    return 2;
  }
  const result = validatePermissions(doc);
  printOutput(buildOutput('validate', result.ok, undefined, result.errors), opts.json);
  return result.ok ? 0 : 3;
}
