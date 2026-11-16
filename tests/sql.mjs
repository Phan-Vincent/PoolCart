// Applies supabase/schema.sql to a real (WASM) Postgres via PGlite with minimal
// Supabase stubs (auth schema, roles, realtime publication), then exercises
// public.delete_my_account() and public.apply_pool_action_rpc() against seeded data.
import { PGlite } from '@electric-sql/pglite';
import fs from 'node:fs';
import assert from 'node:assert/strict';

const schemaPath = process.argv[2] || new URL('../supabase/schema.sql', import.meta.url);
const db = new PGlite();

await db.exec(`
  create role anon; create role authenticated;
  create schema auth;
  create table auth.users (id uuid primary key, email text);
  create or replace function auth.uid() returns uuid language sql stable as
    $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
  create or replace function auth.jwt() returns jsonb language sql stable as
    $$ select jsonb_build_object('email', current_setting('request.jwt.claim.email', true)) $$;
  create publication supabase_realtime;
`);

const sql = fs.readFileSync(schemaPath, 'utf8');
await db.exec(sql);
// Applying twice must also work (the migration is meant to be re-runnable).
await db.exec(sql);
console.log('schema.sql applied twice without errors');

const A = '00000000-0000-0000-0000-00000000000a';
const B = '00000000-0000-0000-0000-00000000000b';
const C = '00000000-0000-0000-0000-00000000000c';
const pool = (id, code, host, status) => `
  insert into public.pools (id, join_code, title, supplier_name, supplier_badge, category, host_user_id, host_name,
    neighborhood, pickup_address, pickup_window, cutoff_time, status, wishlist)
  values ('${id}', '${code}', 't', 's', 'b', 'c', '${host}', 'h', 'n', 'addr', 'w', 'cut', '${status}', '[]');
  insert into public.catalog_items (id, pool_id, name, category, mode, unit_label, unit_price, retail_price)
  values ('${id}_item', '${id}', 'Rice', 'Staples', 'individual', 'bag', 10, 15);
`;
const member = (poolId, uid, name, isHost = false) => `
  insert into public.pool_participants (pool_id, user_id, user_name, is_host) values ('${poolId}', '${uid}', '${name}', ${isHost});
`;
const claim = (poolId, uid, name) => `
  insert into public.item_claims (pool_id, item_id, user_id, user_name, avatar_color, quantity)
  values ('${poolId}', '${poolId}_item', '${uid}', '${name}', '#111', 2);
`;
const msg = (id, poolId, uid) => `
  insert into public.pool_messages (id, pool_id, user_id, user_name, text, created_at_label)
  values ('${id}', '${poolId}', '${uid}', 'x', 'hello', 'now');
`;

await db.exec(`
  insert into auth.users (id, email) values ('${A}', 'a@x.test'), ('${B}', 'b@x.test'), ('${C}', 'c@x.test');
  insert into public.user_profiles (user_id, display_name) values ('${A}', 'A'), ('${B}', 'B'), ('${C}', 'C');
  ${pool('p1', 'P-1', A, 'open')} ${member('p1', A, 'A', true)} ${member('p1', B, 'B')} ${claim('p1', B, 'B')}
  ${pool('p2', 'P-2', C, 'open')} ${member('p2', C, 'C', true)} ${member('p2', B, 'B')} ${claim('p2', B, 'B')} ${claim('p2', C, 'C')}
  ${pool('p3', 'P-3', C, 'locked')} ${member('p3', C, 'C', true)} ${member('p3', B, 'B')} ${claim('p3', B, 'B')}
  ${msg('m1', 'p2', B)} ${msg('m2', 'p2', C)} ${msg('m3', 'p3', B)}
  update public.pools set wishlist = '[
    {"id":"w1","requestedByUserId":"${B}","pledgedUserIds":["${C}"]},
    {"id":"w2","requestedByUserId":"${C}","pledgedUserIds":["${B}","${C}"]}
  ]'::jsonb where id = 'p2';
`);

const asUser = async (uid, fn) => {
  await db.exec(`select set_config('request.jwt.claim.sub', '${uid}', false)`);
  return fn();
};
const q = async (s) => (await db.query(s)).rows;

// Verify Track 3: RPC validation and settlement invalidation parity on p2 before account deletion
await asUser(C, async () => {
  // Reject negative receipt fees and >2 decimal prices
  await assert.rejects(
    () => db.query(`select public.apply_pool_action_rpc('p2', '{"type":"receipt","trueUp":{"taxOrBagFee":-3}}'::jsonb)`),
    /Receipt fees must be a non-negative amount/
  );
  await assert.rejects(
    () => db.query(`select public.apply_pool_action_rpc('p2', '{"type":"price","itemId":"p2_item","price":4.567}'::jsonb)`),
    /at most two decimal places/
  );
  // Reject malformed wishlist request
  await assert.rejects(
    () => db.query(`select public.apply_pool_action_rpc('p2', '{"type":"request","wish":{"title":"","targetCaseSize":4,"estimatedUnitPrice":5,"estimatedRetailPrice":6}}'::jsonb)`),
    /Wishlist title is required/
  );
  await assert.rejects(
    () => db.query(`select public.apply_pool_action_rpc('p2', '{"type":"request","wish":{"title":"Honey","targetCaseSize":1,"estimatedUnitPrice":5,"estimatedRetailPrice":6}}'::jsonb)`),
    /between 2 and 1000/
  );

  // Valid wishlist request + promote with deterministic newItemId invalidates prior settlement state
  await db.exec(`update public.pool_participants set paid_status = 'paid', settled_amount = 20, picked_up = true where pool_id = 'p2' and user_id = '${C}'`);
  await db.query(`select public.apply_pool_action_rpc('p2', '{"type":"request","wish":{"id":"w_honey","title":"Honey","targetCaseSize":4,"estimatedUnitPrice":10,"estimatedRetailPrice":14}}'::jsonb)`);
  await db.query(`select public.apply_pool_action_rpc('p2', '{"type":"promote","wishId":"w_honey","newItemId":"p2_honey_item"}'::jsonb)`);
  const promoted = await q(`select id from public.catalog_items where id = 'p2_honey_item'`);
  assert.equal(promoted.length, 1, 'promote uses caller-supplied newItemId');
  const hostPart = (await q(`select paid_status, settled_amount, picked_up from public.pool_participants where pool_id = 'p2' and user_id = '${C}'`))[0];
  assert.deepEqual(hostPart, { paid_status: 'pending', settled_amount: null, picked_up: false }, 'promote invalidates settlement state');

  // Trim partial case on p2_honey_item removes the 1 remainder unit and keeps wishlist clean for deletion test
  await db.exec(`update public.pool_participants set paid_status = 'paid', settled_amount = 20, picked_up = true where pool_id = 'p2' and user_id = '${C}'`);
  await db.query(`select public.apply_pool_action_rpc('p2', '{"type":"trim","itemId":"p2_honey_item"}'::jsonb)`);
  const hostAfterTrim = (await q(`select paid_status, settled_amount, picked_up from public.pool_participants where pool_id = 'p2' and user_id = '${C}'`))[0];
  assert.deepEqual(hostAfterTrim, { paid_status: 'pending', settled_amount: null, picked_up: false }, 'trim invalidates settlement state');
  await db.exec(`delete from public.catalog_items where id = 'p2_honey_item'`);
  await db.exec(`update public.pools set wishlist = '[
    {"id":"w1","requestedByUserId":"${B}","pledgedUserIds":["${C}"]},
    {"id":"w2","requestedByUserId":"${C}","pledgedUserIds":["${B}","${C}"]}
  ]'::jsonb where id = 'p2'`);
});

// Catalog inserts must remain loadable by validatePool, even for direct member RPC calls.
await asUser(B, async () => {
  const action = (payload) => db.query('select public.apply_pool_action_rpc($1, $2::jsonb)', ['p2', JSON.stringify(payload)]);
  const base = { id: 'invalid_catalog', name: 'Member rice', unitLabel: 'bag', mode: 'individual', unitPrice: 10, retailPrice: 15, claims: [] };
  const before = await q("select id from public.catalog_items where pool_id = 'p2' order by id");
  const invalid = [
    [{ mode: 'case_split' }, /Shares per case must be a whole number between 2 and 1000/],
    [{ mode: 'case_split', caseSize: 5000 }, /Shares per case must be a whole number between 2 and 1000/],
    [{ unitPrice: 1.005 }, /Wholesale unit price must use at most two decimal places/],
    [{ unitPrice: 5000000 }, /Wholesale unit price must be a finite number between 0.01 and 1000000/],
    [{ id: '' }, /Item ID is required/],
    [{ id: '   ' }, /Item ID is required/],
    [{ mode: 'case_split', caseSize: 2.5 }, /Shares per case must be a whole number between 2 and 1000/],
    [{ mode: 'case_split', caseSize: 6, maxCases: 0 }, /Maximum cases must be a whole number between 1 and 1000/],
    [{ mode: 'case_split', caseSize: 6, maxCases: 1.5 }, /Maximum cases must be a whole number between 1 and 1000/],
    [{ mode: 'other' }, /Invalid item mode/],
    [{ name: ' ' }, /Each item needs a name and unit label/],
    [{ unitLabel: ' ' }, /Each item needs a name and unit label/],
    ...['unitPrice', 'retailPrice'].flatMap((key) => [undefined, null, '10', 0, 0.001, 1000001, 1.005].map((value) => [
      { [key]: value }, new RegExp(`${key === 'unitPrice' ? 'Wholesale' : 'Retail'} unit price must`),
    ])),
    ...[0, -1, 1.5, 1000001, null, '2'].map((quantity) => [
      { claims: [{ userId: B, quantity }] }, /Claim quantity must be a whole number between 1 and 1000000/,
    ]),
  ];
  for (const [patch, message] of invalid) {
    await assert.rejects(() => action({ type: 'addItems', items: [{ ...base, ...patch }] }), message);
  }
  await assert.rejects(() => action({ type: 'reorder', receipt: { items: [
    { ...base, name: ' ', unitLabel: ' ', unitPrice: 1.005, quantity: 1 },
  ] } }), /Each item needs a name and unit label/);
  // Reorder uses the same item helper, rather than relying on addItems validation.
  for (const [patch, message] of invalid.filter(([patch]) => !('id' in patch) && !('claims' in patch))) {
    await assert.rejects(() => action({ type: 'reorder', receipt: { items: [{ ...base, ...patch, quantity: 1 }] } }), message);
  }
  for (const quantity of [0, -1, 2.5, 1000001, null, '2']) {
    await assert.rejects(() => action({ type: 'reorder', receipt: { items: [{ ...base, quantity }] } }),
      /Reorder quantity must be a positive whole number between 1 and 1000000/);
  }
  assert.deepEqual(await q("select id from public.catalog_items where pool_id = 'p2' order by id"), before,
    'rejected member payloads leave no catalog rows behind');

  await action({ type: 'addItems', items: [
    { ...base, id: 'member_individual', name: ' Member rice ', unitLabel: ' bag ', claims: [{ userId: B, quantity: 1 }] },
    { ...base, id: 'member_case', name: ' Member apples ', unitLabel: ' share ', mode: 'case_split', caseSize: 6, maxCases: 2, claims: [{ userId: B, quantity: 1 }] },
  ] });
  assert.deepEqual(await q("select id, name, unit_label, case_size, max_cases from public.catalog_items where id in ('member_individual', 'member_case') order by id"), [
    { id: 'member_case', name: 'Member apples', unit_label: 'share', case_size: 6, max_cases: 2 },
    { id: 'member_individual', name: 'Member rice', unit_label: 'bag', case_size: null, max_cases: null },
  ]);
  assert.deepEqual(await q("select item_id, quantity from public.item_claims where item_id in ('member_individual', 'member_case') and user_id = '" + B + "' order by item_id"), [
    { item_id: 'member_case', quantity: 1 }, { item_id: 'member_individual', quantity: 1 },
  ]);
  await action({ type: 'reorder', receipt: { items: [{ ...base, quantity: 2 }] } });
  assert.equal((await q("select quantity from public.item_claims where item_id = 'member_individual' and user_id = '" + B + "'"))[0].quantity, 3,
    'valid reorder adds to an existing own claim');
  await action({ type: 'reorder', receipt: { items: [{ ...base, name: ' Reordered beans ', unitLabel: ' tin ', quantity: 2 }] } });
  assert.deepEqual(await q("select name, unit_label from public.catalog_items where pool_id = 'p2' and name = 'Reordered beans'"),
    [{ name: 'Reordered beans', unit_label: 'tin' }], 'valid reorder creates a trimmed catalog item');
  // Keep the existing account-deletion fixture and its exact row counts intact.
  await db.exec("delete from public.catalog_items where pool_id = 'p2' and id <> 'p2_item'");
});
console.log('member catalog validation: all checks passed');

// Pool creation uses the same rules and rolls back the pool if an item or initial claim is invalid.
await asUser(C, async () => {
  const base = { id: 'catalog_pool', joinCode: 'CATALOG-POOL', title: 'Catalog test', minimumOrderAmount: 10, freeDeliveryThreshold: 20 };
  const item = { id: 'created_item', name: ' Created rice ', unitLabel: ' bag ', mode: 'individual', unitPrice: 1, retailPrice: 2 };
  const create = (items) => db.query('select public.create_pool_with_catalog($1::jsonb)', [JSON.stringify({ ...base, items })]);
  await assert.rejects(() => create([{ ...item, mode: 'case_split' }]), /Shares per case must be a whole number between 2 and 1000/);
  await assert.rejects(
    () => create([{ ...item, mode: 'case_split', caseSize: 4, maxCases: 1, claims: [{ userId: C, quantity: 5 }] }]),
    /This item has reached its case cap/
  );
  await assert.rejects(
    () => create([{ ...item, claims: [{ userId: C, quantity: 0 }] }]),
    /Claim quantity must be a whole number between 1 and 1000000/
  );
  await assert.rejects(
    () => create([{ ...item, claims: [{ userId: B, quantity: 1 }] }]),
    /An added item can only contain your own claim/
  );
  assert.equal((await q("select id from public.pools where id = 'catalog_pool'")).length, 0);
  await create([item]);
  assert.deepEqual(await q("select name, unit_label from public.catalog_items where id = 'created_item'"), [{ name: 'Created rice', unit_label: 'bag' }]);
  await db.exec("delete from public.pools where id = 'catalog_pool'");
});

// Unauthenticated callers are rejected.
await db.exec(`select set_config('request.jwt.claim.sub', '', false)`);
await assert.rejects(() => db.query('select public.delete_my_account()'), /Authentication required/);

// Delete B (member of p1/p2/p3, host of nothing)
const resB = await asUser(B, () => db.query('select public.delete_my_account() as r'));
assert.equal(resB.rows[0].r.hostedPoolsDeleted, 0);
assert.equal((await q(`select 1 from auth.users where id = '${B}'`)).length, 0, 'auth user removed');
assert.equal((await q(`select 1 from public.user_profiles where user_id = '${B}'`)).length, 0, 'profile removed');
assert.equal((await q(`select 1 from public.pool_messages where user_id = '${B}'`)).length, 0, 'messages removed');
assert.equal((await q(`select 1 from public.pool_messages where user_id = '${C}'`)).length, 1, 'others keep messages');
assert.equal((await q(`select 1 from public.item_claims where user_id = '${B}' and pool_id in ('p1','p2')`)).length, 0, 'open-pool claims removed');
assert.equal((await q(`select 1 from public.pool_participants where user_id = '${B}' and pool_id in ('p1','p2')`)).length, 0, 'open-pool membership removed');
const locked = await q(`select user_name, quantity from public.item_claims where user_id = '${B}' and pool_id = 'p3'`);
assert.deepEqual(locked, [{ user_name: 'Deleted neighbor', quantity: 2 }], 'locked-pool order line kept, de-identified');
assert.equal((await q(`select user_name from public.pool_participants where user_id = '${B}' and pool_id = 'p3'`))[0].user_name, 'Deleted neighbor');
const wl = (await q(`select wishlist from public.pools where id = 'p2'`))[0].wishlist;
assert.deepEqual(wl, [{ id: 'w2', requestedByUserId: C, pledgedUserIds: [C] }], 'wishlist request and pledge stripped');
assert.equal((await q(`select 1 from public.item_claims where user_id = '${C}' and pool_id = 'p2'`)).length, 1, 'other members untouched');

// Delete A (host of p1): p1 and its children are gone
const resA = await asUser(A, () => db.query('select public.delete_my_account() as r'));
assert.equal(resA.rows[0].r.hostedPoolsDeleted, 1);
assert.equal((await q(`select 1 from public.pools where id = 'p1'`)).length, 0);
assert.equal((await q(`select 1 from public.catalog_items where pool_id = 'p1'`)).length, 0);
assert.equal((await q(`select 1 from public.pools where id in ('p2','p3')`)).length, 2, 'other pools kept');

// Internal helpers are not callable through the API; RLS helper only for signed-in users
const priv = async (role, fn) => (await q(`select has_function_privilege('${role}', '${fn}', 'execute') as ok`))[0].ok;
for (const fn of ['public.validate_catalog_item_payload(jsonb, boolean)', 'public.require_authenticated_uid()', 'public.is_pool_host_user(text, text)', 'public.recompute_pool_order_summary(text)']) {
  assert.equal(await priv('anon', fn), false, `anon must not execute ${fn}`);
  assert.equal(await priv('authenticated', fn), false, `authenticated must not execute ${fn}`);
}
assert.equal(await priv('anon', 'public.is_pool_member(text, text)'), false);
assert.equal(await priv('authenticated', 'public.is_pool_member(text, text)'), true);

// Grants: only authenticated may execute
const grants = await q(`select grantee from information_schema.role_routine_grants
  where routine_name = 'delete_my_account' and grantee in ('anon','authenticated','PUBLIC')`);
assert.deepEqual(grants.map((g) => g.grantee).sort(), ['authenticated']);

console.log('delete_my_account and apply_pool_action_rpc: all checks passed');
