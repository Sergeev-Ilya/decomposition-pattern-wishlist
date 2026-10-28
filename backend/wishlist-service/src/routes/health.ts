import { Router } from 'express';
import { Pool } from 'pg';
export function healthRouter(pool: Pool): Router {
  const router = Router();
  router.get('/health', async (_req, res) => {
    await pool.query('SELECT 1');
    res.json({ status: 'ok' });
  });
  return router;
}
