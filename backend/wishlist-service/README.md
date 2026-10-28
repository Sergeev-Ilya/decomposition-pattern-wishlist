# Wishlist service

Node.js 24, Express 5, TypeScript and PostgreSQL 18. Implements the wishlist API from `docs/wishlist-service/api.yaml`; gateway strips `/api` before forwarding. No CORS, JWT validation or auth-service lookups.

Copy `.env.example` to `.env`, set `DATABASE_URL` and a random `INTERNAL_TOKEN` containing at least 32 UTF-8 bytes. No secret defaults. `PORT` defaults to 3000. For Compose use `DATABASE_URL=postgresql://<role>:<password>@wishlist-db:5432/wishlist_data` and the same `INTERNAL_TOKEN` as gateway; keep the service and database internal.

```sh
npm install --no-audit --no-fund
npm run build
npm start
```

Startup applies SQL migrations and the ledger in one transaction under an advisory lock before listening. `npm run migrate` runs the compiled migrator separately after building. Health (`GET /health`) checks the real database. All other routes require `X-Internal-Token`; private `/wishlists` routes additionally require gateway-verified `X-User-Id`. Shared routes optionally compare that checked UUID; reservation secrets work independently. Mutation requests use `Content-Type: application/json`; empty POST inputs are `{}`. Responses use no-store, no-referrer and noindex headers and safe request IDs. URLs, request bodies, credentials and raw secrets are never logged.

All aggregate writes lock wishlist → gift → reservation. The gift count is checked under the wishlist lock; partial uniqueness enforces one active reservation. Rotation invalidates the old share token without changing reservations. Gift edits increment their version and preserve reservations. Cancellation is idempotent and affects only its own retained reservation row. Reservation secrets contain 32 random bytes and are returned only at creation; the DB stores SHA-256 of the UTF-8 token string.

```sh
# First time only; from any directory with Docker running:
docker run -d --name wishlist-data-check-db -p 127.0.0.1:55433:5432 \
  -e POSTGRES_USER=wishlist_test -e POSTGRES_PASSWORD=wishlist_test_only \
  -e POSTGRES_DB=wishlist_data_test postgres:18-alpine
until docker exec wishlist-data-check-db pg_isready -h 127.0.0.1 -U wishlist_test -d wishlist_data_test; do sleep 1; done
# cwd: backend/wishlist-service, Node.js 24:
npm ci --no-audit --no-fund
npm test
```

If the test container already exists but is stopped, run `docker start wishlist-data-check-db` instead of `docker run`, then repeat the readiness check. Stop it after testing with `docker stop wishlist-data-check-db`. This standalone test container is outside product Compose; these credentials are test-only, and its database remains in its writable layer until the disposable container is removed.

Integration tests need real PostgreSQL 18. They ignore `DATABASE_URL`; use `TEST_DATABASE_URL` with a database name ending `_test`, or the local isolated default `postgresql://wishlist_test:wishlist_test_only@127.0.0.1:55433/wishlist_data_test`. Cleanup only removes this run's randomly generated owners, never truncates the database. Missing PostgreSQL is a test failure, not a skipped check.

Build the runtime with `docker build -t wishlist-service .`. It uses compiled JavaScript, production dependencies and an unprivileged Node user. Runtime starts migrations automatically; do not run a second migration job concurrently with application startup unless it uses the same migrator lock.
