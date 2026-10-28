import { Request } from 'express';
import { invalidInput, unauthenticated, ApiError } from './middleware/errorHandler';
import { UUID, CAPABILITY } from './security';
export const notFound = () => new ApiError(404, 'NOT_FOUND', 'Not found');
export function uuid(value: unknown): string {
  if (typeof value !== 'string' || !UUID.test(value)) throw invalidInput();
  return value.toLowerCase();
}
export function capability(value: unknown): string {
  if (typeof value !== 'string' || !CAPABILITY.test(value)) throw notFound();
  return value;
}
export function viewer(req: Request, required = false): string | undefined {
  const value = req.headers['x-user-id'];
  if (value === undefined) { if (required) throw unauthenticated(); return undefined; }
  return uuid(value);
}
type Input = Record<string, string | number>;
export function body(value: unknown, kind: 'wishlist' | 'gift' | 'empty', patch = false): Input {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw invalidInput();
  const source = value as Record<string, unknown>;
  const allowed = kind === 'wishlist' ? ['title', 'description'] : kind === 'gift' ? ['title', 'priceKopecks', 'url', 'note'] : [];
  if (Object.keys(source).some(key => !allowed.includes(key)) || (patch && Object.keys(source).length === 0)) throw invalidInput();
  if (!patch && kind !== 'empty' && (!Object.hasOwn(source, 'title') || (kind === 'gift' && !Object.hasOwn(source, 'priceKopecks')))) throw invalidInput();
  const result: Input = {};
  for (const [key, value] of Object.entries(source)) {
    if (key === 'priceKopecks') {
      if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) throw invalidInput();
      result[key] = value;
    } else {
      if (typeof value !== 'string') throw invalidInput();
      const trimmed = value.trim();
      const max = key === 'title' ? 200 : key === 'url' ? 4096 : 2000;
      if (Array.from(trimmed).length > max || (key === 'title' && !trimmed)) throw invalidInput();
      if (key === 'url' && trimmed) {
        let parsed: URL;
        try { parsed = new URL(trimmed); } catch { throw invalidInput(); }
        if (!/^https?:\/\//i.test(trimmed) || !['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password) throw invalidInput();
      }
      result[key] = trimmed;
    }
  }
  if (!patch && kind === 'wishlist') result.description ??= '';
  if (!patch && kind === 'gift') { result.url ??= ''; result.note ??= ''; }
  return result;
}
