import { createApp } from './app';
import { loadConfig } from './config';
import { createPool } from './db/pool';
import { migrate } from './db/migrate';

async function start(): Promise<void> {
  const config = loadConfig();
  const pool = createPool(config);
  try { await migrate(pool); } catch { await pool.end(); throw new Error('Startup migration failed'); }
  const server = createApp({ config, pool }).listen(config.port, () => console.log('Auth service ready'));
  server.on('error', () => { console.error('HTTP server failed'); process.exitCode = 1; void pool.end(); });
  for (const signal of ['SIGINT', 'SIGTERM'] as const) {
    process.once(signal, () => { server.close(() => { void pool.end(); }); });
  }
}
start().catch(() => { console.error('Auth service startup failed: check configuration and database'); process.exitCode = 1; });
