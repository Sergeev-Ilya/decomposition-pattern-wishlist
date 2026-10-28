# auth-service — схема PostgreSQL

База: `wishlist_auth`, контейнер `auth-db`, PostgreSQL 18. Доступ имеет только роль auth-service. Основание: [архитектура](../architecture.md), контракт [api.yaml](api.yaml). Таблицы содержат UUID PK, `created_at`/`updated_at` в UTC (`timestamptz`).

## Миграция `001_init.sql`

SQL выполняется мигратором одной транзакцией, до приема трафика. Мигратор фиксирует примененные файлы в отдельном техническом ledger `schema_migrations`; повторный запуск не выполняет уже примененный файл. Ledger не является доменной сущностью.

```sql
CREATE TABLE users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email text NOT NULL UNIQUE,
  password_hash text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT users_email_normalized CHECK (
    email = lower(btrim(email)) AND char_length(email) BETWEEN 3 AND 254
  ),
  CONSTRAINT users_password_hash_present CHECK (
    char_length(password_hash) BETWEEN 32 AND 512
  )
);

CREATE TABLE sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at timestamptz NOT NULL,
  revoked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT sessions_expiry CHECK (expires_at > created_at),
  CONSTRAINT sessions_revocation CHECK (revoked_at IS NULL OR revoked_at >= created_at)
);
CREATE INDEX sessions_user_id_idx ON sessions(user_id);
CREATE INDEX sessions_expires_at_idx ON sessions(expires_at);

CREATE FUNCTION touch_updated_at() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;
CREATE TRIGGER users_touch_updated_at BEFORE UPDATE ON users
  FOR EACH ROW EXECUTE FUNCTION touch_updated_at();
CREATE TRIGGER sessions_touch_updated_at BEFORE UPDATE ON sessions
  FOR EACH ROW EXECUTE FUNCTION touch_updated_at();
```

## Поля и внешние DTO

| Данные | Правило хранения / выдачи |
|--------|--------------------------|
| `users.email` | Приложение делает `trim().toLowerCase()` до валидации формата и длины; UNIQUE защищает и при конкурентной регистрации. Сравнение и поиск по нормализованному значению. |
| `users.password_hash` | Формат `scrypt$32768$8$3$<salt-base64>$<hash-base64>`; случайная соль 16 байт, результат 64 байта. UTF-8 исходного пароля, без trim/Unicode-нормализации; 12–128 Unicode code points. `maxmem=64 MiB`, сравнение constant-time. В API/журналы не попадает. |
| `sessions.id` | JWT claim `sid`; PK позволяет проверить строку сессии без сканирования. Это не секрет отмены брони и не самостоятельный публичный credential. |
| `sessions.expires_at` | Ровно 24 часа от создания; JWT `exp` соответствует этому сроку с точностью до секунды. Валидатор проверяет и JWT, и значение БД. |
| `sessions.revoked_at` | `NULL` для действующей сессии; logout устанавливает timestamp только текущей строке. Повторный logout не меняет факт отзыва. Истечение определяется временем, фоновой очистки для корректности не требуется. |
| Собственный пользователь | `{id, email, displayName, createdAt}`. `displayName` вычисляется как часть email до `@`, отдельной колонки/формы профиля нет. Секреты и session UUID в публичный DTO не входят. |

JWT подписывается `HS256` ключом `JWT_SECRET` без встроенного значения; claims: `sub`, `sid`, `iat`, `exp`, `iss=wishlist-auth`, `aud=wishlist-web`. Открытый JWT в БД не хранится. Он передается только cookie `wishlist_session`; внутренний validate получает JWT в JSON по закрытой сети с `X-Internal-Token`. Наличие `sid` не заменяет проверку подписи и всех claims.

## Транзакции и ошибки

1. **Регистрация:** нормализация/валидация → вычисление scrypt вне транзакции → `BEGIN` → INSERT user → INSERT session → `COMMIT` → JWT/cookie и `201 {user}`. Ошибка UNIQUE email дает `409 EMAIL_IN_USE` с rollback; остальные ошибки не выдают cookie. Пользователь и первая сессия сохраняются атомарно.
2. **Вход:** SELECT по нормализованному email → проверка scrypt → INSERT новой session → cookie и `200 {user}` только после успешного INSERT. Неизвестный email и неверный пароль имеют одинаковый `401 INVALID_CREDENTIALS`; для неизвестного пользователя выполняется сопоставимая scrypt-проверка фиктивного хеша, не хранится фиктивный аккаунт. Другие сессии сохраняются.
3. **Проверка:** после криптографической проверки JOIN sessions/users по `sid`, `sub`, `revoked_at IS NULL`, `expires_at > now()`; возвращаются собственный пользователь и, только внутреннему caller, `sessionId`/`expiresAt`. Нет положительного кеша. Невалидный/истекший/отозванный JWT — `401`, сбой БД — `503`, не гостевой контекст.
4. **Выход:** валидный неистекший JWT → `UPDATE sessions SET revoked_at = COALESCE(revoked_at, now()) WHERE id=$sid AND user_id=$sub` → `204` с удалением cookie. Отсутствующая строка уже недействительна. Без cookie либо с криптографически невалидной/истекшей cookie — безопасный `204` с ее очисткой; при сбое БД для действующего JWT — `503`, без заявления об отзыве и без очистки cookie.

Ошибки всегда имеют `{error:{code,message},requestId}` без SQL/stacktrace/секретов. `/health` выполняет `SELECT 1`, возвращает `200 {status:"ok"}` либо безопасный `503`. Все маршруты, кроме health, проверяют `X-Internal-Token` до чтения учетных данных; gateway отвечает за Origin, `X-Requested-With`, 32 KiB JSON и ограничения частоты. Токены, cookie, email/пароли из request body не журналируются.

## Межсервисные связи и проверка

Внешних FK нет. `wishlist-service` хранит только логический `owner_id`, не читает эту БД и не получает публичный lookup пользователей. Доменные факты `UserRegistered`, `SessionCreated`, `SessionRevoked` не публикуются: подписчиков и брокера в MVP нет.

Проверки на настоящем PostgreSQL: конкурентная регистрация одного нормализованного email создает одного пользователя; rollback первой сессии не оставляет пользователя; вход/выход/истечение/отзыв не обходятся JWT без действующей строки; logout одной сессии не отзывает другую; секреты отсутствуют в ответах; UNIQUE и FK сохраняются после перезапуска. В тестах используются случайные пользователи, готового demo-аккаунта в продуктовой БД нет.
