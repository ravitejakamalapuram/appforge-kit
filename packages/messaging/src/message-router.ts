import type { MessageEnvelope, MessageHandler, ResponseEnvelope, RuntimeMessageListener } from './types.js';

function isMessageEnvelope(value: unknown): value is MessageEnvelope {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as MessageEnvelope).type === 'string' &&
    typeof (value as MessageEnvelope).requestId === 'string'
  );
}

/**
 * Builds a chrome.runtime.onMessage listener that dispatches by `type` to the matching handler,
 * responding with a ResponseEnvelope. Returns `false` (don't keep the message channel open) for
 * anything that isn't our envelope shape, so other libraries' onMessage listeners on the same
 * page still get a chance to handle it.
 */
export function createMessageRouter(handlers: Record<string, MessageHandler>): RuntimeMessageListener {
  return (message, _sender, sendResponse) => {
    if (!isMessageEnvelope(message)) return false;

    const handler = handlers[message.type];
    if (!handler) {
      const response: ResponseEnvelope = { requestId: message.requestId, ok: false, error: { message: `No handler for message type "${message.type}"` } };
      sendResponse(response);
      return false;
    }

    Promise.resolve(handler(message.payload))
      .then((result) => sendResponse({ requestId: message.requestId, ok: true, result }))
      .catch((err: unknown) =>
        sendResponse({ requestId: message.requestId, ok: false, error: { message: err instanceof Error ? err.message : String(err) } })
      );
    return true; // keep the channel open for the async sendResponse above
  };
}
