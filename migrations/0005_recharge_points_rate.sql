-- D1 uses SQLite, which does not support
-- `alter table ... add column if not exists`.
--
-- Fresh local databases already get this column from 0002, and existing
-- databases are repaired defensively by ensureRechargeSchema() at runtime.
-- Keep this marker migration as a no-op so Wrangler can record it without
-- failing on databases where the column already exists.
select 1;
