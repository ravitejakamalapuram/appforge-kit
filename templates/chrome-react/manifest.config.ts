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
  name: 'AppForge Chrome Template (React)',
  description: 'A Manifest V3 template with a real popup + options UI (React), wired to the AppForge shared packages.',
  version: pkg.version,
  minimum_chrome_version: '116',
  background: {
    service_worker: 'src/background/service-worker.ts',
    type: 'module',
  },
  action: {
    default_popup: 'src/popup/index.html',
    default_title: 'AppForge Template',
  },
  options_page: 'src/options/index.html',
  permissions: ['storage'],
  content_security_policy: {
    extension_pages: "script-src 'self'; object-src 'self'",
  },
});
