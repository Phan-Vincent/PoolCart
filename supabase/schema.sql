-- ============================================================================
-- PoolCart — Supabase PostgreSQL + Realtime Schema
-- Paste this into your Supabase SQL Editor (https://supabase.com/dashboard)
-- and click "Run" to create the tables, policies, and Realtime channels.
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

-- 6. Enable Row Level Security (Open for MVP prototyping so neighbors can read/write)
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

-- 7. Enable Supabase Realtime on all 5 tables
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
