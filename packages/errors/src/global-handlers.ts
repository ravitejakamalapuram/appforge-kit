import type { ErrorEventTarget, ErrorSink } from './types.js';

interface WindowErrorLike {
  message?: string;
  error?: unknown;
}

interface RejectionEventLike {
  reason?: unknown;
}

function messageAndStackOf(value: unknown): { message: string; stack?: string } {
  if (value instanceof Error) return { message: value.message, stack: value.stack };
  return { message: String(value) };
}

/**
 * Installs handlers for uncaught errors and unhandled promise rejections, reporting each as a
 * structured ErrorEvent to `sink` (console.error, a telemetry queue — whatever the caller wants;
 * this package has no opinion). Returns an uninstall function that actually removes both
 * listeners, not a no-op — long-lived pages/service workers may install/uninstall these more
 * than once (e.g. around a test harness).
 */
export function installGlobalErrorHandlers(target: ErrorEventTarget, sink: ErrorSink): () => void {
  const onError = (event: unknown) => {
    const e = event as WindowErrorLike;
    const { message, stack } = e.error !== undefined ? messageAndStackOf(e.error) : { message: e.message ?? 'Unknown error', stack: undefined };
    sink({ message, stack, source: 'window_error', timestamp: Date.now() });
  };

  const onRejection = (event: unknown) => {
    const { reason } = event as RejectionEventLike;
    const { message, stack } = messageAndStackOf(reason);
    sink({ message, stack, source: 'unhandled_rejection', timestamp: Date.now() });
  };

  target.addEventListener('error', onError);
  target.addEventListener('unhandledrejection', onRejection);

  return () => {
    target.removeEventListener('error', onError);
    target.removeEventListener('unhandledrejection', onRejection);
  };
}
