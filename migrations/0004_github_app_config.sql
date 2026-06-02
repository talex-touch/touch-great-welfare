create table if not exists github_app_config (
  id text primary key,
  enabled integer not null default 0,
  app_name text not null default '',
  app_slug text not null default '',
  client_id text not null,
  client_secret text not null,
  callback_url text not null,
  authorize_url text not null,
  token_url text not null,
  api_base_url text not null,
  scopes text not null,
  created_at text not null default current_timestamp,
  updated_at text not null default current_timestamp
);
