# Локальный deploy-gate Wishlist

- Дата: 2026-10-28, health/API/assets проверены в 14:57 UTC (17:57 Europe/Moscow).
- Target: `local`, Docker Compose project `wishlist` из `backend/docker-compose.yaml`.
- Полный baseUrl: **http://localhost:8880**.
- Результат: deploy-gate **passed**. Автоматический frontend/E2E gate также **passed** 2026-10-28 после обновления frontend; подробности в [frontend-test-report.md](frontend-test-report.md).
- Удаленный сервер, внешний домен/HTTPS, broker, object storage, CI и внешняя публикация не используются. Нагрузочные гарантии не проверялись.

## Фактически запущенная сборка и health

Выполнен `docker compose up -d --build --wait --wait-timeout 120`: все четыре образа приложения проверены сборщиком по текущим исходникам (build cache совпал), контейнеры приложения пересозданы, ожидание готовности завершилось успешно. Существующие PostgreSQL, `.env` и тома сохранены; миграции выполняются сервисами при старте. Runtime-код и Compose-конфигурация в этом gate не менялись.

| Compose service | Docker state / health | Проверка |
|---|---|---|
| auth-db | running / healthy | pg_isready, Compose healthcheck |
| wishlist-db | running / healthy | pg_isready, Compose healthcheck |
| auth-service | running / healthy | внутренний GET `:3000/health` → **200**, `{"status":"ok"}` |
| wishlist-service | running / healthy | внутренний GET `:3000/health` → **200**, `{"status":"ok"}` |
| api-gateway | running / healthy | внутренний GET `:8080/health` → **200**, `{"status":"ok"}` |
| frontend | running / healthy | GET `http://localhost:8880/health` → **200** |

Проверены опубликованные порты работающих контейнеров: только frontend `127.0.0.1:8880 → 80/tcp`. `3000/tcp`, `8080/tcp` и `5432/tcp` остальных пяти контейнеров доступны в Docker-сети без host-публикации. Отдельные временные test PostgreSQL `wishlist-auth-check-db`/`wishlist-data-check-db` на loopback 55432/55433 не входят в продуктовый Compose и оставлены работающими для следующего тестового этапа.

## Smoke через тот же origin, что у SPA

Запущен новый адаптированный `backend/scripts/post-deploy-smoke.sh`. Скрипт не передает cookie, не использует `curl -f` для ожидаемых 401, выполняет ровно один запрос на проверку и сравнивает код целиком. Любое расхождение или transport error завершает его с exit 1; 403/404/200 на закрытом API не принимаются.

```text
Post-deploy smoke: http://localhost:8880 (without cookies)
PASS /: HTTP 200
PASS /health: HTTP 200
PASS /api/auth/me: HTTP 401
PASS /api/wishlists: HTTP 401
PASS: all same-origin checks
```

HTML `/` имеет HTTP 200, `text/html` и корневой React-элемент. Проверены все JS/CSS, перечисленные в HTML: `/assets/index-OyOSe9AE.js` → 200 `application/javascript`, 297035 bytes; `/assets/index-CWFInjLI.css` → 200 `text/css`, 32190 bytes. Пустые ответы или подмена assets на HTML не обнаружены. HTTP GET `/login`, `/register`, `/wishlists`, `/wishlists/deploy-smoke`, `/s/deploy-smoke`, `/r/deploy-smoke`, `/missing-deploy-smoke` возвращают тот же SPA HTML (200); это проверка fallback nginx, а не функциональное E2E этих страниц. Для API проверялся именно `http://localhost:8880/api/*`, не только внутренний gateway.

## Выполненные команды

```sh
# cwd: backend
docker compose up -d --build --wait --wait-timeout 120
docker compose ps --format json
docker compose exec -T auth-service node -e "fetch('http://127.0.0.1:3000/health').then(async r=>{console.log('auth-service /health: '+r.status+' '+await r.text());if(r.status!==200)process.exit(1)}).catch(e=>{console.error(e.message);process.exit(1)})"
docker compose exec -T wishlist-service node -e "fetch('http://127.0.0.1:3000/health').then(async r=>{console.log('wishlist-service /health: '+r.status+' '+await r.text());if(r.status!==200)process.exit(1)}).catch(e=>{console.error(e.message);process.exit(1)})"
docker compose exec -T api-gateway node -e "fetch('http://127.0.0.1:8080/health').then(async r=>{console.log('api-gateway /health: '+r.status+' '+await r.text());if(r.status!==200)process.exit(1)}).catch(e=>{console.error(e.message);process.exit(1)})"

# cwd: repository root
bash -n backend/scripts/post-deploy-smoke.sh
bash backend/scripts/post-deploy-smoke.sh http://localhost:8880
docker ps --format '{{.Names}}\t{{.Image}}\t{{.Ports}}'
```

Дополнительно одноразовая проверка Python `urllib.request`/`HTMLParser` запросила HTML, извлекла и проверила assets, сравнила HTML всех указанных SPA fallback и проверила `State`, `Health`, `Publishers` шести строк `docker compose ps --format json`. Секреты окружения, полная Compose-конфигурация и cookie не выводились. Sandbox-отказы Docker/localhost повторены с разрешенным доступом; функциональных отказов deploy не обнаружено.

## Измененные артефакты и передача

- Добавлен strict smoke `backend/scripts/post-deploy-smoke.sh`; framework templates не менялись.
- Добавлена короткая пользовательская инструкция `docs/run-local.md`, backend README ссылается на нее и strict smoke.
- В README auth/wishlist добавлены команды создания/повторного запуска изолированных test PostgreSQL, readiness и зависимости, чтобы backend-тесты можно было повторить после остановки временных БД.
- После всех успешных smoke установлено только `.project/state.json.baseUrl = "http://localhost:8880"`; phase, test flags и e2eLastRun этим gate не менялись.
- Продукт оставлен работающим. Автоматические frontend/E2E-проверки на этом baseUrl завершены ниже.

## Финальный frontend/E2E gate — 2026-10-28 15:13 UTC

**Passed:** `npm test` — **52 / 52**, 5 файлов; `npm run build` — passed; `PLAYWRIGHT_BASE_URL=http://localhost:8880 npm run test:e2e` — **2 / 2**, exit **0**, 5.7 s, Chrome, workers 1, retries 0. Финальный прогон относится к production bundle с React Router **7.18.5**. `npm audit --omit=dev --json` — exit 0, **0 production vulnerabilities**. Покрыты все 8 маршрутов, реальный CRUD, register/login/logout/reload, owner privacy, invalid HttpOnly session / явный гостевой выход, гостевая бронь / отмена, измененная карточка, замена общей ссылки и 360 px без горизонтального overflow. API не мокируется.

Найден и исправлен race возврата после успешного login/register в `frontend/src/components/AuthForm.tsx`; добавлены 3 regression unit. Выполнены 3 настоящих E2E прогона / 2 цикла исправления (первый — fixture login pathname, второй — product returnTo), затем зеленый повтор всего gate после согласованного узкого security update Router до 7.18.5. Backend source и flags не менялись. Добавлены совместимые dev-only Vitest 4.1.12 / Testing Library / jsdom / Playwright; другие product libraries не обновлялись. Полный audit сохраняет 6 dev-only advisories, см. отчет.

Фактические команды после исправления:

```sh
# cwd: frontend
npm test
npm run build
npm audit --omit=dev --json

# cwd: backend
docker compose up -d --build frontend
docker compose ps --format '{{.Service}}: {{.State}} / {{.Health}}'
bash scripts/post-deploy-smoke.sh http://localhost:8880

# cwd: frontend
PLAYWRIGHT_BASE_URL=http://localhost:8880 npm run test:e2e

# cwd: repository root
curl -fsS http://localhost:8880/assets/index-DW8pk5sK.js -o /tmp/wishlist-served-frontend.js
shasum -a 256 frontend/dist/assets/index-DW8pk5sK.js /tmp/wishlist-served-frontend.js
```

Production JS совпадает с source build по SHA256; после suite все **6 / 6 контейнеров running / healthy**, origin остается **http://localhost:8880**. Повторный strict smoke: **200 / 200 / 401 / 401**. Созданные E2E списки / подарки удалены, сессии отозваны; остаются только уникальные синтетические аккаунты без списков. Полный отчет и пределы проверки: [frontend-test-report.md](frontend-test-report.md). p95 / нагрузочные показатели не измерялись.

## Завершение — 2026-10-28 15:15 UTC

После прохождения всех проверок временные `wishlist-auth-check-db` и `wishlist-data-check-db` остановлены и автоматически удалены (`--rm` при создании). Продуктовые БД, именованные тома и секреты не изменялись. После очистки `docker compose ps` подтвердил все шесть рабочих контейнеров healthy; strict same-origin smoke вновь завершился с кодом 0 (200 / 200 / 401 / 401). Приложение оставлено работающим на **http://localhost:8880**. Команды повторного запуска тестовых БД сохранены в README сервисов; пользовательская инструкция — [run-local.md](run-local.md).
