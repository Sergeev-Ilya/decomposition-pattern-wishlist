import request from 'supertest';
import { randomUUID, createHash } from 'node:crypto';
import { describe, it, expect } from 'vitest';
import { app, config, pool, ownerIds } from './setup';
const internal = { 'X-Internal-Token': config.internalToken };
const owner = () => { const id = randomUUID(); ownerIds.push(id); return { ...internal, 'X-User-Id': id }; };
async function fixture() {
  const headers = owner();
  const list = await request(app).post('/wishlists').set(headers).send({ title: ' Birthday ', description: ' Wishes ' }).expect(201);
  const wishlist = list.body.wishlist;
  const gift = await request(app).post(`/wishlists/${wishlist.id}/gifts`).set(headers).send({ title: 'Gift', priceKopecks: 9007199254740991 }).expect(201);
  return { headers, wishlist, gift: gift.body.gift, reserve: `/shared/${wishlist.shareToken}/gifts/${gift.body.gift.id}/reservations` };
}
describe('real PostgreSQL wishlist integration', () => {
  it('checks real health and safe headers without credentials', async () => {
    const result = await request(app).get('/health').expect(200);
    expect(result.body).toEqual({ status: 'ok' });
    expect(result.headers['cache-control']).toBe('no-store');
    expect(result.headers['referrer-policy']).toBe('no-referrer');
    expect(result.headers['x-robots-tag']).toBe('noindex, nofollow');
  });
  it('authenticates internal context before trusting owner UUID', async () => {
    await request(app).get('/wishlists').set('X-User-Id', randomUUID()).expect(403);
    await request(app).get('/wishlists').set(internal).expect(401);
    await request(app).get('/wishlists').set(internal).set('X-User-Id', 'bad').expect(400);
    expect((await request(app).get('/wishlists').set(owner()).expect(200)).body).toEqual({ wishlists: [] });
  });
  it('implements owner CRUD, trims fields, hides foreign objects and preserves exact prices', async () => {
    const f = await fixture();
    expect(f.wishlist.title).toBe('Birthday');
    expect(f.gift.priceKopecks).toBe(9007199254740991);
    const path = `/wishlists/${f.wishlist.id}`;
    await request(app).get(path).set(owner()).expect(404);
    const detail = await request(app).get(path).set(f.headers).expect(200);
    expect(detail.body.wishlist.giftCount).toBe(1);
    expect(detail.body.wishlist.gifts[0]).toEqual(f.gift);
    expect((await request(app).patch(path).set(f.headers).send({ title: ' Updated ' }).expect(200)).body.wishlist.title).toBe('Updated');
    const lists = await request(app).get('/wishlists').set(f.headers).expect(200);
    expect(lists.body.wishlists[0]).not.toHaveProperty('gifts');
    await request(app).delete(`${path}/gifts/${f.gift.id}`).set(f.headers).set('Content-Type', 'application/json').expect(204);
    expect((await request(app).get(path).set(f.headers)).body.wishlist.giftCount).toBe(0);
    await request(app).delete(path).set(f.headers).set('Content-Type', 'application/json').expect(204);
    await request(app).get(path).set(f.headers).expect(404);
  });
  it('has no reservation fields in either owner projection', async () => {
    const f = await fixture();
    await request(app).post(f.reserve).set(internal).send({}).expect(201);
    const privateView = await request(app).get(`/wishlists/${f.wishlist.id}`).set(f.headers).expect(200);
    expect(Object.keys(privateView.body.wishlist.gifts[0]).sort()).toEqual(['id','wishlistId','title','priceKopecks','currency','url','note','version','createdAt','updatedAt'].sort());
    const sharedOwner = await request(app).get(`/shared/${f.wishlist.shareToken}`).set(f.headers).expect(200);
    expect(sharedOwner.body.wishlist.isOwner).toBe(true);
    expect(Object.keys(sharedOwner.body.wishlist.gifts[0]).sort()).toEqual(['id','title','priceKopecks','currency','url','note'].sort());
    const guest = await request(app).get(`/shared/${f.wishlist.shareToken}`).set(internal).expect(200);
    expect(guest.body.wishlist.gifts[0].reserved).toBe(true);
    expect((await request(app).post(f.reserve).set(f.headers).send({}).expect(403)).body.error.code).toBe('OWN_WISHLIST');
    expect(sharedOwner.body.wishlist).not.toHaveProperty('ownerId');
  });
  it('issues one reservation in a race and stores only the UTF-8 token hash', async () => {
    const f = await fixture();
    const results = await Promise.all(Array.from({ length: 8 }, () => request(app).post(f.reserve).set(internal).send({})));
    expect(results.filter(r => r.status === 201)).toHaveLength(1);
    expect(results.filter(r => r.status === 409)).toHaveLength(7);
    const secret = results.find(r => r.status === 201)!.body.reservationToken;
    expect(secret).toMatch(/^[A-Za-z0-9_-]{43}$/);
    const db = await pool.query('SELECT token_hash FROM reservations WHERE gift_id=$1', [f.gift.id]);
    expect(db.rows[0].token_hash).toEqual(createHash('sha256').update(secret, 'utf8').digest());
  });
  it('retains reservation on PATCH and cancels idempotently without affecting a new reservation', async () => {
    const f = await fixture();
    const first = await request(app).post(f.reserve).set(internal).send({}).expect(201);
    const secretPath = `/reservations/${first.body.reservationToken}`;
    expect((await request(app).get(secretPath).set(internal).expect(200)).body.reservation.giftChanged).toBe(false);
    const edit = await request(app).patch(`/wishlists/${f.wishlist.id}/gifts/${f.gift.id}`).set(f.headers).send({ title: 'New title', priceKopecks: 0 }).expect(200);
    expect(edit.body.gift.version).toBe(2);
    const changed = await request(app).get(secretPath).set(internal).expect(200);
    expect(changed.body.reservation.giftChanged).toBe(true);
    expect(changed.body.reservation.status).toBe('active');
    const canceled = await request(app).post(`${secretPath}/cancel`).set(internal).send({}).expect(200);
    expect(canceled.body.reservation.status).toBe('canceled');
    const second = await request(app).post(f.reserve).set(internal).send({}).expect(201);
    expect(second.body.reservationToken).not.toBe(first.body.reservationToken);
    const again = await request(app).post(`${secretPath}/cancel`).set(internal).send({}).expect(200);
    expect(again.body).toEqual(canceled.body);
    expect((await request(app).get(`/reservations/${second.body.reservationToken}`).set(internal)).body.reservation.status).toBe('active');
    expect(JSON.stringify(again.body)).not.toContain(first.body.reservationToken);
  });
  it('revokes old shares on rotation, keeps secret access and cascades deletion', async () => {
    const f = await fixture();
    const secret = (await request(app).post(f.reserve).set(internal).send({}).expect(201)).body.reservationToken;
    const rotated = await request(app).post(`/wishlists/${f.wishlist.id}/share-link`).set(f.headers).send({}).expect(200);
    expect(rotated.body.shareToken).not.toBe(f.wishlist.shareToken);
    await request(app).get(`/shared/${f.wishlist.shareToken}`).set(internal).expect(404);
    await request(app).post(f.reserve).set(internal).send({}).expect(404);
    await request(app).get(`/shared/${rotated.body.shareToken}`).set(internal).expect(200);
    await request(app).get(`/reservations/${secret}`).set(internal).expect(200);
    await request(app).delete(`/wishlists/${f.wishlist.id}`).set(f.headers).set('Content-Type', 'application/json').expect(204);
    await request(app).get(`/shared/${rotated.body.shareToken}`).set(internal).expect(404);
    await request(app).get(`/reservations/${secret}`).set(internal).expect(404);
    await request(app).post(`/reservations/${secret}/cancel`).set(internal).send({}).expect(404);
  });
  it('enforces the 100 gift cap across concurrent additions', async () => {
    const f = await fixture();
    await pool.query(`INSERT INTO gifts(wishlist_id,title,price_kopecks) SELECT $1,'Gift',0 FROM generate_series(1,98)`, [f.wishlist.id]);
    const results = await Promise.all(Array.from({ length: 5 }, () => request(app).post(`/wishlists/${f.wishlist.id}/gifts`).set(f.headers).send({ title: 'Last', priceKopecks: 1 })));
    expect(results.filter(r => r.status === 201)).toHaveLength(1);
    expect(results.filter(r => r.status === 409 && r.body.error.code === 'GIFT_LIMIT_REACHED')).toHaveLength(4);
    expect((await pool.query('SELECT COUNT(*)::int AS count FROM gifts WHERE wishlist_id=$1', [f.wishlist.id])).rows[0].count).toBe(100);
  });
  it('rejects unknown fields, unsafe prices, invalid URLs, empty PATCH and malformed capabilities', async () => {
    const f = await fixture();
    for (const payload of [{ title: 'x', priceKopecks: 0.5 }, { title: 'x', priceKopecks: -1 }, { title: 'x', priceKopecks: 9007199254740992 }, { title: 'x', priceKopecks: '1' }, { title: 'x', priceKopecks: 1, reserved: false }, { title: 'x', priceKopecks: 1, url: 'https://user:pass@example.com' }, { title: 'x', priceKopecks: 1, url: 'javascript:alert(1)' }]) {
      await request(app).post(`/wishlists/${f.wishlist.id}/gifts`).set(f.headers).send(payload).expect(400);
    }
    await request(app).patch(`/wishlists/${f.wishlist.id}`).set(f.headers).send({}).expect(400);
    await request(app).post('/wishlists').set(f.headers).send({ title: ' ' }).expect(400);
    const malformed = await request(app).get('/reservations/invalid').set(internal).expect(404);
    const unknown = await request(app).get(`/reservations/${'a'.repeat(43)}`).set(internal).expect(404);
    expect(malformed.body.error).toEqual(unknown.body.error);
    await request(app).get('/shared/invalid').set(internal).expect(404);
    await request(app).get('/shared/%ZZ').set(internal).expect(404);
    await request(app).delete(`/wishlists/${f.wishlist.id}`).set(f.headers).send({ reserved: false }).expect(400);
    await request(app).delete(`/wishlists/${f.wishlist.id}/gifts/${f.gift.id}`).set(f.headers).send({ reserved: false }).expect(400);
    await request(app).get(`/shared/${f.wishlist.shareToken}`).set(internal).set('X-User-Id', 'bad').expect(400);
  });
  it('applies ownership checks to every mutation and rejects cross-list gift IDs', async () => {
    const f = await fixture();
    const foreign = owner();
    const path = `/wishlists/${f.wishlist.id}`;
    await request(app).patch(path).set(foreign).send({ title: 'stolen' }).expect(404);
    await request(app).delete(path).set(foreign).send({}).expect(404);
    await request(app).post(`${path}/share-link`).set(foreign).send({}).expect(404);
    await request(app).post(`${path}/gifts`).set(foreign).send({ title: 'x', priceKopecks: 0 }).expect(404);
    await request(app).patch(`${path}/gifts/${f.gift.id}`).set(foreign).send({ title: 'stolen' }).expect(404);
    await request(app).delete(`${path}/gifts/${f.gift.id}`).set(foreign).send({}).expect(404);
    const second = (await request(app).post('/wishlists').set(f.headers).send({ title: 'Other list' }).expect(201)).body.wishlist;
    await request(app).patch(`/wishlists/${second.id}/gifts/${f.gift.id}`).set(f.headers).send({ title: 'wrong list' }).expect(404);
    await request(app).delete(`/wishlists/${second.id}/gifts/${f.gift.id}`).set(f.headers).send({}).expect(404);
    await request(app).post(`/shared/${second.shareToken}/gifts/${f.gift.id}/reservations`).set(internal).send({}).expect(404);
    expect((await request(app).get(path).set(f.headers).expect(200)).body.wishlist.gifts[0]).toEqual(f.gift);
  });
  it('accepts optional blank/HTTP/HTTPS URLs and rejects missing, null and oversized values', async () => {
    const f = await fixture();
    const path = `/wishlists/${f.wishlist.id}/gifts`;
    expect(f.gift.url).toBe(''); expect(f.gift.note).toBe('');
    for (const url of ['', 'http://example.com/a', 'https://example.com/a?q=1']) {
      const response = await request(app).post(path).set(f.headers).send({ title: 'Valid', priceKopecks: 0, url }).expect(201);
      expect(response.body.gift.url).toBe(url); expect(response.body.gift.priceKopecks).toBe(0);
    }
    for (const value of [{ title: 'x' }, { title: 'x', priceKopecks: null }, { title: 'x', priceKopecks: 1, url: null }, { title: 'x', priceKopecks: 1, url: '/relative' }, { title: 'x', priceKopecks: 1, url: 'ftp://example.com/a' }, { title: 'x'.repeat(201), priceKopecks: 1 }, { title: 'x', priceKopecks: 1, note: 'x'.repeat(2001) }]) {
      await request(app).post(path).set(f.headers).send(value).expect(400);
    }
    await request(app).patch(`${path}/${f.gift.id}`).set(f.headers).send({}).expect(400);
  });
  it.each(['rotate', 'delete'] as const)('rechecks a stale reservation request after a competing %s commits', async operation => {
    const f = await fixture();
    const blocker = await pool.connect();
    let mutation: Promise<request.Response> | undefined;
    let reservation: Promise<request.Response> | undefined;
    const waitForLocks = async (count: number) => {
      const deadline = Date.now() + 3000;
      while (Date.now() < deadline) {
        const result = await pool.query("SELECT count(*)::int AS n FROM pg_stat_activity WHERE datname=current_database() AND wait_event_type='Lock'");
        if (result.rows[0].n >= count) return;
        await new Promise(resolve => setTimeout(resolve, 10));
      }
      throw new Error('Expected PostgreSQL lock contention did not occur');
    };
    try {
      await blocker.query('BEGIN');
      await blocker.query('SELECT id FROM wishlists WHERE id=$1 FOR UPDATE', [f.wishlist.id]);
      mutation = (operation === 'rotate'
        ? request(app).post(`/wishlists/${f.wishlist.id}/share-link`).set(f.headers).send({})
        : request(app).delete(`/wishlists/${f.wishlist.id}`).set(f.headers).send({})).then(result => result);
      await waitForLocks(1);
      reservation = request(app).post(f.reserve).set(internal).send({}).then(result => result);
      await waitForLocks(2);
      await blocker.query('COMMIT');
      expect((await mutation).status).toBe(operation === 'rotate' ? 200 : 204);
      expect((await reservation).status).toBe(404);
      expect((await pool.query('SELECT id FROM reservations WHERE gift_id=$1', [f.gift.id])).rows).toHaveLength(0);
    } finally {
      await blocker.query('ROLLBACK'); blocker.release();
      await Promise.allSettled([mutation, reservation]);
    }
  });
  it('deletes a reserved gift with its secret while preserving the list and another gift', async () => {
    const f = await fixture();
    const other = (await request(app).post(`/wishlists/${f.wishlist.id}/gifts`).set(f.headers).send({ title: 'Keep', priceKopecks: 5 }).expect(201)).body.gift;
    const secret = (await request(app).post(f.reserve).set(internal).send({}).expect(201)).body.reservationToken;
    await request(app).delete(`/wishlists/${f.wishlist.id}/gifts/${f.gift.id}`).set(f.headers).send({}).expect(204);
    await request(app).get(`/reservations/${secret}`).set(internal).expect(404);
    await request(app).post(`/reservations/${secret}/cancel`).set(internal).send({}).expect(404);
    expect((await pool.query('SELECT id FROM reservations WHERE gift_id=$1', [f.gift.id])).rows).toHaveLength(0);
    const detail = (await request(app).get(`/wishlists/${f.wishlist.id}`).set(f.headers).expect(200)).body.wishlist;
    expect(detail.gifts).toEqual([other]);
  });

});
