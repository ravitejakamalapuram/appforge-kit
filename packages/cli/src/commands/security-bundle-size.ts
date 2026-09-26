import { readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { checkBundleSize, type BundleFileSize } from '@appforge/schemas';
import { buildOutput, printOutput } from '../output.js';

export interface SecurityBundleSizeOptions {
  distDir: string;
  maxKb: number;
  json: boolean;
}

/**
 * Walks distDir recursively, summing every file's size except source maps (*.map) — a source
 * map is a dev-only artifact never loaded by the running extension, and including it would
 * inflate the total with a number unrelated to what actually ships to a user's browser.
 */
function collectFileSizes(distDir: string): BundleFileSize[] {
  const files: BundleFileSize[] = [];
  function walk(dir: string): void {
    for (const name of readdirSync(dir)) {
      const fullPath = path.join(dir, name);
      const stat = statSync(fullPath);
      if (stat.isDirectory()) {
        walk(fullPath);
      } else if (stat.isFile() && !name.endsWith('.map')) {
        files.push({ path: path.relative(distDir, fullPath), bytes: stat.size });
      }
    }
  }
  walk(distDir);
  return files;
}

/**
 * Exit codes: 0 ok, 2 invalid input (dist dir missing/unreadable, or maxKb not a finite positive
 * number — an unvalidated NaN/negative maxKb would make `totalBytes <= maxBytes` silently always
 * false in JS, i.e. every build "fails the budget" with no diagnosable cause), 9 budget exceeded.
 */
export function runSecurityBundleSize(opts: SecurityBundleSizeOptions): number {
  if (!Number.isFinite(opts.maxKb) || opts.maxKb <= 0) {
    printOutput(
      buildOutput('security-bundle-size', false, undefined, [`--max-kb must be a finite, positive number, got "${opts.maxKb}"`]),
      opts.json
    );
    return 2;
  }

  let files: BundleFileSize[];
  try {
    files = collectFileSizes(opts.distDir);
  } catch (err) {
    printOutput(
      buildOutput('security-bundle-size', false, undefined, [`cannot read dist directory ${opts.distDir}: ${(err as Error).message}`]),
      opts.json
    );
    return 2;
  }

  const maxBytes = Math.floor(opts.maxKb * 1024);
  const result = checkBundleSize(files, maxBytes);
  printOutput(buildOutput('security-bundle-size', result.ok, result, result.errors), opts.json);
  return result.ok ? 0 : 9;
}
