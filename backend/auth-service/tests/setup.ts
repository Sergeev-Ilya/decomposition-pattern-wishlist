import { beforeAll, afterAll } from 'vitest';
import { Pool } from 'pg';
import { loadConfig } from '../src/config';
import { createApp } from '../src/app';
import { migrate } from '../src/db/migrate';

// DATABASE_URL is deliberately ignored. Never target a product database implicitly.
const testUrl = process.env.TEST_DATABASE_URL ?? 'postgresql://wishlist_test:wishlist_test_only@127.0.0.1:55432/wishlist_auth_test';
const parsed = new URL(testUrl);
if (!/^\/[a-zA-Z0-9_]+_test$/.test(parsed.pathname)) throw new Error('TEST_DATABASE_URL must name an isolated *_test database');
export const config = loadConfig({ PORT: '3000', DATABASE_URL: testUrl, JWT_SECRET: 'integration-only-jwt-secret-32-bytes-long', INTERNAL_TOKEN: 'integration-only-internal-token-32-bytes', COOKIE_SECURE: 'false' });
export const pool = new Pool({ connectionString: testUrl, connectionTimeoutMillis: 3000 });
export const app = createApp({ config, pool });
export const userIds: string[] = [];
beforeAll(async () => { await migrate(pool); await migrate(pool); });
afterAll(async () => {
  // Delete only users created by this run, never truncate an arbitrary database.
  if (userIds.length) await pool.query('DELETE FROM users WHERE id = ANY($1::uuid[])', [userIds]);
  await pool.end();
});
