import { request } from './client';
import type { GiftInput, GiftPatch, GiftResponse, ShareLinkResponse, WishlistInput, WishlistPatch, WishlistResponse, WishlistsResponse } from './types';

const wishlistPath = (id: string) => `/wishlists/${encodeURIComponent(id)}`;
const giftPath = (id: string, giftId: string) => `${wishlistPath(id)}/gifts/${encodeURIComponent(giftId)}`;
export const ownerApi = {
  list: (signal?: AbortSignal) => request<WishlistsResponse>('/wishlists', { signal }),
  get: (id: string, signal?: AbortSignal) => request<WishlistResponse>(wishlistPath(id), { signal }),
  create: (body: WishlistInput) => request<WishlistResponse>('/wishlists', { method: 'POST', body }),
  update: (id: string, body: WishlistPatch) => request<WishlistResponse>(wishlistPath(id), { method: 'PATCH', body }),
  delete: (id: string) => request<void>(wishlistPath(id), { method: 'DELETE' }),
  createGift: (id: string, body: GiftInput) => request<GiftResponse>(`${wishlistPath(id)}/gifts`, { method: 'POST', body }),
  updateGift: (id: string, giftId: string, body: GiftPatch) => request<GiftResponse>(giftPath(id, giftId), { method: 'PATCH', body }),
  deleteGift: (id: string, giftId: string) => request<void>(giftPath(id, giftId), { method: 'DELETE' }),
  rotateShareLink: (id: string) => request<ShareLinkResponse>(`${wishlistPath(id)}/share-link`, { method: 'POST' }),
};
