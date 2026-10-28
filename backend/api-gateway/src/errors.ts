import { ErrorRequestHandler } from 'express';
export class ApiError extends Error {
  constructor(public status: number, public code: string, message: string) { super(message); }
}
export const invalid = () => new ApiError(400, 'VALIDATION_ERROR', 'Invalid request');
export const unauthenticated = () => new ApiError(401, 'UNAUTHENTICATED', 'Authentication required');
export const notFound = () => new ApiError(404, 'NOT_FOUND', 'Not found');
export const unavailable = () => new ApiError(503, 'SERVICE_UNAVAILABLE', 'Service unavailable');
export const errorHandler: ErrorRequestHandler = (error: unknown, _req, res, _next) => {
  let safe = error instanceof ApiError ? error : unavailable();
  if (typeof error === 'object' && error !== null && 'type' in error) {
    if (error.type === 'entity.too.large') safe = new ApiError(413, 'REQUEST_TOO_LARGE', 'Request too large');
    else if (error.type === 'encoding.unsupported') safe = new ApiError(415, 'UNSUPPORTED_MEDIA_TYPE', 'Unsupported content encoding');
    else if (['request.aborted', 'request.size.invalid'].includes(String(error.type))) safe = invalid();
  }
  res.status(safe.status).json({ error: { code: safe.code, message: safe.message }, requestId: res.locals.requestId });
};
