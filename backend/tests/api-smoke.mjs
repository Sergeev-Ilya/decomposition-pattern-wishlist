import assert from 'node:assert/strict';
import { randomUUID, randomBytes } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

// Runs only against the agreed local deployment. No fixtures, secrets or DB access.
const origin = 'http://localhost:8880';
const composeDirectory = fileURLToPath(new URL('../', import.meta.url));
const outage = process.argv.includes('--with-auth-outage');
let cookie;
let wishlistId;
let authStopped = false;
let checks = 0;
function check(condition, label) { assert(condition, label); checks++; }
function compose(...args) {
  const result = spawnSync('docker', ['compose', ...args], { cwd: composeDirectory, encoding: 'utf8' });
  assert(result.status === 0, `Compose ${args[0]} failed; inspect Docker separately`);
  return result.stdout.trim();
}
async function restoreAuth() {
  compose('start', 'auth-service');
  const id = compose('ps', '-q', 'auth-service');
  const deadline = Date.now() + 60000;
  while (Date.now() < deadline) {
    const result = spawnSync('docker', ['inspect', '--format', '{{.State.Health.Status}}', id], { encoding: 'utf8' });
    if (result.status === 0 && result.stdout.trim() === 'healthy') {
      authStopped = false;
      console.log('auth-service restored: healthy');
      return;
    }
    await new Promise(resolve => setTimeout(resolve, 500));
  }
  throw new Error('Auth did not become healthy after restoration');
}
async function api(label, method, path, { status = 200, owner = false, body = {}, explicitCookie } = {}) {
  const headers = {};
  if (owner) headers.Cookie = cookie;
  if (explicitCookie !== undefined) headers.Cookie = explicitCookie;
  const options = { method, headers, signal: AbortSignal.timeout(10000) };
  if (method !== 'GET') {
    Object.assign(headers, { Origin: origin, 'X-Requested-With': 'Wishlist', 'Content-Type': 'application/json' });
    options.body = JSON.stringify(body);
  }
  const response = await fetch(`${origin}/api${path}`, options);
  check(response.status === status, `${label}: expected ${status}, received ${response.status}`);
  console.log(`${label}: ${response.status}`);
  const text = await response.text();
  return { body: text ? JSON.parse(text) : null, response };
}
try {
  const registered = await api('register', 'POST', '/auth/register', {
    status: 201, body: { email: `api-smoke-${randomUUID()}@example.test`, password: randomBytes(24).toString('base64url') },
  });
  check(Object.keys(registered.body).join() === 'user', 'Register exposes only user JSON');
  const sessionCookie = registered.response.headers.getSetCookie().find(value => value.startsWith('wishlist_session='));
  check(Boolean(sessionCookie) && sessionCookie.includes('HttpOnly'), 'Register sets HttpOnly cookie');
  cookie = sessionCookie.split(';')[0];
  const list = await api('create list', 'POST', '/wishlists', { status: 201, owner: true, body: { title: 'API smoke temporary list' } });
  wishlistId = list.body.wishlist.id;
  const share = list.body.wishlist.shareToken;
  const created = await api('create gift', 'POST', `/wishlists/${wishlistId}/gifts`, { status: 201, owner: true, body: { title: 'API smoke gift', priceKopecks: 12345 } });
  const giftId = created.body.gift.id;
  const shared = `/shared/${share}`;
  const reserve = `${shared}/gifts/${giftId}/reservations`;
  const first = await api('reserve as guest', 'POST', reserve, { status: 201 });
  const secret = `/reservations/${first.body.reservationToken}`;
  const owner = (await api('public owner projection', 'GET', shared, { owner: true })).body.wishlist;
  check(owner.isOwner && !Object.hasOwn(owner.gifts[0], 'reserved'), 'Owner does not learn reservation status');
  check(Object.keys(owner).sort().join() === 'description,gifts,id,isOwner,title', 'Public owner fields exclude owner identity and secret');
  const guest = (await api('public guest projection', 'GET', shared)).body.wishlist;
  check(!guest.isOwner && guest.gifts[0].reserved === true, 'Guest sees active reservation');
  check(Object.keys(guest).sort().join() === 'description,gifts,id,isOwner,title', 'Guest fields exclude owner identity and secret');
  await api('owner cannot reserve own gift', 'POST', reserve, { owner: true, status: 403 });
  const privateList = (await api('owner management privacy', 'GET', `/wishlists/${wishlistId}`, { owner: true })).body.wishlist;
  check(Object.keys(privateList.gifts[0]).sort().join() === 'createdAt,currency,id,note,priceKopecks,title,updatedAt,url,version,wishlistId', 'Management gift has no reservation fields');
  check((await api('secret initially unchanged', 'GET', secret)).body.reservation.giftChanged === false, 'Initial giftChanged false');
  await api('edit reserved gift', 'PATCH', `/wishlists/${wishlistId}/gifts/${giftId}`, { owner: true, body: { title: 'API smoke edited gift' } });
  const edited = (await api('secret reflects edit', 'GET', secret)).body.reservation;
  check(edited.giftChanged && edited.status === 'active', 'Edit preserves reservation and marks change');
  const rotated = await api('rotate share', 'POST', `/wishlists/${wishlistId}/share-link`, { owner: true });
  const newShared = `/shared/${rotated.body.shareToken}`;
  check(rotated.body.shareToken !== share, 'Rotation issues new token');
  await api('old share revoked', 'GET', shared, { status: 404 });
  await api('old share cannot reserve', 'POST', reserve, { status: 404 });
  await api('secret survives rotation', 'GET', secret);
  let canceled;
  if (outage) {
    // finally always restores the deliberately stopped dependency.
    authStopped = true;
    compose('stop', 'auth-service');
    console.log('auth-service stopped for dependency independence check');
    await api('secret GET ignores cookie during auth outage', 'GET', secret, { owner: true });
    canceled = (await api('secret cancel ignores malformed cookie during outage', 'POST', `${secret}/cancel`, { explicitCookie: 'wishlist_session=%ZZ' })).body.reservation;
    await api('anonymous public GET during outage', 'GET', newShared);
    await api('owner fails closed during auth outage', 'GET', '/wishlists', { owner: true, status: 503 });
    await api('optional-cookie public fails closed during outage', 'GET', newShared, { owner: true, status: 503 });
    const logout = await api('logout cannot claim success during outage', 'POST', '/auth/logout', { owner: true, status: 503 });
    check(logout.response.headers.getSetCookie().length === 0, 'Failed logout preserves cookie');
    await restoreAuth();
    await api('same session survives auth restart', 'GET', '/auth/me', { owner: true });
  } else {
    canceled = (await api('cancel reservation', 'POST', `${secret}/cancel`)).body.reservation;
  }
  check(canceled.status === 'canceled', 'Reservation canceled');
  const repeat = (await api('repeat cancellation', 'POST', `${secret}/cancel`)).body.reservation;
  check(repeat.canceledAt === canceled.canceledAt, 'Repeat keeps original cancellation time');
  const second = await api('new reservation', 'POST', `${newShared}/gifts/${giftId}/reservations`, { status: 201 });
  check(second.body.reservationToken !== first.body.reservationToken, 'New reservation uses independent secret');
  await api('old secret cancel after new reservation', 'POST', `${secret}/cancel`);
  const secondSecret = `/reservations/${second.body.reservationToken}`;
  check((await api('new reservation remains active', 'GET', secondSecret)).body.reservation.status === 'active', 'Old secret cannot cancel new reservation');
  await api('cleanup list', 'DELETE', `/wishlists/${wishlistId}`, { owner: true, status: 204 });
  wishlistId = undefined;
  await api('cascade removes first secret', 'GET', secret, { status: 404 });
  await api('cascade removes second secret', 'GET', secondSecret, { status: 404 });
  await api('deleted list share unavailable', 'GET', newShared, { status: 404 });
  await api('logout', 'POST', '/auth/logout', { owner: true, status: 204 });
  await api('revoked cookie rejected immediately', 'GET', '/auth/me', { owner: true, status: 401 });
  console.log(`API smoke passed: ${checks} assertions; outage=${outage}`);
} catch (error) {
  console.error(`API smoke failed: ${error.message}`);
  process.exitCode = 1;
} finally {
  if (authStopped) await restoreAuth();
  if (wishlistId && cookie) await api('cleanup after failure', 'DELETE', `/wishlists/${wishlistId}`, { owner: true, status: 204 });
}
