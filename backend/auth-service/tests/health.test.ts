import { describe, it, expect } from 'vitest';
import request from 'supertest';
import { randomUUID } from 'node:crypto';
import { app, config, pool, userIds } from './setup';
import { createApp } from '../src/app';
import { Pool } from 'pg';
import jwt, { JwtPayload } from 'jsonwebtoken';
import { createConnection } from 'node:net';
const header = { 'X-Internal-Token': config.internalToken };
const password = '  very long password  ';
const email = `basic-${randomUUID()}@example.com`;
let cookie = '';
let token = '';
let loginCookie = '';

describe('Auth on real PostgreSQL', () => {
  it('health verifies the database and sets private response headers', async () => {
    const response = await request(app).get('/health');
    expect(response.status).toBe(200);
    expect(response.body).toEqual({ status: 'ok' });
    expect(response.headers['cache-control']).toBe('no-store');
    expect(response.headers['referrer-policy']).toBe('no-referrer');
    expect(response.headers['x-robots-tag']).toContain('noindex');
  });
  it('rejects every protected path before accepting credentials', async () => {
    for (const path of ['/auth/register', '/auth/login', '/auth/logout', '/internal/sessions/validate']) {
      const response = await request(app).post(path).set('X-Internal-Token', 'wrong').send({});
      expect(response.status).toBe(403);
      expect(response.body.error.code).toBe('FORBIDDEN');
      expect(response.body.requestId).toMatch(/^[0-9a-f-]{36}$/);
    }
    expect((await request(app).get('/auth/me')).status).toBe(403);
  });
  it('registers normalized email with an HttpOnly cookie, no JSON token', async () => {
    const response = await request(app).post('/auth/register').set(header).send({ email: `  ${email.toUpperCase()} `, password });
    expect(response.status).toBe(201);
    userIds.push(response.body.user.id);
    expect(Object.keys(response.body)).toEqual(['user']);
    expect(response.body.user.email).toBe(email);
    expect(Object.keys(response.body.user).sort()).toEqual(['createdAt', 'displayName', 'email', 'id']);
    const raw = response.headers['set-cookie'][0];
    expect(raw).toContain('HttpOnly'); expect(raw).toContain('SameSite=Lax'); expect(raw).toContain('Max-Age=86400'); expect(raw).toContain('Path=/');
    cookie = raw.split(';')[0]; token = cookie.slice('wishlist_session='.length);
    const hash = (await pool.query('SELECT password_hash FROM users WHERE id=$1', [response.body.user.id])).rows[0].password_hash;
    expect(hash).toMatch(/^scrypt\$32768\$8\$3\$/);
  });
  it('enforces normalized uniqueness without creating another session', async () => {
    const response = await request(app).post('/auth/register').set(header).send({ email, password });
    expect(response.status).toBe(409); expect(response.headers['set-cookie']).toBeUndefined();
    expect((await pool.query('SELECT count(*)::int AS n FROM sessions WHERE user_id=$1', [userIds[0]])).rows[0].n).toBe(1);
  });
  it('returns own user and validates the internal session', async () => {
    const me = await request(app).get('/auth/me').set(header).set('Cookie', cookie);
    expect(me.status).toBe(200); expect(me.body.user.email).toBe(email);
    const validated = await request(app).post('/internal/sessions/validate').set(header).send({ token });
    expect(validated.status).toBe(200); expect(validated.body.sessionId).toBeTypeOf('string'); expect(validated.body.expiresAt).toBeTypeOf('string');
  });
  it('keeps password spaces significant and unknown-user failures uniform', async () => {
    const wrong = await request(app).post('/auth/login').set(header).send({ email, password: password.trim() });
    const unknown = await request(app).post('/auth/login').set(header).send({ email: `unknown-${email}`, password });
    expect(wrong.status).toBe(401); expect(unknown.status).toBe(401); expect(wrong.body.error).toEqual(unknown.body.error);
    expect(wrong.headers['set-cookie']).toBeUndefined();
  });
  it('creates an independent login session', async () => {
    const response = await request(app).post('/auth/login').set(header).send({ email, password });
    expect(response.status).toBe(200); loginCookie = response.headers['set-cookie'][0].split(';')[0];
    expect(loginCookie).not.toBe(cookie);
  });
  it('logout revokes immediately while preserving the other session', async () => {
    const response = await request(app).post('/auth/logout').set(header).set('Cookie', cookie).send({});
    expect(response.status).toBe(204); expect(response.headers['set-cookie'][0]).toContain('Max-Age=0');
    expect((await request(app).get('/auth/me').set(header).set('Cookie', cookie)).status).toBe(401);
    expect((await request(app).post('/internal/sessions/validate').set(header).send({ token })).status).toBe(401);
    expect((await request(app).get('/auth/me').set(header).set('Cookie', loginCookie)).status).toBe(200);
    expect((await request(app).post('/auth/logout').set(header).set('Cookie', cookie).send({})).status).toBe(204);
  });
  it('does not clear a signed active cookie when the database fails', async () => {
    const closedPool = new Pool({ connectionString: config.databaseUrl });
    await closedPool.end();
    const unavailableApp = createApp({ config, pool: closedPool });
    const response = await request(unavailableApp).post('/auth/logout').set(header).set('Cookie', loginCookie).send({});
    expect(response.status).toBe(503);
    expect(response.body.error.code).toBe('SERVICE_UNAVAILABLE');
    expect(response.headers['set-cookie']).toBeUndefined();
    expect((await request(unavailableApp).get('/health')).status).toBe(503);
  });
  it('rejects malformed inputs and counts password Unicode code points', async () => {
    expect((await request(app).post('/auth/register').set(header).send({ email, password: '😀'.repeat(11) })).status).toBe(400);
    const response = await request(app).post('/auth/register').set(header).send({ email: `unicode-${email}`, password: '😀'.repeat(12) });
    expect(response.status).toBe(201); userIds.push(response.body.user.id);
    expect((await request(app).post('/auth/register').set(header).send({ email, password, extra: true })).status).toBe(400);
  });
  it('validates JWT signature, algorithm, issuer, audience, required claims and DB ownership', async () => {
    const original = loginCookie.slice('wishlist_session='.length);
    const claims = jwt.verify(original, config.jwtSecret, { algorithms: ['HS256'], issuer: 'wishlist-auth', audience: 'wishlist-web' }) as JwtPayload;
    expect(claims.exp! - claims.iat!).toBe(86400);
    expect(jwt.decode(original, { complete: true })!.header.alg).toBe('HS256');
    const sign = (changes: Record<string, unknown>, algorithm: 'HS256' | 'HS384' | 'none' = 'HS256') => jwt.sign({ ...claims, ...changes }, algorithm === 'none' ? '' : config.jwtSecret, { algorithm });
    const missing = (key: string) => { const copy = { ...claims }; delete copy[key]; return jwt.sign(copy, config.jwtSecret, key === 'iat' ? { noTimestamp: true } : {}); };
    const now = Math.floor(Date.now() / 1000);
    const invalid = [
      jwt.sign(claims, 'different-signing-secret'), sign({}, 'HS384'), sign({}, 'none'),
      sign({ iss: 'other' }), sign({ aud: 'other' }), sign({ aud: ['wishlist-web', 'other'] }),
      ...['sub', 'sid', 'iat', 'exp'].map(missing),
      sign({ sub: 'bad' }), sign({ sid: 'bad' }), sign({ sub: randomUUID() }), sign({ sid: randomUUID() }),
      sign({ iat: now + 60, exp: now + 86460 }), sign({ exp: claims.exp! + 1 }),
      sign({ iat: now - 86401, exp: now - 1 }), sign({ iat: claims.iat! - 1, exp: claims.exp! - 1 }),
    ];
    for (const candidate of invalid) {
      const response = await request(app).post('/internal/sessions/validate').set(header).send({ token: candidate });
      expect(response.status).toBe(401);
      expect(response.body.error.code).toBe('UNAUTHENTICATED');
      expect(response.headers['set-cookie']).toBeUndefined();
    }
    // A signed identity with someone else's sid cannot revoke their session either.
    const foreign = sign({ sub: randomUUID() });
    await request(app).post('/auth/logout').set(header).set('Cookie', `wishlist_session=${foreign}`).send({}).expect(204);
    await request(app).get('/auth/me').set(header).set('Cookie', loginCookie).expect(200);
    await pool.query("UPDATE sessions SET expires_at=expires_at + interval '1 second' WHERE id=$1", [claims.sid]);
    try { await request(app).post('/internal/sessions/validate').set(header).send({ token: original }).expect(401); }
    finally { await pool.query('UPDATE sessions SET expires_at=to_timestamp($2) WHERE id=$1', [claims.sid, claims.exp]); }
  });
  it('arbitrates concurrent normalized registrations with exactly one user and session', async () => {
    const raceEmail = `race-${randomUUID()}@example.com`;
    const responses = await Promise.all([raceEmail, ` ${raceEmail.toUpperCase()} `, raceEmail].map(email => request(app).post('/auth/register').set(header).send({ email, password })));
    const winners = responses.filter(response => response.status === 201);
    winners.forEach(response => userIds.push(response.body.user.id));
    expect(winners).toHaveLength(1);
    expect(responses.filter(response => response.status === 409)).toHaveLength(2);
    responses.filter(response => response.status === 409).forEach(response => expect(response.headers['set-cookie']).toBeUndefined());
    const result = await pool.query('SELECT u.id, count(s.id)::int AS sessions FROM users u LEFT JOIN sessions s ON s.user_id=u.id WHERE email=$1 GROUP BY u.id', [raceEmail]);
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0].sessions).toBe(1);
  });
  it('rolls registration back when the first session insert fails, without issuing a cookie', async () => {
    const failedEmail = `atomic-${randomUUID()}@example.com`;
    // Real transaction and user INSERT; inject only the second SQL statement's failure.
    const failingPool = { connect: async () => {
      const client = await pool.connect();
      return {
        query: (sql: string, values?: unknown[]) => {
          if (sql.startsWith('INSERT INTO sessions')) return Promise.reject(new Error('injected session write failure'));
          return client.query(sql, values);
        },
        release: () => client.release(),
      };
    } } as unknown as Pool;
    const failingApp = createApp({ config, pool: failingPool });
    const response = await request(failingApp).post('/auth/register').set(header).send({ email: failedEmail, password });
    expect(response.status).toBe(503);
    expect(response.headers['set-cookie']).toBeUndefined();
    expect((await pool.query('SELECT id FROM users WHERE email=$1', [failedEmail])).rows).toHaveLength(0);
    expect(JSON.stringify(response.body)).not.toContain('injected');
  });
  it('accepts truly bodyless logout without Content-Length or Transfer-Encoding', async () => {
    const server = app.listen(0, '127.0.0.1');
    try {
      await new Promise<void>(resolve => server.once('listening', resolve));
      const address = server.address() as { port: number };
      const response = await new Promise<string>((resolve, reject) => {
        const socket = createConnection({ host: '127.0.0.1', port: address.port });
        let received = '';
        socket.setTimeout(3000, () => socket.destroy(new Error('HTTP timeout')));
        socket.on('connect', () => socket.write(`POST /auth/logout HTTP/1.1\r\nHost: localhost\r\nConnection: close\r\nX-Internal-Token: ${config.internalToken}\r\nContent-Type: application/json\r\n\r\n`));
        socket.on('data', data => { received += data.toString(); });
        socket.on('end', () => resolve(received)); socket.on('error', reject);
      });
      expect(response.split('\r\n')[0]).toBe('HTTP/1.1 204 No Content');
      expect(response).toContain('Max-Age=0');
    } finally { await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())); }
  });
  it('allows bodyless JSON logout and clears absent or malformed cookies idempotently', async () => {
    for (const badCookie of [undefined, 'wishlist_session=invalid', 'wishlist_session=%ZZ']) {
      const req = request(app).post('/auth/logout').set(header).set('Content-Type', 'application/json; charset=utf-8');
      if (badCookie) req.set('Cookie', badCookie);
      const response = await req;
      expect(response.status).toBe(204);
      expect(response.headers['set-cookie'][0]).toContain('Max-Age=0');
    }
    await request(app).post('/auth/logout').set(header).set('Content-Type', 'application/jsonp').expect(415);
  });

});
