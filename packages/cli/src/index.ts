#!/usr/bin/env node
import { Command, CommanderError } from 'commander';
import { runValidate } from './commands/validate.js';
import { runProductTransition } from './commands/product-transition.js';
import { buildOutput, printOutput } from './output.js';
import type { ProductState } from '@appforge/schemas';

const program = new Command();
program.name('appforge').version('0.1.0');
// Route commander's own usage/help/version handling through exceptions instead of a bare
// process.exit(), so an invalid invocation still gets a cli-output@1-shaped error and the
// exit code appforge validate/product-transition callers rely on (2 = invalid input), not
// commander's default exit(1).
program.exitOverride();

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

try {
  await program.parseAsync(process.argv);
} catch (err) {
  const commanderErr = err as CommanderError;
  const exitCode = typeof commanderErr.exitCode === 'number' ? commanderErr.exitCode : 1;
  // commander's own exitCode 0 covers --help/--version, which already printed what the user
  // asked for; anything else is a usage error and belongs in our own exit-code table as 2.
  if (exitCode === 0) {
    process.exit(0);
  }
  const jsonRequested = process.argv.includes('--json');
  printOutput(buildOutput('appforge', false, undefined, [commanderErr.message ?? 'invalid arguments']), jsonRequested);
  process.exit(2);
}
