import dotenv from 'dotenv';
dotenv.config();

export interface Config {
  port: number;
  databaseUrl: string;
  jwtSecret: string;
  internalToken: string;
  cookieSecure: boolean;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const port = Number(env.PORT ?? '3000');
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Invalid PORT');
  if (!env.DATABASE_URL) throw new Error('DATABASE_URL is required');
  let db: URL;
  try { db = new URL(env.DATABASE_URL); } catch { throw new Error('Invalid DATABASE_URL'); }
  if (!['postgres:', 'postgresql:'].includes(db.protocol)) throw new Error('Invalid DATABASE_URL');
  if (!env.JWT_SECRET || Buffer.byteLength(env.JWT_SECRET) < 32) throw new Error('JWT_SECRET must contain at least 32 bytes');
  if (!env.INTERNAL_TOKEN || Buffer.byteLength(env.INTERNAL_TOKEN) < 32) throw new Error('INTERNAL_TOKEN must contain at least 32 bytes');
  if (env.JWT_SECRET === env.INTERNAL_TOKEN) throw new Error('Secrets must be different');
  if (env.COOKIE_SECURE !== undefined && !['true', 'false'].includes(env.COOKIE_SECURE)) throw new Error('Invalid COOKIE_SECURE');
  return { port, databaseUrl: env.DATABASE_URL, jwtSecret: env.JWT_SECRET, internalToken: env.INTERNAL_TOKEN, cookieSecure: env.COOKIE_SECURE === 'true' };
}
