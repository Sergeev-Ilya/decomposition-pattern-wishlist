# Wishlist auth-service

Node.js 24, Express 5, TypeScript and PostgreSQL 18. Run only on the private Compose network; gateway owns browser Origin/CSRF checks and rate limits. This service does not enable CORS or accept Bearer/X-User-Id as authentication. No demo account is seeded.

Copy `.env.example` to `.env`, supply `DATABASE_URL`, and generate **separate** random `JWT_SECRET` and `INTERNAL_TOKEN` values of at least 32 bytes (`openssl rand -hex 32` for each). Missing, short or identical secrets stop startup. Configure `COOKIE_SECURE=false` only for agreed HTTP localhost; use `true` with HTTPS. Port defaults to 3000.

```sh
npm install --no-audit --no-fund
npm run build
npm run migrate
npm start
```

`npm start` automatically applies migrations before opening its HTTP listener; running `migrate` separately is optional. The compiled JS migrator and all SQL files are included in the runtime image. An advisory lock serializes concurrent starts; SQL and migration ledger are committed atomically. Restarting is safe. Build the image from this directory with `docker build -t wishlist-auth-service .`.

All paths below omit `/api` (gateway removes that prefix):

| Method | Path | Result |
|---|---|---|
| GET | `/health` | 200 if PostgreSQL is available; otherwise 503 |
| POST | `/auth/register` | 201 `{user}` and session cookie; `{email,password}` |
| POST | `/auth/login` | 200 `{user}` and new independent session cookie; `{email,password}` |
| GET | `/auth/me` | 200 `{user}` with current valid cookie |
| POST | `/auth/logout` | 204, revokes current session and clears cookie; send `{}` |
| POST | `/internal/sessions/validate` | 200 `{user,sessionId,expiresAt}`; `{token}` only on private network |

Except `/health`, all paths require `X-Internal-Token`. Unsafe requests use `application/json` (32 KiB maximum). JWT HS256 is issued only in `wishlist_session` (`HttpOnly; SameSite=Lax; Path=/; Max-Age=86400`, no Domain); JSON never returns JWT. Signature, fixed issuer/audience, UUID subject/session, issuance/expiry and live DB session are checked per request without positive caching. Logout with a valid JWT requires a successful database UPDATE; database failure returns 503 without clearing that cookie. Errors use `{error:{code,message},requestId}` and never include SQL, credentials or stacks. Incoming UUID `X-Request-Id` is accepted only with a valid internal credential. Responses set no-store, no-referrer, noindex. No request logging records URLs, bodies or secrets.

Passwords preserve all spaces and Unicode; length is 12–128 code points. Email is trimmed and lowercased. Password storage is salted async scrypt, N=32768/r=8/p=3, 16-byte salt, 64-byte hash, 64 MiB maxmem; unknown-email login performs comparable work.

Integration tests require a disposable real PostgreSQL database:

```sh
# First time only; from any directory with Docker running:
docker run -d --name wishlist-auth-check-db -p 127.0.0.1:55432:5432 \
  -e POSTGRES_USER=wishlist_test -e POSTGRES_PASSWORD=wishlist_test_only \
  -e POSTGRES_DB=wishlist_auth_test postgres:18-alpine
until docker exec wishlist-auth-check-db pg_isready -h 127.0.0.1 -U wishlist_test -d wishlist_auth_test; do sleep 1; done
# cwd: backend/auth-service, Node.js 24:
npm ci --no-audit --no-fund
npm test
```

If the test container already exists but is stopped, run `docker start wishlist-auth-check-db` instead of `docker run`, then repeat the readiness check. Stop it after testing with `docker stop wishlist-auth-check-db`. This standalone test container is outside the product Compose stack; its credentials above are test-only. Its database stays in the container's writable layer until that disposable container is removed.

Without `TEST_DATABASE_URL`, tests use the explicitly disposable local `wishlist_auth_test` database (role `wishlist_test`, test-only password `wishlist_test_only`, port 55432). They ignore `DATABASE_URL`, apply migrations idempotently, create random users and delete only users created by that run; no tables are truncated. Never set `TEST_DATABASE_URL` to a product database.

Compose needs PostgreSQL 18 `auth-db` with its own role/password/database and volume, `DATABASE_URL` pointing there, the above secrets shared with gateway where appropriate (`INTERNAL_TOKEN`; JWT_SECRET remains auth-only), `COOKIE_SECURE`, and internal port 3000. Readiness should call `/health`; the image contains its own healthcheck. Do not publish auth-service or PostgreSQL ports to the host.
