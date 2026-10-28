import { createApp } from './app';
import { loadConfig } from './config';

function start(): void {
  const config = loadConfig();
  const server = createApp({ config }).listen(config.port, () => console.log('API gateway ready'));
  server.on('error', () => { console.error('Gateway HTTP server failed'); process.exitCode = 1; });
  for (const signal of ['SIGTERM', 'SIGINT'] as const) process.once(signal, () => {
    server.close(() => { clearTimeout(forceClose); });
    const forceClose = setTimeout(() => { server.closeAllConnections(); }, config.upstreamTimeoutMs + 1000);
    forceClose.unref();
  });
}
try { start(); } catch { console.error('Gateway startup failed: check configuration'); process.exitCode = 1; }
