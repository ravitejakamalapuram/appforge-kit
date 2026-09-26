import { readFileSync } from 'node:fs';
import { canTransition, PRODUCT_STATES, type ProductState } from '@appforge/schemas';
import { buildOutput, printOutput } from '../output.js';

export interface ProductTransitionOptions {
  from: ProductState;
  to: ProductState;
  evidenceFile?: string;
  approved: boolean;
  json: boolean;
}

function isPlainEvidenceObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Exit codes: 0 ok, 2 invalid input (unreadable/malformed evidence file, or a --from/--to that
 * is not a real ProductState), 8 transition not allowed.
 */
export function runProductTransition(opts: ProductTransitionOptions): number {
  if (!PRODUCT_STATES.includes(opts.from) || !PRODUCT_STATES.includes(opts.to)) {
    const bad = !PRODUCT_STATES.includes(opts.from) ? opts.from : opts.to;
    printOutput(
      buildOutput('product-transition', false, undefined, [
        `"${bad}" is not a valid product state. Valid states (case-sensitive): ${PRODUCT_STATES.join(', ')}`,
      ]),
      opts.json
    );
    return 2;
  }

  let evidence: Record<string, unknown> = {};
  if (opts.evidenceFile) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(readFileSync(opts.evidenceFile, 'utf8'));
    } catch (err) {
      printOutput(buildOutput('product-transition', false, undefined, [`cannot read/parse ${opts.evidenceFile}: ${(err as Error).message}`]), opts.json);
      return 2;
    }
    if (!isPlainEvidenceObject(parsed)) {
      printOutput(buildOutput('product-transition', false, undefined, [`${opts.evidenceFile} must contain a JSON object, got ${Array.isArray(parsed) ? 'an array' : parsed === null ? 'null' : typeof parsed}`]), opts.json);
      return 2;
    }
    evidence = parsed;
  }
  const result = canTransition(opts.from, opts.to, evidence, opts.approved);
  printOutput(buildOutput('product-transition', result.ok, { rule: result.rule }, result.missing), opts.json);
  return result.ok ? 0 : 8;
}
