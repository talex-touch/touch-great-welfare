-- D1 uses SQLite, which does not support `add column if not exists`.
-- Runtime schema guards add these resource-provisioning columns and indexes
-- defensively for databases that may already have been touched by app runtime:
--   sub2api_key_bindings.application_id
--   sub2api_key_bindings.item_id
--   sub2api_resource_provision_locks
--   idx_sub2api_key_bindings_resource_item
-- Keep this marker migration as a no-op so Wrangler can record it without
-- failing on databases where the columns already exist.
select 1;
