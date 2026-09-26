export interface ErrorEvent {
  message: string;
  stack?: string;
  source: 'window_error' | 'unhandled_rejection' | 'manual';
  context?: Record<string, unknown>;
  timestamp: number;
}

/** Async sinks are expected (a real telemetry sink is almost always a fetch) — the return type
 * says so explicitly, rather than declaring `void` and leaving callers to discover at runtime
 * that a promise came back. */
export type ErrorSink = (event: ErrorEvent) => void | Promise<void>;

/**
 * The subset of EventTarget needed to listen for global errors — injected so this package never
 * touches `window`/`self` directly (a service worker has neither `window` nor `document`, only
 * `self`; a page has `window`), and so tests can use a fake target.
 */
export interface ErrorEventTarget {
  addEventListener(type: 'error' | 'unhandledrejection', listener: (event: unknown) => void): void;
  removeEventListener(type: 'error' | 'unhandledrejection', listener: (event: unknown) => void): void;
}
