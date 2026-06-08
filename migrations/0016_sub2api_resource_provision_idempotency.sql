alter table sub2api_key_bindings add column application_id text;
alter table sub2api_key_bindings add column item_id text;

create table if not exists sub2api_resource_provision_locks (
  id text primary key,
  owner text not null,
  expires_at text not null,
  created_at text not null default current_timestamp
);

create index if not exists idx_sub2api_key_bindings_resource_item
  on sub2api_key_bindings (application_id, item_id, status);
