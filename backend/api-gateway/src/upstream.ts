import { Config } from './config';
import { ApiError, unavailable } from './errors';

export type Fetch = typeof globalThis.fetch;
export interface Result { status: number; body: unknown; headers: Headers; }
export function object(value: unknown): value is Record<string, unknown> { return value !== null && typeof value === 'object' && !Array.isArray(value); }

export async function callUpstream(fetcher: Fetch, config: Config, url: string, method: string, headers: Record<string, string>, body?: unknown): Promise<Result> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), config.upstreamTimeoutMs);
  try {
    const response = await fetcher(url, { method, headers, ...(body === undefined ? {} : { body: JSON.stringify(body) }), redirect: 'error', signal: controller.signal });
    if (response.status >= 300 && response.status < 400) throw unavailable();
    if (response.status === 204) return { status: 204, body: undefined, headers: response.headers };
    if (response.headers.get('content-type')?.split(';')[0].trim().toLowerCase() !== 'application/json') throw unavailable();
    const value: unknown = await response.json();
    if (!object(value)) throw unavailable();
    return { status: response.status, body: value, headers: response.headers };
  } catch (error) {
    if (controller.signal.aborted) throw new ApiError(504, 'GATEWAY_TIMEOUT', 'Service request timed out');
    if (error instanceof ApiError) throw error;
    throw unavailable();
  } finally { clearTimeout(timer); }
}

const errors: Record<string, { status: number; message: string }> = {
  VALIDATION_ERROR: { status: 400, message: 'Invalid request' },
  UNAUTHENTICATED: { status: 401, message: 'Authentication required' },
  INVALID_CREDENTIALS: { status: 401, message: 'Invalid email or password' },
  OWN_WISHLIST: { status: 403, message: 'Cannot reserve own gift' },
  NOT_FOUND: { status: 404, message: 'Not found' },
  EMAIL_IN_USE: { status: 409, message: 'Email already registered' },
  GIFT_RESERVED: { status: 409, message: 'Gift already reserved' },
  GIFT_LIMIT_REACHED: { status: 409, message: 'Gift limit reached' },
  SERVICE_UNAVAILABLE: { status: 503, message: 'Service unavailable' },
};
export function upstreamError(result: Result): ApiError {
  const body = result.body;
  if (object(body) && object(body.error) && typeof body.error.code === 'string') {
    const safe = errors[body.error.code];
    if (safe && safe.status === result.status) return new ApiError(safe.status, body.error.code, safe.message);
  }
  return unavailable();
}
