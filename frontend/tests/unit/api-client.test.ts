import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiError, request } from '../../src/api/client';

afterEach(() => vi.unstubAllGlobals());
describe('API mutation error semantics', () => {
  it('sends the same-origin cookie and JSON empty body and accepts 204 without JSON parsing', async () => {
    const parse = vi.fn();
    const fetch = vi.fn().mockResolvedValue({ ok: true, status: 204, json: parse });
    vi.stubGlobal('fetch', fetch);
    await expect(request('/auth/logout', { method: 'POST' })).resolves.toBeUndefined();
    expect(fetch).toHaveBeenCalledOnce();
    expect(fetch).toHaveBeenCalledWith('/api/auth/logout', expect.objectContaining({ credentials: 'same-origin', body: '{}', referrerPolicy: 'no-referrer', headers: expect.objectContaining({ 'Content-Type': 'application/json', 'X-Requested-With': 'Wishlist' }) }));
    expect(parse).not.toHaveBeenCalled();
  });
  it('never retries a reservation whose network outcome is unknown', async () => {
    const fetch = vi.fn().mockRejectedValue(new Error('raw URL must not escape'));
    vi.stubGlobal('fetch', fetch);
    await expect(request('/shared/synthetic/gifts/synthetic/reservations', { method: 'POST' })).rejects.toMatchObject({ code: 'NETWORK_ERROR', outcomeUnknown: true });
    expect(fetch).toHaveBeenCalledOnce();
  });
  it('preserves conflict classification and Retry-After without raw transport text', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ requestId: 'synthetic-request', error: { code: 'GIFT_RESERVED', message: 'Already reserved' } }), { status: 409, headers: { 'Retry-After': '7' } })));
    await expect(request('/shared/synthetic/gifts/synthetic/reservations', { method: 'POST' })).rejects.toMatchObject({ status: 409, code: 'GIFT_RESERVED', retryAfterSeconds: 7, outcomeUnknown: false });
  });
  it('refuses off-origin paths before making a request', async () => {
    const fetch = vi.fn(); vi.stubGlobal('fetch', fetch);
    await expect(request('//foreign.test/path')).rejects.toBeInstanceOf(ApiError);
    expect(fetch).not.toHaveBeenCalled();
  });
});
