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
