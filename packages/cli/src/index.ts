#!/usr/bin/env node
import { Command, CommanderError } from 'commander';
import { runValidate } from './commands/validate.js';
import { runProductTransition } from './commands/product-transition.js';
import { runSecurityPermissions } from './commands/security-permissions.js';
import { runTestE2e } from './commands/test-e2e.js';
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

const security = program.command('security').description('Deterministic security checks (no LLM involved)');

security
  .command('permissions')
  .description('Diff manifest permissions against .appforge/permissions.yaml and flag newly added high-risk permissions')
  .requiredOption('--manifest <path>', 'path to the built manifest.json')
  .option('--permissions <path>', 'path to permissions.yaml', '.appforge/permissions.yaml')
  .option('--security <path>', 'path to a security.yaml with a high_risk_permissions list (falls back to a built-in default list)')
  .option('--previous-manifest <path>', 'a previous manifest.json to diff against, to detect newly added permissions (without it, every current permission is treated as new)')
  .option('--json', 'machine-readable output', false)
  .action((opts: { manifest: string; permissions: string; security?: string; previousManifest?: string; json: boolean }) => {
    process.exitCode = runSecurityPermissions({
      manifestFile: opts.manifest,
      permissionsFile: opts.permissions,
      securityFile: opts.security,
      previousManifestFile: opts.previousManifest,
      json: opts.json,
    });
  });

program
  .command('test')
  .description('Run test suites for an AppForge product (currently: --e2e, the Playwright Chrome extension harness)')
  .option('--e2e', 'run the Playwright e2e suite', false)
  .option('--dir <path>', 'product directory to build and test', '.')
  .option('--dist <path>', 'a pre-built extension dist directory (skips the build step)')
  .option('--json', 'machine-readable output', false)
  .action(async (opts: { e2e: boolean; dir: string; dist?: string; json: boolean }) => {
    if (!opts.e2e) {
      printOutput(buildOutput('test', false, undefined, ['no test type selected; pass --e2e']), opts.json);
      process.exitCode = 2;
      return;
    }
    const code = await runTestE2e({ dir: opts.dir, dist: opts.dist, json: opts.json });
    // Defense in depth against a leaked Playwright/Chromium handle keeping the event loop alive
    // (see @appforge/e2e's launch.ts docstring — a launch failure closes its own browser context,
    // but an explicit exit here means a future leak fails fast instead of hanging the CI job).
    process.exit(code);
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
