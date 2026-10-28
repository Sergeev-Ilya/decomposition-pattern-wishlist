import { ApiError } from '../api';

const messages: Record<string, string> = {
  VALIDATION_ERROR: 'Проверьте введенные данные и ограничения полей.',
  INVALID_CREDENTIALS: 'Не удалось войти. Проверьте email и пароль.',
  UNAUTHENTICATED: 'Сессия завершилась. Войдите снова или явно продолжите как гость.',
  EMAIL_IN_USE: 'Этот email уже используется. Попробуйте войти.',
  FORBIDDEN: 'Не удалось выполнить действие. Обновите страницу и попробуйте снова.',
  OWN_WISHLIST: 'Нельзя бронировать подарок в своем списке.',
  NOT_FOUND: 'Объект или ссылка недоступны.',
  GIFT_RESERVED: 'Подарок уже забронирован. Выберите другое желание.',
  GIFT_LIMIT_REACHED: 'В одном списке может быть до 100 подарков.',
  RATE_LIMITED: 'Слишком много запросов. Подождите и попробуйте снова.',
  SERVICE_UNAVAILABLE: 'Сервис временно недоступен. Попробуйте еще раз.',
  GATEWAY_TIMEOUT: 'Сервер не ответил вовремя. Проверьте актуальное состояние.',
  REQUEST_TOO_LARGE: 'Данные слишком большие. Сократите текст.',
  UNSUPPORTED_MEDIA_TYPE: 'Не удалось отправить данные. Обновите страницу.',
  NETWORK_ERROR: 'Нет ответа от сервера. Проверьте подключение и попробуйте снова.',
  REQUEST_ABORTED: 'Запрос отменен.',
  INVALID_RESPONSE: 'Не удалось прочитать ответ сервера. Попробуйте снова.',
};
export function errorMessage(error: unknown): string {
  if (error instanceof ApiError) {
    const message = messages[error.code] ?? 'Не удалось выполнить запрос. Попробуйте снова.';
    return message + (error.retryAfterSeconds ? ` Повторите через ${error.retryAfterSeconds} сек.` : '');
  }
  return error instanceof Error ? error.message : 'Не удалось выполнить действие.';
}
export function isStatus(error: unknown, status: number) { return error instanceof ApiError && error.status === status; }
export function safeReturn(value: string | null) {
  return value && /^\/(?!\/)/.test(value) && !value.includes('\\') && !/[\u0000-\u0020]/.test(value) && !/^\/(login|register)(?:[/?#]|$)/.test(value) ? value : '/wishlists';
}
export function parsePrice(value: string): number {
  const amount = value.trim().replace(',', '.');
  if (!/^\d+(\.\d{1,2})?$/.test(amount) || amount.length > 32) throw new Error('Укажите неотрицательную цену с точностью до копеек.');
  const [rubles, fraction = ''] = amount.split('.');
  const kopecks = BigInt(rubles) * 100n + BigInt(fraction.padEnd(2, '0'));
  if (kopecks > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error('Цена не должна превышать 90 071 992 547 409,91 ₽.');
  return Number(kopecks);
}
export function priceInput(kopecks: number): string {
  const exact = BigInt(kopecks);
  return `${exact / 100n}.${(exact % 100n).toString().padStart(2, '0')}`;
}
export function formatPrice(kopecks: number): string {
  const exact = BigInt(kopecks);
  const rubles = new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 0 }).format(exact / 100n);
  return `${rubles}${exact % 100n ? `,${(exact % 100n).toString().padStart(2, '0')}` : ''}\u00a0₽`;
}
export function artVariant(id: string) { return [...id].reduce((sum, char) => sum + char.charCodeAt(0), 0); }
export function shareUrl(token: string) { return `${window.location.origin}/s/${token}`; }
