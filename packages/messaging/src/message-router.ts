import type { MessageEnvelope, ResponseEnvelope, RuntimeMessageListener } from './types.js';

function isMessageEnvelope(value: unknown): value is MessageEnvelope {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as MessageEnvelope).type === 'string' &&
    typeof (value as MessageEnvelope).requestId === 'string'
  );
}

function respondSafely(sendResponse: (response: ResponseEnvelope) => void, response: ResponseEnvelope): void {
  try {
    sendResponse(response);
  } catch {
    // The message port may already be closed (e.g. the sender navigated away or the extension
    // reloaded) — there is nothing more we can do, and this must never become an unhandled
    // rejection that (with @appforge/errors installed) would feed straight back into itself.
  }
}

/**
 * Builds a chrome.runtime.onMessage listener that dispatches by `type` to the matching handler
 * in `handlers`, responding with a ResponseEnvelope. `H` is inferred from the object literal
 * passed in, so a handler's payload/result types are checked normally instead of forcing every
 * handler down to `(payload: unknown) => unknown`.
 *
 * Returns `false` (don't keep the message channel open, and — for an unmatched type — don't
 * respond at all) for anything that isn't ours, so:
 * - a message meant for a router in another context (the service worker, popup, an offscreen
 *   document — MV3 may have several onMessage listeners for the same message) still gets a
 *   chance to be answered there;
 * - `sendTypedMessage`'s "no handler responded" error is still reachable when truly nobody
 *   answers, instead of some other router's "no handler for type X" masking that.
 */
export function createMessageRouter<H extends Record<string, (payload: any) => any>>(handlers: H): RuntimeMessageListener {
  return (message, _sender, sendResponse) => {
    if (!isMessageEnvelope(message)) return false;
    // `in`/bracket lookup on a plain object also finds inherited Object.prototype members
    // (`toString`, `constructor`, `hasOwnProperty`, ...). A message `type` is attacker- or
    // bug-reachable (any extension surface, including a content script, can send one), so only
    // an actual *own* property of `handlers` counts as "ours".
    if (!Object.hasOwn(handlers, message.type)) return false;

    const handler = handlers[message.type];
    // Wrapping the call itself in the promise chain (rather than calling it first and passing
    // the result to Promise.resolve) means a handler that throws *synchronously* — a plain,
    // non-async function — is caught here too, instead of throwing out of this listener and
    // leaving the sender to wait out the full timeout for no reason.
    Promise.resolve()
      .then(() => handler(message.payload))
      .then((result) => respondSafely(sendResponse, { requestId: message.requestId, ok: true, result }))
      .catch((err: unknown) =>
        respondSafely(sendResponse, { requestId: message.requestId, ok: false, error: { message: err instanceof Error ? err.message : String(err) } })
      );
    return true; // keep the channel open for the async sendResponse above
  };
}
