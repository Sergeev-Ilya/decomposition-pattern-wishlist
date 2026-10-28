import dotenv from 'dotenv';
dotenv.config();

export interface Config {
  port: number;
  databaseUrl: string;
  internalToken: string;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const port = Number(env.PORT ?? '3000');
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Invalid PORT');
  if (!env.DATABASE_URL) throw new Error('DATABASE_URL is required');
  let db: URL;
  try { db = new URL(env.DATABASE_URL); } catch { throw new Error('Invalid DATABASE_URL'); }
  if (!['postgres:', 'postgresql:'].includes(db.protocol)) throw new Error('Invalid DATABASE_URL');
  if (!env.INTERNAL_TOKEN || Buffer.byteLength(env.INTERNAL_TOKEN) < 32) throw new Error('INTERNAL_TOKEN must contain at least 32 bytes');
  return { port, databaseUrl: env.DATABASE_URL, internalToken: env.INTERNAL_TOKEN };
}
