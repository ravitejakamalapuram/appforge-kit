export interface E2eCheckResult {
  /** Stable, human-readable name. This is what appears in the CLI's cli-output@1 `errors` array on failure. */
  name: string;
  ok: boolean;
  error?: string;
  durationMs: number;
}

export interface E2eReport {
  ok: boolean;
  buildDir: string;
  checks: E2eCheckResult[];
}

export interface RunE2eSuiteOptions {
  /**
   * true (default) launches Chromium in `--headless=new` mode, which supports loading unpacked
   * MV3 extensions (verified during this plan's investigation — see Review Focus item 4). false
   * opens a visible browser window, useful when debugging a check locally.
   */
  headless?: boolean;
  /** Max time to wait for the extension's service worker to appear after launch. Default 10000. */
  launchTimeoutMs?: number;
}
