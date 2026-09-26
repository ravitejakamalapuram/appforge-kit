import { describe, it, expect, vi } from 'vitest';
import { createMessageRouter } from '../src/index.js';

describe('createMessageRouter', () => {
  it('dispatches to the matching handler and responds ok:true with its result (typed payload, not cast to unknown)', async () => {
    const router = createMessageRouter({ greet: async (payload: { name: string }) => `hello ${payload.name}` });
    const sendResponse = vi.fn();
    const keepChannelOpen = router({ type: 'greet', payload: { name: 'ada' }, requestId: 'r1' }, {}, sendResponse);
    expect(keepChannelOpen).toBe(true);
    await vi.waitFor(() => expect(sendResponse).toHaveBeenCalled());
    expect(sendResponse).toHaveBeenCalledWith({ requestId: 'r1', ok: true, result: 'hello ada' });
  });

  it('responds ok:false with the error message when an async handler rejects', async () => {
    const router = createMessageRouter({ boom: async () => { throw new Error('kaboom'); } });
    const sendResponse = vi.fn();
    router({ type: 'boom', payload: {}, requestId: 'r2' }, {}, sendResponse);
    await vi.waitFor(() => expect(sendResponse).toHaveBeenCalled());
    expect(sendResponse).toHaveBeenCalledWith({ requestId: 'r2', ok: false, error: { message: 'kaboom' } });
  });

  it('does not respond when no handler matches the message type, deferring to any other router (see the dedicated test below for why)', () => {
    const router = createMessageRouter({});
    const sendResponse = vi.fn();
    const keepChannelOpen = router({ type: 'unknown', payload: {}, requestId: 'r3' }, {}, sendResponse);
    expect(sendResponse).not.toHaveBeenCalled();
    expect(keepChannelOpen).toBe(false);
  });

  it('ignores (returns false, never calls sendResponse) a message that is not our envelope shape, so other listeners can handle it', () => {
    const router = createMessageRouter({ greet: async () => 'x' });
    const sendResponse = vi.fn();
    const keepChannelOpen = router({ someOtherLibrarysMessage: true }, {}, sendResponse);
    expect(keepChannelOpen).toBe(false);
    expect(sendResponse).not.toHaveBeenCalled();
  });

  it('does not respond and returns false for an unmatched type, so a router in ANOTHER context (e.g. an offscreen document) still gets a chance to answer (fix: was answering ok:false and stealing the message)', () => {
    const router = createMessageRouter({ onlyMine: async () => 'x' });
    const sendResponse = vi.fn();
    const keepChannelOpen = router({ type: 'someoneElses', payload: {}, requestId: 'r4' }, {}, sendResponse);
    expect(sendResponse).not.toHaveBeenCalled();
    expect(keepChannelOpen).toBe(false);
  });

  it('catches a SYNCHRONOUS throw from a non-async handler instead of letting it escape the listener (fix: was hanging the sender until timeout)', async () => {
    const router = createMessageRouter({ syncBoom: () => { throw new Error('sync kaboom'); } });
    const sendResponse = vi.fn();
    expect(() => router({ type: 'syncBoom', payload: {}, requestId: 'r5' }, {}, sendResponse)).not.toThrow();
    await vi.waitFor(() => expect(sendResponse).toHaveBeenCalled());
    expect(sendResponse).toHaveBeenCalledWith({ requestId: 'r5', ok: false, error: { message: 'sync kaboom' } });
  });

  it('handles a synchronous (non-Promise) return value from a handler', async () => {
    const router = createMessageRouter({ sync: () => 'immediate result' });
    const sendResponse = vi.fn();
    router({ type: 'sync', payload: {}, requestId: 'r6' }, {}, sendResponse);
    await vi.waitFor(() => expect(sendResponse).toHaveBeenCalled());
    expect(sendResponse).toHaveBeenCalledWith({ requestId: 'r6', ok: true, result: 'immediate result' });
  });

  it('does not dispatch to an inherited Object.prototype member (fix: "toString"/"constructor"/"hasOwnProperty" were reachable as message types)', () => {
    const router = createMessageRouter({ greet: async () => 'x' });
    const sendResponse = vi.fn();
    for (const type of ['toString', 'constructor', 'hasOwnProperty', 'valueOf']) {
      expect(() => router({ type, payload: {}, requestId: 'rp' }, {}, sendResponse)).not.toThrow();
    }
    expect(sendResponse).not.toHaveBeenCalled();
  });

  it('never lets a throwing sendResponse escape as an unhandled rejection (fix: the port may already be closed)', async () => {
    const router = createMessageRouter({ greet: async () => 'hi' });
    const throwingSendResponse = vi.fn(() => { throw new Error('port closed'); });
    expect(() => router({ type: 'greet', payload: {}, requestId: 'r7' }, {}, throwingSendResponse)).not.toThrow();
    await vi.waitFor(() => expect(throwingSendResponse).toHaveBeenCalled());
    // If the throw inside sendResponse were unhandled, this test would fail the whole run via
    // an "unhandled rejection" reporter — reaching this line at all is the assertion.
    expect(throwingSendResponse).toHaveBeenCalledTimes(1);
  });
});
