create table if not exists recharge_orders (
  out_trade_no text primary key,
  user_id text not null,
  amount text not null,
  credited_points integer not null,
  status text not null,
  ldc_trade_no text,
  payment_type text not null default 'epay',
  order_name text not null,
  notify_payload text,
  created_at text not null default current_timestamp,
  paid_at text,
  updated_at text not null default current_timestamp
);

create table if not exists recharge_merchant_config (
  id text primary key,
  enabled integer not null default 0,
  gateway_base_url text not null,
  pid text not null,
  key text not null,
  points_per_ldc integer not null default 10,
  created_at text not null default current_timestamp,
  updated_at text not null default current_timestamp
);
