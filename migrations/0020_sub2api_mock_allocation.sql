-- D1 uses SQLite, which does not support `add column if not exists`.
-- Runtime schema guards add this feature flag defensively for existing DBs:
--   sub2api_config.mock_enabled
-- Keep this marker migration as a no-op so Wrangler can record it without
-- failing on databases where the column already exists.
select 1;
