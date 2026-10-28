# Frontend / E2E gate Wishlist

Дата: 2026-10-28. Полный проверенный адрес: **http://localhost:8880**. Итог: **passed**.

## Результаты

| Проверка | Результат |
|---|---|
| `npm test` | **52 / 52 passed**, 5 файлов, Vitest 4.1.12 + Testing Library / jsdom |
| `npm run build` | **passed**, TypeScript и Vite 6.4.3 |
| `PLAYWRIGHT_BASE_URL=http://localhost:8880 npm run test:e2e` | **2 / 2 passed**, exit 0, 5.7 s, patched React Router 7.18.5 bundle |
| `npm audit --omit=dev --json` | **0 production vulnerabilities**, exit 0 |
| Production Compose | **6 / 6 running / healthy** после E2E |
| Same-origin smoke после пересборки | `/` 200, `/health` 200, `/api/auth/me` 401, `/api/wishlists` 401 |
| Browser errors | Неожиданных console errors и `pageerror` нет; ожидаемые HTTP 401 / 404 отделены |

Playwright использует установленный Google Chrome в отдельном временном профиле, `workers=1`, `fullyParallel=false`, `retries=0`. Нет Vite webServer, `page.route` и mock API: браузер выполняет настоящие запросы через production nginx/gateway на порту 8880. Network mocks используются только в unit-тестах изолированных модулей.

## Unit coverage

- 36 проверок денег и адресов возврата: десятичная запятая, ноль, копейки, точный `Number.MAX_SAFE_INTEGER`, соседний выход за предел, форматирование и round trip через BigInt, ошибочные числа; внутренние пути, внешние URL, `//host`, backslash, control characters и циклы login/register.
- 6 проверок GiftForm: обязательная цена, точные копейки, пустой допустимый URL, запрещенные credentials в URL, сохранение ввода и закрытие сессии при 401.
- 3 проверки AuthProvider: guest bootstrap 401, сервисная ошибка и retry, сохранение авторизованного UI при logout 503 до подтвержденного отзыва.
- 4 проверки API client: same-origin cookie / JSON `{}` / 204, неопределенный результат мутации без автоматического повтора, 409 / Retry-After, запрет внешнего API path.
- 3 regression-проверки AuthForm: login/register сохраняют безопасный returnTo при обновлении сессии; уже авторизованный прямой посетитель формы переходит в кабинет.

## Покрытие всех маршрутов

| Маршрут | Проверено в браузере |
|---|---|
| `/` | Гостевая главная, title / heading, 360 px |
| `/register` | Реальная регистрация уникального синтетического аккаунта, отклонение внешнего returnTo, 360 px формы |
| `/login` | Реальный повторный вход, возврат к закрытому списку, logout / reload / session bootstrap, 360 px |
| `/wishlists` | Закрытый redirect, кабинет, создание списка, пустое состояние после удаления, 360 px |
| `/wishlists/:wishlistId` | Реальный ID: чтение / редактирование / удаление списка; create / read / update / delete подарков; сохранность после reload и повторного login; 360 px |
| `/s/:shareToken` | Реальная общая ссылка: owner privacy в UI и DTO, гостевая доступность, неверная и замененная ссылки; invalid HttpOnly cookie → 401 → явное «Продолжить как гость»; 360 px |
| `/r/:reservationToken` | Реальная выданная бронь: активная / измененная карточка / отмененная; переживает замену общей ссылки, работает при auth bootstrap 401; reload не повторяет отмену; неверный секрет; 360 px |
| `*` | Отдельная страница неизвестного маршрута, 360 px |

Полный сценарий создает список, меняет название, добавляет подарок `1250,50` без ссылки и подарок с нулевой ценой / HTTPS URL. Пустая обязательная цена блокирует отправку. Проверяются отсутствие пустой кнопки магазина, `noopener noreferrer` / `no-referrer`, HttpOnly cookie, пустые localStorage/sessionStorage. Гость подтверждает бронь; владелец изменяет забронированный подарок до `42,01`, заменяет общую ссылку; старый публичный адрес закрывается, секрет продолжает работать и показывает изменение. Подтвержденная отмена сохраняется после reload. Затем владелец выходит, снова входит с возвратом к списку, удаляет подарок и список, выходит. При 360 px горизонтального overflow нет на страницах и открытых подтверждениях брони / отмены / удаления.

## Исправление и итерации

Выполнены **3 настоящих E2E прогона в fix-loop**, **2 цикла исправления**, затем успешная повторная проверка после узкого security update зависимости:

1. Начальный fixture ожидал ровно `/login`; переход Protected вправе добавлять безопасный returnTo. Проверка уточнена до pathname.
2. Найден реальный race AuthForm: `auth.user` → `<Navigate /wishlists>` перебивал адрес возврата после успешного login. Флаг отправки данной формы согласует оба перехода; прямой визит уже авторизованного пользователя остается переходом в кабинет. Добавлены regression unit для login/register и прямого визита.
3. После исправления, unit/build и пересборки Docker оба E2E прошли без retries.

После этого оркестратор подтвердил узкое обновление React Router из-за production advisories. `npm install react-router-dom@^7.18.2` установил `react-router-dom` / `react-router` **7.18.5**. `npm audit --omit=dev --json` завершился exit 0 с пустым vulnerabilities. Повторены 52 unit, build, Compose rebuild, strict smoke и весь E2E на новом production bundle: **2 / 2 passed**, 5.7 s, без новых failures или test-fix итераций. Финальное время gate: **2026-10-28T15:13:22Z**.

Sandbox Chrome launch EPERM и localhost/Docker отказы повторены с разрешенным доступом; они не являются функциональными test-fix итерациями. Gateway rate limit не отключался, отдельный restart для обхода лимита не понадобился.

Production source изменен только в `src/components/AuthForm.tsx`, дизайн не менялся. Дополнительно обновлена одна product dependency — React Router 7.18.5 по подтвержденному security fix. Backend source не менялся. `docker compose up -d --build frontend` пересобрал frontend и пересоздал зависимые app containers с cached backend builds; базы / тома / секреты сохранены. Финальный production asset `index-DW8pk5sK.js` совпал с локальной сборкой по SHA256 `5d54e52447928702e894dff3c67a1ca9b94ff535a4310c71b98d369522d96dc0`.

Для тестов добавлены devDependencies. Vitest 4.1.12 выбран по официальным npm peer/engine metadata: Vite `^6.0.0 || ^7.0.0 || ^8.0.0`, Node `^20 || ^22 || >=24`. Начальный Vitest 3 заменен из-за advisories test runner / mocker / tinypool. После узкого Router update production audit чист; полный `npm audit` продолжает сообщать **6 dev-only advisories** существующего build-стека / транзитивных пакетов (1 moderate, 5 high). Полный audit-clean результат не заявляется; другие product libraries не обновлялись.

## Повторение и тестовые данные

```sh
# cwd: frontend, Node.js >=24; установлен Google Chrome
npm ci --no-audit --no-fund
npm test
npm run build
npm audit --omit=dev --json
PLAYWRIGHT_BASE_URL=http://localhost:8880 npm run test:e2e

# cwd: backend — применить изменение frontend перед живыми E2E
docker compose up -d --build frontend
docker compose ps --format '{{.Service}}: {{.State}} / {{.Health}}'
bash scripts/post-deploy-smoke.sh http://localhost:8880
```

Каждый полный E2E прогон регистрирует один уникальный синтетический аккаунт. Cleanup удаляет только IDs списков, созданных данным прогоном, и отзывает его сессии; реальные пользовательские данные не перебираются и не изменяются. Синтетические аккаунты остаются без списков: удаления аккаунта в MVP нет. Сессии / capabilities находятся только в памяти контекстов и маршрутах, не сохраняются в app storage, storageState-файлах, traces, screenshots или обычных логах. Успешный `frontend/test-results/.last-run.json` содержит только passed / пустые failedTests.

Это функциональный gate. Нагрузочный benchmark, p95, внешний HTTPS, полный chaos / race-тест UI и аудит доступности здесь не заявляются; backend gate остается отдельным ранее выполненным этапом.
