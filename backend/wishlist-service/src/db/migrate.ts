import fs from 'node:fs/promises';
import path from 'node:path';
import { Pool } from 'pg';
import { loadConfig } from '../config';
import { createPool } from './pool';

export async function migrate(pool: Pool, dir = path.join(__dirname, '../../migrations')): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('SELECT pg_advisory_xact_lock(97241002)');
    await client.query(`CREATE TABLE IF NOT EXISTS schema_migrations (
      id SERIAL PRIMARY KEY, name VARCHAR(255) NOT NULL UNIQUE,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )`);
    const files = (await fs.readdir(dir)).filter(file => /^\d+.*\.sql$/.test(file)).sort();
    for (const file of files) {
      const applied = await client.query('SELECT 1 FROM schema_migrations WHERE name=$1', [file]);
      if (applied.rowCount) continue;
      await client.query(await fs.readFile(path.join(dir, file), 'utf8'));
      await client.query('INSERT INTO schema_migrations(name) VALUES ($1)', [file]);
    }
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw error;
  } finally { client.release(); }
}

if (require.main === module) {
  let pool: Pool | undefined;
  (async () => {
    pool = createPool(loadConfig());
    await migrate(pool);
    console.log('Migrations complete');
  })().catch(() => { console.error('Migration failed'); process.exitCode = 1; })
    .finally(async () => { await pool?.end(); });
}
