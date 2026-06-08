-- D1 uses SQLite, which does not support `add column if not exists`.
-- Runtime schema guards add these ai_temporary_keys columns defensively:
--   name
--   key_masked
--   status
--   provider
-- Keep this marker migration as a no-op so Wrangler can record it without
-- failing on databases where the columns already exist.
select 1;
