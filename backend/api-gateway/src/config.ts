import dotenv from 'dotenv';
import { isIP } from 'node:net';
dotenv.config();

export interface Config {
  port: number;
  authServiceUrl: string;
  wishlistServiceUrl: string;
  appOrigin: string;
  internalToken: string;
  upstreamTimeoutMs: number;
  trustedProxyIps: string[];
}

function serviceUrl(value: string | undefined, key: string): string {
  if (!value) throw new Error(`${key} is required`);
  let parsed: URL;
  try { parsed = new URL(value); } catch { throw new Error(`Invalid ${key}`); }
  if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password || parsed.pathname !== '/' || parsed.search || parsed.hash) throw new Error(`Invalid ${key}`);
  return parsed.origin;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const port = Number(env.PORT ?? '8080');
  const upstreamTimeoutMs = Number(env.UPSTREAM_TIMEOUT_MS ?? '5000');
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Invalid PORT');
  if (!Number.isInteger(upstreamTimeoutMs) || upstreamTimeoutMs < 1 || upstreamTimeoutMs > 60000) throw new Error('Invalid UPSTREAM_TIMEOUT_MS');
  if (!env.INTERNAL_TOKEN || Buffer.byteLength(env.INTERNAL_TOKEN) < 32 || /[\r\n]/.test(env.INTERNAL_TOKEN)) throw new Error('INTERNAL_TOKEN must contain at least 32 bytes and no newlines');
  const appOrigin = env.APP_ORIGIN ?? 'http://localhost:8880';
  if (serviceUrl(appOrigin, 'APP_ORIGIN') !== appOrigin) throw new Error('APP_ORIGIN must be an exact origin without a trailing slash');
  const trustedProxyIps = env.TRUSTED_PROXY_IPS ? env.TRUSTED_PROXY_IPS.split(',').map(ip => ip.trim()) : [];
  if (trustedProxyIps.some(ip => !isIP(ip))) throw new Error('TRUSTED_PROXY_IPS must contain explicit IP addresses');
  return { port, authServiceUrl: serviceUrl(env.AUTH_SERVICE_URL, 'AUTH_SERVICE_URL'), wishlistServiceUrl: serviceUrl(env.WISHLIST_SERVICE_URL, 'WISHLIST_SERVICE_URL'), appOrigin, internalToken: env.INTERNAL_TOKEN, upstreamTimeoutMs, trustedProxyIps };
}
