-- D1 migrations cannot safely add existing columns without IF NOT EXISTS.
-- Runtime schema guards add these encrypted-secret columns defensively for both
-- D1 and Postgres deployments:
--   recharge_merchant_config.key_encrypted
--   github_app_config.client_secret_encrypted
--   oauth_provider_config.client_secret_encrypted
select 1;
