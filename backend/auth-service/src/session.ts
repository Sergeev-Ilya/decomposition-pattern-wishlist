import { createHash, timingSafeEqual } from 'node:crypto';
import jwt from 'jsonwebtoken';
import { Request } from 'express';
import { Config } from './config';

export const COOKIE_NAME = 'wishlist_session';
export const TTL = 86400;
export const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export interface Claims { sub: string; sid: string; iat: number; exp: number; }
export function internalMatches(value: unknown, expected: string): boolean {
  if (typeof value !== 'string') return false;
  return timingSafeEqual(createHash('sha256').update(value).digest(), createHash('sha256').update(expected).digest());
}
export function signSession(claims: Claims, config: Config): string {
  return jwt.sign(claims, config.jwtSecret, { algorithm: 'HS256', issuer: 'wishlist-auth', audience: 'wishlist-web' });
}
export function verifySession(token: string | undefined, config: Config): Claims | null {
  if (!token || token.length > 4096) return null;
  try {
    const value = jwt.verify(token, config.jwtSecret, { algorithms: ['HS256'], issuer: 'wishlist-auth', audience: 'wishlist-web' });
    if (typeof value !== 'object' || value.iss !== 'wishlist-auth' || value.aud !== 'wishlist-web') return null;
    const { sub, sid, iat, exp } = value;
    if (typeof sub !== 'string' || !UUID.test(sub) || typeof sid !== 'string' || !UUID.test(sid)) return null;
    if (!Number.isSafeInteger(iat) || !Number.isSafeInteger(exp) || typeof iat !== 'number' || typeof exp !== 'number') return null;
    if (iat > Math.floor(Date.now() / 1000) || exp - iat !== TTL) return null;
    return { sub, sid, iat, exp };
  } catch { return null; }
}
export function readCookie(req: Request): string | undefined {
  const cookies = (req.headers.cookie ?? '').split(';').map(item => item.trim()).filter(item => item.startsWith(`${COOKIE_NAME}=`));
  if (cookies.length !== 1) return undefined;
  try { return decodeURIComponent(cookies[0].slice(COOKIE_NAME.length + 1)); } catch { return undefined; }
}
export function cookieOptions(config: Config) {
  return { httpOnly: true, sameSite: 'lax' as const, path: '/', secure: config.cookieSecure };
}
