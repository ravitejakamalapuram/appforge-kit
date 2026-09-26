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

/**
 * Matches CSP source-list tokens exactly (case-insensitively), not by substring. A substring
 * check on 'unsafe-eval' would also match 'wasm-unsafe-eval' — a distinct, MV3-sanctioned
 * keyword for WebAssembly that Chrome's own default extension_pages CSP includes — which would
 * make this check fail extensions that never opted into anything unsafe. CSP keyword tokens are
 * also case-insensitive per the CSP spec, so 'UNSAFE-EVAL' must still be caught.
 */
function checkCspString(label: string, csp: unknown, errors: string[]): void {
  if (typeof csp !== 'string') return;
  const tokens = csp.toLowerCase().split(/[\s;]+/);
  for (const unsafe of UNSAFE_CSP_VALUES) {
    if (tokens.includes(`'${unsafe}'`)) {
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
