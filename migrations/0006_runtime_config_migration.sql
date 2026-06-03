-- D1 uses SQLite and does not support `add column if not exists`.
-- These runtime-config columns/tables are created defensively by
-- ensureNotificationSchema(), so this migration is intentionally a no-op for
-- local D1 databases that may already have been touched by the app runtime.
select 1;
