PoolCart QA via school GPT-6 Astra, High

Verdict: the reviewed source is not ready for real shared orders or settlement. The school review produced 12 prioritized findings. Five selected defects were independently reproduced with local fixtures; other findings have the evidence levels described below.

Task: `task-db7cf682a931`. School workspace: California State University, San Bernardino EDU. Work mode, GPT-6 Astra and High were visibly verified immediately before submission. [School review](https://chatgpt.com/c/6af3dc1e-ee68-83e8-b915-22e5471069c6).

Scope: 19 source/configuration/documentation files, plus the working-tree diff, frozen at the UTC timestamp in `manifest.json`. Source upload was explicitly approved by the user. No environment files, credentials, or installed dependencies were uploaded. Original rendered response is preserved in `school-review.txt`; the full rendered conversation is in `school-chat-rendered.txt`.

Provenance caveat: the school UI selected GPT-6 Astra High, but the response self-identifies as “Codex (/root); exact model identifier not exposed.” The report preserves this discrepancy. The UI configuration was verified; the underlying execution model cannot be independently attested from the returned text.

Supervisor verification

| Finding | Evidence | Result |
| --- | --- | --- |
| Pending shares incorrectly unlock supplier thresholds and are charged despite exclusion from the supplier order | Executed frozen calculations | $290 committed + $15 pending unlocks a $300 threshold; supplier invoice displays $290; participant due is $305; applying the configured delivery rule to the actual merchandise yields $314. |
| Case rollover misclassifies committed shares as pending | Executed frozen calculations | Seven $3 shares in a six-unit case produce $18 committed at pool level but $0 committed/$21 pending in the participant ledger. |
| Delivery shares do not reconcile in cents | Executed frozen calculations | $20 delivery split three ways produces a displayed aggregate one cent above the supplier invoice. |
| Opening Venmo marks a participant paid without confirming payment | Executed ledger callback with native navigation mocked | Merely resolving `openURL` invokes the paid callback. No payment completion event was supplied. |
| Rejected atomic RPC falls back to an unrestricted absolute write | Executed repository with Supabase mocked | A “Pool is locked” RPC error triggers participant and claim upserts and returns no error. |
| Public policies and caller-supplied identity do not enforce pool membership/host boundaries | Supervisor source inspection | All five RLS policies use unconditional predicates; RPC identity is supplied by the caller. Deployed database grants were not inspected. |
| First claim RPC computes zero when no claim row exists | Supervisor source inspection plus primary PostgreSQL documentation | `SELECT ... INTO` assigns null for no row; `GREATEST(0, null + delta)` returns zero. Database execution remains outstanding. |
| Existing-schema upgrade omits the new `max_cases` column | Supervisor source inspection | Column exists only inside `CREATE TABLE IF NOT EXISTS`; there is no corresponding `ALTER TABLE` migration. Fresh/upgrade execution remains outstanding. |

Reproduce the five local defect fixtures with:

```sh
node qa/2026-11-10-school-astra-high/verify-snapshot.cjs
```

`verification.json` contains the measured outputs. The runner reads the frozen bundle directly and mocks platform/Supabase dependencies; it makes no network requests, real payments, or database writes. Its successful assertions confirm the described defects, not application readiness. `npm run typecheck` passed both before submission and after the review.

Current working-tree drift

Three supplied files changed during the school review: `App.tsx`, `src/components/ActionModals.tsx`, and `src/components/CatalogItemCard.tsx`. Full snapshot hashes are in `manifest.json`; `drift.json` records the comparison. The five executed reproduction targets (`calculations.ts`, `SplitLedgerView.tsx`, and `repository.ts`) and the inspected SQL file were unchanged at the final comparison.

The latest `App.tsx` now imports/calls the atomic transition and RPC helpers, and mounts the notification modal. Accordingly, the original school findings that those features are completely disconnected are superseded for the latest working tree. This does not resolve the unchanged SQL first-claim defect or RPC error fallback. The latest claim handler also discards the returned `rpcResult` and generates local alerts before the backend acknowledges the mutation; that reconciliation path warrants follow-up QA.

The original review also flags partial-case deletion/reinsert races, hidden sync failures/local-to-cloud data loss, stale weekly rerun host/payment details, numeric validation gaps, unreliable invite redemption, and accessibility gaps. These retain their original source-review status; they were not all independently reproduced. The notification finding should now be limited to absent native push/background scheduling and any remaining integration gaps, rather than an absent in-app feed. The three changed files have not received a complete second Astra review.

Recommended fix order: enforce identity/membership/host permissions; repair and migrate the first-claim RPC; fail closed on RPC rejection and reconcile authoritative results; correct order/ledger accounting and payment confirmation; make partial resolution and persistence transactional. Then re-run QA against a stable tree and an isolated database.

Limits: no PostgreSQL binary was available locally. No SQL installation/upgrade, live Supabase authorization/concurrency, Expo build, iOS/Android runtime, payment application, accessibility, or full browser journey was executed. No product source was changed by this QA task; only this QA directory was created. Nothing was committed, pushed, or deployed.

SQL semantics checked against [PostgreSQL SELECT INTO documentation](https://www.postgresql.org/docs/current/plpgsql-statements.html#PLPGSQL-STATEMENTS-SQL-ONEROW) and [GREATEST/LEAST documentation](https://www.postgresql.org/docs/current/functions-conditional.html#FUNCTIONS-GREATEST-LEAST).
