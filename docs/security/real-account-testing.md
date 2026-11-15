# Opt-in real-account isolation smoke test

This is an optional operator test, not an automatic CI job. It exercises real Supabase sign-in and RLS using **two existing dedicated test accounts**. It creates five clearly marked synthetic rows owned by test account A, reads those exact IDs as A, B and anonymous, and attempts to delete those rows in a `finally` block. It does not create or delete accounts, enumerate user records, touch legacy events or booking links, test the app browser UI or server actions, prove account recovery, or establish comprehensive security. Email confirmation is currently disabled. Do not use real customer or supplier information.

Run it only after obtaining permission to use both accounts and confirming the project. Test accounts must have enough row quota. Set these environment variables securely in your local shell or secret manager; **do not commit them or send passwords in chat**:

- `SUPABASE_URL` (HTTPS Supabase project origin) and `SUPABASE_PUBLISHABLE_KEY` (public, never service-role/secret key).
- `TEST_A_EMAIL`, `TEST_A_PASSWORD`, `TEST_B_EMAIL`, `TEST_B_PASSWORD` for two distinct dedicated accounts.
- `CONFIRM_SYNTHETIC_ACCOUNT_TEST=yes` to enable writes.

Install project dependencies and run `node tests/real-account-isolation.cjs`. Without all variables and the explicit flag, it exits without connecting. Failures and cleanup failures are reported without printing credentials. A failed network request may create a row without returning its ID; the test prints the exact synthetic title/name on failure. Inspect and delete only matching test rows from test account A if needed. Clean up any test users separately through approved Supabase administration; this script never deletes users.

A passing test shows only that the tested records were isolated at that moment. Direct database client behavior does not replace real signed-in browser save/reload/delete, cross-session tests, recovery tests, server endpoint audits or independent security review. Existing shared legacy events/guests remain accessible as before.
