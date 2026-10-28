import express, { Request } from 'express';
import helmet from 'helmet';
import { randomUUID } from 'node:crypto';
import { isIP } from 'node:net';
import { Config, loadConfig } from './config';
import { ApiError, errorHandler, invalid, notFound, unauthenticated, unavailable } from './errors';
import { CAPABILITY, Route, routes, UUID } from './routes';
import { callUpstream, Fetch, object, upstreamError } from './upstream';

const COOKIE = 'wishlist_session';
function sessionCookie(req: Request): { present: boolean; token?: string; header?: string } {
  const parts = (req.headers.cookie ?? '').split(';').map(part => part.trim()).filter(part => part.split('=')[0].trim() === COOKIE);
  if (!parts.length) return { present: false };
  const header = parts.join('; ');
  if (parts.length !== 1 || !parts[0].startsWith(`${COOKIE}=`)) return { present: true, header };
  try {
    const token = decodeURIComponent(parts[0].slice(COOKIE.length + 1));
    return { present: true, header, ...(token && token.length <= 4096 ? { token } : {}) };
  } catch { return { present: true, header }; }
}

function clientIp(req: Request, config: Config): string {
  const socketIp = req.socket.remoteAddress ?? 'unknown';
  // Only a directly connected, explicitly configured proxy may supply one rewritten IP.
  if (config.trustedProxyIps.includes(socketIp)) {
    const candidate = req.headers['x-forwarded-for'];
    if (typeof candidate === 'string' && isIP(candidate.trim())) return candidate.trim();
  }
  return socketIp;
}

export function createApp(options: { config?: Config; fetch?: Fetch; now?: () => number } = {}): express.Application {
  const config = options.config ?? loadConfig();
  const fetcher = options.fetch ?? globalThis.fetch;
  const now = options.now ?? Date.now;
  const counters = new Map<string, { count: number; reset: number }>();
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', false);
  app.use(helmet());
  app.use((_req, res, next) => {
    res.locals.requestId = randomUUID();
    res.set({ 'X-Request-Id': res.locals.requestId, 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer', 'X-Robots-Tag': 'noindex, nofollow' });
    next();
  });
  app.use((req, res, next) => {
    const path = req.url.split('?')[0];
    // No decoding is needed for these ASCII routes; malformed and encoded capabilities
    // get the same neutral 404 and can never turn into an upstream path or query.
    if (path.includes('%') || path.includes('\\')) return next(notFound());
    const route = routes.find(candidate => candidate.pattern.test(path));
    if (!route) return next(notFound());
    if ((route.identity === 'secret' || route.identity === 'optional') && !CAPABILITY.test(path.split('/')[3])) return next(notFound());
    if (!route.methods.includes(req.method)) {
      res.set('Allow', route.methods.join(', '));
      return next(new ApiError(405, 'METHOD_NOT_ALLOWED', 'Method not allowed'));
    }
    res.locals.route = route;
    res.locals.upstreamPath = path.slice(4);
    if (route.identity === 'health') return res.json({ status: 'ok' });
    if (!['GET'].includes(req.method)) {
      if (req.headers.origin !== config.appOrigin || req.headers['x-requested-with'] !== 'Wishlist') return next(new ApiError(403, 'FORBIDDEN', 'Forbidden'));
      const contentType = req.headers['content-type'];
      if (typeof contentType !== 'string' || contentType.split(';')[0].trim().toLowerCase() !== 'application/json') return next(new ApiError(415, 'UNSUPPORTED_MEDIA_TYPE', 'JSON content type required'));
    }
    if (route.rate) {
      const time = now();
      // Expiry is swept on requests; there are no background timers or retained secrets.
      for (const [key, bucket] of counters) if (bucket.reset <= time) counters.delete(key);
      const key = `${route.rate}:${clientIp(req, config)}`;
      const windowMs = route.rate === 'auth' ? 15 * 60000 : 60000;
      const limit = route.rate === 'auth' ? 20 : route.rate === 'reserve' ? 60 : 120;
      const bucket = counters.get(key) ?? { count: 0, reset: time + windowMs };
      counters.set(key, bucket);
      if (++bucket.count > limit) {
        res.set('Retry-After', String(Math.max(1, Math.ceil((bucket.reset - time) / 1000))));
        return next(new ApiError(429, 'RATE_LIMITED', 'Too many requests'));
      }
    }
    next();
  });
  app.use((req, res, next) => {
    if (req.method === 'GET') return next();
    express.raw({ type: () => true, limit: 32768, inflate: false })(req, res, next);
  });
  app.use((req, res, next) => {
    if (req.method === 'GET') return next();
    try {
      if (!Buffer.isBuffer(req.body) || !req.body.length) throw invalid();
      // Reject invalid UTF-8 instead of letting replacement characters change input.
      const text = new TextDecoder('utf-8', { fatal: true }).decode(req.body);
      req.body = JSON.parse(text);
      if (!object(req.body)) throw invalid();
      const route: Route = res.locals.route;
      if ((route.empty || req.method === 'DELETE') && Object.keys(req.body).length) throw invalid();
      next();
    } catch { next(invalid()); }
  });
  app.use(async (req, res) => {
    const route: Route = res.locals.route;
    const headers: Record<string, string> = { accept: 'application/json', 'x-internal-token': config.internalToken, 'x-request-id': res.locals.requestId };
    if (req.method !== 'GET') headers['content-type'] = 'application/json';
    const cookie = sessionCookie(req);
    if (route.identity === 'owner' || (route.identity === 'optional' && cookie.present)) {
      if (!cookie.token) throw unauthenticated();
      const validation = await callUpstream(fetcher, config, `${config.authServiceUrl}/internal/sessions/validate`, 'POST', { ...headers, 'content-type': 'application/json' }, { token: cookie.token });
      if (validation.status === 400 || validation.status === 401) throw unauthenticated();
      if (validation.status !== 200) throw unavailable();
      if (!object(validation.body) || !object(validation.body.user) || typeof validation.body.user.id !== 'string' || !UUID.test(validation.body.user.id)) throw unavailable();
      headers['x-user-id'] = validation.body.user.id;
    }
    // Secret routes deliberately never consult auth and never carry a cookie.
    if (route.identity === 'auth' && cookie.header) headers.cookie = cookie.header;
    const service = route.identity === 'auth' ? config.authServiceUrl : config.wishlistServiceUrl;
    const result = await callUpstream(fetcher, config, `${service}${res.locals.upstreamPath}`, req.method, headers, req.method === 'GET' ? undefined : req.body);
    if (result.status >= 400) throw upstreamError(result);
    const path: string = res.locals.upstreamPath;
    const created = path === '/auth/register' || (req.method === 'POST' && (path === '/wishlists' || path.endsWith('/gifts') || path.endsWith('/reservations')));
    const empty = req.method === 'DELETE' || path === '/auth/logout';
    if (result.status !== (empty ? 204 : created ? 201 : 200)) throw unavailable();
    let responseBody = result.body;
    if (route.identity === 'auth' && !empty) {
      if (!object(result.body) || !object(result.body.user)) throw unavailable();
      const user = result.body.user;
      if (typeof user.id !== 'string' || !UUID.test(user.id) || typeof user.email !== 'string' || typeof user.displayName !== 'string' || typeof user.createdAt !== 'string') throw unavailable();
      // Rebuild the public auth DTO: JWT/internal validation context cannot escape.
      responseBody = { user: { id: user.id, email: user.email, displayName: user.displayName, createdAt: user.createdAt } };
    } else if (!empty) {
      const key = path.startsWith('/reservations/') ? 'reservation' : path.startsWith('/shared/') ? (created ? 'reservationToken' : 'wishlist') : path.endsWith('/share-link') ? 'shareToken' : path.includes('/gifts') ? 'gift' : path === '/wishlists' && req.method === 'GET' ? 'wishlists' : 'wishlist';
      if (!object(responseBody) || !Object.hasOwn(responseBody, key)) throw unavailable();
    }
    // Whitelist response headers. fetch may decompress upstream JSON, so rebuild
    // JSON and its length instead of copying content-encoding/content-length.
    if (route.identity === 'auth') {
      const cookies = result.headers.getSetCookie();
      if (cookies.length) res.set('Set-Cookie', cookies);
    }
    if (empty) res.status(204).end();
    else res.status(result.status).json(responseBody);
  });
  app.use(errorHandler);
  return app;
}
