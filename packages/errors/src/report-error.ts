import type { ErrorSink } from './types.js';

/**
 * Reports a caught error manually (e.g. from a try/catch a caller wants recorded). Never throws
 * and never produces an unhandled rejection, even if `sink` itself fails — the same guarantee
 * `installGlobalErrorHandlers` makes, just without its cross-call reentrancy guard, since a
 * single manual call has no way to re-trigger itself the way a global rejection handler can.
 */
export function reportError(sink: ErrorSink, error: unknown, context?: Record<string, unknown>): void {
  const message = error instanceof Error ? error.message : String(error);
  const stack = error instanceof Error ? error.stack : undefined;
  try {
    const result = sink({ message, stack, source: 'manual', context, timestamp: Date.now() });
    if (result && typeof (result as PromiseLike<unknown>).then === 'function') {
      Promise.resolve(result).catch(() => {});
    }
  } catch {
    // A sink must never be able to make reportError itself throw.
  }
}
