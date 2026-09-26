/** Minimal chrome.runtime surface this package needs, injected so it never touches globals. */
export interface ChromeRuntime {
  sendMessage(message: unknown): Promise<unknown>;
}

export interface MessageEnvelope<TPayload = unknown> {
  type: string;
  payload: TPayload;
  requestId: string;
}

export interface ResponseError {
  message: string;
  code?: string;
}

export interface ResponseEnvelope<TResult = unknown> {
  requestId: string;
  ok: boolean;
  result?: TResult;
  error?: ResponseError;
}

export type MessageHandler<TPayload = unknown, TResult = unknown> = (payload: TPayload) => Promise<TResult> | TResult;

/** The shape a chrome.runtime.onMessage listener must have (subset needed here). */
export type RuntimeMessageListener = (
  message: unknown,
  sender: unknown,
  sendResponse: (response: ResponseEnvelope) => void
) => boolean;
