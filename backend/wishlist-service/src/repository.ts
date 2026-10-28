import { Pool, PoolClient, QueryResultRow } from 'pg';
import { ApiError } from './middleware/errorHandler';
import { hash, token } from './security';
import { notFound } from './validation';

type Row = QueryResultRow;
type Input = Record<string, string | number>;
const giftColumns = 'id,wishlist_id,title,price_kopecks,currency,url,note,version,created_at,updated_at';
const publicColumns = 'g.id,g.title,g.price_kopecks,g.currency,g.url,g.note';
const iso = (value: Date): string => value.toISOString();
export function publicGift(row: Row) {
  const priceKopecks = Number(row.price_kopecks);
  if (!Number.isSafeInteger(priceKopecks) || priceKopecks < 0) throw new Error('Invalid stored price');
  return { id: row.id, title: row.title, priceKopecks, currency: row.currency, url: row.url, note: row.note };
}
export function giftDto(row: Row) {
  return { ...publicGift(row), wishlistId: row.wishlist_id, version: row.version, createdAt: iso(row.created_at), updatedAt: iso(row.updated_at) };
}
function wishlistDto(row: Row, giftCount: number) {
  return { id: row.id, title: row.title, description: row.description, shareToken: row.share_token, giftCount, createdAt: iso(row.created_at), updatedAt: iso(row.updated_at) };
}
function reservationDto(row: Row) {
  return { id: row.reservation_id, status: row.canceled_at ? 'canceled' : 'active', createdAt: iso(row.reservation_created_at), canceledAt: row.canceled_at ? iso(row.canceled_at) : null, giftChanged: row.version !== row.gift_version, gift: giftDto(row) };
}
const reservationSelect = `SELECT g.*, r.id AS reservation_id, r.created_at AS reservation_created_at,
  r.canceled_at,r.gift_version FROM reservations r JOIN gifts g ON g.id=r.gift_id WHERE r.token_hash=$1`;

export class WishlistRepository {
  constructor(private pool: Pool) {}
  private async transaction<T>(action: (client: PoolClient) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const result = await action(client);
      await client.query('COMMIT');
      return result;
    } catch (error) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw error;
    } finally { client.release(); }
  }
  private async owner(client: PoolClient, id: string, owner: string, write = true): Promise<Row> {
    const result = await client.query(`SELECT * FROM wishlists WHERE id=$1 AND owner_id=$2 FOR ${write ? 'UPDATE' : 'SHARE'}`, [id, owner]);
    if (!result.rows[0]) throw notFound();
    return result.rows[0];
  }
  private async gift(client: PoolClient, id: string, wishlistId: string): Promise<Row> {
    const result = await client.query(`SELECT ${giftColumns} FROM gifts WHERE id=$1 AND wishlist_id=$2 FOR UPDATE`, [id, wishlistId]);
    if (!result.rows[0]) throw notFound();
    return result.rows[0];
  }
  private async detail(client: PoolClient, row: Row) {
    const gifts = await client.query(`SELECT ${giftColumns} FROM gifts WHERE wishlist_id=$1 ORDER BY created_at,id`, [row.id]);
    return { ...wishlistDto(row, gifts.rows.length), gifts: gifts.rows.map(giftDto) };
  }
  async list(owner: string) {
    const result = await this.pool.query(`SELECT w.*, (SELECT COUNT(*)::int FROM gifts g WHERE g.wishlist_id=w.id) AS gift_count
      FROM wishlists w WHERE owner_id=$1 ORDER BY created_at DESC,id DESC`, [owner]);
    return result.rows.map(row => wishlistDto(row, row.gift_count));
  }
  async create(owner: string, input: Input) {
    return this.transaction(async client => {
      const result = await client.query('INSERT INTO wishlists(owner_id,title,description,share_token) VALUES ($1,$2,$3,$4) RETURNING *', [owner, input.title, input.description, token()]);
      return this.detail(client, result.rows[0]);
    });
  }
  async get(id: string, owner: string) {
    return this.transaction(async client => this.detail(client, await this.owner(client, id, owner, false)));
  }
  async update(id: string, owner: string, input: Input) {
    return this.transaction(async client => {
      const old = await this.owner(client, id, owner);
      const result = await client.query('UPDATE wishlists SET title=$2,description=$3 WHERE id=$1 RETURNING *', [id, input.title ?? old.title, input.description ?? old.description]);
      return this.detail(client, result.rows[0]);
    });
  }
  async remove(id: string, owner: string) {
    return this.transaction(async client => {
      await this.owner(client, id, owner);
      await client.query('DELETE FROM wishlists WHERE id=$1', [id]);
    });
  }
  async rotate(id: string, owner: string) {
    return this.transaction(async client => {
      await this.owner(client, id, owner);
      const shareToken = token();
      await client.query('UPDATE wishlists SET share_token=$2 WHERE id=$1', [id, shareToken]);
      return { shareToken };
    });
  }
  async createGift(id: string, owner: string, input: Input) {
    return this.transaction(async client => {
      await this.owner(client, id, owner);
      const count = await client.query('SELECT COUNT(*)::int AS count FROM gifts WHERE wishlist_id=$1', [id]);
      if (count.rows[0].count >= 100) throw new ApiError(409, 'GIFT_LIMIT_REACHED', 'Gift limit reached');
      const result = await client.query(`INSERT INTO gifts(wishlist_id,title,price_kopecks,url,note) VALUES ($1,$2,$3,$4,$5) RETURNING ${giftColumns}`, [id, input.title, input.priceKopecks, input.url, input.note]);
      return giftDto(result.rows[0]);
    });
  }
  async updateGift(id: string, giftId: string, owner: string, input: Input) {
    return this.transaction(async client => {
      await this.owner(client, id, owner);
      const old = await this.gift(client, giftId, id);
      const result = await client.query(`UPDATE gifts SET title=$2,price_kopecks=$3,url=$4,note=$5,version=version+1 WHERE id=$1 RETURNING ${giftColumns}`, [giftId, input.title ?? old.title, input.priceKopecks ?? old.price_kopecks, input.url ?? old.url, input.note ?? old.note]);
      return giftDto(result.rows[0]);
    });
  }
  async removeGift(id: string, giftId: string, owner: string) {
    return this.transaction(async client => {
      await this.owner(client, id, owner);
      await this.gift(client, giftId, id);
      await client.query('DELETE FROM gifts WHERE id=$1', [giftId]);
    });
  }
  async shared(shareToken: string, viewer?: string) {
    return this.transaction(async client => {
      const result = await client.query('SELECT id,owner_id,title,description FROM wishlists WHERE share_token=$1 FOR SHARE', [shareToken]);
      const row = result.rows[0];
      if (!row) throw notFound();
      const isOwner = row.owner_id === viewer;
      // Owner projection never queries reservations, including aggregate availability.
      const availability = isOwner ? '' : ',EXISTS(SELECT 1 FROM reservations r WHERE r.gift_id=g.id AND r.canceled_at IS NULL) AS reserved';
      const gifts = await client.query(`SELECT ${publicColumns}${availability} FROM gifts g WHERE wishlist_id=$1 ORDER BY created_at,id`, [row.id]);
      return { id: row.id, title: row.title, description: row.description, isOwner, gifts: gifts.rows.map(g => isOwner ? publicGift(g) : { ...publicGift(g), reserved: g.reserved }) };
    });
  }
  async reserve(shareToken: string, giftId: string, viewer?: string) {
    try {
      return await this.transaction(async client => {
        // READ COMMITTED rechecks share_token after a competing rotation's UPDATE.
        const result = await client.query('SELECT id,owner_id FROM wishlists WHERE share_token=$1 FOR UPDATE', [shareToken]);
        const row = result.rows[0];
        if (!row) throw notFound();
        if (row.owner_id === viewer) throw new ApiError(403, 'OWN_WISHLIST', 'Cannot reserve own wishlist');
        const gift = await this.gift(client, giftId, row.id);
        const reservationToken = token();
        await client.query('INSERT INTO reservations(gift_id,token_hash,gift_version) VALUES ($1,$2,$3)', [giftId, hash(reservationToken), gift.version]);
        return { reservationToken };
      });
    } catch (error) {
      if ((error as { code?: string; constraint?: string }).code === '23505' && (error as { constraint?: string }).constraint === 'reservations_one_active_gift_idx') throw new ApiError(409, 'GIFT_RESERVED', 'Gift already reserved');
      throw error;
    }
  }
  async reservation(secret: string) {
    const result = await this.pool.query(reservationSelect, [hash(secret)]);
    if (!result.rows[0]) throw notFound();
    return reservationDto(result.rows[0]);
  }
  async cancel(secret: string) {
    const tokenHash = hash(secret);
    return this.transaction(async client => {
      const initial = await client.query('SELECT r.id,r.gift_id,g.wishlist_id FROM reservations r JOIN gifts g ON g.id=r.gift_id WHERE r.token_hash=$1', [tokenHash]);
      const row = initial.rows[0];
      if (!row) throw notFound();
      const locked = await client.query('SELECT id FROM wishlists WHERE id=$1 FOR UPDATE', [row.wishlist_id]);
      if (!locked.rows[0]) throw notFound();
      await this.gift(client, row.gift_id, row.wishlist_id);
      const reservation = await client.query('SELECT id FROM reservations WHERE id=$1 AND gift_id=$2 AND token_hash=$3 FOR UPDATE', [row.id, row.gift_id, tokenHash]);
      if (!reservation.rows[0]) throw notFound();
      await client.query('UPDATE reservations SET canceled_at=clock_timestamp() WHERE id=$1 AND canceled_at IS NULL', [row.id]);
      const result = await client.query(reservationSelect, [tokenHash]);
      if (!result.rows[0]) throw notFound();
      return reservationDto(result.rows[0]);
    });
  }
}
