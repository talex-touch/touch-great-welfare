alter table ai_temporary_keys add column name text;
alter table ai_temporary_keys add column key_masked text;
alter table ai_temporary_keys add column status text not null default 'active';
alter table ai_temporary_keys add column provider text not null default 'newapi';
