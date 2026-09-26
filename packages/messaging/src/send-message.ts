import { MessagingTimeoutError } from './errors.js';
import type { ChromeRuntime, MessageEnvelope, ResponseEnvelope } from './types.js';

let requestCounter = 0;
function nextRequestId(): string {
  requestCounter += 1;
  return `req_${Date.now()}_${requestCounter}`;
}

export interface SendTypedMessageOptions {
  timeoutMs?: number;
}

const DEFAULT_TIMEOUT_MS = 5000;

/**
 * Sends a typed message and waits for a matching ResponseEnvelope, or throws.
 * `chrome.runtime.sendMessage` resolves to `undefined` (not a rejection) when no listener is
 * registered, or a listener returned a falsy value from its onMessage callback — both are
 * treated as "unhandled", not a crash, so callers get an actionable error either way.
 */
export async function sendTypedMessage<TPayload, TResult = unknown>(
  runtime: ChromeRuntime,
  type: string,
  payload: TPayload,
  opts: SendTypedMessageOptions = {}
): Promise<TResult> {
  const envelope: MessageEnvelope<TPayload> = { type, payload, requestId: nextRequestId() };
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  const timeoutPromise = new Promise<never>((_resolve, reject) => {
    setTimeout(() => reject(new MessagingTimeoutError(`No response to message type "${type}" within ${timeoutMs}ms`)), timeoutMs);
  });

  const response = (await Promise.race([runtime.sendMessage(envelope), timeoutPromise])) as ResponseEnvelope<TResult> | undefined;

  if (response === undefined) {
    throw new Error(`No handler responded to message type "${type}"`);
  }
  if (!response.ok) {
    throw new Error(response.error?.message ?? `Message type "${type}" failed`);
  }
  return response.result as TResult;
}
