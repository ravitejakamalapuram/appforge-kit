import type { ErrorSink } from './types.js';

/** Reports a caught error manually (e.g. from a try/catch a caller wants recorded). */
export function reportError(sink: ErrorSink, error: unknown, context?: Record<string, unknown>): void {
  const message = error instanceof Error ? error.message : String(error);
  const stack = error instanceof Error ? error.stack : undefined;
  sink({ message, stack, source: 'manual', context, timestamp: Date.now() });
}
