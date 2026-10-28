import { test, expect, loginAsTestUser, noOverflow, watchGuestErrors } from './fixtures/auth';

test('guest routes, protected redirects, invalid links and mobile layout', async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 800 });
  for (const [route, heading] of [
    ['/', 'Ваши желания. Подсказки для близких.'],
    ['/register', 'У каждой мечты свое место.'],
    ['/login', 'Ваши желания уже здесь.'],
    ['/s/invalid-e2e', 'Список недоступен'],
    ['/r/invalid-e2e', 'Бронь недоступна'],
    ['/missing-e2e', 'Кажется, это не тот адрес'],
  ]) {
    await page.goto(route);
    await expect(page.getByRole('heading', { name: heading, exact: true })).toBeVisible();
    await expect(page).toHaveTitle('Wishlist — для того, что радует');
    await noOverflow(page);
  }
  for (const route of ['/wishlists', '/wishlists/00000000-0000-4000-8000-000000000000']) {
    await page.goto(route);
    await expect(page.getByRole('button', { name: 'Войти', exact: true })).toBeVisible();
    expect(new URL(page.url()).searchParams.get('returnTo')).toBe(route);
    await noOverflow(page);
  }
});

test('real owner CRUD, privacy, guest reservation, changed gift, rotated share and cancellation', async ({ page, context, browser, baseURL, synthetic }) => {
  const guest = await browser.newContext({ baseURL, viewport: { width: 360, height: 800 } });
  const guestErrors = watchGuestErrors(guest);
  try {
    await page.goto('/register?returnTo=https%3A%2F%2Fevil.example');
    await page.getByLabel('Email', { exact: true }).fill(synthetic.email);
    await page.getByLabel(/^Пароль/).fill(synthetic.password);
    await page.getByRole('button', { name: 'Создать аккаунт', exact: true }).click();
    await expect(page).toHaveURL(`${baseURL}/wishlists`);
    await expect(page.getByRole('heading', { name: /Мои вишлисты/ })).toBeVisible();
    const sessionCookie = (await context.cookies()).find(cookie => cookie.name === 'wishlist_session');
    expect(sessionCookie?.httpOnly).toBe(true);
    expect(await page.evaluate(() => document.cookie.includes('wishlist_session'))).toBe(false);

    await page.getByRole('button', { name: 'Создать вишлист', exact: true }).first().click();
    let dialog = page.getByRole('dialog');
    await dialog.getByLabel('Название', { exact: true }).fill('E2E birthday');
    await dialog.getByLabel(/Описание/).fill('Synthetic acceptance data');
    const created = page.waitForResponse(response => response.request().method() === 'POST' && new URL(response.url()).pathname === '/api/wishlists');
    await dialog.getByRole('button', { name: 'Создать вишлист', exact: true }).click();
    const list = (await (await created).json()).wishlist;
    synthetic.listIds.add(list.id);
    await page.getByRole('link', { name: 'Открыть вишлист «E2E birthday»', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'E2E birthday', exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Изменить список', exact: true }).click();
    await page.getByRole('dialog').getByLabel('Название', { exact: true }).fill('E2E updated list');
    await page.getByRole('dialog').getByRole('button', { name: 'Сохранить', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'E2E updated list', exact: true })).toBeVisible();

    for (const [title, price, url] of [['E2E gift no URL', '1250,50', ''], ['E2E gift with URL', '0', 'https://example.com/gift']]) {
      await page.getByRole('button', { name: 'Добавить желание', exact: true }).first().click();
      dialog = page.getByRole('dialog');
      await dialog.getByLabel('Название подарка', { exact: true }).fill(title);
      if (!url) {
        await dialog.getByRole('button', { name: 'Добавить желание', exact: true }).click();
        await expect(dialog).toBeVisible();
        expect(await dialog.getByLabel('Цена, ₽', { exact: true }).evaluate((input: HTMLInputElement) => input.validity.valueMissing)).toBe(true);
      }
      await dialog.getByLabel('Цена, ₽', { exact: true }).fill(price);
      if (url) await dialog.getByLabel(/Ссылка на подарок/).fill(url);
      await dialog.getByRole('button', { name: 'Добавить желание', exact: true }).click();
      await expect(page.getByRole('heading', { name: title, exact: true })).toBeVisible();
    }
    await page.reload();
    await expect(page.getByRole('heading', { name: 'E2E gift no URL', exact: true })).toBeVisible();
    const giftCard = page.getByRole('article').filter({ has: page.getByRole('heading', { name: 'E2E gift no URL', exact: true }) });
    await expect(giftCard).toContainText('1 250,50 ₽');
    await expect(giftCard.getByRole('link')).toHaveCount(0);

    // Owner UI and its server projection contain no availability or guest secrets.
    const ownerResponse = await context.request.get(`/api/wishlists/${list.id}`);
    const ownerGift = (await ownerResponse.json()).wishlist.gifts[0];
    expect(Object.keys(ownerGift).some(key => /reserv|donor/i.test(key))).toBe(false);
    const ownerShared = page.waitForResponse(response => new URL(response.url()).pathname === `/api/shared/${list.shareToken}`);
    await page.goto(`/s/${list.shareToken}`);
    const ownerProjection = (await (await ownerShared).json()).wishlist;
    expect(ownerProjection.isOwner).toBe(true);
    expect(ownerProjection.gifts.every((gift: object) => !Object.keys(gift).some(key => /reserv|donor/i.test(key)))).toBe(true);
    await expect(page.getByText('Это ваш вишлист. В этом представлении брони скрыты.', { exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Хочу подарить' })).toHaveCount(0);
    await expect(page.getByText('Можно подарить', { exact: true })).toHaveCount(0);

    // An invalid *HttpOnly* session must require an explicit guest transition.
    await guest.addCookies([{ name: 'wishlist_session', value: 'invalid-e2e-session', url: baseURL!, httpOnly: true, sameSite: 'Lax' }]);
    const guestPage = await guest.newPage();
    await guestPage.goto(`/s/${list.shareToken}`);
    await expect(guestPage.getByRole('heading', { name: 'Войдите снова или продолжите как гость' })).toBeVisible();
    await expect(guestPage.getByRole('link', { name: 'Войти', exact: true })).toBeVisible();
    await noOverflow(guestPage);
    await guestPage.getByRole('button', { name: 'Продолжить как гость' }).click();
    await expect(guestPage.getByRole('heading', { name: 'E2E updated list', exact: true })).toBeVisible();
    const available = guestPage.getByRole('article').filter({ has: guestPage.getByRole('heading', { name: 'E2E gift no URL', exact: true }) });
    await expect(available.getByRole('link')).toHaveCount(0);
    const store = guestPage.getByRole('link', { name: 'Посмотреть в магазине' });
    await expect(store).toHaveAttribute('href', 'https://example.com/gift');
    await expect(store).toHaveAttribute('rel', 'noopener noreferrer');
    await expect(store).toHaveAttribute('referrerpolicy', 'no-referrer');
    await available.getByRole('button', { name: 'Хочу подарить' }).click();
    await noOverflow(guestPage);
    await guestPage.getByRole('dialog').getByRole('button', { name: 'Забронировать', exact: true }).click();
    await expect(guestPage.getByRole('dialog').getByRole('heading', { name: 'Один подарок. Много радости.' })).toBeVisible();
    const secretURL = await guestPage.getByLabel('Ваша личная ссылка').inputValue();
    await noOverflow(guestPage);
    await guestPage.getByRole('link', { name: 'Открыть мою бронь' }).click();
    await expect(guestPage.getByRole('heading', { name: 'Ваш маленький секрет' })).toBeVisible();

    // Editing a booked gift and rotating the public link preserve its secret capability.
    await page.goto(`/wishlists/${list.id}`);
    await page.getByRole('button', { name: 'Изменить «E2E gift no URL»', exact: true }).click();
    await page.getByRole('dialog').getByLabel('Название подарка', { exact: true }).fill('E2E changed gift');
    await page.getByRole('dialog').getByLabel('Цена, ₽', { exact: true }).fill('42,01');
    await page.getByRole('dialog').getByRole('button', { name: 'Сохранить', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'E2E changed gift', exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Поделиться', exact: true }).click();
    await page.getByRole('dialog').getByRole('button', { name: 'Заменить ссылку', exact: true }).click();
    await page.getByRole('dialog').getByRole('button', { name: 'Заменить ссылку', exact: true }).click();
    await expect(page.getByRole('dialog').getByRole('heading', { name: 'Радостью нужно делиться' })).toBeVisible();
    const newShareURL = await page.getByLabel('Ссылка на вишлист').inputValue();
    expect(new URL(newShareURL).pathname === `/s/${list.shareToken}`).toBe(false);
    await page.getByRole('dialog').getByRole('button', { name: 'Закрыть', exact: true }).click();
    await guestPage.goto(`/s/${list.shareToken}`);
    await expect(guestPage.getByRole('heading', { name: 'Список недоступен' })).toBeVisible();
    await guestPage.goto(newShareURL);
    await expect(guestPage.getByRole('button', { name: 'Уже выбрали', exact: true })).toBeDisabled();
    await guest.addCookies([{ name: 'wishlist_session', value: 'invalid-again', url: baseURL!, httpOnly: true, sameSite: 'Lax' }]);
    await guestPage.goto(secretURL);
    await expect(guestPage.getByRole('heading', { name: 'E2E changed gift' })).toBeVisible();
    await expect(guestPage.getByRole('status')).toContainText('Владелец изменил карточку');
    await expect(guestPage.getByText('42,01 ₽', { exact: true })).toBeVisible();
    await guestPage.reload();
    await expect(guestPage.getByText('Забронировано вами', { exact: true })).toBeVisible();
    await noOverflow(guestPage);
    await guestPage.getByRole('button', { name: 'Отменить мою бронь' }).click();
    await noOverflow(guestPage);
    await guestPage.getByRole('dialog').getByRole('button', { name: 'Да, отменить бронь' }).click();
    await expect(guestPage.getByText('Бронь отменена', { exact: true })).toBeVisible();
    await guestPage.reload();
    await expect(guestPage.getByText('Бронь отменена', { exact: true })).toBeVisible();
    await expect(guestPage.getByRole('button', { name: 'Отменить мою бронь' })).toHaveCount(0);
    expect(await guestPage.evaluate(() => localStorage.length + sessionStorage.length)).toBe(0);

    // Logout revokes this server session; a reload cannot reopen protected data.
    await page.getByRole('button', { name: 'Выйти', exact: true }).first().click();
    await expect.poll(() => new URL(page.url()).pathname).toBe('/login');
    await page.goto(`/wishlists/${list.id}`);
    await expect(page.getByRole('button', { name: 'Войти', exact: true })).toBeVisible();
    await page.reload();
    await loginAsTestUser(page, synthetic.email, synthetic.password);
    await expect(page).toHaveURL(`${baseURL}/wishlists/${list.id}`);
    await expect(page.getByRole('heading', { name: 'E2E updated list', exact: true, level: 1 })).toBeVisible();
    await page.reload();
    await expect(page.getByRole('heading', { name: 'E2E changed gift', exact: true })).toBeVisible();

    await page.setViewportSize({ width: 360, height: 800 });
    await noOverflow(page);
    await page.goto('/wishlists');
    await expect(page.getByRole('heading', { name: /Мои вишлисты/ })).toBeVisible();
    await noOverflow(page);
    await page.goto(`/wishlists/${list.id}`);
    await expect(page.getByRole('heading', { name: 'E2E updated list', exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Удалить «E2E gift with URL»', exact: true }).click();
    await noOverflow(page);
    await page.getByRole('dialog').getByRole('button', { name: 'Удалить', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'E2E gift with URL', exact: true })).toHaveCount(0);
    await page.getByRole('button', { name: 'Удалить', exact: true }).click();
    await page.getByRole('dialog').getByRole('button', { name: 'Удалить', exact: true }).click();
    await expect(page).toHaveURL(`${baseURL}/wishlists`);
    await expect(page.getByRole('heading', { name: 'О чем вы мечтаете?' })).toBeVisible();
    synthetic.listIds.delete(list.id);
    expect(await page.evaluate(() => localStorage.length + sessionStorage.length)).toBe(0);
    await page.getByRole('button', { name: 'Выйти', exact: true }).first().click();
    await expect.poll(() => new URL(page.url()).pathname).toBe('/login');
    expect(guestErrors).toEqual([]);
  } finally { await guest.close(); }
});
