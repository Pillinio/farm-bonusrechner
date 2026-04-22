# RLS Smoke Tests

Each `.sql` file here runs against the current Supabase instance via the MCP `execute_sql` endpoint (or `psql`). Tests must be idempotent: wrap in a DO block, clean up after themselves, and RAISE EXCEPTION on failure so the runner surfaces it.

## Running

Via Supabase MCP (what Claude uses during this workflow):
- Paste a test file's content into `mcp__supabase__execute_sql`.
- An empty result set means the DO block completed; check NOTICE output for PASS/FAIL messages.
- A non-empty error means at least one assertion failed.

Via psql (manual):
```
psql "$SUPABASE_DB_URL" -v ON_ERROR_STOP=1 -f tests/rls/<file>.sql
```

## Convention

- File name: `<table>_<scenario>.sql` (e.g. `farm_calendar_private_block_positive.sql`).
- Start with `begin;` so nothing persists.
- End with `rollback;` unless the test intentionally commits (rare).
- Simulate a user with:
  ```
  perform set_config('request.jwt.claims',
    json_build_object('sub', <uuid>, 'role', 'authenticated')::text, true);
  set local role authenticated;
  ```
- Reset role before cleanup if the test inserted rows it can't delete under RLS.
