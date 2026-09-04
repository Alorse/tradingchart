-- Migration 06: multiple named watchlists
-- Run this in the Supabase SQL Editor.
--
-- `user_watchlists` held exactly one list per user: `items` (jsonb, symbols +
-- section labels) plus the older `symbols text[]`. The app has supported
-- several named lists locally for a while, so only the active one ever
-- reached the cloud and the rest lived and died in localStorage.
--
-- `lists` now holds the whole array — `[{ id, name, items: [...] }, ...]`,
-- the same shape `chart-store`'s `Watchlist[]` serializes to — and
-- `active_id` records which one is selected. `items`/`symbols` are kept, but
-- frozen: they are read once by the backfill below (and by the client's
-- backward-compat path for a row this migration hasn't reached yet) and
-- never written again.

alter table public.user_watchlists
  add column if not exists lists jsonb not null default '[]';

alter table public.user_watchlists
  add column if not exists active_id text;

-- ─────────────────────────────────────────────
-- One-time backfill: legacy single list → `lists`
-- ─────────────────────────────────────────────
-- Guarded on `lists = '[]'` so re-running the migration is a no-op: once a
-- row has been converted (or the client has written real multi-list data),
-- nothing below touches it again.

-- (a) Rows with `items` (migration 03 onwards) — the common case.
with seeded as (
  select id, gen_random_uuid()::text as list_id
  from public.user_watchlists
  where lists = '[]'::jsonb
    and jsonb_typeof(items) = 'array'
    and jsonb_array_length(items) > 0
)
update public.user_watchlists w
set lists = jsonb_build_array(
      jsonb_build_object('id', s.list_id, 'name', 'Default', 'items', w.items)
    ),
    active_id = s.list_id,
    updated_at = now()
from seeded s
where s.id = w.id;

-- (b) Rows predating `items` that only ever got `symbols text[]`. Each symbol
-- becomes a `{ id, type, value }` item, matching what the client builds.
with seeded as (
  select id, gen_random_uuid()::text as list_id
  from public.user_watchlists
  where lists = '[]'::jsonb
    and coalesce(array_length(symbols, 1), 0) > 0
)
update public.user_watchlists w
set lists = jsonb_build_array(
      jsonb_build_object(
        'id', s.list_id,
        'name', 'Default',
        'items', (
          select coalesce(jsonb_agg(jsonb_build_object(
                    'id', substr(md5(random()::text || sym), 1, 8),
                    'type', 'symbol',
                    'value', sym
                  )), '[]'::jsonb)
          from unnest(w.symbols) as sym
        )
      )
    ),
    active_id = s.list_id,
    updated_at = now()
from seeded s
where s.id = w.id;

-- RLS is unchanged: the policy is still `auth.uid() = user_id` over the whole
-- row, so the new columns are covered by the policy created in schema.sql
-- without a drop/recreate.
