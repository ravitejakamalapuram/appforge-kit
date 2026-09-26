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
 * Wraps a sink so it can never crash the page, throw out of an event listener, or produce an
 * unhandled rejection — and, critically, so a sink whose own failure re-triggers another error
 * report (e.g. a telemetry `fetch` that rejects, which becomes an `unhandledrejection`, which
 * this package reports, which calls the sink again, which rejects again...) cannot loop forever.
 * While one call to `sink` is still in flight (including waiting on its returned promise), any
 * further report is dropped rather than re-entering — a bounded, deliberate trade-off: a burst
 * of near-simultaneous distinct errors may collapse to one report, which is far better than an
 * unbounded loop.
 */
function safeSink(sink: ErrorSink): ErrorSink {
  let busy = false;
  return (event) => {
    if (busy) return;
    busy = true;
    let result: unknown;
    try {
      result = sink(event);
    } catch {
      busy = false;
      return;
    }
    if (result && typeof (result as PromiseLike<unknown>).then === 'function') {
      Promise.resolve(result).then(
        () => { busy = false; },
        () => { busy = false; }
      );
    } else {
      busy = false;
    }
  };
}

/**
 * Installs handlers for uncaught errors and unhandled promise rejections, reporting each as a
 * structured ErrorEvent to `sink` (console.error, a telemetry queue — whatever the caller wants;
 * this package has no opinion). Returns an uninstall function that actually removes both
 * listeners, not a no-op — long-lived pages/service workers may install/uninstall these more
 * than once (e.g. around a test harness).
 */
export function installGlobalErrorHandlers(target: ErrorEventTarget, sink: ErrorSink): () => void {
  const safe = safeSink(sink);

  const onError = (event: unknown) => {
    const e = event as WindowErrorLike;
    // A cross-origin or otherwise muted script error sets `event.error` to `null` per the
    // browser spec, not `undefined` — checking only `!== undefined` reported it as the literal
    // string "null" and threw away the one useful field (`event.message`) it still has.
    const { message, stack } = e.error != null ? messageAndStackOf(e.error) : { message: e.message ?? 'Unknown error', stack: undefined };
    safe({ message, stack, source: 'window_error', timestamp: Date.now() });
  };

  const onRejection = (event: unknown) => {
    const { reason } = event as RejectionEventLike;
    const { message, stack } = messageAndStackOf(reason);
    safe({ message, stack, source: 'unhandled_rejection', timestamp: Date.now() });
  };

  target.addEventListener('error', onError);
  target.addEventListener('unhandledrejection', onRejection);

  return () => {
    target.removeEventListener('error', onError);
    target.removeEventListener('unhandledrejection', onRejection);
  };
}
