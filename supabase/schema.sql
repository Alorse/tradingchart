-- Schema for TradingView Free
-- Run this in the SQL Editor of your Supabase project

-- Enable the extension needed for UUIDs
create extension if not exists "pgcrypto";

-- ─────────────────────────────────────────────
-- user_profiles: extra per-user data
-- ─────────────────────────────────────────────
create table if not exists public.user_profiles (
  id          uuid primary key references auth.users(id) on delete cascade,
  email       text,
  created_at  timestamptz default now()
);

alter table public.user_profiles enable row level security;

-- Drop any pre-existing policies on this table (including ones created under
-- older names) so the policy below can be (re)created idempotently.
do $$
declare pol record;
begin
  for pol in
    select policyname from pg_policies
    where schemaname = 'public' and tablename = 'user_profiles'
  loop
    execute format('drop policy if exists %I on public.%I', pol.policyname, 'user_profiles');
  end loop;
end $$;

create policy "Users can only see their own profile"
  on public.user_profiles for all
  using (auth.uid() = id);

-- Function that creates a profile automatically on sign-up
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer as $$
begin
  insert into public.user_profiles (id, email)
  values (new.id, new.email)
  on conflict (id) do nothing;
  return new;
end;
$$;

create or replace trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ─────────────────────────────────────────────
-- user_watchlists: per-user symbol list
-- ─────────────────────────────────────────────
create table if not exists public.user_watchlists (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth.users(id) on delete cascade,
  symbols    text[] not null default '{}',          -- legacy: symbols only
  items      jsonb not null default '[]',           -- full: symbols + labels
  updated_at timestamptz default now()
);

create unique index if not exists user_watchlists_user_id_idx on public.user_watchlists(user_id);

alter table public.user_watchlists enable row level security;

-- Drop any pre-existing policies on this table (including ones created under
-- older names) so the policy below can be (re)created idempotently.
do $$
declare pol record;
begin
  for pol in
    select policyname from pg_policies
    where schemaname = 'public' and tablename = 'user_watchlists'
  loop
    execute format('drop policy if exists %I on public.%I', pol.policyname, 'user_watchlists');
  end loop;
end $$;

create policy "Users can only see their own watchlist"
  on public.user_watchlists for all
  using (auth.uid() = user_id);

-- ─────────────────────────────────────────────
-- user_chart_settings: per-user chart settings
-- ─────────────────────────────────────────────
create table if not exists public.user_chart_settings (
  id               uuid primary key default gen_random_uuid(),
  user_id          uuid not null references auth.users(id) on delete cascade,
  symbol           text not null default 'BTCUSDT',
  timeframe        text not null default '15m',
  indicators       jsonb not null default '{}',
  hidden           jsonb not null default '{}',
  config           jsonb not null default '{}',
  visual_settings  jsonb not null default '{}',  -- chartColors, adxStyle, squeezeStyle, keyLevels, userEMAs, chartType
  updated_at       timestamptz default now()
);

create unique index if not exists user_chart_settings_user_id_idx on public.user_chart_settings(user_id);

alter table public.user_chart_settings enable row level security;

-- Drop any pre-existing policies on this table (including ones created under
-- older names) so the policy below can be (re)created idempotently.
do $$
declare pol record;
begin
  for pol in
    select policyname from pg_policies
    where schemaname = 'public' and tablename = 'user_chart_settings'
  loop
    execute format('drop policy if exists %I on public.%I', pol.policyname, 'user_chart_settings');
  end loop;
end $$;

create policy "Users can only see their own settings"
  on public.user_chart_settings for all
  using (auth.uid() = user_id);

-- ─────────────────────────────────────────────
-- user_price_lines: horizontal price lines
-- ─────────────────────────────────────────────
create table if not exists public.user_price_lines (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth.users(id) on delete cascade,
  symbol     text not null,
  price      double precision not null,
  created_at timestamptz default now()
);

create index if not exists user_price_lines_user_symbol_idx on public.user_price_lines(user_id, symbol);

alter table public.user_price_lines enable row level security;

-- Drop any pre-existing policies on this table (including ones created under
-- older names) so the policy below can be (re)created idempotently.
do $$
declare pol record;
begin
  for pol in
    select policyname from pg_policies
    where schemaname = 'public' and tablename = 'user_price_lines'
  loop
    execute format('drop policy if exists %I on public.%I', pol.policyname, 'user_price_lines');
  end loop;
end $$;

create policy "Users can only see their own price lines"
  on public.user_price_lines for all
  using (auth.uid() = user_id);
