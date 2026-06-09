create index if not exists idx_welfare_applications_status_created
  on welfare_applications (status, created_at asc, id asc);

create index if not exists idx_welfare_applications_user_status_created
  on welfare_applications (user_id, status, created_at desc, id desc);

create index if not exists idx_user_coupons_user_expires_unused
  on user_coupons (user_id, expires_at)
  where used_at is null;
