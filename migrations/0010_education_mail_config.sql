create table if not exists education_mail_config (
  id text primary key,
  enabled integer not null default 0,
  base_url text not null default '',
  admin_key_encrypted text,
  inbox_address text not null default '',
  lookback_hours integer not null default 168,
  created_at text not null default current_timestamp,
  updated_at text not null default current_timestamp
);
