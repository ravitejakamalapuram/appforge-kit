import { describe, it, expect, vi } from 'vitest';
import { createMessageRouter } from '../src/index.js';

describe('createMessageRouter', () => {
  it('dispatches to the matching handler and responds ok:true with its result', async () => {
    const router = createMessageRouter({ greet: async (payload: { name: string }) => `hello ${payload.name}` });
    const sendResponse = vi.fn();
    const keepChannelOpen = router({ type: 'greet', payload: { name: 'ada' }, requestId: 'r1' }, {}, sendResponse);
    expect(keepChannelOpen).toBe(true);
    await vi.waitFor(() => expect(sendResponse).toHaveBeenCalled());
    expect(sendResponse).toHaveBeenCalledWith({ requestId: 'r1', ok: true, result: 'hello ada' });
  });

  it('responds ok:false with the error message when the handler throws', async () => {
    const router = createMessageRouter({ boom: async () => { throw new Error('kaboom'); } });
    const sendResponse = vi.fn();
    router({ type: 'boom', payload: {}, requestId: 'r2' }, {}, sendResponse);
    await vi.waitFor(() => expect(sendResponse).toHaveBeenCalled());
    expect(sendResponse).toHaveBeenCalledWith({ requestId: 'r2', ok: false, error: { message: 'kaboom' } });
  });

  it('responds ok:false when no handler matches the message type', () => {
    const router = createMessageRouter({});
    const sendResponse = vi.fn();
    const keepChannelOpen = router({ type: 'unknown', payload: {}, requestId: 'r3' }, {}, sendResponse);
    expect(sendResponse).toHaveBeenCalledWith({ requestId: 'r3', ok: false, error: { message: expect.stringContaining('unknown') } });
    expect(keepChannelOpen).toBe(false);
  });

  it('ignores (returns false, never calls sendResponse) a message that is not our envelope shape, so other listeners can handle it', () => {
    const router = createMessageRouter({ greet: async () => 'x' });
    const sendResponse = vi.fn();
    const keepChannelOpen = router({ someOtherLibrarysMessage: true }, {}, sendResponse);
    expect(keepChannelOpen).toBe(false);
    expect(sendResponse).not.toHaveBeenCalled();
  });
});
