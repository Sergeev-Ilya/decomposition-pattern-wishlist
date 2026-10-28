import { Pool } from 'pg';
import { Config } from '../config';
export function createPool(config: Config): Pool {
  const pool = new Pool({ connectionString: config.databaseUrl, max: 10, connectionTimeoutMillis: 3000, idleTimeoutMillis: 30000, query_timeout: 4000, statement_timeout: 4000 });
  // Avoid unhandled idle-client errors; never print connection details or SQL.
  pool.on('error', () => { console.error('Database connection unavailable'); });
  return pool;
}
