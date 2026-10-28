import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AuthProvider, useAuth } from '../../src/auth/AuthContext';
import { ApiError, authApi } from '../../src/api';

vi.mock('../../src/api/auth', () => ({ authApi: { me: vi.fn(), logout: vi.fn() } }));
function Probe() {
  const auth = useAuth();
  return <><p role="status">{auth.status}:{auth.user?.email ?? 'guest'}</p><button onClick={() => { void auth.logout().catch(() => undefined); }}>logout</button><button onClick={() => { void auth.refresh(); }}>retry</button></>;
}
describe('session bootstrap and revocation failures', () => {
  beforeEach(() => vi.clearAllMocks());
  it('classifies a bootstrap 401 as a guest', async () => {
    vi.mocked(authApi.me).mockRejectedValue(new ApiError(401, 'UNAUTHENTICATED', ''));
    render(<AuthProvider><Probe /></AuthProvider>);
    expect(await screen.findByText('ready:guest')).toBeInTheDocument();
  });
  it('retains service failure and allows an explicit retry', async () => {
    vi.mocked(authApi.me).mockRejectedValueOnce(new ApiError(503, 'SERVICE_UNAVAILABLE', '')).mockResolvedValueOnce({ user: { email: 'synthetic@example.test' } } as never);
    render(<AuthProvider><Probe /></AuthProvider>);
    expect(await screen.findByText('error:guest')).toBeInTheDocument();
    fireEvent.click(screen.getByText('retry'));
    expect(await screen.findByText('ready:synthetic@example.test')).toBeInTheDocument();
  });
  it('keeps the signed-in UI when logout fails, clearing it only on confirmed revocation', async () => {
    vi.mocked(authApi.me).mockResolvedValue({ user: { email: 'synthetic@example.test' } } as never);
    vi.mocked(authApi.logout).mockRejectedValueOnce(new ApiError(503, 'SERVICE_UNAVAILABLE', '')).mockResolvedValueOnce(undefined);
    render(<AuthProvider><Probe /></AuthProvider>);
    await screen.findByText('ready:synthetic@example.test');
    fireEvent.click(screen.getByText('logout'));
    await waitFor(() => expect(authApi.logout).toHaveBeenCalledTimes(1));
    expect(screen.getByRole('status')).toHaveTextContent('ready:synthetic@example.test');
    fireEvent.click(screen.getByText('logout'));
    expect(await screen.findByText('ready:guest')).toBeInTheDocument();
  });
});
