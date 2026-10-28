import { beforeAll, afterAll } from 'vitest';
import { Pool } from 'pg';
import { loadConfig } from '../src/config';
import { createApp } from '../src/app';
import { migrate } from '../src/db/migrate';
// DATABASE_URL is deliberately ignored. Only isolated *_test databases are allowed.
const testUrl = process.env.TEST_DATABASE_URL ?? 'postgresql://wishlist_test:wishlist_test_only@127.0.0.1:55433/wishlist_data_test';
if (!/^\/[a-zA-Z0-9_]+_test$/.test(new URL(testUrl).pathname)) throw new Error('TEST_DATABASE_URL must name an isolated *_test database');
export const config = loadConfig({ PORT: '3000', DATABASE_URL: testUrl, INTERNAL_TOKEN: 'integration-only-internal-token-32-bytes' });
export const pool = new Pool({ connectionString: testUrl, connectionTimeoutMillis: 3000, max: 15 });
export const app = createApp({ config, pool });
export const ownerIds: string[] = [];
beforeAll(async () => { await migrate(pool); await migrate(pool); });
afterAll(async () => {
  try { if (ownerIds.length) await pool.query('DELETE FROM wishlists WHERE owner_id=ANY($1::uuid[])', [ownerIds]); }
  finally { await pool.end(); }
});
