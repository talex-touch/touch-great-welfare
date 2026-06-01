create table if not exists welfare_app_state (
  id text primary key,
  state text not null,
  updated_at text not null default current_timestamp
);
