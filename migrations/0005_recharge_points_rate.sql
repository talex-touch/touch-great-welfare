alter table recharge_merchant_config
  add column if not exists points_per_ldc integer not null default 10;
