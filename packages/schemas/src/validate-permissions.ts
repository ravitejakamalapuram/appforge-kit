import Ajv2020 from 'ajv/dist/2020.js';
import type { ErrorObject } from 'ajv';
import permissionsSchema from '../schema/permissions.schema.json' with { type: 'json' };

export interface ValidationResult {
  ok: boolean;
  errors: string[];
}

const ajv = new Ajv2020({ allErrors: true, strict: true });
const validateFn = ajv.compile(permissionsSchema);

function formatError(e: ErrorObject): string {
  const path = e.instancePath || '(root)';
  return `${path}: ${e.message}`;
}

export function validatePermissions(doc: unknown): ValidationResult {
  const ok = validateFn(doc);
  if (ok) return { ok: true, errors: [] };
  return { ok: false, errors: (validateFn.errors ?? []).map(formatError) };
}
