-- ============================================================================
-- PoolCart — Supabase PostgreSQL + Realtime + Atomic RPC Schema
-- Paste this into your Supabase SQL Editor (https://supabase.com/dashboard)
-- and click "Run" to create the tables, policies, Realtime channels, and
-- the race-condition-safe `claim_item_share` stored procedure.
-- ============================================================================

-- 1. Pools Table
create table if not exists public.pools (
  id text primary key,
  join_code text not null default 'POOL-01',
  title text not null,
  supplier_name text not null,
  supplier_badge text not null,
  category text not null,
  host_name text not null,
  host_venmo_handle text,
  neighborhood text not null,
  pickup_address text not null,
  pickup_window text not null,
  cutoff_time text not null,
  minimum_order_amount numeric not null default 200,
  delivery_fee numeric not null default 20,
  free_delivery_threshold numeric not null default 300,
  status text not null default 'open',
  created_at timestamptz not null default now()
);

-- 2. Pool Participants Table
create table if not exists public.pool_participants (
  pool_id text not null references public.pools(id) on delete cascade,
  user_id text not null,
  user_name text not null,
  neighborhood text not null default 'Victoria Gardens',
  avatar_color text not null default '#0D9488',
  is_host boolean not null default false,
  paid_status text not null default 'pending' check (paid_status in ('pending', 'paid')),
  picked_up boolean not null default false,
  updated_at timestamptz not null default now(),
  primary key (pool_id, user_id)
);

-- 3. Catalog Items Table
create table if not exists public.catalog_items (
  id text primary key,
  pool_id text not null references public.pools(id) on delete cascade,
  name text not null,
  category text not null,
  emoji text not null default '🛒',
  mode text not null check (mode in ('individual', 'case_split')),
  unit_label text not null,
  unit_price numeric not null,
  retail_price numeric not null,
  case_size integer,
  max_cases integer,
  created_at timestamptz not null default now()
);

-- 4. Item Claims Table
create table if not exists public.item_claims (
  pool_id text not null references public.pools(id) on delete cascade,
  item_id text not null references public.catalog_items(id) on delete cascade,
  user_id text not null,
  user_name text not null,
  avatar_color text not null,
  quantity integer not null check (quantity >= 0),
  updated_at timestamptz not null default now(),
  primary key (item_id, user_id)
);

-- 5. Pool Messages & Host Announcements Table
create table if not exists public.pool_messages (
  id text primary key,
  pool_id text not null references public.pools(id) on delete cascade,
  user_id text not null,
  user_name text not null,
  avatar_color text not null default '#0D9488',
  is_host boolean not null default false,
  is_announcement boolean not null default false,
  text text not null,
  created_at_label text not null,
  created_at timestamptz not null default now()
);

-- 6. Atomic Case-Split Claim RPC Function (`claim_item_share`)
-- Uses `FOR UPDATE` row-level locking on `catalog_items` and `pools` so if two
-- neighbors tap the last share of a bulk case at the exact same millisecond:
--   • It serializes their claims cleanly without lost updates
--   • Rejects mutations if the pool was locked by the host
--   • Enforces `max_cases` cap if the host capped the number of bulk cases
--   • Returns exact case completion & rollover metadata to trigger notifications
create or replace function public.claim_item_share(
  p_pool_id text,
  p_item_id text,
  p_user_id text,
  p_user_name text,
  p_avatar_color text,
  p_neighborhood text,
  p_delta integer
)
returns jsonb
language plpgsql
security definer
as $$
declare
  v_pool_status text;
  v_item_mode text;
  v_case_size integer;
  v_max_cases integer;
  v_current_user_qty integer := 0;
  v_other_users_qty integer := 0;
  v_prev_total integer := 0;
  v_next_user_qty integer := 0;
  v_next_total integer := 0;
  v_max_allowed_units integer;
  v_capped boolean := false;
  v_prev_full_cases integer := 0;
  v_next_full_cases integer := 0;
  v_remainder integer := 0;
begin
  -- Lock pool row to verify cutoff lock status
  select status into v_pool_status
  from public.pools
  where id = p_pool_id
  for update;

  if v_pool_status = 'locked' then
    raise exception 'Pool is locked for wholesale ordering; claims cannot be modified.';
  end if;

  -- Lock catalog_item row to serialize concurrent case-split claims
  select mode, coalesce(case_size, 1), max_cases
  into v_item_mode, v_case_size, v_max_cases
  from public.catalog_items
  where id = p_item_id and pool_id = p_pool_id
  for update;

  if not found then
    raise exception 'Catalog item not found in pool.';
  end if;

  -- Ensure participant exists in pool_participants
  insert into public.pool_participants (pool_id, user_id, user_name, neighborhood, avatar_color)
  values (p_pool_id, p_user_id, p_user_name, coalesce(p_neighborhood, 'Victoria Gardens'), p_avatar_color)
  on conflict (pool_id, user_id) do update
  set user_name = excluded.user_name,
      avatar_color = excluded.avatar_color,
      updated_at = now();

  -- Compute current quantities under lock
  select coalesce(quantity, 0) into v_current_user_qty
  from public.item_claims
  where item_id = p_item_id and user_id = p_user_id;

  select coalesce(sum(quantity), 0) into v_other_users_qty
  from public.item_claims
  where item_id = p_item_id and user_id <> p_user_id;

  v_prev_total := v_current_user_qty + v_other_users_qty;
  v_next_user_qty := greatest(0, v_current_user_qty + p_delta);
  v_next_total := v_other_users_qty + v_next_user_qty;

  -- Enforce max_cases cap if set on a case_split item
  if v_item_mode = 'case_split' and v_max_cases is not null and v_max_cases > 0 then
    v_max_allowed_units := v_max_cases * v_case_size;
    if v_next_total > v_max_allowed_units then
      v_next_user_qty := greatest(0, v_max_allowed_units - v_other_users_qty);
      v_next_total := v_other_users_qty + v_next_user_qty;
      v_capped := true;
    end if;
  end if;

  -- Persist updated claim
  if v_next_user_qty <= 0 then
    delete from public.item_claims
    where item_id = p_item_id and user_id = p_user_id;
  else
    insert into public.item_claims (pool_id, item_id, user_id, user_name, avatar_color, quantity, updated_at)
    values (p_pool_id, p_item_id, p_user_id, p_user_name, p_avatar_color, v_next_user_qty, now())
    on conflict (item_id, user_id) do update
    set quantity = excluded.quantity,
        user_name = excluded.user_name,
        avatar_color = excluded.avatar_color,
        updated_at = now();
  end if;

  if v_item_mode = 'case_split' and v_case_size > 1 then
    v_prev_full_cases := floor(v_prev_total::numeric / v_case_size);
    v_next_full_cases := floor(v_next_total::numeric / v_case_size);
    v_remainder := mod(v_next_total, v_case_size);
  else
    v_prev_full_cases := v_prev_total;
    v_next_full_cases := v_next_total;
    v_remainder := 0;
  end if;

  return jsonb_build_object(
    'newUserQuantity', v_next_user_qty,
    'totalClaimedUnits', v_next_total,
    'fullCasesCount', v_next_full_cases,
    'remainderUnits', v_remainder,
    'justCompletedCase', (v_item_mode = 'case_split' and v_next_full_cases > v_prev_full_cases and v_remainder = 0),
    'justOpenedNewCase', (v_item_mode = 'case_split' and v_prev_total > 0 and mod(v_prev_total, v_case_size) = 0 and v_next_total > v_prev_total),
    'cappedAtMaxCases', v_capped
  );
end;
$$;

-- 7. Enable Row Level Security (Open for MVP prototyping so neighbors can read/write)
alter table public.pools enable row level security;
alter table public.pool_participants enable row level security;
alter table public.catalog_items enable row level security;
alter table public.item_claims enable row level security;
alter table public.pool_messages enable row level security;

drop policy if exists "Allow public read/write on pools" on public.pools;
create policy "Allow public read/write on pools" on public.pools for all using (true) with check (true);

drop policy if exists "Allow public read/write on pool_participants" on public.pool_participants;
create policy "Allow public read/write on pool_participants" on public.pool_participants for all using (true) with check (true);

drop policy if exists "Allow public read/write on catalog_items" on public.catalog_items;
create policy "Allow public read/write on catalog_items" on public.catalog_items for all using (true) with check (true);

drop policy if exists "Allow public read/write on item_claims" on public.item_claims;
create policy "Allow public read/write on item_claims" on public.item_claims for all using (true) with check (true);

drop policy if exists "Allow public read/write on pool_messages" on public.pool_messages;
create policy "Allow public read/write on pool_messages" on public.pool_messages for all using (true) with check (true);

-- 8. Enable Supabase Realtime on all 5 tables
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and tablename = 'pools'
  ) then
    alter publication supabase_realtime add table public.pools;
  end if;

  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and tablename = 'pool_participants'
  ) then
    alter publication supabase_realtime add table public.pool_participants;
  end if;

  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and tablename = 'catalog_items'
  ) then
    alter publication supabase_realtime add table public.catalog_items;
  end if;

  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and tablename = 'item_claims'
  ) then
    alter publication supabase_realtime add table public.item_claims;
  end if;

  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and tablename = 'pool_messages'
  ) then
    alter publication supabase_realtime add table public.pool_messages;
  end if;
end $$;
