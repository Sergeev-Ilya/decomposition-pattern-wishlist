import { describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import { createApp } from '../src/app';
import { Config, loadConfig } from '../src/config';
import { Fetch } from '../src/upstream';

const id = '12345678-1234-4234-8234-123456789abc';
const token = 'a'.repeat(43);
const user = { id, email: 'owner@example.test', displayName: 'owner', createdAt: '2026-10-28T00:00:00.000Z' };
const config: Config = { port: 8080, authServiceUrl: 'http://auth:3000', wishlistServiceUrl: 'http://wishlist:3000', appOrigin: 'http://localhost:8880', internalToken: 'private-credential-'.repeat(3), upstreamTimeoutMs: 100, trustedProxyIps: [] };
const json = (body: unknown, status = 200, headers: Record<string, string> = {}) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', ...headers } });
const safe = { Origin: config.appOrigin, 'X-Requested-With': 'Wishlist' };
function appWith(handler: (url: string, init: RequestInit) => Response | Promise<Response>, override: Partial<Config> = {}, now?: () => number) {
  const fetcher = vi.fn((url: unknown, init?: RequestInit) => Promise.resolve(handler(String(url), init!)));
  const app = createApp({ config: { ...config, ...override }, fetch: fetcher as Fetch, now });
  return { app, fetcher };
}

describe('gateway authentication and trust boundary', () => {
  it('requires a cookie for owner routes regardless of spoofed identity', async () => {
    const { app, fetcher } = appWith(() => json({ wishlists: [] }));
    const response = await request(app).get('/api/wishlists').set({ Authorization: 'Bearer forged', 'X-User-Id': id, 'X-Internal-Token': config.internalToken });
    expect(response.status).toBe(401);
    expect(fetcher).not.toHaveBeenCalled();
  });
  it('uses only verified identity and freshly built upstream headers without caching', async () => {
    const { app, fetcher } = appWith(url => url.endsWith('/validate') ? json({ user }) : json({ wishlists: [] }));
    for (let i = 0; i < 2; i++) {
      expect((await request(app).get('/api/wishlists?redirect=http://evil').set({ Cookie: 'other=secret; wishlist_session=real-token', Authorization: 'Bearer forged', 'X-User-Id': 'spoof', 'X-User-Email': 'secret', 'X-Internal-Token': 'spoof', 'X-Internal-Other': 'spoof', 'X-Forwarded-For': '1.2.3.4', 'X-Request-Id': id })).status).toBe(200);
    }
    expect(fetcher).toHaveBeenCalledTimes(4);
    const [, validation] = fetcher.mock.calls[0];
    expect(JSON.parse(String(validation!.body))).toEqual({ token: 'real-token' });
    const [url, init] = fetcher.mock.calls[1];
    expect(url).toBe('http://wishlist:3000/wishlists');
    expect(init!.redirect).toBe('error');
    expect(init!.headers).toEqual({ accept: 'application/json', 'x-internal-token': config.internalToken, 'x-user-id': id, 'x-request-id': expect.any(String) });
    expect((init!.headers as Record<string, string>)['x-request-id']).not.toBe(id);
  });
  it('treats an absent shared cookie as guest and drops all supplied identity', async () => {
    const { app, fetcher } = appWith(() => json({ wishlist: { isOwner: false } }));
    expect((await request(app).get(`/api/shared/${token}`).set({ 'X-User-Id': id, Authorization: 'Bearer forged' })).status).toBe(200);
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(fetcher.mock.calls[0][1]!.headers).not.toHaveProperty('x-user-id');
  });
  it.each(['wishlist_session=', 'wishlist_session=a; wishlist_session=b', 'wishlist_session=%ZZ', 'wishlist_session'])('rejects malformed present shared cookie %s', async cookie => {
    const { app, fetcher } = appWith(() => json({ wishlist: {} }));
    expect((await request(app).get(`/api/shared/${token}`).set('Cookie', cookie)).status).toBe(401);
    expect(fetcher).not.toHaveBeenCalled();
  });
  it.each([400, 401])('maps invalid-session auth status %s to 401 without guest fallback', async status => {
    const { app, fetcher } = appWith(() => json({ error: { code: 'VALIDATION_ERROR' } }, status));
    expect((await request(app).get(`/api/shared/${token}`).set('Cookie', 'wishlist_session=invalid')).status).toBe(401);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it('never calls wishlist after auth unavailability', async () => {
    const { app, fetcher } = appWith(() => { throw new Error('connection refused secret'); });
    expect((await request(app).get(`/api/shared/${token}`).set('Cookie', 'wishlist_session=token')).status).toBe(503);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it.each(['get', 'cancel'])('ignores malformed cookie on secret %s while auth is down', async operation => {
    const { app, fetcher } = appWith(url => {
      if (url.startsWith(config.authServiceUrl)) throw new Error('auth down');
      return json({ reservation: { status: 'active' } });
    });
    const response = operation === 'get' ? await request(app).get(`/api/reservations/${token}`).set('Cookie', 'wishlist_session=%ZZ') : await request(app).post(`/api/reservations/${token}/cancel`).set(safe).set('Cookie', 'wishlist_session=%ZZ').send({});
    expect(response.status).toBe(200);
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(fetcher.mock.calls[0][1]!.headers).not.toHaveProperty('cookie');
  });
  it('delegates logout directly and preserves cookie deletion', async () => {
    const { app, fetcher } = appWith(() => new Response(null, { status: 204, headers: { 'Set-Cookie': 'wishlist_session=; Max-Age=0; Path=/; HttpOnly; SameSite=Lax' } }));
    const response = await request(app).post('/api/auth/logout').set(safe).set('Cookie', 'wishlist_session=expired; unrelated=private').send({});
    expect(response.status).toBe(204);
    expect(response.headers['set-cookie'][0]).toContain('Max-Age=0');
    expect(fetcher.mock.calls[0][0]).toBe('http://auth:3000/auth/logout');
    expect(fetcher.mock.calls[0][1]!.headers).toHaveProperty('cookie', 'wishlist_session=expired');
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it('rebuilds auth JSON without JWT/internal fields and preserves separate Set-Cookie headers', async () => {
    const { app } = appWith(() => {
      const response = json({ user: { ...user, jwt: 'hidden' }, token: 'hidden', sessionId: id }, 200, { 'X-Internal-Token': 'hidden', 'X-User-Id': id, 'Content-Encoding': 'gzip', 'Content-Length': '999999' });
      response.headers.append('Set-Cookie', 'wishlist_session=jwt; Path=/; HttpOnly; SameSite=Lax');
      response.headers.append('Set-Cookie', 'second=value; Path=/; HttpOnly');
      return response;
    });
    const response = await request(app).post('/api/auth/login').set(safe).send({ email: user.email, password: 'password12345' });
    expect(response.status).toBe(200);
    expect(response.body).toEqual({ user });
    expect(response.headers['set-cookie']).toHaveLength(2);
    expect(response.headers['x-internal-token']).toBeUndefined();
    expect(response.headers['x-user-id']).toBeUndefined();
    expect(response.headers['content-encoding']).toBeUndefined();
    expect(Number(response.headers['content-length'])).toBe(Buffer.byteLength(JSON.stringify({ user })));
  });
});

describe('routing and request guards', () => {
  it('has independent health without upstreams', async () => {
    const { app, fetcher } = appWith(() => { throw new Error('down'); });
    const response = await request(app).get('/health');
    expect(response.body).toEqual({ status: 'ok' });
    expect(response.headers['cache-control']).toBe('no-store');
    expect(response.headers['referrer-policy']).toBe('no-referrer');
    expect(response.headers['x-robots-tag']).toBe('noindex, nofollow');
    expect(response.headers['x-request-id']).toMatch(/^[a-f0-9-]{36}$/);
    expect(fetcher).not.toHaveBeenCalled();
  });
  it.each(['/api/internal/sessions/validate', '/api/anything', '/api/auth/me/extra', '/api/wishlists/', '/api/shared/%ZZ', '/api/shared/%2F', '/api/shared/short', '/api/reservations/short', '/api/reservations/%E0%A4%A'])('returns neutral JSON404 for %s', async path => {
    const { app, fetcher } = appWith(() => json({}));
    const response = await request(app).get(path);
    expect(response.status).toBe(404);
    expect(response.body.error).toEqual({ code: 'NOT_FOUND', message: 'Not found' });
    expect(fetcher).not.toHaveBeenCalled();
  });
  it.each([['/api/wishlists', 'GET, POST'], ['/api/auth/me', 'GET'], [`/api/reservations/${token}`, 'GET']])('returns 405+Allow for known route %s', async (path, allow) => {
    const { app } = appWith(() => json({}));
    const response = await request(app).put(path);
    expect(response.status).toBe(405);
    expect(response.headers.allow).toBe(allow);
    expect(response.body.error.code).toBe('METHOD_NOT_ALLOWED');
  });
  it('does not implicitly allow HEAD or OPTIONS', async () => {
    const { app } = appWith(() => json({}));
    expect((await request(app).head('/api/auth/me')).status).toBe(405);
    expect((await request(app).options('/api/auth/me')).status).toBe(405);
  });
  it.each([{}, { Origin: 'http://evil', 'X-Requested-With': 'Wishlist' }, { Origin: config.appOrigin }, { Origin: config.appOrigin + '/', 'X-Requested-With': 'Wishlist' }])('requires exact origin and request marker %j', async headers => {
    const { app, fetcher } = appWith(() => json({}));
    expect((await request(app).post(`/api/reservations/${token}/cancel`).set(headers).send({})).status).toBe(403);
    expect(fetcher).not.toHaveBeenCalled();
  });
  it.each([undefined, 'text/plain', 'application/jsonp'])('rejects unsupported/missing content type %s even with empty body', async type => {
    const { app } = appWith(() => json({}));
    const req = request(app).post('/api/auth/logout').set(safe);
    if (type) req.set('Content-Type', type);
    expect((await req).status).toBe(415);
  });
  it.each(['', '{bad', 'null', '[]', '1', '{"unexpected":true}'])('requires strict object JSON {} for empty operations %s', async body => {
    const { app, fetcher } = appWith(() => json({}));
    expect((await request(app).post('/api/auth/logout').set(safe).set('Content-Type', 'application/json').send(body)).status).toBe(400);
    expect(fetcher).not.toHaveBeenCalled();
  });
  it('accepts JSON with charset and rejects body larger than 32KiB', async () => {
    const { app } = appWith(() => new Response(null, { status: 204 }));
    expect((await request(app).post('/api/auth/logout').set(safe).set('Content-Type', 'application/json; charset=utf-8').send('{}')).status).toBe(204);
    expect((await request(app).post('/api/auth/logout').set(safe).send({ oversized: 'a'.repeat(32768) })).status).toBe(413);
  });
  it('rejects unknown fields on DELETE before calling upstreams', async () => {
    const { app, fetcher } = appWith(() => json({}));
    expect((await request(app).delete(`/api/wishlists/${id}`).set(safe).send({ ownerId: id })).status).toBe(400);
    expect(fetcher).not.toHaveBeenCalled();
  });
});

describe('upstream failures and rate limits', () => {
  it.each([() => { throw new Error('secret upstream URL'); }, () => new Response('<h1>Oops</h1>', { status: 502 }), () => new Response('{bad', { headers: { 'Content-Type': 'application/json' } }), () => json({ wrong: true }), () => new Response(null, { status: 302, headers: { Location: 'http://evil' } })])('maps unavailable/invalid upstream to safe 503', async handler => {
    const { app } = appWith(handler);
    const response = await request(app).get(`/api/reservations/${token}`);
    expect(response.status).toBe(503);
    expect(response.body.error).toEqual({ code: 'SERVICE_UNAVAILABLE', message: 'Service unavailable' });
    expect(response.body.requestId).toBe(response.headers['x-request-id']);
  });
  it('sanitizes upstream errors instead of returning their details', async () => {
    const { app } = appWith(() => json({ error: { code: 'NOT_FOUND', message: `SQL password ${token}` }, requestId: id }, 404));
    const response = await request(app).get(`/api/reservations/${token}`);
    expect(response.status).toBe(404);
    expect(response.body.error.message).toBe('Not found');
    expect(JSON.stringify(response.body)).not.toContain(token);
    expect(response.body.requestId).not.toBe(id);
  });
  it.each([false, true])('returns 504 on timeout including session validation %s', async shared => {
    const { app, fetcher } = appWith((_url, init) => new Promise((_resolve, reject) => init.signal!.addEventListener('abort', () => reject(new Error('aborted')))), { upstreamTimeoutMs: 10 });
    const path = shared ? `/api/shared/${token}` : `/api/reservations/${token}`;
    const response = await request(app).get(path).set('Cookie', 'wishlist_session=valid');
    expect(response.status).toBe(504);
    expect(response.body.error.code).toBe('GATEWAY_TIMEOUT');
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it('combines register and login limits, ignores spoofed forwarding, and expires windows', async () => {
    let time = 0;
    const { app, fetcher } = appWith(() => json({ user }), {}, () => time);
    for (let i = 0; i < 20; i++) expect((await request(app).post(i % 2 ? '/api/auth/register' : '/api/auth/login').set(safe).set('X-Forwarded-For', `10.0.0.${i}`).send({})).status).not.toBe(429);
    const response = await request(app).post('/api/auth/login').set(safe).send({});
    expect(response.status).toBe(429);
    expect(response.headers['retry-after']).toBe('900');
    expect(fetcher).toHaveBeenCalledTimes(20);
    time = 900000;
    expect((await request(app).post('/api/auth/login').set(safe).send({})).status).toBe(200);
  });
  it('limits guest creation to 60/min and shares secret read/cancel limit of 120/min', async () => {
    const { app } = appWith(url => url.includes('/shared/') ? json({ reservationToken: token }, 201) : json({ reservation: {} }));
    for (let i = 0; i < 60; i++) expect((await request(app).post(`/api/shared/${token}/gifts/${id}/reservations`).set(safe).send({})).status).toBe(201);
    expect((await request(app).post(`/api/shared/${token}/gifts/${id}/reservations`).set(safe).send({})).status).toBe(429);
    for (let i = 0; i < 120; i++) {
      const response = i % 2 ? await request(app).get(`/api/reservations/${token}`) : await request(app).post(`/api/reservations/${token}/cancel`).set(safe).send({});
      expect(response.status).toBe(200);
    }
    const limited = await request(app).get(`/api/reservations/${token}`);
    expect(limited.status).toBe(429);
    expect(Number(limited.headers['retry-after'])).toBeGreaterThan(0);
  });
});

describe('configuration', () => {
  const env = { INTERNAL_TOKEN: 'x'.repeat(32), AUTH_SERVICE_URL: 'http://auth:3000', WISHLIST_SERVICE_URL: 'http://wishlist:3000' };
  it('loads local defaults without JWT secret or database', () => {
    expect(loadConfig(env)).toMatchObject({ port: 8080, appOrigin: 'http://localhost:8880', trustedProxyIps: [], upstreamTimeoutMs: 5000 });
  });
  it.each([{ INTERNAL_TOKEN: '' }, { INTERNAL_TOKEN: 'short' }, { AUTH_SERVICE_URL: 'http://auth/path' }, { AUTH_SERVICE_URL: 'http://user:pass@auth' }, { APP_ORIGIN: 'http://localhost:8880/' }, { TRUSTED_PROXY_IPS: 'true' }, { UPSTREAM_TIMEOUT_MS: '0' }])('rejects insecure or invalid configuration %j', override => {
    expect(() => loadConfig({ ...env, ...override })).toThrow();
  });
});
