# Wishlist — интегрированный frontend

React + Vite + TypeScript + Tailwind CSS v4. Все восемь маршрутов и действия в модалках используют живой API по `docs/api-gateway.yaml`. Источник данных — сервер; демонстрационных аккаунтов, токенов, fixtures и mock fallbacks в frontend нет. Утвержденные SVG-иллюстрации, структура и адаптивный дизайн сохранены.

## Production: согласованный локальный запуск

Нужны Docker Compose v2 и Node.js 24 для генерации окружения/локальной сборки.

```sh
# Из корня репозитория, при первом запуске:
cd backend
node scripts/init-local-env.mjs
docker compose up -d --build --wait --wait-timeout 120

# Обновление уже работающего frontend:
docker compose up -d --build frontend
```

Откройте **http://localhost:8880**. Только nginx опубликован на `127.0.0.1:8880`; БД, бизнес-сервисы и gateway остаются внутри Docker-сети. `APP_ORIGIN` строго равен `http://localhost:8880`. Адрес `http://127.0.0.1:8880` не является согласованным Origin для unsafe-запросов. Не выводите `.env` и полную Compose-конфигурацию с секретами.

Dockerfile собирает приложение на Node 24 Alpine через `npm ci`, runtime — `nginx:stable-alpine`. Nginx сохраняет SPA fallback, передает `/api` gateway без срезания префикса, не превращает ошибки API в HTML. Все ответы имеют no-store/no-referrer/noindex. Access log отключен, error log ограничен crit; forwarding headers перезаписываются. `/health` проверяет только nginx, не заменяет API-проверку.

## Разработка

Запустите Compose-стек как выше, затем из корня репозитория:

```sh
cd frontend
npm ci --no-audit --no-fund
npm run dev
# http://localhost:5174 (также http://127.0.0.1:5174)
npm run build
```

Vite слушает только loopback на 5174 со strictPort. Отдельный прототип использует 5173. Tailwind собирается через Vite-плагин; `index.html` напрямую не открывается.

Dev proxy передает `/api` в **http://localhost:8880**, дополнительных опубликованных внутренних портов не требуется. Только во время разработки входящий Origin **ровно** `http://localhost:5174` или `http://127.0.0.1:5174` заменяется на `http://localhost:8880`. Чужой либо отсутствующий Origin не переписывается и отклоняется production gateway. Безусловной подстановки Origin, CORS-разрешений и изменений production-политик нет. Этот proxy не входит в production bundle. Для воспроизводимой проверки выберите один dev hostname: cookie разных hostname не смешиваются.

## Живые маршруты и API

Все API-пути относительны origin страницы и имеют префикс `/api`.

| Route | API и действия |
|-------|----------------|
| `/` | `GET /api/auth/me`; авторизованный пользователь переходит в кабинет, вторичный CTA ведет к шагам на странице |
| `/register` | `POST /api/auth/register`; email и пароль, ошибки и блокировка повторной отправки |
| `/login` | `POST /api/auth/login`; безопасный внутренний returnTo |
| `/wishlists` | `GET, POST /api/wishlists`; `PATCH, DELETE /api/wishlists/:wishlistId`; сессия и `POST /api/auth/logout` |
| `/wishlists/:wishlistId` | `GET, PATCH, DELETE /api/wishlists/:wishlistId`; `POST /api/wishlists/:wishlistId/gifts`; `PATCH, DELETE /api/wishlists/:wishlistId/gifts/:giftId`; `POST /api/wishlists/:wishlistId/share-link`; session/logout |
| `/s/:shareToken` | `GET /api/shared/:shareToken`; подтвержденный `POST /api/shared/:shareToken/gifts/:giftId/reservations` |
| `/r/:reservationToken` | `GET /api/reservations/:reservationToken`; подтвержденный `POST /api/reservations/:reservationToken/cancel` |
| `*` | Страница 404; статус собственной сессии определяет ссылку перехода |

`src/api/` содержит DTO, fetch wrapper и функции групп auth/owner/shared/reservations. `src/auth/AuthContext.tsx` восстанавливает сессию после reload через `/auth/me`. Закрытые маршруты ждут bootstrap; 401 направляет на вход с безопасным внутренним returnTo, сбой сервиса предлагает повторить загрузку. Logout очищает закрытое состояние только после подтвержденного сервером отзыва: 503 показывает ошибку и сохраняет текущий интерфейс.

JWT находится только в HttpOnly cookie, не в JavaScript/storage. Fetch использует относительный `BASE_URL='/api'`, `credentials: 'same-origin'`, `X-Requested-With: Wishlist`, JSON для unsafe-методов и `{}` для операций без полей. Ответ 204 не разбирается как JSON; серверные коды отображаются по-русски.

Цены передаются безопасным целым `priceKopecks`, валюта RUB. Десятичный ввод и форматирование используют целые разряды/BigInt и сохраняют копейки вплоть до `Number.MAX_SAFE_INTEGER`. Название и цена обязательны; URL и заметка необязательны. Без URL карточка остается доступна для брони.

Публичная страница использует только серверный `isOwner`: владелец не видит статусов или действий брони; гости видят доступность. Недействительная присутствующая cookie не превращается в анонимный просмотр: 401 предлагает вход либо явный logout «Продолжить как гость». Сбой logout не считается успехом. Полная секретность от анонимного владельца не обещается: статусы скрыты в его кабинете и авторизованном представлении.

Секрет брони выдается однажды и остается только в ответе, состоянии компонента или маршруте; localStorage/sessionStorage/логи его не сохраняют. При 409 список перечитывается. При неопределенном результате бронирования выводится предупреждение, выполняется только GET актуального состояния: автоматического повторного POST и восстановления секрета нет. Страница `/r/` не ждет успешного auth bootstrap и работает независимо от cookie/доступности auth. Есть состояния измененной карточки, отмененной брони и нейтрального 404; GET ничего не меняет.

## Фактическая проверка 2026-10-28

- `npm run build` прошел локально и при сборке Docker; после обновления все шесть Compose-контейнеров healthy.
- Оркестратор выполнил ручной браузерный сценарий через production origin: регистрация → создание списка → подарок с ценой `1250,50` без URL → reload с восстановлением сессии и данных → собственная общая страница без доступности → logout → гостевой просмотр → бронь с подтверждением → личная ссылка → отмена → reload отмененной брони.
- Проверены повторный login, удаление созданного списка и logout. Синтетический аккаунт остался без списков, потому что удаления аккаунта в MVP нет. `localStorage` и `sessionStorage` пусты, cookie недоступна JavaScript. Неожиданных JS-ошибок не обнаружено; 401 `/auth/me` для гостя ожидаем.
- Общая страница при ширине 360 px: scrollWidth=360, горизонтального overflow нет; после отмены подарок снова доступен.
- Dev proxy: страница 200, `/api/auth/me` без cookie 401; пустой logout с двумя разрешенными dev Origin — 204, с чужим и отсутствующим Origin — 403.

После ручной проверки завершен автоматический frontend gate: **52 unit / 2 E2E passed** на **http://localhost:8880**, все 8 маршрутов; [полный отчет](../docs/frontend-test-report.md). Исправлен race безопасного returnTo при успешном login/register, React Router обновлен до **7.18.5** из-за production advisories; production audit — **0 vulnerabilities**. Gate повторен на пересобранном patched bundle. Нагрузочная производительность, полный chaos/race-аудит и внешний HTTPS-деплой здесь не заявляются.

```sh
# cwd: frontend, Node.js >=24; установлен Google Chrome
npm ci --no-audit --no-fund
npm test
PLAYWRIGHT_BASE_URL=http://localhost:8880 npm run test:e2e
```

Playwright работает против живого Compose без mocked network; workers 1, retries 0, отдельный временный Chrome profile. Каждый полный прогон создает уникальный синтетический аккаунт, очищает только созданные им списки / подарки, отзывает сессии. Аккаунт остается без списков, поскольку удаления аккаунта в MVP нет. Cookie / capabilities не сохраняются в storageState-файлах, traces или screenshots.
