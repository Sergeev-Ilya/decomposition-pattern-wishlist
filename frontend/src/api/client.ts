import type { ErrorResponse } from './types';

export const BASE_URL = '/api';
type Method = 'GET' | 'POST' | 'PATCH' | 'DELETE';
export interface RequestOptions { method?: Method; body?: unknown; signal?: AbortSignal }

export class ApiError extends Error {
  readonly name = 'ApiError';
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly requestId?: string,
    readonly retryAfterSeconds?: number,
    /** A failed mutation may have committed. Never silently repeat a reservation POST. */
    readonly outcomeUnknown = false,
  ) { super(message); }
}

function isErrorResponse(value: unknown): value is ErrorResponse {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Partial<ErrorResponse>;
  return typeof candidate.requestId === 'string' && !!candidate.error &&
    typeof candidate.error.code === 'string' && typeof candidate.error.message === 'string';
}

/** One fetch only. Cookie ownership belongs to the server; no JWT is visible to JavaScript. */
export async function request<T>(path: string, options: RequestOptions = {}): Promise<T> {
  if (!path.startsWith('/') || path.startsWith('//') || /[?#\\]/.test(path)) {
    throw new ApiError(0, 'INVALID_API_PATH', 'Некорректный путь API.');
  }
  const method = options.method ?? 'GET';
  const unsafe = method !== 'GET';
  const headers: Record<string, string> = { Accept: 'application/json', 'X-Requested-With': 'Wishlist' };
  if (unsafe) headers['Content-Type'] = 'application/json';
  let response: Response;
  try {
    response = await fetch(`${BASE_URL}${path}`, {
      method,
      headers,
      credentials: 'same-origin',
      cache: 'no-store',
      referrerPolicy: 'no-referrer',
      signal: options.signal,
      ...(unsafe ? { body: JSON.stringify(options.body ?? {}) } : {}),
    });
  } catch {
    // Avoid retaining the raw request URL, which can contain a capability token.
    throw new ApiError(0, options.signal?.aborted ? 'REQUEST_ABORTED' : 'NETWORK_ERROR',
      unsafe ? 'Ответ не получен. Изменение могло сохраниться; проверьте состояние.' : 'Не удалось загрузить данные. Попробуйте еще раз.',
      undefined, undefined, unsafe);
  }
  if (response.status === 204 && response.ok) return undefined as T;
  const retryHeader = response.headers.get('Retry-After');
  const retryAfter = retryHeader && /^\d+$/.test(retryHeader) ? Number(retryHeader) : undefined;
  let payload: unknown;
  try { payload = await response.json(); } catch {
    throw new ApiError(response.status, 'INVALID_RESPONSE', 'Не удалось прочитать ответ сервера.',
      response.headers.get('X-Request-Id') ?? undefined, retryAfter, unsafe);
  }
  if (!response.ok) {
    const error = isErrorResponse(payload) ? payload : undefined;
    throw new ApiError(response.status, error?.error.code ?? 'HTTP_ERROR',
      error?.error.message ?? 'Не удалось выполнить запрос.',
      error?.requestId ?? response.headers.get('X-Request-Id') ?? undefined,
      retryAfter, unsafe && response.status >= 500);
  }
  return payload as T;
}
