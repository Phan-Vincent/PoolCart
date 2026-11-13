# PoolCart — Neighborhood Grocery Group-Buy (Local Demo & Authenticated Cloud Sync)

Expo / React Native / TypeScript application for neighborhood wholesale orders and bulk-case shares. Supports both **local single-device demonstration mode** and an **authenticated Supabase cloud sync path** backed by member-scoped Row-Level Security (RLS) and transactional PostgreSQL RPCs.

## Working journeys

- Browse sample/local pools in local mode or connect to a Supabase project with an authenticated session to join and host shared cloud pools.
- Use invite codes (`join_pool_by_invite` in cloud mode) or incoming `poolcart://join/CODE` links, and create pools from supplier templates or rerun existing catalogs.
- Order direct units, claim case shares with caps, search/filter products, request wishlist items, and promote pledges into catalog claims.
- Resolve partial cases by covering the remainder or dropping pending shares. Lock only a complete order that meets its supplier minimum.
- Paste catalog rows and explicit per-unit receipt text; review parse errors and matches before applying.
- Reconcile actual prices and fees, inspect per-neighbor totals, export supplier order text, and record porch status/pickup.
- Open Venmo separately for the active user's finalized share. Only the host can manually confirm receipt of payment; opening a link never marks a payment received.
- Simulate card authorization and capture in local demo mode with explicitly separate **demo** statuses (`demo_authorized`, `demo_paid`) that move no funds and are never persisted as cloud payment records.
- Reorder sample history and rerun a catalog with a newly entered schedule and clean transactional state (`claims: []`, cleared `trueUp`, `porchCheckIn`, `wishlist`, `actualUnitPrice`, and settlement statuses).

## Accounting rules

Only direct items and completed-case units count toward supplier thresholds, invoices, and payable amounts. Pending units remain visible but are not payable. Completed units are allocated by **claim-entry order** (`claim_seq` in PostgreSQL). Dropping a partial case removes claims from the end of that same order. Reordering is atomic: a cap violation rejects the whole action.

Delivery is divided across participants with committed units. Receipt fees are proportional to committed merchandise. Largest-remainder allocation assigns exact cents, with participant ID breaking ties. Prices require positive finite values with at most two decimals; fees cannot be negative. Reported savings include delivery and receipt fees and may therefore be negative.

Changing quantities, allocation, prices, or an amount due invalidates affected hold/payment records and pickup status. Receipt adjustments may be made after locking; settlement checks the current committed minimum and absence of partial cases.

## Persistence, Cloud Architecture & Migration

- **Local Storage**: Full pool objects are stored in AsyncStorage via a serialized write queue. Unreadable or invalid stored pool data is not silently overwritten with fixtures.
- **Authenticated Cloud Sync**:
  - Cloud identity is derived strictly from the authenticated Supabase session (`auth.uid()`) and server-side `user_profiles` / `pool_participants` records—never from caller-supplied demo user IDs, names, `isHost`, or `verifiedAuth` flags.
  - Demo profile switching and simulated card holds are confined to local demo mode.
  - Sample fixtures (`INITIAL_POOLS`) are never uploaded automatically when connecting to a cloud project or encountering an empty database.
  - Distinguishes `local_mode`, `auth_required`, `empty_cloud`, `synced`, `auth_rejected`, `network_unavailable`, and `schema_or_query_error`, preserving unsaved local edits in `@poolcart_pending_cloud_edits_v1` for explicit retry rather than silently presenting rejected changes as cloud success.
  - Persists and reloads rich domain state (`host_user_id`, `distance_miles`, `true_up`, `porch_check_in`, `wishlist`, `actual_unit_price`, `settled_amount`, `claim_seq`, and `pool_messages`).
- **Non-Destructive SQL Migration (`supabase/schema.sql`)**:
  - Retains `text` primary keys (`pools.id`, `pool_participants.user_id`, `catalog_items.id`) for backward compatibility with existing records and adds rich domain columns via `ALTER TABLE ... ADD COLUMN IF NOT EXISTS`.
  - Enforces member-only `SELECT` policies (`public.is_pool_member`) so non-members cannot read unrelated pools, pickup addresses, or porch gate PINs.
  - Revokes direct client `INSERT`/`UPDATE`/`DELETE` on tables and routes all mutations through transactional `SECURITY DEFINER` RPCs (`upsert_my_profile`, `join_pool_by_invite`, `create_pool_with_catalog`, `claim_item_share`, `apply_pool_action_rpc`) using `FOR UPDATE` row locks.

## Integration boundaries

No real payment processor (Stripe/Venmo API), third-party SMS/email OTP provider beyond standard Supabase Auth password/email session support, camera OCR, push notification transport, background reminder scheduler, or QR image encoder is connected. Review and test `supabase/schema.sql` in a staging Supabase environment before applying to any production project.

## Store builds

Builds with `EXPO_PUBLIC_SUPABASE_URL` and `EXPO_PUBLIC_SUPABASE_ANON_KEY` set are store builds. They connect only to that backend and open on a sign-in screen. Sample pools, demo profiles, simulated card holds, and the editable backend form are all hidden. Signed-in users can delete their account in-app (`delete_my_account` RPC). Builds without those variables keep the local demo. See [docs/STORE-SUBMISSION.md](docs/STORE-SUBMISSION.md) for the release runbook, and `public/privacy.html` for the privacy policy, served at `/privacy` by the web export.

## Development and validation

```sh
npm test
npm run test:sql   # applies supabase/schema.sql to an in-process Postgres (PGlite) and tests account deletion
npm run typecheck
npm run build:web
```

`npm test` runs domain, math, parser, storage write-queue, behavioral rerun callback, rich-field round-trip, and stateful SQL/RPC authorization & concurrency simulation tests. These tests run in Node without starting a live PostgreSQL instance, browser, or external network connection.
