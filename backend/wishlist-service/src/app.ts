import express from 'express';
import helmet from 'helmet';
import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { Config, loadConfig } from './config';
import { createPool } from './db/pool';
import { healthRouter } from './routes/health';
import { wishlistRouter } from './routes/wishlists';
import { ApiError, errorHandler, notFoundHandler } from './middleware/errorHandler';
import { internalMatches, UUID } from './security';

export function createApp(options: { config?: Config; pool?: Pool } = {}): express.Application {
  const config = options.config ?? loadConfig();
  const pool = options.pool ?? createPool(config);
  const app = express();
  app.disable('x-powered-by');
  app.use(helmet());
  app.use((req, res, next) => {
    const trusted = internalMatches(req.headers['x-internal-token'], config.internalToken);
    const candidate = req.headers['x-request-id'];
    res.locals.requestId = trusted && typeof candidate === 'string' && UUID.test(candidate) ? candidate : randomUUID();
    res.set({ 'X-Request-Id': res.locals.requestId, 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer', 'X-Robots-Tag': 'noindex, nofollow' });
    next();
  });
  app.use(healthRouter(pool));
  app.use((req, _res, next) => {
    if (!internalMatches(req.headers['x-internal-token'], config.internalToken)) return next(new ApiError(403, 'FORBIDDEN', 'Forbidden'));
    next();
  });
  app.use((req, _res, next) => {
    if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method) && req.get('content-type')?.split(';')[0].trim().toLowerCase() !== 'application/json') return next(new ApiError(400, 'VALIDATION_ERROR', 'Invalid request'));
    next();
  });
  app.use(express.json({ limit: 32768, strict: true }));
  app.use(wishlistRouter(pool));
  app.use(notFoundHandler);
  app.use(errorHandler);
  return app;
}
