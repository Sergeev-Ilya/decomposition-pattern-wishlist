import { Request, Response, NextFunction } from 'express';

export class ApiError extends Error {
  constructor(public status: number, public code: string, message: string) { super(message); }
}
export const unavailable = () => new ApiError(503, 'SERVICE_UNAVAILABLE', 'Service temporarily unavailable');
export const unauthenticated = () => new ApiError(401, 'UNAUTHENTICATED', 'Authentication required');
export const invalidInput = () => new ApiError(400, 'VALIDATION_ERROR', 'Invalid request');
export function notFoundHandler(_req: Request, _res: Response, next: NextFunction): void {
  next(new ApiError(404, 'NOT_FOUND', 'Not found'));
}
export function errorHandler(error: unknown, _req: Request, res: Response, _next: NextFunction): void {
  let safe = error instanceof ApiError ? error : unavailable();
  if (error instanceof URIError) {
    const capabilityPath = _req.path.startsWith('/shared/') || _req.path.startsWith('/reservations/');
    safe = capabilityPath ? new ApiError(404, 'NOT_FOUND', 'Not found') : invalidInput();
  }
  if (typeof error === 'object' && error !== null && 'type' in error) {
    if (error.type === 'entity.too.large') safe = invalidInput();
    else if (['entity.parse.failed', 'encoding.unsupported', 'charset.unsupported', 'request.aborted', 'request.size.invalid'].includes(String(error.type))) safe = invalidInput();
  }
  res.status(safe.status).json({ error: { code: safe.code, message: safe.message }, requestId: res.locals.requestId });
}
