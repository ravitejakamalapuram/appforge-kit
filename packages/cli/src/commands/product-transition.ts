import { readFileSync } from 'node:fs';
import { canTransition, type ProductState } from '@appforge/schemas';
import { buildOutput, printOutput } from '../output.js';

export interface ProductTransitionOptions {
  from: ProductState;
  to: ProductState;
  evidenceFile?: string;
  approved: boolean;
  json: boolean;
}

/** Exit codes: 0 ok, 2 invalid input (unreadable evidence file when one was given), 8 transition not allowed. */
export function runProductTransition(opts: ProductTransitionOptions): number {
  let evidence: Record<string, unknown> = {};
  if (opts.evidenceFile) {
    try {
      evidence = JSON.parse(readFileSync(opts.evidenceFile, 'utf8'));
    } catch (err) {
      printOutput(buildOutput('product-transition', false, undefined, [`cannot read/parse ${opts.evidenceFile}: ${(err as Error).message}`]), opts.json);
      return 2;
    }
  }
  const result = canTransition(opts.from, opts.to, evidence, opts.approved);
  printOutput(buildOutput('product-transition', result.ok, { rule: result.rule }, result.missing), opts.json);
  return result.ok ? 0 : 8;
}
