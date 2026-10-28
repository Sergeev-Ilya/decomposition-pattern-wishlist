import { request } from './client';
import type { AuthCredentials, AuthUserResponse } from './types';

export const authApi = {
  register: (body: AuthCredentials) => request<AuthUserResponse>('/auth/register', { method: 'POST', body }),
  login: (body: AuthCredentials) => request<AuthUserResponse>('/auth/login', { method: 'POST', body }),
  me: (signal?: AbortSignal) => request<AuthUserResponse>('/auth/me', { signal }),
  logout: () => request<void>('/auth/logout', { method: 'POST' }),
};
