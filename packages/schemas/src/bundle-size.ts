/**
 * Deterministic bundle-size budget check (master plan §13.4 "bundle-size reporting"). Pure
 * comparison over pre-computed file sizes — deciding which files count (e.g. excluding source
 * maps) is filesystem I/O and lives in the CLI layer (@appforge/cli), kept out of this function
 * so it stays trivially testable with fixture data and has no I/O of its own.
 */
export interface BundleFileSize {
  path: string;
  bytes: number;
}

export interface BundleSizeResult {
  ok: boolean;
  totalBytes: number;
  maxBytes: number;
  errors: string[];
}

export function checkBundleSize(files: readonly BundleFileSize[], maxBytes: number): BundleSizeResult {
  const totalBytes = files.reduce((sum, f) => sum + f.bytes, 0);
  const ok = totalBytes <= maxBytes;
  const errors = ok
    ? []
    : [`built bundle is ${totalBytes} bytes, exceeding the ${maxBytes}-byte budget by ${totalBytes - maxBytes} bytes`];
  return { ok, totalBytes, maxBytes, errors };
}
