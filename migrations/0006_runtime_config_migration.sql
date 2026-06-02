alter table ai_provider_config add column api_key_encrypted text;
alter table ai_provider_config add column newapi_key_encrypted text;
alter table ai_provider_config add column newapi_management_base_url text not null default '';
alter table ai_provider_config add column newapi_user_id text not null default '';

create table if not exists notification_provider_config (
  id text primary key,
  resend_api_key_encrypted text,
  resend_from_email text not null default '',
  vapid_public_key text not null default '',
  vapid_private_key_encrypted text,
  vapid_subject text not null default '',
  created_at text not null default current_timestamp,
  updated_at text not null default current_timestamp
);
