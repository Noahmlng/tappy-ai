# Supabase Bootstrap Execution Log

- Date (UTC): 2026-02-21
- Project ref: `bkqjenmznafkqqwvwrad`
- Execution channel: Supabase MCP (`supabase.execute_sql`)
- Migration file: `mediation/migrations/0001_mediation_core_baseline.sql`
- Migration checksum: `48c885ae205e0f45b4c7f23d6ee07a1e414e1687926b78791933bc7891474b23`

## Executed Steps

1. Created `schema_migrations` table (idempotent).
2. Executed full SQL from `0001_mediation_core_baseline.sql`.
3. Inserted migration row:
   - `version=0001`
   - `file_name=0001_mediation_core_baseline.sql`
   - `checksum=48c885ae205e0f45b4c7f23d6ee07a1e414e1687926b78791933bc7891474b23`
   - `ON CONFLICT DO NOTHING`

## Verification Snapshot

Existing `public` tables confirmed:

1. `config_snapshots`
2. `config_publish_operations`
3. `opportunity_records`
4. `delivery_records`
5. `event_records`
6. `archive_records`
7. `audit_records`
8. `replay_jobs`
9. `idempotency_keys`
10. `dead_letter_records`
11. `schema_migrations`

`schema_migrations` row (`version=0001`) confirmed with `applied_at=2026-02-21 12:40:16.835468+00`.

## Notes

1. Local script `db-migrate.js` remains the source-of-truth for repeatable migration execution.
2. For CI/CD and runtime environments, `SUPABASE_DB_URL` still needs to be configured in secrets manager.
