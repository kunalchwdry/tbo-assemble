# Local route-evidence integration test

This test exercises the real Next.js API, a disposable PostgreSQL database, live public-source retrieval, concurrency, and ownership scoping. **Authentication is a local test double, not real Supabase.** It neither proves production authentication nor validates production database clocks. The fake auth server accepts unsigned test tokens and must never be exposed or used by a deployed app.

Requires Node, app dependencies, PostgreSQL binaries and network access to the public data source. Use a fresh PostgreSQL cluster, bound only to 127.0.0.1, listening on port 5548. Create a disposable database named `evidence_local_test` and roles `anon` and `authenticated`:

```sh
createdb -h 127.0.0.1 -p 5548 evidence_local_test
psql 'postgresql://user@127.0.0.1:5548/evidence_local_test' -v ON_ERROR_STOP=1 \
  -c "CREATE SCHEMA auth; CREATE TABLE auth.users(id uuid primary key); CREATE ROLE anon; CREATE ROLE authenticated; INSERT INTO auth.users VALUES ('11111111-1111-4111-8111-111111111111'), ('22222222-2222-4222-8222-222222222222');" \
  -f docs/security/route-evidence.sql
node tests/route-evidence-local-auth.cjs
```

If the roles already exist in the local cluster, omit the `CREATE ROLE` statements. In separate terminals, run:

```sh
DATABASE_URL='postgresql://user@127.0.0.1:5548/evidence_local_test' \
NEXT_PUBLIC_SUPABASE_URL='http://127.0.0.1:54329' NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY='local-test-key' \
npm run dev -- --hostname 127.0.0.1 --port 3173

TEST_EVIDENCE_DATABASE_URL='postgresql://user@127.0.0.1:5548/evidence_local_test' node tests/route-evidence-local-integration.cjs
```

Adjust only the local database username if needed. The test inserts and deletes records for its two fixed synthetic owners and refuses to run against a different host, port or database name. It also refuses to start if records belonging to other owners exist. Do not use a production database or real user IDs. A source outage or future-dated source records can make the live-source portion fail independently of application correctness.
