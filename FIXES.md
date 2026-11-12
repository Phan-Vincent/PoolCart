# task-c22542522064 — cloud-preserving revision & rerun fix

Baseline: `45d7c6642b88d6e0a41e6d4835f7426763fc7e53`.
Revision: `cloud-preserving-fixes` (`task-c22542522064`).

## Summary of Revisions

1. **Rerun Defect Fixed (`src/components/ActionModals.tsx`)**:
   - Extracted and fixed `buildCreatedPoolFromForm` so launching a rerun (or new pool) initializes every catalog item with `claims: []` and `actualUnitPrice: undefined`.
   - Preserves catalog item definitions (`name`, `category`, `emoji`, `mode`, `unitLabel`, `unitPrice`, `retailPrice`, `caseSize`, `maxCases`) while clearing all prior claims, receipt `trueUp`, `porchCheckIn`, `wishlist`, and participant payment/pickup statuses.
   - Added behavioral callback regression coverage in `tests/ui.cjs` and `tests/run.cjs` that invokes the form creation callback with a populated source pool and asserts `claims.length === 0` across every created item.

2. **Authenticated Cloud Path & Server-Enforced Membership/Host Roles (`supabase/schema.sql`, `src/services/repository.ts`, `App.tsx`, `src/components/SupabaseSetupCard.tsx`)**:
   - Enabled `CLOUD_SYNC_AVAILABLE = true` with explicit Supabase URL/Anon Key configuration and Supabase Auth session sign-in/sign-up (`signInCloudWithPassword`, `signUpCloudAccount`, `signOutCloud`, `getAuthenticatedCloudUser`).
   - Confined demo profile switching and custom demo profile creation strictly to local demo mode (`saveActiveUser` rejects switching when cloud sync is enabled, and `SupabaseSetupCard` disables demo pills in cloud mode).
   - Derived cloud identity strictly from `auth.uid()` on the server (`public.require_authenticated_uid()`) and server-stored `user_profiles` / `pool_participants` records. Forged `p_user_id` parameters to `claim_item_share` are explicitly rejected at the RPC boundary.
   - Enforced pool membership via `public.is_pool_member(pool_id, auth.uid()::text)` in RLS `SELECT` policies and RPC guards so non-members cannot read unrelated pools, pickup addresses, or porch PINs.
   - Implemented explicit invite-code joining via `public.join_pool_by_invite(p_join_code, ...)` and wired `JoinByCodeModal` and deep-link handling to invoke it in cloud mode.

3. **Full Rich-Field Cloud Persistence & Demo Payment Separation (`supabase/schema.sql`, `src/services/repository.ts`)**:
   - Added non-destructive columns (`host_user_id`, `distance_miles`, `true_up`, `porch_check_in`, `wishlist`, `actual_unit_price`, `settled_amount`, `claim_seq`) to `supabase/schema.sql` using `ALTER TABLE ... ADD COLUMN IF NOT EXISTS`, preserving `text` IDs for legacy compatibility.
   - Implemented `assembleCloudPoolsFromRows` and `sanitizePoolForCloud` in `src/services/repository.ts` to round-trip all rich fields without loss while stripping local-only `demo_authorized` / `demo_paid` / `demoHoldId` fields so simulated card holds are never stored or treated as real cloud payment records.

4. **Transactional Cloud Mutations & Distinct Failure / Pending-Edit Handling (`src/services/repository.ts`, `App.tsx`)**:
   - Removed unsafe delete-all/reinsert claim replacement, unrestricted direct-write fallbacks, and automatic fixture seeding (`INITIAL_POOLS` is never uploaded on connection or when the cloud database is empty).
   - Routed cloud mutations through transactional PostgreSQL RPCs (`create_pool_with_catalog`, `join_pool_by_invite`, `claim_item_share`, `apply_pool_action_rpc`).
   - Distinguished `local_mode`, `auth_required`, `empty_cloud`, `synced`, `auth_rejected`, `network_unavailable`, and `schema_or_query_error`.
   - Preserved rejected or offline local edits in `@poolcart_pending_cloud_edits_v1` (`queuePendingCloudEdit`, `flushPendingCloudEdits`) and surfaced them in the UI rather than silently presenting failed cloud writes as cloud success.

## Validation & Verification Limits

- **Executed Checks**:
  - Expanded regression suite (`node tests/run.cjs`): 46/46 test groups passed (all 37 original groups plus 9 new groups covering behavioral rerun creation, rich-field cloud row round-tripping, empty-cloud non-seeding, distinct cloud error/offline/auth states, pending local edit preservation & retry, and a stateful RPC authorization/concurrency harness testing cross-pool rejection, forged identity rejection, non-host receipt/announcement/lock/settlement rejection, and concurrent last-share case-cap serialization).
  - Full project typecheck (`npm run typecheck`): passed with zero errors against the repository's installed TypeScript/Expo/React Native dependencies.
  - Candidate Expo web bundle export (`npx expo export -p web`): passed cleanly.
- **Unverified Limits**:
  - The RPC authorization and concurrency tests execute against an in-memory transactional Postgres RPC/RLS simulator in Node plus static SQL verification of `supabase/schema.sql`; no live Supabase cloud instance, physical iOS/Android device, or real payment provider was contacted or modified.
