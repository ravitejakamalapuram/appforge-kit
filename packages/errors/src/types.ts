export interface ErrorEvent {
  message: string;
  stack?: string;
  source: 'window_error' | 'unhandled_rejection' | 'manual';
  context?: Record<string, unknown>;
  timestamp: number;
}

export type ErrorSink = (event: ErrorEvent) => void;

/**
 * The subset of EventTarget needed to listen for global errors — injected so this package never
 * touches `window`/`self` directly (a service worker has neither `window` nor `document`, only
 * `self`; a page has `window`), and so tests can use a fake target.
 */
export interface ErrorEventTarget {
  addEventListener(type: 'error' | 'unhandledrejection', listener: (event: unknown) => void): void;
  removeEventListener(type: 'error' | 'unhandledrejection', listener: (event: unknown) => void): void;
}
