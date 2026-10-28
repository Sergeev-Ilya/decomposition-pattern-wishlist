# wishlist-service — схема PostgreSQL

База `wishlist_data`, PostgreSQL 18, отдельный контейнер `wishlist-db`. Только wishlist-service имеет доступ. Источники: [архитектура](../architecture.md), [api.yaml](api.yaml). Email, пароли, имена и JWT здесь не хранятся; `owner_id` — логический UUID без FK в auth.

## Миграция `001_init.sql`

Мигратор применяет файл одной транзакцией до приема трафика и фиксирует имя в техническом ledger `schema_migrations`. У всех доменных таблиц UUID PK и audit timestamps (`timestamptz`, JSON ISO 8601 UTC).

```sql
CREATE TABLE wishlists (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id uuid NOT NULL,
  title varchar(200) NOT NULL CHECK (char_length(btrim(title)) > 0),
  description varchar(2000) NOT NULL DEFAULT '',
  share_token varchar(43) NOT NULL UNIQUE CHECK (share_token ~ '^[A-Za-z0-9_-]{43}$'),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX wishlists_owner_created_idx ON wishlists(owner_id, created_at DESC, id DESC);

CREATE TABLE gifts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  wishlist_id uuid NOT NULL REFERENCES wishlists(id) ON DELETE CASCADE,
  title varchar(200) NOT NULL CHECK (char_length(btrim(title)) > 0),
  price_kopecks bigint NOT NULL CHECK (price_kopecks BETWEEN 0 AND 9007199254740991),
  currency char(3) NOT NULL DEFAULT 'RUB' CHECK (currency = 'RUB'),
  url varchar(4096) NOT NULL DEFAULT '',
  note varchar(2000) NOT NULL DEFAULT '',
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT gifts_url_scheme CHECK (url = '' OR url ~* '^https?://')
);
CREATE INDEX gifts_wishlist_created_idx ON gifts(wishlist_id, created_at, id);

CREATE TABLE reservations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  gift_id uuid NOT NULL REFERENCES gifts(id) ON DELETE CASCADE,
  token_hash bytea NOT NULL UNIQUE CHECK (octet_length(token_hash) = 32),
  gift_version integer NOT NULL CHECK (gift_version > 0),
  canceled_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT reservations_cancel_time CHECK (canceled_at IS NULL OR canceled_at >= created_at)
);
CREATE UNIQUE INDEX reservations_one_active_gift_idx
  ON reservations(gift_id) WHERE canceled_at IS NULL;
CREATE INDEX reservations_gift_idx ON reservations(gift_id);

CREATE FUNCTION touch_updated_at() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;
CREATE TRIGGER wishlists_touch_updated_at BEFORE UPDATE ON wishlists
  FOR EACH ROW EXECUTE FUNCTION touch_updated_at();
CREATE TRIGGER gifts_touch_updated_at BEFORE UPDATE ON gifts
  FOR EACH ROW EXECUTE FUNCTION touch_updated_at();
CREATE TRIGGER reservations_touch_updated_at BEFORE UPDATE ON reservations
  FOR EACH ROW EXECUTE FUNCTION touch_updated_at();
```

Полная проверка URL выполняется приложением через URL parser: только абсолютный HTTP(S), без username/password. SQL CHECK дополняет ее, но не заменяет. Названия, описание, URL и заметка обрезаются по краям. Неизвестные поля запроса отклоняются. Счетчик подарков не хранится: вычисляется по `gifts`, не по броням.

## DTO и проекции

| Данные | Контракт |
|--------|----------|
| Цена | `price_kopecks` ↔ `priceKopecks` — безопасное целое копеек, ноль допустим; валюта всегда `RUB`. Драйвер `pg` возвращает BIGINT строкой: после проверки границы значение переводится в JS number. Рубли с десятичной точкой/запятой преобразует UI по десятичным разрядам через целую арифметику, без `Math.round(Number(input) * 100)`. |
| Owner-список | `id,title,description,shareToken,giftCount,createdAt,updatedAt`; detail дополнительно `gifts`. Нет ownerId и никаких полей/счетчиков/идентификаторов брони. Возвращается как `{wishlists:[...]}` или `{wishlist:...}`. |
| Owner-подарок | `id,wishlistId,title,priceKopecks,currency,url,note,version,createdAt,updatedAt`, envelope `{gift:...}`. Owner-запросы не выбирают reservations. |
| Публичный список | `{wishlist:{id,title,description,isOwner,gifts}}`. Для проверенного владельца `isOwner=true`, подарок только `id,title,priceKopecks,currency,url,note`, без reserved. Для гостя/чужого пользователя `isOwner=false`, каждый подарок дополнительно имеет `reserved:boolean`, вычисленный как EXISTS активной брони. Нет ownerId/email/name/shareToken/секретов отмены. |
| Создание брони | `201 {reservationToken}` — только один открытый секрет, без данных других броней. UI строит `origin + /r/ + reservationToken`. В БД хранится лишь SHA-256 сырых байтов UTF-8 token-строки. |
| Чтение / отмена своей брони | Оба возвращают `200 {reservation:{id,status,createdAt,canceledAt,giftChanged,gift}}`; `status` равен `active` или `canceled`, `canceledAt` — ISO timestamp либо null, gift — актуальный полный Gift DTO. Токен обратно не возвращается. `giftChanged = gifts.version != reservations.gift_version`. |

Все чтения имеют детерминированный порядок: списки по `(created_at DESC,id DESC)`, подарки по `(created_at,id)` по возрастанию. Строки отмененных броней сохраняются, автоматического истечения/фонового удаления нет. Удаление подарка каскадно удаляет все его брони; после этого GET/POST cancel по их секретам возвращает нейтральный 404.

## Транзакции и единый порядок блокировок

Все изменения существующего агрегата используют один порядок: **wishlist → gift → reservation**. Уровня READ COMMITTED достаточно при повторной проверке прав/ссылки под блокировкой. Транзакция завершается до отправки ответа; ошибки откатывают ее полностью.

1. **Owner-операции:** `SELECT ... FROM wishlists WHERE id=$id AND owner_id=$checked_user FOR UPDATE`; отсутствие дает 404. Затем, если нужен подарок, SELECT gift по id и wishlist_id `FOR UPDATE`. Приватный маршрут без проверенного user UUID — 401; неверный внутренний credential — 403 до бизнес-логики. Wishlist-service не вызывает auth и не доверяет cookie/Bearer.
2. **Добавление подарка:** после блокировки wishlist подсчитать подарки; при 100 — `409 GIFT_LIMIT_REACHED`, иначе INSERT. Параллельные добавления не превышают лимит. PATCH обновляет только переданные поля и увеличивает `version=version+1`; существующие reservations не изменяются. Пустой PATCH недопустим. DELETE gift удаляет его каскадно; DELETE wishlist выполняется после блокировки самого списка, каскады удаляют gifts/reservations.
3. **Замена ссылки:** блокировка собственного wishlist → новый `crypto.randomBytes(32).toString('base64url')` → UPDATE share_token → COMMIT → `{shareToken}`. Старая ссылка прекращает работу; подарки и брони не меняются. Генерация при создании списка такая же. Общий raw token хранится в закрытой БД, чтобы владелец мог повторно получить свою ссылку; он не журналируется.
4. **Бронирование:** `SELECT wishlist WHERE share_token=$token FOR UPDATE` → повторно подтвердить актуальный token/существование списка → запретить owner по checked user UUID → SELECT gift по id/wishlist_id `FOR UPDATE` → сгенерировать независимые 32 случайных байта base64url → INSERT reservations с `gift_version` и SHA-256(token UTF-8) → COMMIT → `201 {reservationToken}`. Partial UNIQUE защищает инвариант даже при обходе предварительной проверки: конфликт активной брони — `409 GIFT_RESERVED`. Бронь не имеет срока действия. Старый shareToken, в том числе проигравший гонку с ротацией, не создает бронь.
5. **Отмена:** по SHA-256 token предварительно найти связку reservation → gift → wishlist без блокировок; затем заблокировать wishlist, gift, reservation в общем порядке и заново проверить существование/соответствие. Если каскадное удаление уже произошло — 404. Для активной строки установить canceled_at; для отмененной не изменять его. Возвращается актуальный ReservationView со status=canceled. Новые брони имеют другие строки/хеши, поэтому повтор со старым секретом их не затрагивает.
6. **Чтение секрета:** lookup по token_hash с JOIN актуального gift; нет обращения к auth или проверки shareToken. Сессия владельца не предоставляет этот секрет. Малформатный/неизвестный token и удаленный объект дают одинаковый 404. GET ничего не изменяет.

Нет повторного возврата секрета по общей ссылке или восстановления после потерянного ответа. UI блокирует повтор до результата, не выполняет автоматический retry POST бронирования; при неопределенности показывает сообщение и перечитывает доступность. Повтор все равно не создает вторую активную бронь благодаря уникальному индексу. Открытые секреты не записываются в БД/логи/браузерное постоянное хранилище.

## Ошибки, границы и проверки

Все ошибки: `{error:{code,message},requestId}`. 400 — VALIDATION_ERROR; 401 — UNAUTHENTICATED; 403 — FORBIDDEN/OWN_WISHLIST; 404 — NOT_FOUND; 409 — GIFT_RESERVED/GIFT_LIMIT_REACHED; 503 — SERVICE_UNAVAILABLE. Gateway дополнительно отвечает 429 RATE_LIMITED с Retry-After (60 броней/минуту/IP, 120 secret lookup/cancel/минуту/IP), проверяет CSRF и различает отказ зависимости 503 / timeout 504. Только `/health` без внутреннего credential, он выполняет SELECT 1. Бизнес-сервисы не публикуются на host.

Кросс-сервисные FK и read-модели отсутствуют. Доменные факты WishlistCreated/ShareLinkRotated/GiftChanged/GiftDeleted/GiftReserved/ReservationCanceled не публикуются: брокера и подписчиков нет, инварианты выполняются в этой БД.

На настоящем PostgreSQL проверяются: чужое владение; отсутствие полей брони в owner DTO и public-owner DTO; одна успешная бронь при гонке; лимит 100 при параллельном добавлении; гонка ротации/удаления/бронирования; точная цена и валидация URL; сохранение брони при PATCH и giftChanged; отмена/повтор/новая бронь/старый секрет; каскады; доступ секрета после замены общей ссылки; сохранность данных после перезапуска. Fixtures прототипа в продуктовую БД не переносятся.
