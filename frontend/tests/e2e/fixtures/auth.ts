import { test as base, expect, type APIRequestContext, type BrowserContext, type Page } from '@playwright/test';
import { randomUUID } from 'node:crypto';

export const jsonHeaders = (origin: string) => ({ Origin: origin, 'X-Requested-With': 'Wishlist', 'Content-Type': 'application/json' });
export async function loginAsTestUser(page: Page, email: string, password: string) {
  await page.getByLabel('Email', { exact: true }).fill(email);
  await page.getByLabel(/^Пароль/).fill(password);
  await page.getByRole('button', { name: 'Войти', exact: true }).click();
}
export async function mutation(request: APIRequestContext, origin: string, method: string, path: string, data = {}) {
  return request.fetch(`${origin}/api${path}`, { method, headers: jsonHeaders(origin), data });
}
export async function noOverflow(page: Page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
}

type Synthetic = { email: string; password: string; listIds: Set<string> };
export const test = base.extend<{ synthetic: Synthetic; browserErrors: void }>({
  synthetic: async ({ context, baseURL }, use) => {
    const account = { email: `e2e-${randomUUID()}@example.test`, password: `Synthetic-${randomUUID()}`, listIds: new Set<string>() };
    try { await use(account); }
    finally {
      // Delete only IDs returned by this run. Reauthenticate solely if UI logout already revoked the session.
      for (const id of account.listIds) {
        let result = await mutation(context.request, baseURL!, 'DELETE', `/wishlists/${id}`);
        if (result.status() === 401) {
          const login = await mutation(context.request, baseURL!, 'POST', '/auth/login', { email: account.email, password: account.password });
          expect(login.status()).toBe(200);
          result = await mutation(context.request, baseURL!, 'DELETE', `/wishlists/${id}`);
        }
        expect([204, 404]).toContain(result.status());
      }
      const logout = await mutation(context.request, baseURL!, 'POST', '/auth/logout');
      expect(logout.status()).toBe(204);
    }
  },
  browserErrors: [async ({ context }, use) => {
    const errors: string[] = [];
    const watch = (page: Page) => {
      page.on('pageerror', error => errors.push(error.message.replace(/[A-Za-z0-9_-]{43,}/g, '[redacted]')));
      page.on('console', message => {
        if (message.type() !== 'error') return;
        // Chromium emits resource messages for intentional guest/bootstrap 401 and invalid-link 404.
        if (/^Failed to load resource: the server responded with a status of (401|404) \(/.test(message.text())) return;
        errors.push(message.text().replace(/[A-Za-z0-9_-]{43,}/g, '[redacted]'));
      });
    };
    context.on('page', watch); context.pages().forEach(watch);
    await use();
    expect(errors).toEqual([]);
  }, { auto: true }],
});
export { expect };
export function watchGuestErrors(context: BrowserContext) {
  const errors: string[] = [];
  context.on('page', page => {
    page.on('pageerror', () => errors.push('uncaught guest JS error'));
    page.on('console', message => {
      if (message.type() === 'error' && !/^Failed to load resource: the server responded with a status of (401|404) \(/.test(message.text())) errors.push('unexpected guest console error');
    });
  });
  return errors;
}
