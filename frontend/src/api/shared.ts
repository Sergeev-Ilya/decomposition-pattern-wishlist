import { request } from './client';
import type { ReservationCreatedResponse, SharedWishlistResponse } from './types';

export const sharedApi = {
  get: (shareToken: string, signal?: AbortSignal) => request<SharedWishlistResponse>(`/shared/${encodeURIComponent(shareToken)}`, { signal }),
  reserve: (shareToken: string, giftId: string) => request<ReservationCreatedResponse>(
    `/shared/${encodeURIComponent(shareToken)}/gifts/${encodeURIComponent(giftId)}/reservations`, { method: 'POST' }),
};
