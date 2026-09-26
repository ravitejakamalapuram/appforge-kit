import { defineManifest } from '@crxjs/vite-plugin';
import pkg from './package.json';

/**
 * Manifest V3 configuration. Permission rationale is the single source of truth in
 * `.appforge/permissions.yaml` — this file's `permissions`/`host_permissions` arrays must match
 * it exactly (checked by `appforge validate` and `appforge security permissions` against the
 * built manifest.json, run from the appforge-kit repo root).
 */
export default defineManifest({
  manifest_version: 3,
  name: 'AppForge Chrome Template (Vanilla)',
  description:
    'A minimal Manifest V3 new-tab template with no UI framework, wired to the AppForge shared packages (storage, messaging, error reporting, remote flags).',
  version: pkg.version,
  minimum_chrome_version: '116',
  background: {
    service_worker: 'src/background/service-worker.ts',
    type: 'module',
  },
  chrome_url_overrides: {
    newtab: 'src/newtab/index.html',
  },
  permissions: ['storage'],
  content_security_policy: {
    extension_pages: "script-src 'self'; object-src 'self'",
  },
});
