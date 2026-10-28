import { useSyncExternalStore } from 'react';

export type User = { id: string; email: string; name: string; passwordHash?: string };
export type Wishlist = { id: string; ownerId: string; title: string; description: string; shareToken: string; color: number; created: string };
export type Gift = { id: string; wishlistId: string; title: string; price: number; url: string; note: string; version: number; kind: number };
export type Reservation = { id: string; giftId: string; token: string; version: number; active: boolean };
type State = { users: User[]; userId: string | null; wishlists: Wishlist[]; gifts: Gift[]; reservations: Reservation[] };
export const demo = { email: 'maria@example.com', password: 'Wishlist2026!', publicPath: '/s/birthday-demo' };
export const steps = [
  { number: '01', title: 'Соберите желания', text: 'От маленьких радостей до большой мечты. Добавьте название, цену и ссылку, если она есть.' },
  { number: '02', title: 'Поделитесь ссылкой', text: 'Отправьте вишлист друзьям. Он откроется без регистрации — всё очень просто.' },
  { number: '03', title: 'Оставьте место сюрпризу', text: 'Друзья забронируют подарки, а вы не узнаете, кто и что выбрал.' },
];
const initial: State = {
  users: [{ id: 'maria', email: demo.email, name: 'Мария' }], userId: null,
  wishlists: [
    { id: 'birthday', ownerId: 'maria', title: 'Мой день рождения', description: 'Маленькие вещи, которые делают меня счастливее. Буду рада любому из этих подарков ♡', shareToken: 'birthday-demo', color: 0, created: '2026-10-28' },
    { id: 'home', ownerId: 'maria', title: 'Для уютного дома', description: 'Пусть дома всегда будет немного теплее.', shareToken: 'home-demo', color: 1, created: '2026-10-27' },
    { id: 'someday', ownerId: 'maria', title: 'Однажды обязательно', description: 'Мечтам тоже нужно свое место.', shareToken: 'someday-demo', color: 2, created: '2026-10-26' },
  ],
  gifts: [
    { id: 'g1', wishlistId: 'birthday', title: 'Наушники Marshall Major V', price: 1499000, url: 'https://www.marshall.com/', note: 'В черном цвете. Чтобы любимая музыка была всегда рядом.', version: 1, kind: 0 },
    { id: 'g2', wishlistId: 'birthday', title: 'Керамическая чашка', price: 280000, url: '', note: 'Ручная работа, неровные края и много места для утреннего кофе.', version: 1, kind: 1 },
    { id: 'g3', wishlistId: 'birthday', title: 'Книга «Искусство замечать»', price: 165000, url: '', note: 'Бумажная книга с красивыми иллюстрациями.', version: 1, kind: 2 },
    { id: 'g4', wishlistId: 'birthday', title: 'Билет на мастер-класс', price: 450000, url: '', note: 'Гончарное дело или рисование — буду рада попробовать что-то новое.', version: 1, kind: 3 },
    { id: 'g5', wishlistId: 'home', title: 'Льняная скатерть', price: 520000, url: '', note: 'Натуральный оттенок, для долгих завтраков.', version: 1, kind: 2 },
    { id: 'g6', wishlistId: 'home', title: 'Настольная лампа', price: 890000, url: '', note: 'Теплый свет для любимого уголка.', version: 1, kind: 3 },
  ],
  reservations: [{ id: 'r-demo', giftId: 'g2', token: 'reserved-demo-token', version: 1, active: true }],
};
const storageKey = 'wishlist-prototype-v1';
function load(): State {
  try { const data = JSON.parse(sessionStorage.getItem(storageKey) || 'null'); if (data?.users && data?.wishlists && data?.gifts && data?.reservations) return data; } catch { /* clean demo state if storage is unavailable */ }
  return structuredClone(initial);
}
let state = load();
const listeners = new Set<() => void>();
function commit(next: State) { state = next; try { sessionStorage.setItem(storageKey, JSON.stringify(state)); } catch { /* memory-only fallback */ } listeners.forEach(fn => fn()); }
export function useStore() { return useSyncExternalStore(fn => { listeners.add(fn); return () => listeners.delete(fn); }, () => state); }
export function currentUser() { return state.users.find(u => u.id === state.userId); }
function id() { return crypto.randomUUID(); }
async function digest(value: string) { const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value)); return Array.from(new Uint8Array(hash), b => b.toString(16).padStart(2, '0')).join(''); }
export async function login(email: string, password: string) {
  const user = state.users.find(u => u.email === email.trim().toLowerCase());
  const valid = user?.id === 'maria' ? password === demo.password : user?.passwordHash === await digest(password);
  if (!user || !valid) throw new Error('Не удалось войти. Проверьте email и пароль.');
  commit({ ...state, userId: user.id });
}
export async function register(email: string, password: string) {
  const normalized = email.trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized)) throw new Error('Укажите корректный email.');
  if (password.length < 12 || password.length > 128) throw new Error('Пароль должен содержать от 12 до 128 символов.');
  if (state.users.some(u => u.email === normalized)) throw new Error('Этот email уже используется. Попробуйте войти.');
  const user: User = { id: id(), email: normalized, name: normalized.split('@')[0], passwordHash: await digest(password) };
  commit({ ...state, users: [...state.users, user], userId: user.id });
}
export function logout() { commit({ ...state, userId: null }); }
export function safeReturn(value: string | null) { return value && /^\/(?!\/)/.test(value) && !value.includes('\\') && !/[\u0000-\u0020]/.test(value) && !/^\/(login|register)(?:[/?#]|$)/.test(value) ? value : '/wishlists'; }
export function saveWishlist(values: { title: string; description: string }, wishlistId?: string) {
  if (!values.title.trim()) throw new Error('Добавьте название списка.');
  if (!state.userId) throw new Error('Войдите, чтобы сохранить список.');
  if (wishlistId && !state.wishlists.some(w => w.id === wishlistId && w.ownerId === state.userId)) throw new Error('Список недоступен.');
  const data = { title: values.title.trim(), description: values.description.trim() };
  if (wishlistId) commit({ ...state, wishlists: state.wishlists.map(w => w.id === wishlistId ? { ...w, ...data } : w) });
  else { const wishlist: Wishlist = { id: id(), ownerId: state.userId, ...data, shareToken: id(), color: state.wishlists.length % 3, created: new Date().toISOString() }; commit({ ...state, wishlists: [...state.wishlists, wishlist] }); return wishlist.id; }
  return wishlistId!;
}
export function deleteWishlist(wishlistId: string) {
  if (!state.wishlists.some(w => w.id === wishlistId && w.ownerId === state.userId)) return;
  const removed = state.gifts.filter(g => g.wishlistId === wishlistId).map(g => g.id);
  commit({ ...state, wishlists: state.wishlists.filter(w => w.id !== wishlistId), gifts: state.gifts.filter(g => g.wishlistId !== wishlistId), reservations: state.reservations.filter(r => !removed.includes(r.giftId)) });
}
export function rotateShare(wishlistId: string) {
  if (!state.wishlists.some(w => w.id === wishlistId && w.ownerId === state.userId)) throw new Error('Список недоступен.');
  commit({ ...state, wishlists: state.wishlists.map(w => w.id === wishlistId ? { ...w, shareToken: id() } : w) });
}
export type GiftValues = { title: string; price: string; url: string; note: string };
export function saveGift(wishlistId: string, values: GiftValues, giftId?: string) {
  if (!state.wishlists.some(w => w.id === wishlistId && w.ownerId === state.userId)) throw new Error('Список недоступен.');
  if (!values.title.trim()) throw new Error('Добавьте название подарка.');
  const amount = values.price.trim().replace(',', '.');
  if (!/^\d+(\.\d{1,2})?$/.test(amount) || !Number.isSafeInteger(Math.round(Number(amount) * 100))) throw new Error('Укажите неотрицательную цену с точностью до копеек.');
  const url = values.url.trim();
  if (url) { try { const parsed = new URL(url); if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password) throw Error(); } catch { throw new Error('Ссылка должна начинаться с https:// или http:// и не содержать логин или пароль.'); } }
  const data = { title: values.title.trim(), price: Math.round(Number(amount) * 100), url, note: values.note.trim() };
  if (giftId) { if (!state.gifts.some(g => g.id === giftId && g.wishlistId === wishlistId)) throw new Error('Подарок недоступен.'); commit({ ...state, gifts: state.gifts.map(g => g.id === giftId ? { ...g, ...data, version: g.version + 1 } : g) }); }
  else { if (state.gifts.filter(g => g.wishlistId === wishlistId).length >= 100) throw new Error('В одном списке может быть до 100 подарков.'); commit({ ...state, gifts: [...state.gifts, { id: id(), wishlistId, ...data, version: 1, kind: state.gifts.length % 4 }] }); }
}
export function deleteGift(giftId: string) {
  const gift = state.gifts.find(g => g.id === giftId);
  if (!gift || !state.wishlists.some(w => w.id === gift.wishlistId && w.ownerId === state.userId)) return;
  commit({ ...state, gifts: state.gifts.filter(g => g.id !== giftId), reservations: state.reservations.filter(r => r.giftId !== giftId) });
}
export function reserve(giftId: string, shareToken: string) {
  const gift = state.gifts.find(g => g.id === giftId); const list = state.wishlists.find(w => w.id === gift?.wishlistId && w.shareToken === shareToken);
  if (!gift || !list) throw new Error('Этот подарок больше недоступен.');
  if (list.ownerId === state.userId) throw new Error('Вы не можете забронировать подарок в своем списке.');
  if (state.reservations.some(r => r.giftId === giftId && r.active)) throw new Error('Подарок уже забронирован. Выберите другое желание.');
  const reservation: Reservation = { id: id(), giftId, token: id(), version: gift.version, active: true };
  commit({ ...state, reservations: [...state.reservations, reservation] });
  return reservation.token;
}
export function cancelReservation(token: string) { commit({ ...state, reservations: state.reservations.map(r => r.token === token ? { ...r, active: false } : r) }); }
export function formatPrice(kopecks: number) { return new Intl.NumberFormat('ru-RU', { style: 'currency', currency: 'RUB', maximumFractionDigits: kopecks % 100 ? 2 : 0 }).format(kopecks / 100); }
export function shareUrl(token: string) { return `${window.location.origin}/s/${token}`; }
