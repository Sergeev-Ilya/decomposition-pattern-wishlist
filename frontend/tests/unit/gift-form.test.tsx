import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { GiftForm } from '../../src/components/Forms';
import { ApiError, ownerApi } from '../../src/api';

const expire = vi.hoisted(() => vi.fn());
vi.mock('../../src/auth/AuthContext', () => ({ useAuth: () => ({ expire }) }));
vi.mock('../../src/api/owner', () => ({ ownerApi: { createGift: vi.fn(), updateGift: vi.fn() } }));

function form() {
  const onSaved = vi.fn().mockResolvedValue(undefined); const onClose = vi.fn();
  render(<GiftForm wishlistId="synthetic-list" onSaved={onSaved} onClose={onClose} />);
  fireEvent.change(screen.getByLabelText('Название подарка'), { target: { value: 'Тестовый подарок' } });
  return { onSaved, onClose };
}
describe('gift form validation and failed saves', () => {
  beforeEach(() => vi.clearAllMocks());
  it('saves mandatory price exactly and permits an empty store URL', async () => {
    vi.mocked(ownerApi.createGift).mockResolvedValue({} as never);
    const { onSaved, onClose } = form();
    fireEvent.change(screen.getByLabelText('Цена, ₽'), { target: { value: '1250,50' } });
    fireEvent.click(screen.getByRole('button', { name: 'Добавить желание' }));
    await waitFor(() => expect(onClose).toHaveBeenCalledOnce());
    expect(ownerApi.createGift).toHaveBeenCalledWith('synthetic-list', { title: 'Тестовый подарок', priceKopecks: 125050, url: '', note: '' });
    expect(onSaved).toHaveBeenCalledOnce();
  });
  it.each(['-1', '1.001', ''])('never sends invalid mandatory price %j', async value => {
    form();
    fireEvent.change(screen.getByLabelText('Цена, ₽'), { target: { value } });
    fireEvent.submit(screen.getByRole('button', { name: 'Добавить желание' }).closest('form')!);
    expect(await screen.findByRole('alert')).toHaveTextContent('Укажите неотрицательную цену');
    expect(ownerApi.createGift).not.toHaveBeenCalled();
  });
  it('rejects credentials in otherwise valid HTTP store URLs', async () => {
    form();
    fireEvent.change(screen.getByLabelText('Цена, ₽'), { target: { value: '1' } });
    fireEvent.change(screen.getByLabelText(/Ссылка на подарок/), { target: { value: 'https://user:password@example.com/gift' } });
    fireEvent.submit(screen.getByRole('button', { name: 'Добавить желание' }).closest('form')!);
    expect(await screen.findByRole('alert')).toHaveTextContent('без логина и пароля');
    expect(ownerApi.createGift).not.toHaveBeenCalled();
  });
  it('preserves input, reports a server error, and expires a rejected session', async () => {
    vi.mocked(ownerApi.createGift).mockRejectedValue(new ApiError(401, 'UNAUTHENTICATED', 'internal detail'));
    const { onSaved, onClose } = form();
    fireEvent.change(screen.getByLabelText('Цена, ₽'), { target: { value: '2,50' } });
    fireEvent.click(screen.getByRole('button', { name: 'Добавить желание' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Сессия завершилась');
    expect(screen.getByLabelText('Цена, ₽')).toHaveValue('2,50');
    expect(expire).toHaveBeenCalledOnce();
    expect(onSaved).not.toHaveBeenCalled(); expect(onClose).not.toHaveBeenCalled();
  });
});
