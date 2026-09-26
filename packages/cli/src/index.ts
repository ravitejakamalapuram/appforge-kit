#!/usr/bin/env node
import { Command } from 'commander';
import { runValidate } from './commands/validate.js';
import { runProductTransition } from './commands/product-transition.js';
import type { ProductState } from '@appforge/schemas';

const program = new Command();
program.name('appforge').version('0.1.0');

program
  .command('validate')
  .description("Validate .appforge/permissions.yaml against the appforge/permissions@1 schema")
  .option('--file <path>', 'path to permissions.yaml', '.appforge/permissions.yaml')
  .option('--json', 'machine-readable output', false)
  .action((opts: { file: string; json: boolean }) => {
    process.exitCode = runValidate(opts);
  });

program
  .command('product-transition')
  .description('Check whether a product state transition is allowed')
  .requiredOption('--from <state>', 'current product state')
  .requiredOption('--to <state>', 'target product state')
  .option('--evidence <path>', 'JSON file of evidence flags')
  .option('--approved', 'a board approval has been verified for this transition', false)
  .option('--json', 'machine-readable output', false)
  .action((opts: { from: string; to: string; evidence?: string; approved: boolean; json: boolean }) => {
    process.exitCode = runProductTransition({
      from: opts.from as ProductState,
      to: opts.to as ProductState,
      evidenceFile: opts.evidence,
      approved: opts.approved,
      json: opts.json,
    });
  });

program.parseAsync(process.argv);
