create table if not exists integration_events (
  id text primary key,
  provider text not null,
  event_id text,
  event_type text,
  signature_valid integer not null default 0,
  payload text not null,
  status text not null,
  error text,
  created_at text not null default current_timestamp,
  processed_at text
);

create table if not exists ai_provider_config (
  id text primary key,
  enabled integer not null default 0,
  base_url text not null,
  image_model text not null,
  review_model text not null default 'gpt-4.1-mini',
  temporary_key_ttl_minutes integer not null default 60,
  temporary_key_quota integer not null default 100,
  created_at text not null default current_timestamp,
  updated_at text not null default current_timestamp
);

create table if not exists ai_image_jobs (
  id text primary key,
  user_id text not null,
  application_id text,
  model text not null,
  prompt text not null,
  status text not null,
  r2_object_key text,
  content_type text,
  error text,
  created_at text not null default current_timestamp,
  completed_at text,
  updated_at text not null default current_timestamp
);

create table if not exists ai_temporary_keys (
  id text primary key,
  user_id text not null,
  key_hash text not null,
  upstream_token_id text,
  quota integer not null,
  expires_at text not null,
  revoked_at text,
  created_at text not null default current_timestamp
);

create table if not exists notifications (
  id text primary key,
  user_id text not null,
  event text not null,
  title text not null,
  body text not null,
  data text not null default '{}',
  read_at text,
  created_at text not null default current_timestamp
);

create table if not exists notification_settings (
  user_id text primary key,
  email_enabled integer not null default 0,
  email_address text not null default '',
  feishu_enabled integer not null default 0,
  feishu_webhook_encrypted text,
  browser_push_enabled integer not null default 0,
  created_at text not null default current_timestamp,
  updated_at text not null default current_timestamp
);

create table if not exists notification_deliveries (
  id text primary key,
  notification_id text not null,
  channel text not null,
  status text not null,
  error text,
  charged_points integer not null default 0,
  provider_message_id text,
  created_at text not null default current_timestamp,
  updated_at text not null default current_timestamp
);

create table if not exists push_subscriptions (
  id text primary key,
  user_id text not null,
  endpoint text not null unique,
  p256dh text not null,
  auth text not null,
  user_agent text,
  enabled integer not null default 1,
  disabled_at text,
  created_at text not null default current_timestamp,
  updated_at text not null default current_timestamp
);
