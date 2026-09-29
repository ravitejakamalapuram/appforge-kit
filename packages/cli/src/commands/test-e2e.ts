import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { runE2eSuite } from '@appforge/e2e';
import { buildOutput, printOutput } from '../output.js';

export interface TestE2eOptions {
  dir: string;
  dist?: string;
  json: boolean;
}

// Package managers to try, in preference order, when the target's package.json does not name
// one via "packageManager". `pnpm`/`yarn` run a script by name directly; `npm` requires `run`.
const BUILD_ARGS: Record<string, string[]> = { pnpm: ['build'], yarn: ['build'], npm: ['run', 'build'] };
const DEFAULT_PACKAGE_MANAGERS = ['pnpm', 'npm'];

function isCommandAvailable(command: string): boolean {
  try {
    execFileSync(command, ['--version'], { stdio: 'ignore' });
    return true;
  } catch (err) {
    return (err as { code?: string }).code !== 'ENOENT';
  }
}

function readDeclaredPackageManager(dir: string): string | undefined {
  try {
    const pkg = JSON.parse(readFileSync(path.join(dir, 'package.json'), 'utf8')) as { packageManager?: string };
    return pkg.packageManager?.split('@')[0];
  } catch {
    return undefined;
  }
}

function resolvePackageManager(dir: string): { command: string; args: string[] } | { error: string } {
  const declared = readDeclaredPackageManager(dir);
  const candidates = declared
    ? [declared, ...DEFAULT_PACKAGE_MANAGERS.filter((pm) => pm !== declared)]
    : DEFAULT_PACKAGE_MANAGERS;

  for (const pm of candidates) {
    if (isCommandAvailable(pm)) {
      return { command: pm, args: BUILD_ARGS[pm] ?? ['run', 'build'] };
    }
  }
  return {
    error: `no supported package manager (${candidates.join(', ')}) is available on PATH in this runtime — install one, or pass --dist to skip the build step`,
  };
}

/**
 * Exit codes: 0 ok (every check passed), 2 invalid input (no package manager was resolvable,
 * the build step failed, or neither --dist nor a successful build produced a directory
 * containing manifest.json — see Review Focus item 5), 4 one or more e2e checks failed.
 * (Final-review finding I2: the master plan's §29c table reserves exit 9 for "deterministic
 * task" — the not-yet-built `route` command — so this uses the next free code, 4, not 9, to
 * avoid colliding with that reserved meaning.)
 */
export async function runTestE2e(opts: TestE2eOptions): Promise<number> {
  let distDir: string;

  if (opts.dist) {
    distDir = path.resolve(opts.dist);
  } else {
    const dir = path.resolve(opts.dir);
    const packageManager = resolvePackageManager(dir);
    if ('error' in packageManager) {
      printOutput(buildOutput('test', false, undefined, [packageManager.error]), opts.json);
      return 2;
    }
    try {
      execFileSync(packageManager.command, packageManager.args, { cwd: dir, stdio: 'pipe' });
    } catch (err) {
      const stderr = (err as { stderr?: Buffer }).stderr?.toString() ?? (err as Error).message;
      printOutput(buildOutput('test', false, undefined, [`build failed in ${dir}: ${stderr}`]), opts.json);
      return 2;
    }
    distDir = path.join(dir, 'dist');
  }

  if (!existsSync(path.join(distDir, 'manifest.json'))) {
    printOutput(
      buildOutput('test', false, undefined, [`${distDir} does not contain a manifest.json — is this a built extension directory?`]),
      opts.json
    );
    return 2;
  }

  const report = await runE2eSuite(distDir, {});
  const errors = report.checks.filter((c) => !c.ok).map((c) => `${c.name}: ${c.error ?? 'failed'}`);
  printOutput(buildOutput('test', report.ok, report, errors), opts.json);
  return report.ok ? 0 : 4;
}
