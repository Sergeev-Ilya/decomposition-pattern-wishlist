# Запуск Wishlist на своем компьютере

Нужны Docker Desktop с Compose v2 и Node.js 24. Запустите Docker Desktop; если Engine еще не работает, выполните `docker desktop start` и дождитесь готовности. Все команды ниже выполняются из каталога `backend` этого репозитория.

Первый запуск:

```sh
node scripts/init-local-env.mjs
docker compose up -d --build --wait --wait-timeout 120
bash scripts/post-deploy-smoke.sh http://localhost:8880
```

Откройте **http://localhost:8880**. Можно зарегистрировать свой аккаунт; готовых аккаунтов нет. Используйте именно `localhost`: он согласован с проверкой Origin. Только frontend доступен на `127.0.0.1:8880`; базы и внутренние API не публикуют порты.

Обычный запуск после остановки:

```sh
docker compose up -d --wait --wait-timeout 120
bash scripts/post-deploy-smoke.sh http://localhost:8880
```

Остановка:

```sh
docker compose stop
```

Перезапуск с ожиданием готовности:

```sh
docker compose stop
docker compose up -d --wait --wait-timeout 120
bash scripts/post-deploy-smoke.sh http://localhost:8880
```

После изменения исходников обновите сборку:

```sh
docker compose up -d --build --wait --wait-timeout 120
bash scripts/post-deploy-smoke.sh http://localhost:8880
```

`docker compose ps` должен показывать шесть healthy-контейнеров. Smoke требует HTTP 200 для страницы и health, HTTP 401 для закрытых API без входа. При ошибке проверьте Docker Desktop и `docker compose logs --tail 50`; не публикуйте `.env` или полную Compose-конфигурацию.

Списки, подарки и аккаунты сохраняются в томах `wishlist_auth_data` и `wishlist_wishlist_data` при остановке, перезапуске и пересборке. Сохраните `backend/.env`: генератор при повторном запуске оставляет существующие секреты. Не удаляйте тома и не меняйте пароли существующих баз. Команды резервного копирования находятся в [`backend/README.md`](../backend/README.md).

Прототип на 5173 и тестовые PostgreSQL на 55432/55433 не нужны для использования продукта. Backend-тесты и запуск изолированных тестовых БД описаны в README сервисов. Frontend gate завершен: 52 unit и 2 E2E сценария на настоящем **http://localhost:8880** прошли; [отчет](frontend-test-report.md).

Повторить frontend-проверки при запущенном Compose (из каталога `frontend`, Node.js >=24 и установленный Google Chrome):

```sh
npm ci --no-audit --no-fund
npm test
PLAYWRIGHT_BASE_URL=http://localhost:8880 npm run test:e2e
```

E2E создает уникальный синтетический аккаунт и удаляет только свои списки / подарки, затем отзывает сессии. Сам аккаунт остается: удаления аккаунта в MVP нет. После изменений frontend сначала пересоберите Compose командой выше, чтобы E2E проверял актуальный production bundle.
