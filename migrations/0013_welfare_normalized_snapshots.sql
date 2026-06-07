create table if not exists welfare_applications (
  id text primary key,
  user_id text not null,
  type text not null,
  status text not null,
  title text not null,
  payload text not null,
  created_at text not null,
  updated_at text not null default current_timestamp
);

create index if not exists idx_welfare_applications_user_created
  on welfare_applications (user_id, created_at desc, id desc);

create index if not exists idx_welfare_applications_status
  on welfare_applications (status);

create table if not exists user_coupons (
  id text primary key,
  user_id text not null,
  name text not null,
  scope text,
  discount_type text,
  discount_rate real not null,
  discount_amount integer,
  payload text not null,
  created_at text not null,
  expires_at text,
  used_at text
);

create index if not exists idx_user_coupons_user_created
  on user_coupons (user_id, created_at desc, id desc);

create index if not exists idx_user_coupons_user_used
  on user_coupons (user_id, used_at);
