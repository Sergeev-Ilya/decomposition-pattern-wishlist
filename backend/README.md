# Локальный стек Wishlist

Из корня репозитория:

```sh
cd backend
node scripts/init-local-env.mjs
docker compose config --quiet
docker compose build
docker compose up -d --wait --wait-timeout 120
```

Нужны Node.js 24 и Docker Compose v2. Скрипт создает игнорируемый `backend/.env` с правами `0600` и четырьмя независимыми значениями из `crypto.randomBytes(32)`. При повторном запуске проверяет существующий файл, сохраняет все значения и устанавливает права `0600`. Невалидный файл не перезаписывается; ошибка содержит только имена проблемных полей. Значения должны быть различными URL-safe строками минимум из 32 символов; генератор создает 64 hex-символа. Не экспортируйте одноименные переменные в shell: Compose отдает им приоритет над `.env`.

Проект Compose называется `wishlist`. Единственный опубликованный адрес — `http://localhost:8880` (`127.0.0.1:8880`); удаленный доступ не включен. Все контейнеры соединены отдельной bridge-сетью; базы и внутренние сервисы не публикуют порты. Сеть оставлена обычной bridge, чтобы Docker Desktop сохранял публикацию loopback-порта nginx. У auth и wishlist отдельные PostgreSQL 18, роли, пароли и базы. Общий `INTERNAL_TOKEN` передается трем API-сервисам, `JWT_SECRET` — только auth. Для локального HTTP настроены `APP_ORIGIN=http://localhost:8880` и `COOKIE_SECURE=false`.

Nginx обслуживает интегрированную SPA и проксирует `/api` в gateway. Frontend использует живой API без mock-данных; сценарий регистрации, списка, подарка, гостевой брони и отмены проверен вручную через `http://localhost:8880`. Команды frontend и подробности проверки описаны в `frontend/README.md`; автоматические frontend/E2E-проверки выполняются следующим этапом. Gateway использует socket IP, не доверяет клиентским forwarding headers; за локальным nginx действует общий IP-счетчик лимитов.

Проверка готовности:

```sh
docker compose ps
bash scripts/post-deploy-smoke.sh http://localhost:8880
```

Strict smoke требует `200` на `/` и `/health`, ровно `401` на `/api/auth/me` и `/api/wishlists` без cookie; любой другой код или ошибка соединения завершает его с кодом 1. `docker compose up --wait` ждет healthcheck обеих БД, бизнес-сервисов, gateway и nginx. Миграции выполняются автоматически до открытия HTTP-портов сервисов. Все контейнеры имеют `restart: unless-stopped`; обычный запуск после остановки — снова `docker compose up -d --wait --wait-timeout 120`. Краткая инструкция для пользователя: [`docs/run-local.md`](../docs/run-local.md); итог deploy-gate: [`docs/deploy-log.md`](../docs/deploy-log.md).

Штатная остановка сохраняет контейнеры и данные:

```sh
docker compose stop
```

Для удаления только контейнеров и сети допустимо `docker compose down` **без** флага удаления томов. Постоянные тома `wishlist_auth_data` и `wishlist_wishlist_data` хранят данные при restart/stop/down и новой сборке. В PostgreSQL 18 они монтируются в `/var/lib/postgresql`; каталог версии располагается внутри тома. Не удаляйте тома и не меняйте пароли в `.env` у существующих баз: переменные инициализации PostgreSQL действуют только на пустой том. Сохраните `.env` вместе с резервными копиями в закрытом месте. Не печатайте полную `docker compose config` или окружение контейнеров: они содержат секреты.

Резервные копии обеих баз из каталога `backend`:

```sh
mkdir -p backups
chmod 700 backups
umask 077
docker compose exec -T auth-db sh -c 'pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Fc' > backups/auth.dump
docker compose exec -T wishlist-db sh -c 'pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Fc' > backups/wishlist.dump
```

Файлы `*.dump` содержат персональные данные; храните их вне git и переносите из рабочей копии в закрытое хранилище. Перед внешним запуском требуется отдельная проверка восстановления обеих копий в пустые изолированные БД. Локальные тестовые PostgreSQL на `55432` и `55433` не входят в этот Compose и не затрагиваются его командами.
