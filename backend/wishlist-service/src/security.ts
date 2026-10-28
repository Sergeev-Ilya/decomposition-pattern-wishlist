import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
export const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const CAPABILITY = /^[A-Za-z0-9_-]{43}$/;
export const token = (): string => randomBytes(32).toString('base64url');
export const hash = (value: string): Buffer => createHash('sha256').update(value, 'utf8').digest();
export function internalMatches(value: unknown, expected: string): boolean {
  return typeof value === 'string' && timingSafeEqual(hash(value), hash(expected));
}
