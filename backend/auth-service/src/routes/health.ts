import { Router } from 'express';
import { Pool } from 'pg';
import { unavailable } from '../middleware/errorHandler';
export function healthRouter(pool: Pool): Router {
  const router = Router();
  router.get('/health', async (_req, res) => {
    try { await pool.query('SELECT 1'); } catch { throw unavailable(); }
    res.json({ status: 'ok' });
  });
  return router;
}
