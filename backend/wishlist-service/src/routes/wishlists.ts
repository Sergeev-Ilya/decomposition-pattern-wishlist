import { Router } from 'express';
import { Pool } from 'pg';
import { WishlistRepository } from '../repository';
import { body, capability, uuid, viewer } from '../validation';

export function wishlistRouter(pool: Pool): Router {
  const router = Router();
  const repository = new WishlistRepository(pool);
  // All identity headers are interpreted only after app-level internal authentication.
  router.use('/wishlists', (req, res, next) => { res.locals.owner = viewer(req, true); next(); });
  router.get('/wishlists', async (_req, res) => { res.json({ wishlists: await repository.list(res.locals.owner) }); });
  router.post('/wishlists', async (req, res) => { res.status(201).json({ wishlist: await repository.create(res.locals.owner, body(req.body, 'wishlist')) }); });
  router.get('/wishlists/:wishlistId', async (req, res) => { res.json({ wishlist: await repository.get(uuid(req.params.wishlistId), res.locals.owner) }); });
  router.patch('/wishlists/:wishlistId', async (req, res) => { res.json({ wishlist: await repository.update(uuid(req.params.wishlistId), res.locals.owner, body(req.body, 'wishlist', true)) }); });
  router.delete('/wishlists/:wishlistId', async (req, res) => { if (req.body !== undefined) body(req.body, 'empty'); await repository.remove(uuid(req.params.wishlistId), res.locals.owner); res.sendStatus(204); });
  router.post('/wishlists/:wishlistId/share-link', async (req, res) => { body(req.body, 'empty'); res.json(await repository.rotate(uuid(req.params.wishlistId), res.locals.owner)); });
  router.post('/wishlists/:wishlistId/gifts', async (req, res) => { res.status(201).json({ gift: await repository.createGift(uuid(req.params.wishlistId), res.locals.owner, body(req.body, 'gift')) }); });
  router.patch('/wishlists/:wishlistId/gifts/:giftId', async (req, res) => { res.json({ gift: await repository.updateGift(uuid(req.params.wishlistId), uuid(req.params.giftId), res.locals.owner, body(req.body, 'gift', true)) }); });
  router.delete('/wishlists/:wishlistId/gifts/:giftId', async (req, res) => { if (req.body !== undefined) body(req.body, 'empty'); await repository.removeGift(uuid(req.params.wishlistId), uuid(req.params.giftId), res.locals.owner); res.sendStatus(204); });
  router.get('/shared/:shareToken', async (req, res) => { res.json({ wishlist: await repository.shared(capability(req.params.shareToken), viewer(req)) }); });
  router.post('/shared/:shareToken/gifts/:giftId/reservations', async (req, res) => { const share = capability(req.params.shareToken); body(req.body, 'empty'); res.status(201).json(await repository.reserve(share, uuid(req.params.giftId), viewer(req))); });
  router.get('/reservations/:reservationToken', async (req, res) => { res.json({ reservation: await repository.reservation(capability(req.params.reservationToken)) }); });
  router.post('/reservations/:reservationToken/cancel', async (req, res) => { const secret = capability(req.params.reservationToken); body(req.body, 'empty'); res.json({ reservation: await repository.cancel(secret) }); });
  return router;
}
