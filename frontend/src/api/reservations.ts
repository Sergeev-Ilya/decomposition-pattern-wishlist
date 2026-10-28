import { request } from './client';
import type { ReservationResponse } from './types';

export const reservationsApi = {
  get: (token: string, signal?: AbortSignal) => request<ReservationResponse>(`/reservations/${encodeURIComponent(token)}`, { signal }),
  cancel: (token: string) => request<ReservationResponse>(`/reservations/${encodeURIComponent(token)}/cancel`, { method: 'POST' }),
};
