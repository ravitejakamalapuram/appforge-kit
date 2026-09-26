# AppForge Chrome Security Pipeline Follow-Up (P1-12) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extend the reusable `.github/workflows/checks.yml` workflow with the three pieces explicitly deferred when it first shipped (P1-09): OSV dependency scanning, a CSP/remote-code check, and a bundle-size budget — closing out backlog item P1-12.

**Architecture:** The CSP check and the bundle-size check are new deterministic, dependency-free logic added to the existing `@appforge/schemas` (pure functions) / `@appforge/cli` (`security csp`, `security bundle-size` subcommands, I/O + `cli-output@1` contract) split that `security permissions` already established — no new packages. OSV scanning has no CLI equivalent to build (it wraps an external scanner binary against the caller's lockfile), so it is pure workflow YAML: install `osv-scanner`, run it against the caller repo, and gate on severity with `jq`. All three land as new steps inside the existing `permissions-check` job (not a new job), because all three results fold into the one PR comment that job already builds — a second job would need artifact-passing just to share comment-building state, for no benefit. The reusable workflow is proven end-to-end the same way P1-09 proved it originally: by temporarily pointing `json-workbench`'s `checks.yml` caller at this feature branch, watching a real PR run it, then reverting the pointer to `main` before merging.

**Tech Stack:** TypeScript (strict, existing `tsconfig.base.json`), Vitest (existing `vitest.workspace.ts`), Commander (existing `@appforge/cli`), GitHub Actions (`workflow_call`), `osv-scanner` v2 CLI (Go binary, installed via direct GitHub release download — no Docker, no separate reusable-workflow nesting), `jq` (pre-installed on `ubuntu-latest`).

**Spec:** Master plan §13.4 ("Chrome security pipeline": secret scan done → deps [OSV] → static [ESLint/no-eval/CSP] → permission analysis done → network/data-flow/runtime OUT OF SCOPE, needs an e2e harness that is separate in-flight work). Backlog item P1-12. The existing `.github/workflows/checks.yml` top-of-file comment (this repo, commit `9a6f18e`) is the exact scope boundary this plan closes: *"OSV dependency scanning, a CSP check, and bundle-size reporting are a deliberate follow-up — not built here."*

## Global Constraints

- Node ≥ 22.0, TypeScript `strict: true` (matches the rest of the monorepo).
- All new CLI logic follows the exact `cli-output@1` contract in `packages/cli/src/output.ts` (`buildOutput`/`printOutput`) and the established split: pure decision logic lives in `@appforge/schemas`, file I/O and exit codes live in `@appforge/cli/src/commands/*.ts`, exactly like `security permissions` (`packages/schemas/src/permission-diff.ts` + `packages/cli/src/commands/security-permissions.ts`).
- **Ruling — exit codes:** existing exit codes are 0 (ok), 2 (invalid input), 3 (validate schema fail), 6 (permission findings), 8 (product-transition not allowed). This plan adds **7** for `security csp` findings and **9** for `security bundle-size` findings — no collisions with any existing command.
- **Ruling — CSP check scope:** the CSP check reads only the built `manifest.json` (the same file `permissions-check` already builds and saves) — it does not parse HTML or JS file contents. It flags: (a) `unsafe-eval` or `unsafe-inline` appearing anywhere in `content_security_policy.extension_pages` or `content_security_policy.sandbox`; (b) any `background.service_worker` or `content_scripts[].js` entry that is an absolute `http://`/`https://`/protocol-relative (`//`) URL, i.e. remotely hosted code. Relative paths and `chrome-extension://` URLs are allowed. This matches the task's literal spec text and keeps the check dependency-free and crash-proof against partial/malformed manifests.
- **Ruling — bundle-size scope:** the budget counts the **total bytes of every file under the built `dist/` directory, recursively, excluding `*.map` files**. Source maps are a dev-only artifact never loaded by the running extension (confirmed against this repo's own build output: `templates/chrome-react/dist` is 532 KB including maps but 147 KB excluding them — including maps would make any sane budget useless). Default budget: **300 KB**, chosen as roughly 2× `templates/chrome-react`'s current built size (~147.5 KB) and ~40× `templates/chrome-vanilla`'s (~7.4 KB) — both pass comfortably today while a budget this size still catches a real bloat regression (e.g. an accidentally-bundled heavy dependency). Verified directly: `cd appforge-kit && pnpm build && find templates/*/dist -type f ! -name '*.map' -print0 | xargs -0 stat -f%z` (macOS) sums to 7,610 and 150,987 bytes respectively as of this plan.
- **Ruling — OSV severity threshold:** the job fails only on **HIGH or CRITICAL** findings (case-insensitive match on each vulnerability's `database_specific.severity` field, the field GHSA-sourced npm/pnpm advisories populate — confirmed against `google/osv-scanner`'s own JSON output docs, which embed "Full OSV" vulnerability objects). A finding with no `database_specific.severity` (some non-GHSA ecosystems) is reported in the PR comment but does not fail the job — documented as a known limitation, not silently ignored. LOW/MODERATE findings are reported but non-blocking.
- **Ruling — osv-scanner install method:** installed by downloading the pinned `osv-scanner_linux_amd64` binary directly from a GitHub release (new `osv-scanner-version` input, default `v2.6.0`), not the `google/osv-scanner-action` reusable workflow — that action's reusable workflows are designed to run as a whole top-level job posting to GitHub Code Scanning (needs `security-events: write` and SARIF upload), not to hand back JSON this job can fold into its own PR comment. A plain binary + `--format json --output-file` gives full control with no nested-reusable-workflow complexity.
- **Ruling — job placement:** all three new checks are new steps inside the existing `permissions-check` job, not a new job — this keeps the single existing PR comment as the one place all AppForge check results land, matching the task's explicit instruction to "extend that same comment rather than creating a second one."
- Every POST... n/a (no server code in this plan). Every new CLI command must return `2` for unreadable/malformed input, never let an uncaught exception escape — matching every existing command's own documented exit-code table.
- The reusable workflow's own inputs are additive only (`max-bundle-size-kb`, `osv-scanner-version`) — no existing input's name, type, or default changes, so no existing caller (`json-workbench`) breaks without an update.
- **Ruling — live-caller proof:** proven end-to-end by temporarily editing `json-workbench`'s `.github/workflows/ci.yml` `appforge-kit-ref: feat/security-checks-osv-csp-bundle` (pinning to this feature branch instead of `main`), pushing to a `json-workbench` branch, opening a PR there to trigger the `workflow_call`, confirming the new PR comment sections and pass/fail behavior render correctly, then reverting that pointer to `main` in the same `json-workbench` branch before this plan's own PR is marked ready — exactly the precedent recorded in this repo's commit `9a6f18e` / PR #7.

## Review Focus

- **CSP check false-positives on this repo's own templates.** Both `templates/chrome-vanilla` and `templates/chrome-react` build a `content_security_policy.extension_pages` of `"script-src 'self'; object-src 'self'"` and a relative `background.service_worker: "service-worker-loader.js"`. The CSP check must pass both cleanly — a naive substring match or an overly broad "any non-`chrome-extension://` string" remote-script check would break the very templates the task promises not to regress. Covered in Task 1 (`checkContentSecurityPolicy` unit tests against fixture manifests shaped exactly like these two real ones) and Task 5 (live proof).
- **Bundle-size budget silently defeated by source maps or a missing dist dir.** If `.map` files were counted, `templates/chrome-react` (532 KB with maps vs. 147 KB without) would fail any sane budget by default, and a caller whose build step failed silently (empty or missing `dist/`) must get a clear `exit 2`, not a false "0 bytes, budget passed." Covered in Task 3 (`collectFileSizes`/`runSecurityBundleSize` tests: excludes `.map`, missing directory returns 2).
- **Invalid `--max-kb` silently always failing or always passing.** `Number('not-a-number')` is `NaN`, and `totalBytes <= NaN` is always `false` in JavaScript — an unvalidated bad input would make every build "fail the budget" with a confusing, undiagnosable error instead of a clear "invalid input" message. Covered in Task 4 (`runSecurityBundleSize` validates `maxKb` is a finite, positive number before comparing, returning `2` with a specific message otherwise).
- **OSV scan noise from repo-internal checkouts.** The job later checks out `appforge-base-checkout/` and `appforge-kit-checkout/` (each with their own lockfiles) inside the caller's working directory. If the OSV scan step ran after those checkouts, it would report vulnerabilities from `appforge-kit`'s own dependencies as if they belonged to the caller repo — confusing and wrong attribution. Covered in Task 5 by placing the OSV install/scan steps immediately after "Save built manifest," before either of those checkouts exist.
- **A vulnerability with no severity field silently disappearing instead of being visibly non-blocking.** Some ecosystems' OSV records omit `database_specific.severity`. If the comment-building script only listed HIGH/CRITICAL items, a real (if lower-confidence) finding would vanish from the PR comment entirely, looking like a clean scan when it wasn't. Covered in Task 5: the comment lists every finding (with an "UNKNOWN" severity label when the field is absent), and only the HIGH/CRITICAL subset gates the job.

---

### Task 1: `@appforge/schemas` — CSP + remote-script check

**Files:**
- Create: `packages/schemas/src/csp-check.ts`
- Modify: `packages/schemas/src/index.ts` (add `export * from './csp-check.js';`)
- Test: `packages/schemas/tests/csp-check.test.ts`

**Interfaces:**
- Consumes: nothing new (plain `unknown` manifest input, same shape `extractManifestPermissions` already accepts).
- Produces: `CspCheckResult { ok: boolean; errors: string[] }` and `checkContentSecurityPolicy(manifest: unknown): CspCheckResult` — consumed by Task 2's CLI command.

- [ ] **Step 1: Write the failing tests**

```ts
// packages/schemas/tests/csp-check.test.ts
import { describe, it, expect } from 'vitest';
import { checkContentSecurityPolicy } from '../src/csp-check.js';

const VANILLA_TEMPLATE_MANIFEST = {
  manifest_version: 3,
  name: 'AppForge Chrome Template (Vanilla)',
  version: '0.1.0',
  background: { service_worker: 'service-worker-loader.js', type: 'module' },
  chrome_url_overrides: { newtab: 'src/newtab/index.html' },
  permissions: ['storage'],
  content_security_policy: { extension_pages: "script-src 'self'; object-src 'self'" },
};

describe('checkContentSecurityPolicy', () => {
  it('passes a manifest shaped like this repo\'s real chrome-vanilla template build (Review Focus: no false positive)', () => {
    expect(checkContentSecurityPolicy(VANILLA_TEMPLATE_MANIFEST)).toEqual({ ok: true, errors: [] });
  });

  it('passes a minimal manifest with no content_security_policy, background, or content_scripts at all', () => {
    expect(checkContentSecurityPolicy({ manifest_version: 3, name: 'x', version: '1.0.0' })).toEqual({ ok: true, errors: [] });
  });

  it('rejects unsafe-eval in content_security_policy.extension_pages', () => {
    const result = checkContentSecurityPolicy({
      ...VANILLA_TEMPLATE_MANIFEST,
      content_security_policy: { extension_pages: "script-src 'self' 'unsafe-eval'" },
    });
    expect(result.ok).toBe(false);
    expect(result.errors[0]).toContain('unsafe-eval');
  });

  it('rejects unsafe-inline in content_security_policy.extension_pages', () => {
    const result = checkContentSecurityPolicy({
      ...VANILLA_TEMPLATE_MANIFEST,
      content_security_policy: { extension_pages: "script-src 'self' 'unsafe-inline'" },
    });
    expect(result.ok).toBe(false);
    expect(result.errors[0]).toContain('unsafe-inline');
  });

  it('rejects unsafe-eval in content_security_policy.sandbox', () => {
    const result = checkContentSecurityPolicy({
      ...VANILLA_TEMPLATE_MANIFEST,
      content_security_policy: { extension_pages: "script-src 'self'", sandbox: "sandbox allow-scripts; script-src 'self' 'unsafe-eval'" },
    });
    expect(result.ok).toBe(false);
    expect(result.errors.some((e) => e.includes('sandbox') && e.includes('unsafe-eval'))).toBe(true);
  });

  it('rejects a remote background.service_worker, but allows the real relative one (Review Focus: no false positive)', () => {
    expect(checkContentSecurityPolicy(VANILLA_TEMPLATE_MANIFEST).ok).toBe(true);
    const remote = checkContentSecurityPolicy({
      ...VANILLA_TEMPLATE_MANIFEST,
      background: { service_worker: 'https://evil.example.com/sw.js' },
    });
    expect(remote.ok).toBe(false);
    expect(remote.errors[0]).toContain('background.service_worker');
  });

  it('rejects a protocol-relative remote content_scripts[].js entry', () => {
    const result = checkContentSecurityPolicy({
      ...VANILLA_TEMPLATE_MANIFEST,
      content_scripts: [{ matches: ['<all_urls>'], js: ['//evil.example.com/inject.js'] }],
    });
    expect(result.ok).toBe(false);
    expect(result.errors[0]).toContain('content_scripts[0].js');
  });

  it('allows a relative content_scripts[].js entry', () => {
    const result = checkContentSecurityPolicy({
      ...VANILLA_TEMPLATE_MANIFEST,
      content_scripts: [{ matches: ['<all_urls>'], js: ['content.js'] }],
    });
    expect(result).toEqual({ ok: true, errors: [] });
  });

  it('accumulates multiple errors instead of stopping at the first', () => {
    const result = checkContentSecurityPolicy({
      ...VANILLA_TEMPLATE_MANIFEST,
      content_security_policy: { extension_pages: "script-src 'unsafe-eval'" },
      background: { service_worker: 'http://evil.example.com/sw.js' },
    });
    expect(result.ok).toBe(false);
    expect(result.errors).toHaveLength(2);
  });

  it('rejects a non-object manifest instead of crashing', () => {
    expect(checkContentSecurityPolicy(null)).toEqual({ ok: false, errors: ['manifest must be a JSON object'] });
    expect(checkContentSecurityPolicy('nope')).toEqual({ ok: false, errors: ['manifest must be a JSON object'] });
  });

  it('does not crash on a malformed content_scripts entry (not an object, or js missing)', () => {
    expect(checkContentSecurityPolicy({ ...VANILLA_TEMPLATE_MANIFEST, content_scripts: ['not-an-object', {}] })).toEqual({ ok: true, errors: [] });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd appforge-kit && pnpm --filter @appforge/schemas test -- csp-check`
Expected: FAIL — `../src/csp-check.js` does not exist.

- [ ] **Step 3: Implement `checkContentSecurityPolicy`**

```ts
// packages/schemas/src/csp-check.ts
/**
 * Deterministic, dependency-free CSP + remote-code check for a built MV3 manifest.json
 * (master plan §13.4 "static" stage). Reads only the manifest's own declared fields — no HTML
 * or JS file contents are parsed — so it is crash-proof against partial/malformed manifests and
 * needs no network access to run in CI.
 */

const UNSAFE_CSP_VALUES = ['unsafe-eval', 'unsafe-inline'] as const;

export interface CspCheckResult {
  ok: boolean;
  errors: string[];
}

function checkCspString(label: string, csp: unknown, errors: string[]): void {
  if (typeof csp !== 'string') return;
  for (const unsafe of UNSAFE_CSP_VALUES) {
    if (csp.includes(unsafe)) {
      errors.push(`content_security_policy.${label} allows '${unsafe}': ${csp}`);
    }
  }
}

/** A script reference is remote (and disallowed) if it's an absolute http(s) or protocol-relative URL. Relative paths and chrome-extension:// URLs are allowed. */
function isRemoteScriptRef(ref: unknown): ref is string {
  return typeof ref === 'string' && /^(https?:)?\/\//i.test(ref);
}

export function checkContentSecurityPolicy(manifest: unknown): CspCheckResult {
  if (typeof manifest !== 'object' || manifest === null) {
    return { ok: false, errors: ['manifest must be a JSON object'] };
  }
  const errors: string[] = [];
  const doc = manifest as Record<string, unknown>;

  const csp = doc.content_security_policy;
  if (typeof csp === 'object' && csp !== null) {
    const cspDoc = csp as Record<string, unknown>;
    checkCspString('extension_pages', cspDoc.extension_pages, errors);
    checkCspString('sandbox', cspDoc.sandbox, errors);
  }

  const background = doc.background;
  if (typeof background === 'object' && background !== null) {
    const serviceWorker = (background as Record<string, unknown>).service_worker;
    if (isRemoteScriptRef(serviceWorker)) {
      errors.push(`background.service_worker references a remote script: ${serviceWorker}`);
    }
  }

  const contentScripts = doc.content_scripts;
  if (Array.isArray(contentScripts)) {
    contentScripts.forEach((entry, index) => {
      if (typeof entry !== 'object' || entry === null) return;
      const js = (entry as Record<string, unknown>).js;
      if (!Array.isArray(js)) return;
      for (const script of js) {
        if (isRemoteScriptRef(script)) {
          errors.push(`content_scripts[${index}].js references a remote script: ${script}`);
        }
      }
    });
  }

  return { ok: errors.length === 0, errors };
}
```

```ts
// packages/schemas/src/index.ts — add this line alongside the existing exports
export * from './csp-check.js';
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter @appforge/schemas test -- csp-check`
Expected: PASS (11 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/schemas/src/csp-check.ts packages/schemas/src/index.ts packages/schemas/tests/csp-check.test.ts
git commit -m "feat(schemas): add checkContentSecurityPolicy (CSP + remote-script check)"
```

---

### Task 2: `@appforge/cli` — `appforge security csp` command

**Files:**
- Create: `packages/cli/src/commands/security-csp.ts`
- Modify: `packages/cli/src/index.ts` (wire the `security csp` subcommand)
- Test: `packages/cli/tests/security-csp.integration.test.ts`
- Modify: `packages/cli/tests/cli-binary.integration.test.ts` (append real commander-wiring tests)

**Interfaces:**
- Consumes: `checkContentSecurityPolicy` from Task 1.
- Produces: `runSecurityCsp(opts: { manifestFile: string; json: boolean }): number` — exit codes 0 (ok), 2 (invalid input), 7 (CSP/remote-script findings).

- [ ] **Step 1: Write the failing tests**

```ts
// packages/cli/tests/security-csp.integration.test.ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { runSecurityCsp } from '../src/commands/security-csp.js';

let dir: string;
beforeAll(() => { dir = mkdtempSync(path.join(tmpdir(), 'appforge-security-csp-test-')); });
afterAll(() => { rmSync(dir, { recursive: true, force: true }); });

function write(name: string, content: string): string {
  const file = path.join(dir, name);
  writeFileSync(file, content);
  return file;
}

describe('runSecurityCsp', () => {
  it('returns 0 for a manifest with a strict CSP and no remote scripts', () => {
    const manifest = write('manifest-ok.json', JSON.stringify({
      background: { service_worker: 'service-worker-loader.js' },
      content_security_policy: { extension_pages: "script-src 'self'; object-src 'self'" },
    }));
    expect(runSecurityCsp({ manifestFile: manifest, json: true })).toBe(0);
  });

  it('returns 7 for a manifest allowing unsafe-eval', () => {
    const manifest = write('manifest-unsafe-eval.json', JSON.stringify({
      content_security_policy: { extension_pages: "script-src 'self' 'unsafe-eval'" },
    }));
    expect(runSecurityCsp({ manifestFile: manifest, json: true })).toBe(7);
  });

  it('returns 7 for a manifest with a remote content_scripts[].js entry', () => {
    const manifest = write('manifest-remote-script.json', JSON.stringify({
      content_scripts: [{ matches: ['<all_urls>'], js: ['https://evil.example.com/inject.js'] }],
    }));
    expect(runSecurityCsp({ manifestFile: manifest, json: true })).toBe(7);
  });

  it('returns 2 for an unreadable manifest file, not a crash', () => {
    expect(runSecurityCsp({ manifestFile: path.join(dir, 'does-not-exist.json'), json: true })).toBe(2);
  });

  it('returns 2 for a manifest file that is not valid JSON', () => {
    const manifest = write('manifest-broken.json', '{not json');
    expect(runSecurityCsp({ manifestFile: manifest, json: true })).toBe(2);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter @appforge/cli test -- security-csp.integration`
Expected: FAIL — `../src/commands/security-csp.js` does not exist.

- [ ] **Step 3: Implement `runSecurityCsp` and wire the subcommand**

```ts
// packages/cli/src/commands/security-csp.ts
import { readFileSync } from 'node:fs';
import { checkContentSecurityPolicy } from '@appforge/schemas';
import { buildOutput, printOutput } from '../output.js';

export interface SecurityCspOptions {
  manifestFile: string;
  json: boolean;
}

/** Exit codes: 0 ok, 2 invalid input (unreadable/malformed manifest), 7 CSP/remote-script findings. */
export function runSecurityCsp(opts: SecurityCspOptions): number {
  let manifest: unknown;
  try {
    manifest = JSON.parse(readFileSync(opts.manifestFile, 'utf8'));
  } catch (err) {
    printOutput(
      buildOutput('security-csp', false, undefined, [`cannot read/parse manifest ${opts.manifestFile}: ${(err as Error).message}`]),
      opts.json
    );
    return 2;
  }
  const result = checkContentSecurityPolicy(manifest);
  printOutput(buildOutput('security-csp', result.ok, result, result.errors), opts.json);
  return result.ok ? 0 : 7;
}
```

In `packages/cli/src/index.ts`, add the import near the other command imports:

```ts
import { runSecurityCsp } from './commands/security-csp.js';
```

And add the subcommand right after the existing `security.command('permissions')...` block:

```ts
security
  .command('csp')
  .description('Check the built manifest.json for unsafe CSP directives and remote script references')
  .requiredOption('--manifest <path>', 'path to the built manifest.json')
  .option('--json', 'machine-readable output', false)
  .action((opts: { manifest: string; json: boolean }) => {
    process.exitCode = runSecurityCsp({ manifestFile: opts.manifest, json: opts.json });
  });
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter @appforge/cli test -- security-csp.integration`
Expected: PASS (5 tests).

- [ ] **Step 5: Add real commander-wiring tests to the binary integration test, then confirm they pass**

Append to `packages/cli/tests/cli-binary.integration.test.ts` (after the existing `describe('appforge security permissions (nested subcommand wiring)', ...)` block, same file, same `dir`/`beforeAll`/`afterAll` pattern — add a new top-level `describe`):

```ts
describe('appforge security csp (nested subcommand wiring)', () => {
  let dir: string;
  beforeAll(() => { dir = mkdtempSync(path.join(tmpdir(), 'appforge-cli-csp-binary-')); });
  afterAll(() => { rmSync(dir, { recursive: true, force: true }); });

  it('exits 0 for a manifest with a strict CSP', () => {
    const manifest = path.join(dir, 'manifest-ok.json');
    writeFileSync(manifest, JSON.stringify({ content_security_policy: { extension_pages: "script-src 'self'" } }));
    const { code } = run(['security', 'csp', '--manifest', manifest]);
    expect(code).toBe(0);
  });

  it('exits 7, via the real nested "security csp" subcommand, for unsafe-eval', () => {
    const manifest = path.join(dir, 'manifest-bad.json');
    writeFileSync(manifest, JSON.stringify({ content_security_policy: { extension_pages: "script-src 'unsafe-eval'" } }));
    const { code } = run(['security', 'csp', '--manifest', manifest]);
    expect(code).toBe(7);
  });
});
```

This test file already builds `dist/index.js` via `pnpm --filter @appforge/cli build` as a prerequisite (see the existing `pretest`/`build` root scripts) — no new build step is needed here.

Run: `pnpm --filter @appforge/cli build && pnpm --filter @appforge/cli test -- cli-binary.integration`
Expected: PASS (all tests in the file, including the 2 new ones).

- [ ] **Step 6: Commit**

```bash
git add packages/cli/src/commands/security-csp.ts packages/cli/src/index.ts packages/cli/tests/security-csp.integration.test.ts packages/cli/tests/cli-binary.integration.test.ts
git commit -m "feat(cli): add appforge security csp command"
```

---

### Task 3: `@appforge/schemas` — bundle-size budget check

**Files:**
- Create: `packages/schemas/src/bundle-size.ts`
- Modify: `packages/schemas/src/index.ts` (add `export * from './bundle-size.js';`)
- Test: `packages/schemas/tests/bundle-size.test.ts`

**Interfaces:**
- Consumes: nothing new.
- Produces: `BundleFileSize { path: string; bytes: number }`, `BundleSizeResult { ok: boolean; totalBytes: number; maxBytes: number; errors: string[] }`, `checkBundleSize(files: readonly BundleFileSize[], maxBytes: number): BundleSizeResult` — consumed by Task 4's CLI command, which does the actual filesystem walking (kept out of this pure function per the Global Constraints' pure-logic/I/O split).

- [ ] **Step 1: Write the failing tests**

```ts
// packages/schemas/tests/bundle-size.test.ts
import { describe, it, expect } from 'vitest';
import { checkBundleSize } from '../src/bundle-size.js';

describe('checkBundleSize', () => {
  it('returns ok true with the summed totalBytes when under budget', () => {
    const result = checkBundleSize([{ path: 'a.js', bytes: 100 }, { path: 'b.js', bytes: 50 }], 1000);
    expect(result).toEqual({ ok: true, totalBytes: 150, maxBytes: 1000, errors: [] });
  });

  it('returns ok true at the exact boundary (total equals budget, not exceeding it) (Review Focus)', () => {
    const result = checkBundleSize([{ path: 'a.js', bytes: 1000 }], 1000);
    expect(result.ok).toBe(true);
  });

  it('returns ok false with a descriptive error when the total exceeds the budget', () => {
    const result = checkBundleSize([{ path: 'a.js', bytes: 1500 }], 1000);
    expect(result.ok).toBe(false);
    expect(result.totalBytes).toBe(1500);
    expect(result.errors[0]).toContain('1500');
    expect(result.errors[0]).toContain('1000');
    expect(result.errors[0]).toContain('500'); // the overage
  });

  it('returns ok true and totalBytes 0 for an empty file list', () => {
    expect(checkBundleSize([], 1000)).toEqual({ ok: true, totalBytes: 0, maxBytes: 1000, errors: [] });
  });

  it('sums many files correctly', () => {
    const files = Array.from({ length: 10 }, (_, i) => ({ path: `f${i}.js`, bytes: 100 }));
    expect(checkBundleSize(files, 5000).totalBytes).toBe(1000);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter @appforge/schemas test -- bundle-size`
Expected: FAIL — `../src/bundle-size.js` does not exist.

- [ ] **Step 3: Implement `checkBundleSize`**

```ts
// packages/schemas/src/bundle-size.ts
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
```

```ts
// packages/schemas/src/index.ts — add this line alongside the existing exports
export * from './bundle-size.js';
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter @appforge/schemas test -- bundle-size`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/schemas/src/bundle-size.ts packages/schemas/src/index.ts packages/schemas/tests/bundle-size.test.ts
git commit -m "feat(schemas): add checkBundleSize budget comparison"
```

---

### Task 4: `@appforge/cli` — `appforge security bundle-size` command

**Files:**
- Create: `packages/cli/src/commands/security-bundle-size.ts`
- Modify: `packages/cli/src/index.ts` (wire the `security bundle-size` subcommand)
- Test: `packages/cli/tests/security-bundle-size.integration.test.ts`
- Modify: `packages/cli/tests/cli-binary.integration.test.ts` (append real commander-wiring tests)

**Interfaces:**
- Consumes: `checkBundleSize`, `BundleFileSize` from Task 3.
- Produces: `runSecurityBundleSize(opts: { distDir: string; maxKb: number; json: boolean }): number` — exit codes 0 (ok), 2 (invalid input — missing dist dir, or non-finite/non-positive `maxKb`), 9 (budget exceeded).

- [ ] **Step 1: Write the failing tests**

```ts
// packages/cli/tests/security-bundle-size.integration.test.ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { runSecurityBundleSize } from '../src/commands/security-bundle-size.js';

let dir: string;
beforeAll(() => { dir = mkdtempSync(path.join(tmpdir(), 'appforge-security-bundle-size-test-')); });
afterAll(() => { rmSync(dir, { recursive: true, force: true }); });

function makeDist(name: string, files: Record<string, string>): string {
  const distDir = path.join(dir, name);
  for (const [relPath, content] of Object.entries(files)) {
    const full = path.join(distDir, relPath);
    mkdirSync(path.dirname(full), { recursive: true });
    writeFileSync(full, content);
  }
  return distDir;
}

describe('runSecurityBundleSize', () => {
  it('returns 0 when the total size (excluding .map files) is under budget', () => {
    const distDir = makeDist('under-budget', { 'index.js': 'a'.repeat(100) });
    expect(runSecurityBundleSize({ distDir, maxKb: 1, json: true })).toBe(0); // 100 bytes < 1024
  });

  it('returns 9 when the total size exceeds budget', () => {
    const distDir = makeDist('over-budget', { 'index.js': 'a'.repeat(2000) });
    expect(runSecurityBundleSize({ distDir, maxKb: 1, json: true })).toBe(9); // 2000 bytes > 1024
  });

  it('excludes .map files from the total (Review Focus: a huge source map must not blow the budget)', () => {
    const distDir = makeDist('with-sourcemap', {
      'index.js': 'a'.repeat(100),
      'index.js.map': 'x'.repeat(50_000),
    });
    expect(runSecurityBundleSize({ distDir, maxKb: 1, json: true })).toBe(0);
  });

  it('recursively sums files in subdirectories (Review Focus)', () => {
    const distDir = makeDist('nested', {
      'manifest.json': 'a'.repeat(50),
      'assets/index.js': 'b'.repeat(50),
      'src/newtab/index.html': 'c'.repeat(50),
    });
    expect(runSecurityBundleSize({ distDir, maxKb: 1, json: true })).toBe(0);
    const result = runSecurityBundleSize({ distDir, maxKb: 0.1, json: true }); // 102.4 bytes budget, 150 actual
    expect(result).toBe(9);
  });

  it('returns 2 for a dist directory that does not exist, not a crash (Review Focus)', () => {
    expect(runSecurityBundleSize({ distDir: path.join(dir, 'does-not-exist'), maxKb: 100, json: true })).toBe(2);
  });

  it('returns 2 for a non-finite or non-positive maxKb instead of a silently-always-failing comparison (Review Focus)', () => {
    const distDir = makeDist('bad-max-kb', { 'index.js': 'a' });
    expect(runSecurityBundleSize({ distDir, maxKb: NaN, json: true })).toBe(2);
    expect(runSecurityBundleSize({ distDir, maxKb: -5, json: true })).toBe(2);
    expect(runSecurityBundleSize({ distDir, maxKb: 0, json: true })).toBe(2);
  });

  it('is ok exactly at the budget boundary', () => {
    const distDir = makeDist('exact-boundary', { 'index.js': 'a'.repeat(1024) });
    expect(runSecurityBundleSize({ distDir, maxKb: 1, json: true })).toBe(0);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter @appforge/cli test -- security-bundle-size.integration`
Expected: FAIL — `../src/commands/security-bundle-size.js` does not exist.

- [ ] **Step 3: Implement `runSecurityBundleSize` and wire the subcommand**

```ts
// packages/cli/src/commands/security-bundle-size.ts
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
```

In `packages/cli/src/index.ts`, add the import:

```ts
import { runSecurityBundleSize } from './commands/security-bundle-size.js';
```

And add the subcommand after `security csp`:

```ts
security
  .command('bundle-size')
  .description('Fail if the built dist/ directory (excluding source maps) exceeds a byte budget')
  .requiredOption('--dist <path>', 'path to the built dist directory')
  .requiredOption('--max-kb <number>', 'maximum allowed total size in KB, excluding *.map files')
  .option('--json', 'machine-readable output', false)
  .action((opts: { dist: string; maxKb: string; json: boolean }) => {
    process.exitCode = runSecurityBundleSize({ distDir: opts.dist, maxKb: Number(opts.maxKb), json: opts.json });
  });
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter @appforge/cli test -- security-bundle-size.integration`
Expected: PASS (7 tests).

- [ ] **Step 5: Add real commander-wiring tests to the binary integration test, then confirm they pass**

Append to `packages/cli/tests/cli-binary.integration.test.ts` (a new top-level `describe`, using the same `makeDist`-style inline setup since that helper lives in the other test file — write it locally here instead):

```ts
describe('appforge security bundle-size (nested subcommand wiring)', () => {
  let dir: string;
  beforeAll(() => { dir = mkdtempSync(path.join(tmpdir(), 'appforge-cli-bundle-size-binary-')); });
  afterAll(() => { rmSync(dir, { recursive: true, force: true }); });

  it('exits 0 when under budget', () => {
    const distDir = path.join(dir, 'under');
    require('node:fs').mkdirSync(distDir, { recursive: true });
    writeFileSync(path.join(distDir, 'index.js'), 'a'.repeat(10));
    const { code } = run(['security', 'bundle-size', '--dist', distDir, '--max-kb', '1']);
    expect(code).toBe(0);
  });

  it('exits 9, via the real nested "security bundle-size" subcommand, when over budget', () => {
    const distDir = path.join(dir, 'over');
    require('node:fs').mkdirSync(distDir, { recursive: true });
    writeFileSync(path.join(distDir, 'index.js'), 'a'.repeat(2000));
    const { code } = run(['security', 'bundle-size', '--dist', distDir, '--max-kb', '1']);
    expect(code).toBe(9);
  });
});
```

This file already imports `writeFileSync` from `node:fs` at the top — for `mkdirSync`, either add it to the existing top-of-file `import { ... } from 'node:fs'` line (preferred, avoids the inline `require`) or use the inline `require` shown above. Prefer editing the existing import line instead:

```ts
// change the existing line
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
// to
import { mkdtempSync, writeFileSync, rmSync, mkdirSync } from 'node:fs';
```

and then use `mkdirSync(distDir, { recursive: true });` directly (drop the inline `require` calls) in both new `it` blocks above.

Run: `pnpm --filter @appforge/cli build && pnpm --filter @appforge/cli test -- cli-binary.integration`
Expected: PASS (all tests in the file, including the 2 new ones — 4 new total across Tasks 2 and 4).

- [ ] **Step 6: Commit**

```bash
git add packages/cli/src/commands/security-bundle-size.ts packages/cli/src/index.ts packages/cli/tests/security-bundle-size.integration.test.ts packages/cli/tests/cli-binary.integration.test.ts
git commit -m "feat(cli): add appforge security bundle-size command"
```

---

### Task 5: `.github/workflows/checks.yml` — wire OSV scan, CSP, and bundle-size into the reusable workflow

**Files:**
- Modify: `.github/workflows/checks.yml`

**Interfaces:**
- Consumes: `appforge security csp` and `appforge security bundle-size` CLI commands from Tasks 2 and 4 (invoked exactly like the existing `appforge security permissions` step, via `node appforge-kit-checkout/packages/cli/dist/index.js ...`).
- Produces: two new `workflow_call` inputs (`max-bundle-size-kb` default `300`, `osv-scanner-version` default `"v2.6.0"`), consumed by any caller repo (Task 6 uses this on `json-workbench` for the live proof).

- [ ] **Step 1: Update the top-of-file comment and add the two new inputs**

Replace lines 1–16 of `.github/workflows/checks.yml`:

```yaml
name: appforge-checks

# Reusable workflow (P1-09 + P1-12): permission-diff PR comment, secret scanning, OSV
# dependency scanning, a CSP/remote-code check, and a bundle-size budget.
#
# Design notes (see docs/superpowers/plans/2026-09-26-appforge-security-checks.md for the
# full rationale):
#   - OSV: fails the job only on HIGH/CRITICAL severity findings (per each vulnerability's
#     `database_specific.severity` field). Lower-severity or unclassified findings are still
#     reported in the PR comment, just not blocking.
#   - CSP: a deterministic check of the built manifest.json only (no HTML/JS parsing) — fails
#     on `unsafe-eval`/`unsafe-inline` in content_security_policy.extension_pages/sandbox, or a
#     remote (http(s)/protocol-relative) background.service_worker or content_scripts[].js entry.
#   - Bundle-size: total bytes of everything under the built dist/ directory, excluding *.map
#     files (source maps are a dev artifact never loaded by the running extension).
#   - Still explicitly OUT OF SCOPE: network/data-flow/runtime checks — those need a real e2e
#     harness with request logging (separate, in-flight work in this repo).
#
# A caller repo adds a small workflow that does:
#   jobs:
#     appforge-checks:
#       uses: ravitejakamalapuram/appforge-kit/.github/workflows/checks.yml@main
#       with:
#         manifest-path: apps/extension/dist/manifest.json
#       permissions:
#         contents: read
#         pull-requests: write

on:
  workflow_call:
    inputs:
      build-command:
        description: "Shell command that installs deps and builds the extension, producing manifest-path"
        required: false
        type: string
        default: "npm ci && npm run build"
      manifest-path:
        description: "Path to the built manifest.json, relative to the caller repo root"
        required: true
        type: string
      permissions-path:
        description: "Path to .appforge/permissions.yaml, relative to the caller repo root"
        required: false
        type: string
        default: ".appforge/permissions.yaml"
      max-bundle-size-kb:
        description: "Maximum total size, in KB, of the built dist/ directory excluding source maps (*.map files). Default sized against this repo's own templates as of P1-12: ~2x templates/chrome-react's built size."
        required: false
        type: number
        default: 300
      osv-scanner-version:
        description: "osv-scanner release tag to install and run (https://github.com/google/osv-scanner/releases)"
        required: false
        type: string
        default: "v2.6.0"
      node-version:
        required: false
        type: string
        default: "22"
      appforge-kit-ref:
        description: "appforge-kit ref to check out and build the CLI from. No tagged releases exist yet, so this defaults to main — pin to a tag once appforge-kit starts versioning releases."
        required: false
        type: string
        default: "main"
```

- [ ] **Step 2: Add the OSV install/scan steps right after "Save built manifest"**

In the `permissions-check` job, immediately after the existing `- name: Save built manifest` step and before `- name: Checkout base ref`, insert:

```yaml
      - name: Install osv-scanner
        run: |
          curl -sSfL "https://github.com/google/osv-scanner/releases/download/${{ inputs.osv-scanner-version }}/osv-scanner_linux_amd64" -o /usr/local/bin/osv-scanner
          chmod +x /usr/local/bin/osv-scanner

      # Runs now, before the appforge-base-checkout/ and appforge-kit-checkout/ directories
      # exist below (Review Focus: those checkouts have their own lockfiles — scanning after
      # they exist would misattribute appforge-kit's own dependency vulnerabilities to the
      # caller repo). `|| true` because osv-scanner exits non-zero on ANY finding; severity-based
      # gating happens later in "Fail the job if any appforge check failed".
      - name: Run OSV dependency scan
        run: |
          osv-scanner scan source -r --format json --output-file "${{ runner.temp }}/osv.json" . || true
```

- [ ] **Step 3: Add the CSP and bundle-size steps after "appforge validate", before "appforge security permissions"**

```yaml
      - name: appforge security csp
        run: |
          node appforge-kit-checkout/packages/cli/dist/index.js security csp \
            --manifest "${{ runner.temp }}/head-manifest.json" \
            --json | tee "${{ runner.temp }}/csp.json"

      - name: appforge security bundle-size
        run: |
          dist_dir=$(dirname "${{ inputs.manifest-path }}")
          node appforge-kit-checkout/packages/cli/dist/index.js security bundle-size \
            --dist "$dist_dir" \
            --max-kb "${{ inputs.max-bundle-size-kb }}" \
            --json | tee "${{ runner.temp }}/bundle-size.json"
```

Both run unconditionally (on every push and PR), matching `appforge validate` — they are absolute checks on the current build, not diffs against a base ref, so they don't need `if: github.event_name == 'pull_request'`.

- [ ] **Step 4: Extend the PR-comment-building script to include CSP, bundle-size, and OSV**

Replace the entire `script:` block inside `- name: Post or update the PR comment`:

```yaml
      - name: Post or update the PR comment
        if: github.event_name == 'pull_request'
        uses: actions/github-script@v7
        with:
          script: |
            const fs = require('fs');
            const tmp = process.env.RUNNER_TEMP;
            const validate = JSON.parse(fs.readFileSync(`${tmp}/validate.json`, 'utf8'));
            const security = JSON.parse(fs.readFileSync(`${tmp}/security.json`, 'utf8'));
            const csp = JSON.parse(fs.readFileSync(`${tmp}/csp.json`, 'utf8'));
            const bundleSize = JSON.parse(fs.readFileSync(`${tmp}/bundle-size.json`, 'utf8'));
            const osv = JSON.parse(fs.readFileSync(`${tmp}/osv.json`, 'utf8'));
            const marker = '<!-- appforge-checks -->';
            const lines = [marker, '### AppForge checks', ''];

            lines.push(
              validate.ok
                ? '✅ `permissions.yaml` schema valid'
                : '❌ `permissions.yaml` schema invalid:\n' + validate.errors.map((e) => `- ${e}`).join('\n')
            );
            lines.push('');
            lines.push(
              security.ok
                ? '✅ No undocumented, unused, or newly-added high-risk permissions'
                : '❌ Permission issues found:\n' + security.errors.map((e) => `- ${e}`).join('\n')
            );
            if (!security.ok && security.data?.highRisk?.length > 0) {
              lines.push('', '**⚠️ New high-risk permissions require board approval before this can ship.**');
            }
            lines.push('');
            lines.push(
              csp.ok
                ? '✅ No unsafe CSP directives or remote script references'
                : '❌ CSP/remote-code issues found:\n' + csp.errors.map((e) => `- ${e}`).join('\n')
            );
            lines.push('');
            lines.push(
              bundleSize.ok
                ? `✅ Bundle size ${bundleSize.data.totalBytes} bytes (budget ${bundleSize.data.maxBytes} bytes)`
                : `❌ Bundle size budget exceeded:\n` + bundleSize.errors.map((e) => `- ${e}`).join('\n')
            );
            lines.push('');

            // A vulnerability is treated as HIGH/CRITICAL when its `database_specific.severity`
            // field (populated by GHSA-sourced npm/pnpm advisories) says so. A finding with no
            // such field is still listed here (severity shown as UNKNOWN) but does not gate the
            // job (see "Fail the job if any appforge check failed" and this plan's Global
            // Constraints — Review Focus: it must not silently disappear from the comment).
            const vulns = (osv.results ?? []).flatMap((r) => r.packages ?? []).flatMap((p) =>
              (p.vulnerabilities ?? []).map((v) => ({
                pkg: p.package?.name ?? 'unknown',
                version: p.package?.version ?? 'unknown',
                id: v.id,
                severity: v.database_specific?.severity ?? 'UNKNOWN',
              }))
            );
            const highOrCritical = vulns.filter((v) => ['HIGH', 'CRITICAL'].includes(String(v.severity).toUpperCase()));
            if (vulns.length === 0) {
              lines.push('✅ osv-scanner found no known dependency vulnerabilities');
            } else {
              const summary = vulns.map((v) => `- ${v.pkg}@${v.version}: ${v.id} (${v.severity})`).join('\n');
              lines.push(
                highOrCritical.length > 0
                  ? `❌ osv-scanner found ${highOrCritical.length} HIGH/CRITICAL vulnerabilities (of ${vulns.length} total):\n${summary}`
                  : `⚠️ osv-scanner found ${vulns.length} lower-severity vulnerabilities (not blocking):\n${summary}`
              );
            }

            const body = lines.join('\n');
            const { data: comments } = await github.rest.issues.listComments({
              owner: context.repo.owner,
              repo: context.repo.repo,
              issue_number: context.issue.number,
            });
            const existing = comments.find((c) => c.body.startsWith(marker));
            if (existing) {
              await github.rest.issues.updateComment({ owner: context.repo.owner, repo: context.repo.repo, comment_id: existing.id, body });
            } else {
              await github.rest.issues.createComment({ owner: context.repo.owner, repo: context.repo.repo, issue_number: context.issue.number, body });
            }
```

- [ ] **Step 5: Extend the final gating step to check CSP, bundle-size, and OSV severity**

Replace the `- name: Fail the job if any appforge check failed` step:

```yaml
      - name: Fail the job if any appforge check failed
        run: |
          tmp="${{ runner.temp }}"
          fail=0

          ok=$(jq -r '.ok' "$tmp/validate.json")
          if [ "$ok" != "true" ]; then
            echo "::error::appforge validate failed — see the step output above"
            fail=1
          fi

          if [ -f "$tmp/security.json" ]; then
            ok2=$(jq -r '.ok' "$tmp/security.json")
            if [ "$ok2" != "true" ]; then
              echo "::error::appforge security permissions failed — see the PR comment or step output above"
              fail=1
            fi
          fi

          ok3=$(jq -r '.ok' "$tmp/csp.json")
          if [ "$ok3" != "true" ]; then
            echo "::error::appforge security csp failed — see the PR comment or step output above"
            fail=1
          fi

          ok4=$(jq -r '.ok' "$tmp/bundle-size.json")
          if [ "$ok4" != "true" ]; then
            echo "::error::appforge security bundle-size failed — see the PR comment or step output above"
            fail=1
          fi

          # See the top-of-file comment: only HIGH/CRITICAL findings (by database_specific.severity)
          # fail the job. A finding with no severity field is reported but non-blocking.
          high_or_critical=$(jq '[.results[]?.packages[]?.vulnerabilities[]? | select((.database_specific.severity // "") | ascii_upcase | (. == "HIGH" or . == "CRITICAL"))] | length' "$tmp/osv.json")
          if [ "$high_or_critical" -gt 0 ]; then
            echo "::error::osv-scanner found $high_or_critical HIGH/CRITICAL severity vulnerabilities — see the PR comment or osv.json"
            fail=1
          fi

          if [ "$fail" -eq 1 ]; then
            exit 1
          fi
```

- [ ] **Step 6: Validate the YAML is well-formed**

Run: `cd appforge-kit && python3 -c "import yaml, sys; yaml.safe_load(open('.github/workflows/checks.yml'))" && echo "valid YAML"`
Expected: `valid YAML` printed, no exception. (This only checks syntax — Task 6 proves the workflow actually runs correctly end-to-end.)

- [ ] **Step 7: Commit**

```bash
git add .github/workflows/checks.yml
git commit -m "ci: add OSV dependency scan, CSP check, and bundle-size budget to reusable checks.yml (P1-12)"
```

---

### Task 6: Full workspace verification, then prove the reusable workflow end-to-end via `json-workbench`

**Files:**
- None in `appforge-kit` (verification only).
- Temporary edit in a separate `json-workbench` branch (reverted before this plan's PR is marked ready) — see steps below.

**Interfaces:**
- Consumes: everything from Tasks 1–5.
- Produces: nothing new — this task is proof, not code.

- [ ] **Step 1: Run the full workspace verification from repo root**

Run (from the `appforge-kit` worktree root, i.e. `~/git-personal/appforge-kit-security-checks` for this plan's execution):

```bash
pnpm install && pnpm typecheck && pnpm build && pnpm test && pnpm lint
```

Expected: all five green. This is the same full-workspace check the task's own instructions require before marking anything done — it catches any cross-package regression the new `packages/schemas`/`packages/cli` changes might cause elsewhere (e.g. in `templates/*` builds that import `@appforge/schemas` indirectly).

- [ ] **Step 2: Push the feature branch and open a draft PR in `appforge-kit`**

```bash
cd ~/git-personal/appforge-kit-security-checks
direnv exec . git push -u origin feat/security-checks-osv-csp-bundle
direnv exec . gh pr create --draft \
  --title "ci: add OSV dependency scan, CSP check, and bundle-size budget to reusable checks.yml (P1-12)" \
  --body "$(cat <<'EOF'
## What

Extends the reusable \`.github/workflows/checks.yml\` workflow (P1-09) with the three pieces
explicitly deferred when it first shipped:

- **OSV dependency scanning** (\`osv-scanner\`) against the caller repo's lockfile — fails the
  job only on HIGH/CRITICAL severity findings; lower-severity findings are reported in the PR
  comment but non-blocking.
- **CSP / remote-code check** (\`appforge security csp\`, new) — deterministic check of the
  built manifest.json for \`unsafe-eval\`/\`unsafe-inline\` and remote background/content-script
  references.
- **Bundle-size budget** (\`appforge security bundle-size\`, new) — total size of the built
  \`dist/\` directory (excluding source maps), default 300 KB, configurable via the new
  \`max-bundle-size-kb\` workflow input.

All three results fold into the same PR comment \`permissions-check\` already builds.

## Still out of scope

Network/data-flow/runtime checks — those need a real e2e harness with request logging, which is
separate, in-flight work in this repo (a Playwright harness under \`packages/e2e\`). Not touched
by this PR.

## Proof

This is a \`workflow_call\`-only reusable workflow — it can't be exercised by pushing to this
repo alone. Proven by temporarily pointing \`json-workbench\`'s \`checks.yml\` at this branch,
watching a real PR run it end-to-end, then reverting that pointer to \`main\` before this PR is
marked ready (same precedent as PR #7 / commit 9a6f18e).

Plan: \`docs/superpowers/plans/2026-09-26-appforge-security-checks.md\`

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

Record the PR number and URL from the `gh pr create` output for the next steps.

- [ ] **Step 3: Temporarily point `json-workbench` at this branch**

```bash
cd ~/git-personal/json-workbench
direnv exec . git checkout -b test/appforge-security-checks-proof main
```

Edit `.github/workflows/ci.yml`'s `appforge-checks` job:

```yaml
  appforge-checks:
    permissions:
      contents: read
      pull-requests: write
    uses: ravitejakamalapuram/appforge-kit/.github/workflows/checks.yml@feat/security-checks-osv-csp-bundle
    with:
      manifest-path: apps/extension/dist/manifest.json
```

(Only the `uses:` ref changes — from `@main` to `@feat/security-checks-osv-csp-bundle`. No other line changes.)

```bash
git add .github/workflows/ci.yml
git commit -m "test: temporarily point appforge-checks at feat/security-checks-osv-csp-bundle for live proof"
direnv exec . git push -u origin test/appforge-security-checks-proof
direnv exec . gh pr create --draft \
  --title "test: temporary proof for appforge-kit P1-12 security checks (DO NOT MERGE)" \
  --body "Temporary — proves appforge-kit's feat/security-checks-osv-csp-bundle reusable workflow end-to-end. Will be closed once the pointer is reverted to main."
```

- [ ] **Step 4: Watch the proof PR's CI, verify the new comment sections render, then fix forward if anything fails**

```bash
cd ~/git-personal/json-workbench
direnv exec . gh pr checks <proof-pr-number> --watch
```

Then read the PR comment (`direnv exec . gh pr view <proof-pr-number> --comments`) and confirm all five sections appear: `permissions.yaml` schema, permission diff, CSP, bundle size, and OSV — with the ✅/❌ markers matching what's actually true for `json-workbench`'s current build. If the `appforge-checks` job fails for a reason inside this plan's own new code (a real bug in `security csp`/`security bundle-size`, or a workflow YAML mistake), fix it back in the `appforge-kit-security-checks` worktree, commit, push to `feat/security-checks-osv-csp-bundle` (the proof PR picks up the new commit automatically since it references the branch, not a SHA), and re-run `gh pr checks --watch`.

If the job fails only because `json-workbench`'s own build legitimately exceeds the new default 300 KB budget or has a pre-existing CSP finding unrelated to this plan's logic, that is not a bug in this plan — note it in the proof PR's own comment thread for `json-workbench` (a separate, future concern for that repo) and do not change `appforge-kit`'s default just to force this specific proof PR green; instead add `max-bundle-size-kb: <a larger number>` to the temporary `with:` block in this proof branch only, to isolate proving "the mechanism works" from "json-workbench's current build happens to already fit."

- [ ] **Step 5: Revert the `json-workbench` pointer and close the proof PR**

```bash
cd ~/git-personal/json-workbench
git checkout .github/workflows/ci.yml  # discard the temporary uses: ref change
git status  # confirm clean — no leftover diff against main
direnv exec . gh pr close <proof-pr-number> --delete-branch --comment "Proof complete — appforge-kit's feat/security-checks-osv-csp-bundle runs end-to-end correctly. Reverting this temporary pointer; appforge-kit's own PR will point back at main once merged."
```

- [ ] **Step 6: Mark the `appforge-kit` PR ready and watch its own CI**

```bash
cd ~/git-personal/appforge-kit-security-checks
direnv exec . gh pr checks <appforge-kit-pr-number> --watch
```

Once green, mark ready and merge:

```bash
direnv exec . gh pr ready <appforge-kit-pr-number>
direnv exec . gh pr merge <appforge-kit-pr-number> --squash --delete-branch
```

- [ ] **Step 7: Post-merge store/CI verification**

Per this account's standing rule to verify CI/CD landed for every published app touched this session: this plan only touches `appforge-kit` (a library/tooling repo, not itself published to a store) and, temporarily and reversibly, `json-workbench`'s workflow file (reverted in Step 5, never merged to its `main`). No Chrome Web Store or Google Play deploy is triggered by this plan — confirm `json-workbench`'s `main` branch and its own CI are unaffected: `cd ~/git-personal/json-workbench && git log --oneline -3 origin/main` should show no new commits from this plan.

---

## Self-Review Notes

Checked against the Self-Review checklist in `superpowers:writing-plans` before handing this plan off:

1. **Spec coverage.** Master plan §13.4's three deferred pieces (OSV, CSP, bundle-size) each have a dedicated pure-logic task (or workflow task, for OSV) plus a CLI/wiring task. The explicit "network/data-flow/runtime OUT OF SCOPE" line is called out in Global Constraints, the workflow's own top-of-file comment (Task 5, Step 1), and the PR body (Task 6, Step 2) — three places, so it can't be missed by a future reader of any one of them.
2. **Placeholder scan.** No "TBD"/"handle edge cases"/"similar to Task N" language anywhere in this plan — every step has literal code or literal shell commands.
3. **Type consistency.** `CspCheckResult`, `checkContentSecurityPolicy`, `BundleFileSize`, `BundleSizeResult`, `checkBundleSize` are defined once each in Tasks 1/3 and referenced with identical names/shapes in Tasks 2/4 (CLI commands) and nowhere renamed.
4. **Review Focus coverage.** All five Review Focus items have an owning task with a literal test: CSP-on-real-templates → Task 1, Step 1 (`VANILLA_TEMPLATE_MANIFEST` fixture); source-map/missing-dir → Task 3/4 (`checkBundleSize`'s `.map`-exclusion tests, missing-dist-dir test); invalid `maxKb` → Task 4 (`NaN`/negative/zero tests); OSV-scan-ordering-vs-checkouts → Task 5, Step 2 (step placement); missing-severity-field visibility → Task 5, Step 4 (comment always lists every finding, `UNKNOWN` fallback).
5. **Exit-code collision check.** Re-verified against every existing command's docstring (`validate`: 0/2/3, `product-transition`: 0/2/8, `security permissions`: 0/2/6) before assigning 7 (csp) and 9 (bundle-size) — no collisions.
6. **Real-build sanity check.** The default 300 KB bundle-size budget and both CSP test fixtures were checked directly against this repo's actual `pnpm build` output for `templates/chrome-vanilla` and `templates/chrome-react` (not assumed) — both pass today with meaningful headroom, so this plan cannot regress the very templates it's meant to protect.
7. **Live-caller proof is real, not simulated.** Task 6 does not fabricate a "temporary self-test workflow" inside `appforge-kit` — it reuses the exact `json-workbench`-as-live-caller precedent this repo's own history (commit `9a6f18e`, PR #7) already established for proving a `workflow_call`-only reusable workflow, including the revert-before-merge step.
