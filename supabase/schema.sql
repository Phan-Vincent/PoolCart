-- ============================================================================
-- PoolCart — Cloud-Preserving PostgreSQL + RLS + Transactional RPC Migration
-- Revision: cloud-preserving-fixes (task-c22542522064)
--
-- Non-destructive migration strategy:
--   1. Preserves existing text primary keys (`id text`, `user_id text`) so
--      legacy rows and existing deployments upgrade in place without data loss.
--   2. Adds richer domain columns (`host_user_id`, `distance_miles`, `true_up`,
--      `porch_check_in`, `wishlist`, `actual_unit_price`, `settled_amount`,
--      `claim_seq`) via `ALTER TABLE ... ADD COLUMN IF NOT EXISTS`.
--   3. Enforces authenticated pool membership & host authorization via
--      `auth.uid()::text` inside RLS policies and atomic `SECURITY DEFINER`
--      stored procedures (`search_path = public, pg_temp`).
--   4. Never trusts caller-supplied `user_id`, `user_name`, `is_host`, or
--      `verified_auth` parameters; derives identity strictly from `auth.uid()`
--      and server-side profile/membership records.
--   5. Keeps demo card simulation fields (`demo_authorized`, `demo_paid`,
--      `demoHoldId`) strictly out of cloud payment records (`paid_status` in
--      cloud DB allows only `'pending'` or `'paid'` with `settled_amount`).
-- ============================================================================

-- 1. Profiles Table (Authenticated Cloud Identity)
create table if not exists public.user_profiles (
  user_id text primary key,
  display_name text not null check (char_length(btrim(display_name)) between 1 and 120),
  email text,
  neighborhood text not null default 'Victoria Gardens',
  avatar_color text not null default '#0D9488',
  updated_at timestamptz not null default now()
);

-- 2. Pools Table (Non-destructive creation + column additions)
create table if not exists public.pools (
  id text primary key,
  join_code text not null default 'POOL-01',
  title text not null,
  supplier_name text not null,
  supplier_badge text not null,
  category text not null,
  host_user_id text,
  host_name text not null,
  host_venmo_handle text,
  neighborhood text not null,
  distance_miles numeric,
  pickup_address text not null,
  pickup_window text not null,
  cutoff_time text not null,
  minimum_order_amount numeric not null default 200 check (minimum_order_amount > 0),
  delivery_fee numeric not null default 20 check (delivery_fee >= 0),
  free_delivery_threshold numeric not null default 300 check (free_delivery_threshold >= minimum_order_amount),
  status text not null default 'open' check (status in ('open', 'minimum_met', 'locked')),
  true_up jsonb,
  porch_check_in jsonb,
  wishlist jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.pools add column if not exists host_user_id text;
alter table public.pools add column if not exists distance_miles numeric;
alter table public.pools add column if not exists true_up jsonb;
alter table public.pools add column if not exists porch_check_in jsonb;
alter table public.pools add column if not exists wishlist jsonb not null default '[]'::jsonb;
alter table public.pools add column if not exists updated_at timestamptz not null default now();

create unique index if not exists idx_pools_join_code_upper on public.pools (upper(join_code));

-- 3. Pool Participants Table (Server-Enforced Membership & Host Role)
create table if not exists public.pool_participants (
  pool_id text not null references public.pools(id) on delete cascade,
  user_id text not null,
  user_name text not null,
  neighborhood text not null default 'Victoria Gardens',
  avatar_color text not null default '#0D9488',
  is_host boolean not null default false,
  paid_status text not null default 'pending' check (paid_status in ('pending', 'paid')),
  settled_amount numeric check (settled_amount is null or settled_amount > 0),
  picked_up boolean not null default false,
  legacy_unclaimed boolean not null default false,
  updated_at timestamptz not null default now(),
  primary key (pool_id, user_id)
);

alter table public.pool_participants add column if not exists settled_amount numeric;
alter table public.pool_participants add column if not exists legacy_unclaimed boolean not null default false;

-- Backfill host_user_id on legacy pools from pool_participants where is_host = true
update public.pools p
set host_user_id = part.user_id
from public.pool_participants part
where part.pool_id = p.id
  and part.is_host = true
  and p.host_user_id is null;

-- Reset any legacy paid_status='paid' lacking settled_amount evidence to 'pending'
update public.pool_participants
set paid_status = 'pending'
where paid_status = 'paid' and settled_amount is null;

-- 4. Catalog Items Table
create table if not exists public.catalog_items (
  id text primary key,
  pool_id text not null references public.pools(id) on delete cascade,
  name text not null,
  category text not null,
  emoji text not null default '🛒',
  mode text not null check (mode in ('individual', 'case_split')),
  unit_label text not null,
  unit_price numeric not null check (unit_price > 0),
  actual_unit_price numeric check (actual_unit_price is null or actual_unit_price > 0),
  retail_price numeric not null check (retail_price > 0),
  case_size integer check (case_size is null or case_size >= 2),
  max_cases integer check (max_cases is null or max_cases >= 1),
  created_at timestamptz not null default now()
);

alter table public.catalog_items add column if not exists actual_unit_price numeric;

-- 5. Item Claims Table (Deterministic claim_seq order for case-split allocation)
create sequence if not exists public.item_claims_seq;

create table if not exists public.item_claims (
  pool_id text not null references public.pools(id) on delete cascade,
  item_id text not null references public.catalog_items(id) on delete cascade,
  user_id text not null,
  user_name text not null,
  avatar_color text not null,
  quantity integer not null check (quantity > 0),
  claim_seq bigint not null default nextval('public.item_claims_seq'),
  updated_at timestamptz not null default now(),
  primary key (item_id, user_id)
);

alter table public.item_claims add column if not exists claim_seq bigint not null default nextval('public.item_claims_seq');

-- 6. Pool Messages & Host Announcements Table
create table if not exists public.pool_messages (
  id text primary key,
  pool_id text not null references public.pools(id) on delete cascade,
  user_id text not null,
  user_name text not null,
  avatar_color text not null default '#0D9488',
  is_host boolean not null default false,
  is_announcement boolean not null default false,
  text text not null check (char_length(btrim(text)) between 1 and 4000),
  created_at_label text not null,
  created_at timestamptz not null default now()
);

-- Covering indexes for pool_id foreign keys
create index if not exists idx_catalog_items_pool_id on public.catalog_items (pool_id);
create index if not exists idx_item_claims_pool_id on public.item_claims (pool_id);
create index if not exists idx_pool_messages_pool_id on public.pool_messages (pool_id);

-- ============================================================================
-- 7. Helper Authorization Functions (Server Identity Enforcement)
-- ============================================================================

create or replace function public.require_authenticated_uid()
returns text
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid text;
begin
  v_uid := auth.uid()::text;
  if v_uid is null or btrim(v_uid) = '' then
    raise exception 'Authentication required: sign in with a verified cloud session.';
  end if;
  return v_uid;
end;
$$;

create or replace function public.is_pool_member(p_pool_id text, p_user_id text default auth.uid()::text)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1
    from public.pool_participants pp
    where pp.pool_id = p_pool_id
      and pp.user_id = p_user_id
  ) or exists (
    select 1
    from public.pools p
    where p.id = p_pool_id
      and p.host_user_id = p_user_id
  );
$$;

create or replace function public.is_pool_host_user(p_pool_id text, p_user_id text default auth.uid()::text)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1
    from public.pools p
    where p.id = p_pool_id
      and (
        p.host_user_id = p_user_id
        or (
          p.host_user_id is null
          and exists (
            select 1
            from public.pool_participants pp
            where pp.pool_id = p.id
              and pp.user_id = p_user_id
              and pp.is_host = true
              and pp.legacy_unclaimed = false
          )
        )
      )
  );
$$;

create or replace function public.recompute_pool_order_summary(p_pool_id text)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_min numeric;
  v_committed numeric := 0;
  v_has_partial boolean := false;
  v_item record;
  v_total_qty integer;
  v_case_size integer;
  v_committed_units integer;
  v_rem integer;
  v_price numeric;
begin
  select minimum_order_amount into v_min
  from public.pools
  where id = p_pool_id;

  for v_item in
    select id, mode, coalesce(case_size, 1) as case_size, unit_price, actual_unit_price
    from public.catalog_items
    where pool_id = p_pool_id
  loop
    select coalesce(sum(quantity), 0) into v_total_qty
    from public.item_claims
    where pool_id = p_pool_id and item_id = v_item.id;

    if v_item.mode = 'case_split' and v_item.case_size > 1 then
      v_committed_units := (v_total_qty / v_item.case_size) * v_item.case_size;
      v_rem := mod(v_total_qty, v_item.case_size);
      if v_rem > 0 then
        v_has_partial := true;
      end if;
    else
      v_committed_units := v_total_qty;
      v_rem := 0;
    end if;

    v_price := coalesce(v_item.actual_unit_price, v_item.unit_price);
    v_committed := v_committed + round(v_committed_units * v_price, 2);
  end loop;

  return jsonb_build_object(
    'committedTotal', v_committed,
    'minimumOrderAmount', coalesce(v_min, 0),
    'isMinimumMet', (v_committed > 0 and v_committed >= coalesce(v_min, 0)),
    'hasPartialCases', v_has_partial
  );
end;
$$;

-- ============================================================================
-- 8. Transactional Cloud RPCs
-- ============================================================================

-- 8A. Upsert Authenticated Profile (`upsert_my_profile`)
create or replace function public.upsert_my_profile(
  p_display_name text,
  p_neighborhood text default 'Victoria Gardens',
  p_avatar_color text default '#0D9488'
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid text := public.require_authenticated_uid();
  v_email text := coalesce(auth.jwt() ->> 'email', null);
  v_name text := btrim(coalesce(p_display_name, ''));
  v_hood text := btrim(coalesce(p_neighborhood, 'Victoria Gardens'));
  v_color text := btrim(coalesce(p_avatar_color, '#0D9488'));
begin
  if v_name = '' then
    v_name := coalesce(split_part(v_email, '@', 1), 'Neighbor');
  end if;

  insert into public.user_profiles (user_id, display_name, email, neighborhood, avatar_color, updated_at)
  values (v_uid, v_name, v_email, v_hood, v_color, now())
  on conflict (user_id) do update
  set display_name = excluded.display_name,
      email = coalesce(excluded.email, public.user_profiles.email),
      neighborhood = excluded.neighborhood,
      avatar_color = excluded.avatar_color,
      updated_at = now();

  -- Sync display name & avatar on existing pool memberships for this user
  update public.pool_participants
  set user_name = v_name,
      neighborhood = v_hood,
      avatar_color = v_color,
      updated_at = now()
  where user_id = v_uid;

  return jsonb_build_object(
    'id', v_uid,
    'name', v_name,
    'email', v_email,
    'neighborhood', v_hood,
    'avatarColor', v_color,
    'verifiedAuth', true
  );
end;
$$;

-- 8B. Explicit Invite Code Join (`join_pool_by_invite`)
create or replace function public.join_pool_by_invite(
  p_join_code text,
  p_display_name text default null,
  p_neighborhood text default null,
  p_avatar_color text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid text := public.require_authenticated_uid();
  v_code text := upper(btrim(coalesce(p_join_code, '')));
  v_pool public.pools%rowtype;
  v_profile public.user_profiles%rowtype;
  v_is_host boolean := false;
begin
  if v_code = '' then
    raise exception 'Invite code is required to join a pool.';
  end if;

  select * into v_pool
  from public.pools
  where upper(join_code) = v_code or upper(id) = v_code
  for update;

  if not found then
    raise exception 'No cloud pool found matching invite code "%".', v_code;
  end if;

  perform public.upsert_my_profile(
    coalesce(p_display_name, 'Neighbor'),
    coalesce(p_neighborhood, v_pool.neighborhood),
    coalesce(p_avatar_color, '#0D9488')
  );

  select * into v_profile
  from public.user_profiles
  where user_id = v_uid;

  v_is_host := (v_pool.host_user_id = v_uid);

  insert into public.pool_participants (
    pool_id, user_id, user_name, neighborhood, avatar_color, is_host, paid_status, picked_up, updated_at
  )
  values (
    v_pool.id, v_uid, v_profile.display_name, v_profile.neighborhood, v_profile.avatar_color, v_is_host, 'pending', false, now()
  )
  on conflict (pool_id, user_id) do update
  set user_name = excluded.user_name,
      neighborhood = excluded.neighborhood,
      avatar_color = excluded.avatar_color,
      is_host = (public.pool_participants.is_host or v_is_host),
      updated_at = now();

  return jsonb_build_object(
    'poolId', v_pool.id,
    'joinCode', v_pool.join_code,
    'title', v_pool.title,
    'userId', v_uid,
    'isHost', v_is_host
  );
end;
$$;

-- 8C. Create a New Pool or Rerun Pool Atomically (`create_pool_with_catalog`)
create or replace function public.create_pool_with_catalog(
  p_pool jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid text := public.require_authenticated_uid();
  v_profile public.user_profiles%rowtype;
  v_pool_id text := btrim(coalesce(p_pool ->> 'id', ''));
  v_join_code text := upper(btrim(coalesce(p_pool ->> 'joinCode', '')));
  v_title text := btrim(coalesce(p_pool ->> 'title', ''));
  v_min numeric := (p_pool ->> 'minimumOrderAmount')::numeric;
  v_deliv numeric := coalesce((p_pool ->> 'deliveryFee')::numeric, 0);
  v_free numeric := (p_pool ->> 'freeDeliveryThreshold')::numeric;
  v_item jsonb;
  v_msg jsonb;
begin
  if v_pool_id = '' or v_title = '' or v_join_code !~ '^[A-Z0-9_-]+$' then
    raise exception 'Pool ID, title, and valid invite code are required.';
  end if;
  if v_min is null or v_min <= 0 or v_deliv < 0 or v_free is null or v_free < v_min then
    raise exception 'Invalid pool order minimum, delivery fee, or free-delivery threshold.';
  end if;

  select * into v_profile from public.user_profiles where user_id = v_uid;
  if not found then
    perform public.upsert_my_profile(
      coalesce(p_pool ->> 'hostName', 'Host'),
      coalesce(p_pool ->> 'neighborhood', 'Victoria Gardens'),
      '#0D9488'
    );
    select * into v_profile from public.user_profiles where user_id = v_uid;
  end if;

  insert into public.pools (
    id, join_code, title, supplier_name, supplier_badge, category,
    host_user_id, host_name, host_venmo_handle, neighborhood, distance_miles,
    pickup_address, pickup_window, cutoff_time,
    minimum_order_amount, delivery_fee, free_delivery_threshold,
    status, true_up, porch_check_in, wishlist
  )
  values (
    v_pool_id,
    v_join_code,
    v_title,
    coalesce(p_pool ->> 'supplierName', 'Wholesale Supplier'),
    coalesce(p_pool ->> 'supplierBadge', 'Wholesale Direct'),
    coalesce(p_pool ->> 'category', 'Groceries'),
    v_uid,
    v_profile.display_name,
    nullif(btrim(coalesce(p_pool ->> 'hostVenmoHandle', '')), ''),
    coalesce(p_pool ->> 'neighborhood', v_profile.neighborhood),
    (p_pool ->> 'distanceMiles')::numeric,
    coalesce(p_pool ->> 'pickupAddress', ''),
    coalesce(p_pool ->> 'pickupWindow', ''),
    coalesce(p_pool ->> 'cutoffTime', ''),
    v_min,
    v_deliv,
    v_free,
    'open',
    null,
    null,
    '[]'::jsonb
  );

  -- Host is the sole initial participant;paid_status is strictly 'pending'
  insert into public.pool_participants (
    pool_id, user_id, user_name, neighborhood, avatar_color, is_host, paid_status, picked_up
  )
  values (
    v_pool_id, v_uid, v_profile.display_name, v_profile.neighborhood, v_profile.avatar_color, true, 'pending', false
  );

  -- Insert catalog items (and only caller's own initial claim if present)
  for v_item in select * from jsonb_array_elements(coalesce(p_pool -> 'items', '[]'::jsonb))
  loop
    insert into public.catalog_items (
      id, pool_id, name, category, emoji, mode, unit_label, unit_price, actual_unit_price, retail_price, case_size, max_cases
    )
    values (
      v_item ->> 'id',
      v_pool_id,
      v_item ->> 'name',
      coalesce(v_item ->> 'category', 'Wholesale'),
      coalesce(v_item ->> 'emoji', '🛒'),
      v_item ->> 'mode',
      v_item ->> 'unitLabel',
      (v_item ->> 'unitPrice')::numeric,
      null,
      (v_item ->> 'retailPrice')::numeric,
      (v_item ->> 'caseSize')::integer,
      (v_item ->> 'maxCases')::integer
    );

    if jsonb_array_length(coalesce(v_item -> 'claims', '[]'::jsonb)) > 0 then
      insert into public.item_claims (
        pool_id, item_id, user_id, user_name, avatar_color, quantity
      )
      select
        v_pool_id,
        v_item ->> 'id',
        v_uid,
        v_profile.display_name,
        v_profile.avatar_color,
        greatest(1, ((v_item -> 'claims' -> 0) ->> 'quantity')::integer)
      where ((v_item -> 'claims' -> 0) ->> 'quantity')::integer > 0;
    end if;
  end loop;

  for v_msg in select * from jsonb_array_elements(coalesce(p_pool -> 'messages', '[]'::jsonb))
  loop
    insert into public.pool_messages (
      id, pool_id, user_id, user_name, avatar_color, is_host, is_announcement, text, created_at_label
    )
    values (
      v_msg ->> 'id',
      v_pool_id,
      v_uid,
      v_profile.display_name,
      v_profile.avatar_color,
      true,
      coalesce((v_msg ->> 'isAnnouncement')::boolean, true),
      v_msg ->> 'text',
      coalesce(v_msg ->> 'createdAt', 'Just now')
    );
  end loop;

  return jsonb_build_object('poolId', v_pool_id, 'hostUserId', v_uid);
end;
$$;

-- 8D. Atomic Case-Split Claim RPC Function (`claim_item_share`)
-- Derives user identity strictly from `auth.uid()` and verifies pool membership.
-- Ignored legacy parameters (`p_user_id`, `p_user_name`, `p_avatar_color`, `p_neighborhood`)
-- are retained in the signature for wire compatibility but never trusted if they
-- mismatch `auth.uid()`.
create or replace function public.claim_item_share(
  p_pool_id text,
  p_item_id text,
  p_user_id text default null,
  p_user_name text default null,
  p_avatar_color text default null,
  p_neighborhood text default null,
  p_delta integer default 1
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid text := public.require_authenticated_uid();
  v_pool_status text;
  v_member record;
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
  if p_user_id is not null and btrim(p_user_id) <> '' and p_user_id <> v_uid then
    raise exception 'Forged identity rejected: caller user_id (%) does not match authenticated session (%).', p_user_id, v_uid;
  end if;

  if p_delta not in (-1, 1) or p_delta is null then
    raise exception 'Claim delta must be +1 or -1.';
  end if;

  -- Lock pool row to verify cutoff lock status
  select status into v_pool_status
  from public.pools
  where id = p_pool_id
  for update;

  if not found then
    raise exception 'Pool not found.';
  end if;

  if not public.is_pool_member(p_pool_id, v_uid) then
    raise exception 'Access denied: join this pool by invite code before claiming items.';
  end if;

  if v_pool_status = 'locked' then
    raise exception 'Reopen the pool before changing orders or wishlist claims.';
  end if;

  select user_name, avatar_color, neighborhood
  into v_member
  from public.pool_participants
  where pool_id = p_pool_id and user_id = v_uid
  for update;

  -- Lock catalog_item row to serialize concurrent case-split claims
  select mode, coalesce(case_size, 1), max_cases
  into v_item_mode, v_case_size, v_max_cases
  from public.catalog_items
  where id = p_item_id and pool_id = p_pool_id
  for update;

  if not found then
    raise exception 'Catalog item not found in pool.';
  end if;

  -- Compute current quantities under lock
  select coalesce(quantity, 0) into v_current_user_qty
  from public.item_claims
  where item_id = p_item_id and user_id = v_uid;

  v_current_user_qty := coalesce(v_current_user_qty, 0);

  select coalesce(sum(quantity), 0) into v_other_users_qty
  from public.item_claims
  where item_id = p_item_id and user_id <> v_uid;

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
    where item_id = p_item_id and user_id = v_uid;
  else
    insert into public.item_claims (pool_id, item_id, user_id, user_name, avatar_color, quantity, updated_at)
    values (p_pool_id, p_item_id, v_uid, v_member.user_name, v_member.avatar_color, v_next_user_qty, now())
    on conflict (item_id, user_id) do update
    set quantity = excluded.quantity,
        user_name = excluded.user_name,
        avatar_color = excluded.avatar_color,
        updated_at = now();
  end if;

  -- Reset settlement evidence on affected participants if order changed
  if v_next_user_qty <> v_current_user_qty then
    update public.pool_participants
    set paid_status = 'pending',
        settled_amount = null,
        picked_up = false,
        updated_at = now()
    where pool_id = p_pool_id;
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

-- 8E. Transactional Pool Action RPC (`apply_pool_action_rpc`)
-- Handles multi-row and role-guarded operations atomically under row locks:
--   addItems, reorder, pledge, request, promote, price, receipt, porch,
--   message, lock, cover, trim, paid, pickup
create or replace function public.apply_pool_action_rpc(
  p_pool_id text,
  p_action jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid text := public.require_authenticated_uid();
  v_type text := btrim(coalesce(p_action ->> 'type', ''));
  v_pool public.pools%rowtype;
  v_member public.pool_participants%rowtype;
  v_is_host boolean;
  v_summary jsonb;
  v_item record;
  v_claim record;
  v_rem integer;
  v_needed integer;
  v_remove integer;
  v_deduct integer;
  v_elem jsonb;
  v_wish jsonb;
  v_new_wishlist jsonb := '[]'::jsonb;
  v_found boolean := false;
  v_target_user text;
  v_due numeric;
begin
  select * into v_pool
  from public.pools
  where id = p_pool_id
  for update;

  if not found then
    raise exception 'Pool not found.';
  end if;

  if not public.is_pool_member(p_pool_id, v_uid) then
    raise exception 'Access denied: you are not a member of this pool.';
  end if;

  select * into v_member
  from public.pool_participants
  where pool_id = p_pool_id and user_id = v_uid
  for update;

  v_is_host := public.is_pool_host_user(p_pool_id, v_uid);

  if v_type in ('promote', 'price', 'receipt', 'porch', 'lock', 'cover', 'trim', 'paid', 'pickup') and not v_is_host then
    raise exception 'Only the pool host can perform this action.';
  end if;

  if v_type in ('addItems', 'reorder', 'pledge', 'request', 'promote', 'cover', 'trim') and v_pool.status = 'locked' then
    raise exception 'Reopen the pool before changing orders or wishlist claims.';
  end if;

  if v_type in ('authorizeDemo', 'captureDemo') then
    raise exception 'Simulated card holds are confined to local demo mode and cannot be persisted as cloud payment records.';
  end if;

  case v_type
    when 'addItems' then
      for v_elem in select * from jsonb_array_elements(coalesce(p_action -> 'items', '[]'::jsonb))
      loop
        insert into public.catalog_items (
          id, pool_id, name, category, emoji, mode, unit_label, unit_price, retail_price, case_size, max_cases
        )
        values (
          v_elem ->> 'id',
          p_pool_id,
          v_elem ->> 'name',
          coalesce(v_elem ->> 'category', 'Neighborhood Addition'),
          coalesce(v_elem ->> 'emoji', '🛒'),
          v_elem ->> 'mode',
          v_elem ->> 'unitLabel',
          (v_elem ->> 'unitPrice')::numeric,
          (v_elem ->> 'retailPrice')::numeric,
          (v_elem ->> 'caseSize')::integer,
          (v_elem ->> 'maxCases')::integer
        );

        if jsonb_array_length(coalesce(v_elem -> 'claims', '[]'::jsonb)) > 0 then
          if ((v_elem -> 'claims' -> 0) ->> 'userId') is not null
             and ((v_elem -> 'claims' -> 0) ->> 'userId') <> v_uid then
            raise exception 'An added item can only contain your own claim.';
          end if;
          insert into public.item_claims (pool_id, item_id, user_id, user_name, avatar_color, quantity)
          values (
            p_pool_id,
            v_elem ->> 'id',
            v_uid,
            v_member.user_name,
            v_member.avatar_color,
            greatest(1, ((v_elem -> 'claims' -> 0) ->> 'quantity')::integer)
          );
        end if;
      end loop;

    when 'reorder' then
      for v_elem in select * from jsonb_array_elements(coalesce(p_action -> 'receipt' -> 'items', '[]'::jsonb))
      loop
        select * into v_item
        from public.catalog_items
        where pool_id = p_pool_id and lower(name) = lower(v_elem ->> 'name')
        for update;

        if not found then
          insert into public.catalog_items (
            id, pool_id, name, category, emoji, mode, unit_label, unit_price, retail_price, case_size
          )
          values (
            'item_' || extract(epoch from clock_timestamp())::bigint::text || '_' || substr(md5(random()::text), 1, 6),
            p_pool_id,
            v_elem ->> 'name',
            'Re-Ordered Staple',
            coalesce(v_elem ->> 'emoji', '🛒'),
            v_elem ->> 'mode',
            v_elem ->> 'unitLabel',
            (v_elem ->> 'unitPrice')::numeric,
            (v_elem ->> 'retailPrice')::numeric,
            (v_elem ->> 'caseSize')::integer
          )
          returning * into v_item;
        end if;

        insert into public.item_claims (pool_id, item_id, user_id, user_name, avatar_color, quantity)
        values (
          p_pool_id, v_item.id, v_uid, v_member.user_name, v_member.avatar_color, (v_elem ->> 'quantity')::integer
        )
        on conflict (item_id, user_id) do update
        set quantity = public.item_claims.quantity + excluded.quantity,
            updated_at = now();

        if v_item.mode = 'case_split' and v_item.max_cases is not null then
          if (select coalesce(sum(quantity), 0) from public.item_claims where item_id = v_item.id) > v_item.max_cases * v_item.case_size then
            raise exception 'This item has reached its case cap.';
          end if;
        end if;
      end loop;

    when 'request' then
      v_wish := jsonb_build_object(
        'id', coalesce(p_action -> 'wish' ->> 'id', 'wish_' || substr(md5(random()::text), 1, 8)),
        'poolId', p_pool_id,
        'title', btrim(coalesce(p_action -> 'wish' ->> 'title', '')),
        'emoji', coalesce(p_action -> 'wish' ->> 'emoji', '📦'),
        'category', coalesce(p_action -> 'wish' ->> 'category', 'Neighbor Request'),
        'suggestedUnitLabel', coalesce(p_action -> 'wish' ->> 'suggestedUnitLabel', '1 share'),
        'estimatedUnitPrice', (p_action -> 'wish' ->> 'estimatedUnitPrice')::numeric,
        'estimatedRetailPrice', (p_action -> 'wish' ->> 'estimatedRetailPrice')::numeric,
        'targetCaseSize', (p_action -> 'wish' ->> 'targetCaseSize')::integer,
        'requestedByUserId', v_uid,
        'requestedByUserName', v_member.user_name,
        'pledgedUserIds', jsonb_build_array(v_uid),
        'promotedToCatalog', false
      );
      update public.pools
      set wishlist = jsonb_build_array(v_wish) || coalesce(wishlist, '[]'::jsonb),
          updated_at = now()
      where id = p_pool_id;

    when 'pledge' then
      for v_elem in select * from jsonb_array_elements(coalesce(v_pool.wishlist, '[]'::jsonb))
      loop
        if (v_elem ->> 'id') = (p_action ->> 'wishId') and coalesce((v_elem ->> 'promotedToCatalog')::boolean, false) = false then
          v_found := true;
          if (v_elem -> 'pledgedUserIds') @> to_jsonb(v_uid) then
            v_elem := jsonb_set(
              v_elem,
              '{pledgedUserIds}',
              coalesce((
                select jsonb_agg(x)
                from jsonb_array_elements_text(v_elem -> 'pledgedUserIds') x
                where x <> v_uid
              ), '[]'::jsonb)
            );
          else
            v_elem := jsonb_set(v_elem, '{pledgedUserIds}', (v_elem -> 'pledgedUserIds') || to_jsonb(v_uid));
          end if;
        end if;
        v_new_wishlist := v_new_wishlist || jsonb_build_array(v_elem);
      end loop;
      if not v_found then
        raise exception 'Wishlist request is no longer available.';
      end if;
      update public.pools set wishlist = v_new_wishlist, updated_at = now() where id = p_pool_id;

    when 'promote' then
      for v_elem in select * from jsonb_array_elements(coalesce(v_pool.wishlist, '[]'::jsonb))
      loop
        if (v_elem ->> 'id') = (p_action ->> 'wishId') and coalesce((v_elem ->> 'promotedToCatalog')::boolean, false) = false then
          v_found := true;
          v_wish := v_elem;
          v_elem := jsonb_set(v_elem, '{promotedToCatalog}', 'true'::jsonb);
        end if;
        v_new_wishlist := v_new_wishlist || jsonb_build_array(v_elem);
      end loop;
      if not v_found then
        raise exception 'Wishlist request was already promoted or removed.';
      end if;
      update public.pools set wishlist = v_new_wishlist, updated_at = now() where id = p_pool_id;

      declare
        v_new_item_id text := coalesce(p_action ->> 'newItemId', 'item_' || substr(md5(random()::text), 1, 10));
        v_pledger_id text;
        v_pledger record;
      begin
        insert into public.catalog_items (
          id, pool_id, name, category, emoji, mode, unit_label, unit_price, retail_price, case_size
        )
        values (
          v_new_item_id,
          p_pool_id,
          v_wish ->> 'title',
          coalesce(v_wish ->> 'category', 'Neighbor Request'),
          coalesce(v_wish ->> 'emoji', '📦'),
          'case_split',
          v_wish ->> 'suggestedUnitLabel',
          (v_wish ->> 'estimatedUnitPrice')::numeric,
          (v_wish ->> 'estimatedRetailPrice')::numeric,
          (v_wish ->> 'targetCaseSize')::integer
        );

        for v_pledger_id in select distinct x from jsonb_array_elements_text(v_wish -> 'pledgedUserIds') x
        loop
          select * into v_pledger from public.pool_participants where pool_id = p_pool_id and user_id = v_pledger_id;
          if found then
            insert into public.item_claims (pool_id, item_id, user_id, user_name, avatar_color, quantity)
            values (p_pool_id, v_new_item_id, v_pledger_id, v_pledger.user_name, v_pledger.avatar_color, 1)
            on conflict (item_id, user_id) do nothing;
          end if;
        end loop;
      end;

    when 'price' then
      update public.catalog_items
      set actual_unit_price = case
        when p_action -> 'price' is null or jsonb_typeof(p_action -> 'price') = 'null' then null
        else (p_action ->> 'price')::numeric
      end
      where id = (p_action ->> 'itemId') and pool_id = p_pool_id;
      if not found then
        raise exception 'Catalog item no longer exists.';
      end if;
      update public.pool_participants
      set paid_status = 'pending', settled_amount = null, picked_up = false, updated_at = now()
      where pool_id = p_pool_id;

    when 'receipt' then
      update public.pools
      set true_up = p_action -> 'trueUp',
          updated_at = now()
      where id = p_pool_id;

      for v_elem in select * from jsonb_array_elements(coalesce(p_action -> 'prices', '[]'::jsonb))
      loop
        update public.catalog_items
        set actual_unit_price = (v_elem ->> 'newPrice')::numeric
        where id = (v_elem ->> 'itemId') and pool_id = p_pool_id;
      end loop;

      update public.pool_participants
      set paid_status = 'pending', settled_amount = null, picked_up = false, updated_at = now()
      where pool_id = p_pool_id;

    when 'porch' then
      update public.pools
      set porch_check_in = p_action -> 'checkIn',
          updated_at = now()
      where id = p_pool_id;

    when 'message' then
      if coalesce((p_action -> 'message' ->> 'isAnnouncement')::boolean, false) and not v_is_host then
        raise exception 'Only the host can pin an announcement.';
      end if;
      insert into public.pool_messages (
        id, pool_id, user_id, user_name, avatar_color, is_host, is_announcement, text, created_at_label
      )
      values (
        coalesce(p_action -> 'message' ->> 'id', 'msg_' || substr(md5(random()::text), 1, 10)),
        p_pool_id,
        v_uid,
        v_member.user_name,
        v_member.avatar_color,
        v_is_host,
        coalesce((p_action -> 'message' ->> 'isAnnouncement')::boolean, false),
        btrim(coalesce(p_action -> 'message' ->> 'text', '')),
        coalesce(p_action -> 'message' ->> 'createdAt', 'Just now')
      );

    when 'cover' then
      select * into v_item
      from public.catalog_items
      where id = (p_action ->> 'itemId') and pool_id = p_pool_id
      for update;

      if not found then
        raise exception 'Catalog item no longer exists.';
      end if;

      select mod(coalesce(sum(quantity), 0), coalesce(v_item.case_size, 1))
      into v_rem
      from public.item_claims
      where item_id = v_item.id;

      v_needed := case when v_rem = 0 then 0 else coalesce(v_item.case_size, 1) - v_rem end;
      if v_needed > 0 then
        insert into public.item_claims (pool_id, item_id, user_id, user_name, avatar_color, quantity)
        values (p_pool_id, v_item.id, v_uid, v_member.user_name, v_member.avatar_color, v_needed)
        on conflict (item_id, user_id) do update
        set quantity = public.item_claims.quantity + excluded.quantity,
            updated_at = now();
      end if;

    when 'trim' then
      select * into v_item
      from public.catalog_items
      where id = (p_action ->> 'itemId') and pool_id = p_pool_id
      for update;

      if not found then
        raise exception 'Catalog item no longer exists.';
      end if;

      select mod(coalesce(sum(quantity), 0), coalesce(v_item.case_size, 1))
      into v_remove
      from public.item_claims
      where item_id = v_item.id;

      for v_claim in
        select user_id, quantity
        from public.item_claims
        where item_id = v_item.id
        order by claim_seq desc
        for update
      loop
        exit when v_remove <= 0;
        v_deduct := least(v_remove, v_claim.quantity);
        if v_claim.quantity - v_deduct <= 0 then
          delete from public.item_claims where item_id = v_item.id and user_id = v_claim.user_id;
        else
          update public.item_claims
          set quantity = quantity - v_deduct, updated_at = now()
          where item_id = v_item.id and user_id = v_claim.user_id;
        end if;
        v_remove := v_remove - v_deduct;
      end loop;

    when 'lock' then
      if v_pool.status = 'locked' then
        update public.pools set status = 'open', updated_at = now() where id = p_pool_id;
      else
        v_summary := public.recompute_pool_order_summary(p_pool_id);
        if not coalesce((v_summary ->> 'isMinimumMet')::boolean, false) then
          raise exception 'The committed order must meet the supplier minimum before locking.';
        end if;
        if coalesce((v_summary ->> 'hasPartialCases')::boolean, false) then
          raise exception 'Cover or drop every partial case before locking.';
        end if;
        update public.pools set status = 'locked', updated_at = now() where id = p_pool_id;
      end if;

    when 'paid' then
      v_summary := public.recompute_pool_order_summary(p_pool_id);
      if v_pool.status <> 'locked' then
        raise exception 'Lock the finalized pool before recording settlement or pickup.';
      end if;
      if not coalesce((v_summary ->> 'isMinimumMet')::boolean, false) or coalesce((v_summary ->> 'hasPartialCases')::boolean, false) then
        raise exception 'Resolve partial cases and meet the supplier minimum first.';
      end if;

      v_target_user := p_action ->> 'userId';
      v_due := (p_action ->> 'settledAmount')::numeric;
      if v_due is null or v_due <= 0 then
        raise exception 'No payable share for this neighbor.';
      end if;

      update public.pool_participants
      set paid_status = case when paid_status = 'paid' then 'pending' else 'paid' end,
          settled_amount = case when paid_status = 'paid' then null else v_due end,
          updated_at = now()
      where pool_id = p_pool_id and user_id = v_target_user;

      if not found then
        raise exception 'Participant not found.';
      end if;

    when 'pickup' then
      v_summary := public.recompute_pool_order_summary(p_pool_id);
      if v_pool.status <> 'locked' then
        raise exception 'Lock the finalized pool before recording settlement or pickup.';
      end if;
      if not coalesce((v_summary ->> 'isMinimumMet')::boolean, false) or coalesce((v_summary ->> 'hasPartialCases')::boolean, false) then
        raise exception 'Resolve partial cases and meet the supplier minimum first.';
      end if;

      v_target_user := p_action ->> 'userId';
      update public.pool_participants
      set picked_up = not picked_up,
          updated_at = now()
      where pool_id = p_pool_id and user_id = v_target_user;

      if not found then
        raise exception 'Participant not found.';
      end if;

    else
      raise exception 'Unsupported pool action type: %', v_type;
  end case;

  return jsonb_build_object('ok', true, 'poolId', p_pool_id, 'actionType', v_type);
end;
$$;

-- 8F. Self-Service Account Deletion (`delete_my_account`)
-- Required by App Store Review Guideline 5.1.1(v) and Google Play's account
-- deletion policy. Identity comes only from auth.uid().
--   * Pools the caller hosts are deleted for every member (cascades to
--     participants, items, claims, and messages).
--   * In open pools the caller joined, their claims and membership are removed.
--   * In locked pools (order already placed with the supplier) their order
--     lines are kept for the host's accounting but de-identified.
--   * Their chat messages, wishlist requests/pledges, profile, and auth user
--     are deleted.
create or replace function public.delete_my_account()
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid text := public.require_authenticated_uid();
  v_hosted_deleted integer := 0;
  v_pool_ids text[];
begin
  -- Pools the caller hosts
  with hosted as (
    delete from public.pools p
    where public.is_pool_host_user(p.id, v_uid)
    returning p.id
  )
  select count(*) into v_hosted_deleted from hosted;

  select coalesce(array_agg(pool_id), array[]::text[]) into v_pool_ids
  from public.pool_participants
  where user_id = v_uid;

  -- Chat messages everywhere
  delete from public.pool_messages where user_id = v_uid;

  -- Open pools: remove claims and membership
  delete from public.item_claims c
  using public.pools p
  where c.pool_id = p.id and c.user_id = v_uid and p.status <> 'locked';

  delete from public.pool_participants pp
  using public.pools p
  where pp.pool_id = p.id and pp.user_id = v_uid and p.status <> 'locked';

  -- Locked pools: keep order lines for the host, de-identified
  update public.item_claims c
  set user_name = 'Deleted neighbor', avatar_color = '#94A3B8', updated_at = now()
  from public.pools p
  where c.pool_id = p.id and c.user_id = v_uid and p.status = 'locked';

  update public.pool_participants pp
  set user_name = 'Deleted neighbor',
      neighborhood = '',
      avatar_color = '#94A3B8',
      updated_at = now()
  from public.pools p
  where pp.pool_id = p.id and pp.user_id = v_uid and p.status = 'locked';

  -- Wishlist requests by the caller, and the caller's pledges on others
  update public.pools p
  set wishlist = coalesce((
        select jsonb_agg(
          jsonb_set(
            w,
            '{pledgedUserIds}',
            coalesce((
              select jsonb_agg(x)
              from jsonb_array_elements(coalesce(w -> 'pledgedUserIds', '[]'::jsonb)) x
              where x #>> '{}' is distinct from v_uid
            ), '[]'::jsonb)
          )
        )
        from jsonb_array_elements(p.wishlist) w
        where w ->> 'requestedByUserId' is distinct from v_uid
      ), '[]'::jsonb),
      updated_at = now()
  where p.id = any(v_pool_ids)
    and jsonb_typeof(p.wishlist) = 'array';

  delete from public.user_profiles where user_id = v_uid;

  -- Finally remove the Supabase Auth user (sessions and identities cascade).
  delete from auth.users where id = v_uid::uuid;

  return jsonb_build_object('ok', true, 'hostedPoolsDeleted', v_hosted_deleted);
end;
$$;

-- ============================================================================
-- 9. Row-Level Security (Member-Scoped Read, RPC-Enforced Mutations)
-- ============================================================================

alter table public.user_profiles enable row level security;
alter table public.pools enable row level security;
alter table public.pool_participants enable row level security;
alter table public.catalog_items enable row level security;
alter table public.item_claims enable row level security;
alter table public.pool_messages enable row level security;

-- Drop any legacy open or blanket-deny policies
drop policy if exists "Allow public read/write on pools" on public.pools;
drop policy if exists "Allow public read/write on pool_participants" on public.pool_participants;
drop policy if exists "Allow public read/write on catalog_items" on public.catalog_items;
drop policy if exists "Allow public read/write on item_claims" on public.item_claims;
drop policy if exists "Allow public read/write on pool_messages" on public.pool_messages;

drop policy if exists "Pool members can read pools" on public.pools;
drop policy if exists "Pool members can read participants" on public.pool_participants;
drop policy if exists "Pool members can read catalog items" on public.catalog_items;
drop policy if exists "Pool members can read item claims" on public.item_claims;
drop policy if exists "Pool members can read pool messages" on public.pool_messages;
drop policy if exists "Users can read and update own profile" on public.user_profiles;

-- Only authenticated members of a pool can read that pool's rows (including pickup address & porch PIN)
create policy "Pool members can read pools"
  on public.pools for select
  to authenticated
  using (public.is_pool_member(id, (select auth.uid())::text));

create policy "Pool members can read participants"
  on public.pool_participants for select
  to authenticated
  using (public.is_pool_member(pool_id, (select auth.uid())::text));

create policy "Pool members can read catalog items"
  on public.catalog_items for select
  to authenticated
  using (public.is_pool_member(pool_id, (select auth.uid())::text));

create policy "Pool members can read item claims"
  on public.item_claims for select
  to authenticated
  using (public.is_pool_member(pool_id, (select auth.uid())::text));

create policy "Pool members can read pool messages"
  on public.pool_messages for select
  to authenticated
  using (public.is_pool_member(pool_id, (select auth.uid())::text));

create policy "Users can read and update own profile"
  on public.user_profiles for select
  to authenticated
  using (user_id = (select auth.uid())::text);

-- Revoke direct unguarded table mutations from anon and authenticated;
-- all writes go through transactional SECURITY DEFINER RPCs that enforce roles and locks.
revoke all on public.user_profiles, public.pools, public.pool_participants,
  public.catalog_items, public.item_claims, public.pool_messages
  from public, anon;

revoke insert, update, delete, truncate on public.user_profiles, public.pools,
  public.pool_participants, public.catalog_items, public.item_claims, public.pool_messages
  from authenticated;

grant select on public.user_profiles, public.pools, public.pool_participants,
  public.catalog_items, public.item_claims, public.pool_messages
  to authenticated;

revoke execute on function public.claim_item_share(text, text, text, text, text, text, integer) from public, anon;
revoke execute on function public.apply_pool_action_rpc(text, jsonb) from public, anon;
revoke execute on function public.join_pool_by_invite(text, text, text, text) from public, anon;
revoke execute on function public.create_pool_with_catalog(jsonb) from public, anon;
revoke execute on function public.upsert_my_profile(text, text, text) from public, anon;
revoke execute on function public.delete_my_account() from public, anon;

-- Internal helpers are called only from SECURITY DEFINER RPCs (run as owner).
-- is_pool_member stays executable by `authenticated` because RLS policies call it.
revoke execute on function public.require_authenticated_uid() from public, anon, authenticated;
revoke execute on function public.is_pool_host_user(text, text) from public, anon, authenticated;
revoke execute on function public.recompute_pool_order_summary(text) from public, anon, authenticated;
revoke execute on function public.is_pool_member(text, text) from public, anon;
grant execute on function public.is_pool_member(text, text) to authenticated;

grant execute on function public.claim_item_share(text, text, text, text, text, text, integer) to authenticated;
grant execute on function public.apply_pool_action_rpc(text, jsonb) to authenticated;
grant execute on function public.join_pool_by_invite(text, text, text, text) to authenticated;
grant execute on function public.create_pool_with_catalog(jsonb) to authenticated;
grant execute on function public.upsert_my_profile(text, text, text) to authenticated;
grant execute on function public.delete_my_account() to authenticated;

-- 10. Enable Supabase Realtime on all 5 pool tables
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
