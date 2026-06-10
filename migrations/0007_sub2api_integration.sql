create table if not exists sub2api_config (
  id text primary key,
  enabled integer not null default 0,
  mock_enabled integer not null default 0,
  base_url text not null default '',
  admin_api_key_encrypted text,
  database_url_encrypted text,
  default_group_id integer,
  default_quota_usd real not null default 0,
  default_expires_in_days integer not null default 30,
  default_rate_limit_5h real not null default 0,
  default_rate_limit_1d real not null default 0,
  default_rate_limit_7d real not null default 0,
  created_at text not null default current_timestamp,
  updated_at text not null default current_timestamp
);

create table if not exists sub2api_key_bindings (
  id text primary key,
  user_id text not null,
  sub2api_user_id text not null,
  sub2api_key_id text,
  key_hash text not null,
  key_masked text not null,
  name text not null,
  quota_usd real not null default 0,
  expires_at text,
  status text not null,
  created_at text not null default current_timestamp,
  revoked_at text
);
