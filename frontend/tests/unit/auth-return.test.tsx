import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import AuthForm from '../../src/components/AuthForm';
import { AuthProvider } from '../../src/auth/AuthContext';
import { ApiError, authApi } from '../../src/api';

vi.mock('../../src/api/auth', () => ({ authApi: { me: vi.fn(), login: vi.fn(), register: vi.fn() } }));
const account = { user: { email: 'synthetic@example.test' } } as never;
function form(mode: 'login' | 'register') {
  render(<MemoryRouter initialEntries={[`/${mode}?returnTo=%2Fwishlists%2Fsynthetic`]}><AuthProvider><Routes>
    <Route path={`/${mode}`} element={<AuthForm mode={mode} />} />
    <Route path="/wishlists/synthetic" element={<h1>Requested list</h1>} />
    <Route path="/wishlists" element={<h1>Dashboard</h1>} />
  </Routes></AuthProvider></MemoryRouter>);
}
describe('successful authentication destination', () => {
  beforeEach(() => vi.clearAllMocks());
  it.each(['login', 'register'] as const)('preserves safe returnTo during %s session rerender', async mode => {
    vi.mocked(authApi.me).mockRejectedValue(new ApiError(401, 'UNAUTHENTICATED', ''));
    vi.mocked(authApi[mode]).mockResolvedValue(account);
    form(mode);
    await screen.findByLabelText('Email');
    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'synthetic@example.test' } });
    fireEvent.change(screen.getByLabelText(/^Пароль/), { target: { value: 'Synthetic-password-123' } });
    fireEvent.click(screen.getByRole('button', { name: mode === 'login' ? 'Войти' : 'Создать аккаунт', exact: true }));
    expect(await screen.findByRole('heading', { name: 'Requested list' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Dashboard' })).not.toBeInTheDocument();
  });
  it('sends an already authenticated visitor to the dashboard', async () => {
    vi.mocked(authApi.me).mockResolvedValue(account);
    form('login');
    expect(await screen.findByRole('heading', { name: 'Dashboard' })).toBeInTheDocument();
    expect(authApi.login).not.toHaveBeenCalled();
  });
});
