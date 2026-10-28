import { Router } from 'express';
import { randomUUID } from 'node:crypto';
import { Pool, QueryResultRow } from 'pg';
import { Config } from '../config';
import { ApiError, invalidInput, unauthenticated, unavailable } from '../middleware/errorHandler';
import { hashPassword, verifyPassword, checkUnknownPassword } from '../password';
import { Claims, COOKIE_NAME, TTL, cookieOptions, readCookie, signSession, verifySession } from '../session';

interface UserRow extends QueryResultRow { id: string; email: string; created_at: Date; password_hash: string; }
interface SessionRow extends UserRow { session_id: string; expires_at: Date; }
function userDto(user: UserRow) {
  return { id: user.id, email: user.email, displayName: user.email.split('@')[0], createdAt: user.created_at.toISOString() };
}
function validEmail(email: string): boolean {
  const parts = email.split('@');
  if (parts.length !== 2) return false;
  const [local, domain] = parts;
  if (!local || local.length > 64 || local.startsWith('.') || local.endsWith('.') || local.includes('..')) return false;
  if (!/^[a-z0-9.!#$%&'*+\/=?^_`{|}~-]+$/.test(local)) return false;
  const labels = domain.split('.');
  return labels.length >= 2 && labels.every(label => /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(label));
}
function credentials(value: unknown): { email: string; password: string } {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw invalidInput();
  const input = value as Record<string, unknown>;
  if (Object.keys(input).length !== 2 || typeof input.email !== 'string' || typeof input.password !== 'string') throw invalidInput();
  if ([...input.email].length > 1024) throw invalidInput();
  const email = input.email.trim().toLowerCase();
  const length = [...input.password].length;
  if ([...email].length > 254 || !validEmail(email) || length < 12 || length > 128) throw invalidInput();
  return { email, password: input.password };
}
function newClaims(userId: string): Claims {
  const iat = Math.floor(Date.now() / 1000);
  return { sub: userId, sid: randomUUID(), iat, exp: iat + TTL };
}
async function query<T extends QueryResultRow>(pool: Pool, sql: string, values: unknown[] = []) {
  try { return await pool.query<T>(sql, values); } catch { throw unavailable(); }
}
async function activeSession(pool: Pool, claims: Claims | null): Promise<SessionRow> {
  if (!claims) throw unauthenticated();
  const result = await query<SessionRow>(pool, `SELECT u.id, u.email, u.created_at, s.id AS session_id, s.expires_at
    FROM sessions s JOIN users u ON u.id=s.user_id
    WHERE s.id=$1 AND s.user_id=$2 AND s.revoked_at IS NULL AND s.expires_at>now()
      AND s.expires_at=to_timestamp($3) AND s.created_at=to_timestamp($4)`, [claims.sid, claims.sub, claims.exp, claims.iat]);
  if (!result.rows[0]) throw unauthenticated();
  return result.rows[0];
}

export function authRouter(pool: Pool, config: Config): Router {
  const router = Router();
  router.post('/auth/register', async (req, res) => {
    const input = credentials(req.body);
    const passwordHash = await hashPassword(input.password);
    const userId = randomUUID();
    const claims = newClaims(userId);
    // Prepare cryptographic work before commit; cookie is sent only after commit.
    const token = signSession(claims, config);
    let client;
    let user: UserRow;
    try {
      client = await pool.connect();
      await client.query('BEGIN');
      const result = await client.query<UserRow>('INSERT INTO users (id,email,password_hash) VALUES ($1,$2,$3) RETURNING id,email,created_at', [userId, input.email, passwordHash]);
      user = result.rows[0];
      await client.query('INSERT INTO sessions (id,user_id,created_at,expires_at) VALUES ($1,$2,to_timestamp($3),to_timestamp($4))', [claims.sid, userId, claims.iat, claims.exp]);
      await client.query('COMMIT');
    } catch (error) {
      await client?.query('ROLLBACK').catch(() => undefined);
      if (typeof error === 'object' && error !== null && 'code' in error && error.code === '23505' && 'constraint' in error && error.constraint === 'users_email_key') throw new ApiError(409, 'EMAIL_IN_USE', 'Email already registered');
      throw unavailable();
    } finally { client?.release(); }
    res.cookie(COOKIE_NAME, token, { ...cookieOptions(config), maxAge: TTL * 1000 });
    res.status(201).json({ user: userDto(user) });
  });
  router.post('/auth/login', async (req, res) => {
    const input = credentials(req.body);
    const result = await query<UserRow>(pool, 'SELECT id,email,password_hash,created_at FROM users WHERE email=$1', [input.email]);
    const user = result.rows[0];
    let valid = false;
    if (user) valid = await verifyPassword(input.password, user.password_hash);
    else await checkUnknownPassword(input.password);
    if (!user || !valid) throw new ApiError(401, 'INVALID_CREDENTIALS', 'Invalid email or password');
    const claims = newClaims(user.id);
    const token = signSession(claims, config);
    await query(pool, 'INSERT INTO sessions (id,user_id,created_at,expires_at) VALUES ($1,$2,to_timestamp($3),to_timestamp($4))', [claims.sid, user.id, claims.iat, claims.exp]);
    res.cookie(COOKIE_NAME, token, { ...cookieOptions(config), maxAge: TTL * 1000 });
    res.json({ user: userDto(user) });
  });
  router.get('/auth/me', async (req, res) => {
    const user = await activeSession(pool, verifySession(readCookie(req), config));
    res.json({ user: userDto(user) });
  });
  router.post('/auth/logout', async (req, res) => {
    const claims = verifySession(readCookie(req), config);
    if (claims) {
      // Even an already-revoked signed session requires a successful DB statement.
      await query(pool, 'UPDATE sessions SET revoked_at=COALESCE(revoked_at,now()) WHERE id=$1 AND user_id=$2', [claims.sid, claims.sub]);
    }
    res.cookie(COOKIE_NAME, '', { ...cookieOptions(config), maxAge: 0 });
    res.status(204).end();
  });
  router.post('/internal/sessions/validate', async (req, res) => {
    const body = req.body as Record<string, unknown> | undefined;
    if (!body || typeof body !== 'object' || Array.isArray(body) || Object.keys(body).length !== 1 || typeof body.token !== 'string' || !body.token.length || body.token.length > 4096) throw invalidInput();
    const session = await activeSession(pool, verifySession(body.token, config));
    res.json({ user: userDto(session), sessionId: session.session_id, expiresAt: session.expires_at.toISOString() });
  });
  return router;
}
