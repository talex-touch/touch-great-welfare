create table if not exists database_provision_config (
  id text primary key,
  enabled integer not null default 0,
  root_url_encrypted text,
  default_expires_in_days integer not null default 30,
  database_prefix text not null default 'twg',
  onepanel_base_url text not null default '',
  onepanel_api_key_encrypted text,
  created_at text not null default current_timestamp,
  updated_at text not null default current_timestamp
);

create table if not exists database_resource_bindings (
  id text primary key,
  user_id text not null,
  application_id text not null,
  item_id text not null,
  database_type text not null,
  database_name text not null,
  username text not null,
  password_hash text not null,
  connection_url_encrypted text,
  connection_url_masked text not null,
  permission text not null,
  expires_at text,
  status text not null,
  created_at text not null default current_timestamp,
  revoked_at text
);

create index if not exists idx_database_resource_bindings_user_created
  on database_resource_bindings (user_id, created_at desc, id desc);

create index if not exists idx_database_resource_bindings_item
  on database_resource_bindings (application_id, item_id);

update database_resource_bindings
set status = 'revoked',
    revoked_at = coalesce(revoked_at, current_timestamp)
where status = 'active'
  and exists (
    select 1
    from database_resource_bindings newer
    where newer.application_id = database_resource_bindings.application_id
      and newer.item_id = database_resource_bindings.item_id
      and newer.status = 'active'
      and (
        newer.created_at > database_resource_bindings.created_at
        or (newer.created_at = database_resource_bindings.created_at and newer.id > database_resource_bindings.id)
      )
  );

create unique index if not exists idx_database_resource_bindings_active_item
  on database_resource_bindings (application_id, item_id)
  where status = 'active';
