-- Run this once in your Supabase project's SQL Editor (Database → SQL Editor → New query)
-- This creates the tables and locks them down so each user can only ever see their own data.

create table if not exists trades (
  id text primary key,
  user_id uuid references auth.users not null default auth.uid(),
  pair text,
  direction text,
  date text,
  entry numeric,
  sl numeric,
  tp numeric,
  lot numeric,
  risk_pct numeric,
  exit numeric,
  exit_date text,
  notes text,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

alter table trades enable row level security;

create policy "select own trades" on trades
  for select using (auth.uid() = user_id);

create policy "insert own trades" on trades
  for insert with check (auth.uid() = user_id);

create policy "update own trades" on trades
  for update using (auth.uid() = user_id);

create policy "delete own trades" on trades
  for delete using (auth.uid() = user_id);

create index if not exists trades_user_id_idx on trades(user_id);


create table if not exists user_settings (
  user_id uuid references auth.users primary key default auth.uid(),
  starting_balance numeric default 1000,
  default_risk numeric default 1,
  last_backup_at timestamptz,
  updated_at timestamptz default now()
);

alter table user_settings enable row level security;

create policy "select own settings" on user_settings
  for select using (auth.uid() = user_id);

create policy "insert own settings" on user_settings
  for insert with check (auth.uid() = user_id);

create policy "update own settings" on user_settings
  for update using (auth.uid() = user_id);
