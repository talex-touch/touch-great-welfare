-- No-op migration.
-- The welfare_app_state.version column is added idempotently at runtime because
-- D1 does not support ALTER TABLE ADD COLUMN IF NOT EXISTS consistently.
select 1;
