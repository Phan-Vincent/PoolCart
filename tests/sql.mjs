// Applies supabase/schema.sql to a real (WASM) Postgres via PGlite with minimal
// Supabase stubs (auth schema, roles, realtime publication), then exercises
// public.delete_my_account() against seeded data. No network or server needed.
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

// Unauthenticated callers are rejected.
await db.exec(`select set_config('request.jwt.claim.sub', '', false)`);
await assert.rejects(() => db.query('select public.delete_my_account()'), /Authentication required/);

// Delete B (member of p1/p2/p3, host of nothing)
const resB = await asUser(B, () => db.query('select public.delete_my_account() as r'));
assert.equal(resB.rows[0].r.hostedPoolsDeleted, 0);
const q = async (s) => (await db.query(s)).rows;
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
for (const fn of ['public.require_authenticated_uid()', 'public.is_pool_host_user(text, text)', 'public.recompute_pool_order_summary(text)']) {
  assert.equal(await priv('anon', fn), false, `anon must not execute ${fn}`);
  assert.equal(await priv('authenticated', fn), false, `authenticated must not execute ${fn}`);
}
assert.equal(await priv('anon', 'public.is_pool_member(text, text)'), false);
assert.equal(await priv('authenticated', 'public.is_pool_member(text, text)'), true);

// Grants: only authenticated may execute
const grants = await q(`select grantee from information_schema.role_routine_grants
  where routine_name = 'delete_my_account' and grantee in ('anon','authenticated','PUBLIC')`);
assert.deepEqual(grants.map((g) => g.grantee).sort(), ['authenticated']);

console.log('delete_my_account: all checks passed');

// ---------------------------------------------------------------------------
// Chat safety: objectionable-language filter, reports, and blocks
// ---------------------------------------------------------------------------
const D = '00000000-0000-0000-0000-00000000000d';
const E = '00000000-0000-0000-0000-00000000000e';
const F = '00000000-0000-0000-0000-00000000000f';
await db.exec(`
  grant usage on schema auth to authenticated;
  grant execute on function auth.uid() to authenticated;
  insert into auth.users (id, email) values ('${D}', 'd@x.test'), ('${E}', 'e@x.test'), ('${F}', 'f@x.test');
  insert into public.user_profiles (user_id, display_name) values ('${D}', 'D'), ('${E}', 'E'), ('${F}', 'F');
  ${pool('p4', 'P-4', D, 'open')} ${member('p4', D, 'D', true)} ${member('p4', E, 'E')}
  ${pool('p5', 'P-5', F, 'open')} ${member('p5', F, 'F', true)}
  ${msg('m4', 'p4', E)} ${msg('m5', 'p4', D)} ${msg('m6', 'p5', F)}
`);

// Filter: whole words with endings, no false positives inside other words
const filt = async (t) => (await db.query('select public.contains_blocked_terms($1) as b', [t])).rows[0].b;
assert.equal(await filt('this is FUCKING ridiculous'), true);
assert.equal(await filt('what a bitch'), true);
for (const ok of ['spicy salsa from Scunthorpe', 'assorted shiitake', 'Class of 2026', '']) {
  assert.equal(await filt(ok), false, `false positive: ${ok}`);
}
const action = (text) => JSON.stringify({ type: 'message', message: { id: 'mx' + Math.random().toString(36).slice(2, 8), text } });
await assert.rejects(
  () => asUser(E, () => db.query('select public.apply_pool_action_rpc($1, $2::jsonb)', ['p4', action('you shit head')])),
  /isn't allowed/
);
await asUser(E, () => db.query('select public.apply_pool_action_rpc($1, $2::jsonb)', ['p4', action('Who wants to split the rice?')]));

// Reports: members only, not your own message, valid reason, one per message
await assert.rejects(() => asUser(F, () => db.query(`select public.report_pool_message('m4', 'spam')`)), /no longer exists/);
await assert.rejects(() => asUser(E, () => db.query(`select public.report_pool_message('m4', 'spam')`)), /your own message/);
await assert.rejects(() => asUser(D, () => db.query(`select public.report_pool_message('m4', 'because')`)), /reason/);
await asUser(D, () => db.query(`select public.report_pool_message('m4', 'harassment', 'Rude to neighbors')`));
await asUser(D, () => db.query(`select public.report_pool_message('m4', 'harassment')`));
const reports = await q(`select reporter_id, reported_user_id, pool_id, message_text, reason, status from public.content_reports`);
assert.deepEqual(reports, [{ reporter_id: D, reported_user_id: E, pool_id: 'p4', message_text: 'hello', reason: 'harassment', status: 'open' }]);

// Blocks: cannot block yourself; a block hides the blocked person's messages from the blocker only
await assert.rejects(() => asUser(D, () => db.query(`select public.block_user('${D}')`)), /yourself/);
await asUser(D, () => db.query(`select public.block_user('${E}')`));
await asUser(D, () => db.query(`select public.block_user('${E}')`)); // idempotent
const visible = async (uid) => {
  await db.exec(`select set_config('request.jwt.claim.sub', '${uid}', false); set role authenticated;`);
  try { return (await db.query(`select id from public.pool_messages where pool_id = 'p4' order by id`)).rows.map((r) => r.id); }
  finally { await db.exec('reset role'); }
};
assert.deepEqual(await visible(D), ['m5'], 'blocker no longer sees blocked user messages');
assert.ok((await visible(E)).includes('m5'), 'blocked user still sees the pool');
await db.exec(`select set_config('request.jwt.claim.sub', '${D}', false); set role authenticated;`);
try {
  assert.deepEqual((await db.query('select blocked_id from public.user_blocks')).rows, [{ blocked_id: E }]);
  await assert.rejects(() => db.query('select * from public.content_reports'), /permission denied/);
  await assert.rejects(() => db.query(`insert into public.user_blocks values ('${D}', '${F}')`), /permission denied/);
} finally { await db.exec('reset role'); }
await asUser(D, () => db.query(`select public.unblock_user('${E}')`));
assert.ok((await visible(D)).includes('m4'), 'unblocking shows messages again');

// Account deletion removes blocks and reports involving the user
await asUser(D, () => db.query(`select public.block_user('${E}')`));
await asUser(E, () => db.query('select public.delete_my_account()'));
assert.equal((await q(`select 1 from public.user_blocks where blocked_id = '${E}' or blocker_id = '${E}'`)).length, 0);
assert.equal((await q(`select 1 from public.content_reports where reported_user_id = '${E}'`)).length, 0);

for (const fn of ['public.report_pool_message(text, text, text)', 'public.block_user(text)', 'public.unblock_user(text)']) {
  assert.equal(await priv('anon', fn), false, `anon must not execute ${fn}`);
  assert.equal(await priv('authenticated', fn), true, `authenticated may execute ${fn}`);
}
assert.equal(await priv('authenticated', 'public.contains_blocked_terms(text)'), false);

console.log('chat safety (filter, reports, blocks): all checks passed');
