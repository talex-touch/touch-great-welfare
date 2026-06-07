create table if not exists point_transactions (
  id text primary key,
  user_id text not null,
  delta integer not null,
  type text not null,
  reason text not null,
  ref_id text,
  balance_after integer not null,
  created_at text not null default current_timestamp
);

create index if not exists idx_point_transactions_user_created
  on point_transactions (user_id, created_at desc, id desc);

create index if not exists idx_point_transactions_type
  on point_transactions (type);

create index if not exists idx_point_transactions_ref
  on point_transactions (ref_id);
