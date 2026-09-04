-- Migration 05: paper trading account sync
-- Run this in the Supabase SQL Editor.
--
-- One row per user holding the whole simulated account (balance, positions,
-- orders, history, settings) as a single JSONB blob — same "one row, upsert
-- the whole state" shape as user_chart_settings, since the paper account is
-- likewise small and always read/written in full, never queried by field.

create table if not exists public.user_paper_accounts (
  user_id    uuid primary key references auth.users(id) on delete cascade,
  state      jsonb not null default '{}',
  updated_at timestamptz default now()
);

alter table public.user_paper_accounts enable row level security;

-- Drop any pre-existing policies on this table (including ones created under
-- older names) so the policy below can be (re)created idempotently.
do $$
declare pol record;
begin
  for pol in
    select policyname from pg_policies
    where schemaname = 'public' and tablename = 'user_paper_accounts'
  loop
    execute format('drop policy if exists %I on public.%I', pol.policyname, 'user_paper_accounts');
  end loop;
end $$;

create policy "Users can only access their own paper account"
  on public.user_paper_accounts for all
  using (auth.uid() = user_id);
