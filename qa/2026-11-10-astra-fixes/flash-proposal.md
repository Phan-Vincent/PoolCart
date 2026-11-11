## Status

No files were changed (read-only worker; the shell refused `npx`/`node tsc` in this non-interactive session, so **typecheck and test execution could not be run here**). What follows is a concrete, apply-ready patch authored against the working tree at `78d1061` as I read it, split into (a) files I can supply complete, (b) exact-replacement hunks, and (c) explicitly deferred items. Everything under "verified" is source inspection; nothing is execution.

## What I verified by reading (not by running)

- `supabase/schema.sql` — first-claim `SELECT … INTO` without `found` handling (L151‑153); no `ALTER TABLE … max_cases` (only inside `CREATE TABLE IF NOT EXISTS`, L44‑57); five `using (true)` policies (L216‑229); RPC identity supplied entirely by caller (`p_user_id`, L94, L143‑148); no `set search_path`, no `REVOKE`; direct table writes granted.
- `src/utils/calculations.ts` — thresholds use `combinedPoolTotal` (committed **+** remainder, L79‑87); per-participant `caseFilled` is item-level not allocation-level (L142‑148) → 7×$3 in a 6-case yields $0 committed / $21 pending in the ledger while the pool shows $18 committed; delivery split is float division (L97‑100) → 2301¢ vs 2300¢; manifest omits the delivery fee the ledger charges (L228‑230).
- `src/services/repository.ts` — RPC error falls through to `syncClaimQuantity` absolute upsert (L501‑506) and returns no error; claims are upserted with caller-supplied `user.id`; `loadPools` seeds `INITIAL_POOLS` into the *cloud* (L250‑253) and overwrites the single local cache key (L333); `msgsRes.error` never checked (L242/L248); `syncItemClaimsList` deletes all claims then re-inserts (L671‑685); `syncNewItem` is two non-transactional writes (L571‑589).
- `src/components/SplitLedgerView.tsx` — any successful `Linking.openURL` invokes `onTogglePaidStatus` (L50‑53); every participant's chip and pay button are live for every viewer (L106‑125, L179‑190); `|| 'PoolCart-Host'` fabricates a recipient (L25).
- `src/components/ActionModals.tsx` — `parseFloat(...) || 5` silently substitutes prices (L46‑49); invite copy promises cross-device discovery from a device-local `pools` array (L494‑502, L537); join never creates membership.
- `App.tsx` — claim handler discards `rpcResult`, writes local state first, fires alerts before the backend accepts (L252‑292); lock toggle has no settlement guard (L438‑452); weekly rerun reuses the previous host/payee and auto-claims item 0 (L376‑436); paid toggle is unguarded (L675‑699).

## Findings → fixes (mapping)

| # | QA finding | Root cause | Fix location |
|---|---|---|---|
| F1 | RPC rejection falls back to absolute write | `if (!error && data) … else syncClaimQuantity` | repository hunk R1 |
| F2 | First claim computes 0 | `SELECT … INTO` leaves NULL, `GREATEST(0, NULL+δ)`=0 | `claim_item_share` rewrite (aggregate `coalesce(sum(...),0)` always yields a row) |
| F3 | Caller-supplied identity, open RLS | `p_user_id` + `using(true)` | schema: `auth.uid()`, membership helper, SELECT-only grants, RPC-only writes |
| F4 | Upgrade omits `max_cases` | column only in `CREATE TABLE` | schema: idempotent `ALTER TABLE … ADD COLUMN IF NOT EXISTS` block |
| F5 | Pending shares unlock thresholds / invoice mismatch | combined total used for min + free delivery; manifest excludes fee | calculations rewrite |
| F6 | Rollover misclassifies committed shares | item-level `caseFilled` | deterministic per-claim capacity allocation |
| F7 | Delivery cents don't reconcile | float `/ activeBuyerCount` | `splitCents` largest-remainder, weights = buyers |
| F8 | Venmo navigation marks paid | callback after `openURL` | SplitLedgerView hunk S1 (navigate only) |
| F9 | Anyone can mark anyone paid/picked up | no role check | SplitLedgerView S1/S2 + App C2 |
| F10 | Cloud seed / cache clobber / hidden errors | `seedSupabasePools(INITIAL_POOLS)`, single key, ignored `msgsRes.error` | repository R3/R4 |
| F11 | Partial trim deletes then re-inserts | `syncItemClaimsList` | repository R5 (RPC) |
| F12 | Invite redemption cannot create membership; invite body leaks local-only codes | local `pools.find` | schema `join_pool_by_code` + ActionModals hunk A3 |
| F13 | Numeric validation gaps | `parseFloat \|\| default` | `validation.ts` + ActionModals hunks |
| F14 | Accessibility | no roles/labels; unbounded slot row | CatalogItemCard hunk K1 |
| F15 | Notification claims | "instant push/countdown" copy | deferred (documentation-only change; see Limits) |

---

## Patch

### 1. NEW `src/utils/money.ts` (complete)

```ts
/** Integer-cent money helpers. All monetary authority is cents. */

export function toCents(value: unknown): number | null {
  const n = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(n) || n < 0) return null;
  const cents = Math.round(n * 100);
  return Number.isSafeInteger(cents) ? cents : null;
}

export function fromCents(cents: number): number {
  return Number.isSafeInteger(cents) ? cents / 100 : 0;
}

export function formatCents(cents: number): string {
  return `$${fromCents(cents).toFixed(2)}`;
}

export function multiplyCents(unitCents: number, quantity: number): number {
  const q = Number.isSafeInteger(quantity) && quantity > 0 ? quantity : 0;
  if (!Number.isSafeInteger(unitCents) || unitCents < 0) return 0;
  const total = unitCents * q;
  return Number.isSafeInteger(total) ? total : 0;
}

/**
 * Splits `totalCents` across `weights` with no loss and no invention.
 * Deterministic: largest remainder first, ties resolved by lower index.
 * Guarantees sum(result) === totalCents when totalCents > 0 and weights sum > 0.
 */
export function splitCents(totalCents: number, weights: readonly number[]): number[] {
  const total = Number.isSafeInteger(totalCents) && totalCents > 0 ? totalCents : 0;
  if (weights.length === 0) return [];
  const safe = weights.map((w) => (Number.isFinite(w) && w > 0 ? Math.floor(w) : 0));
  const weightSum = safe.reduce((a, b) => a + b, 0);
  if (total === 0 || weightSum === 0) return weights.map(() => 0);

  const base = safe.map((w) => Math.floor((total * w) / weightSum));
  let remainder = total - base.reduce((a, b) => a + b, 0);
  const order = safe
    .map((w, index) => ({ index, fraction: (total * w) % weightSum }))
    .sort((a, b) => b.fraction - a.fraction || a.index - b.index);

  for (let i = 0; i < order.length && remainder > 0; i += 1) {
    base[order[i].index] += 1;
    remainder -= 1;
  }
  for (let i = 0; i < base.length && remainder > 0; i += 1) {
    base[i] += 1;
    remainder -= 1;
  }
  return base;
}

export function sumCents(values: readonly number[]): number {
  return values.reduce((sum, v) => sum + (Number.isSafeInteger(v) ? v : 0), 0);
}
```

### 2. `src/utils/calculations.ts` (complete replacement)

```ts
import type {
  CatalogItem,
  GroupBuyPool,
  ParticipantShare,
  UserCostBreakdown,
} from '../types/groupBuy';
import { fromCents, multiplyCents, splitCents, sumCents, toCents } from './money';

const MAX_CASE_SIZE = 1000;
const MAX_CLAIM_QUANTITY = 10000;

export interface CaseSplitStatus {
  totalClaimedUnits: number;
  caseSize: number;
  fullCasesCount: number;
  committedUnits: number;
  remainderUnits: number;
  neededForNextCase: number;
  isFullyMatched: boolean;
}

export interface ClaimAllocation {
  committedUnits: number;
  remainderUnits: number;
  caseSize: number;
  committedByUser: Record<string, number>;
  pendingByUser: Record<string, number>;
}

export interface WholesaleManifestLine {
  itemId: string;
  itemName: string;
  emoji: string;
  mode: 'individual' | 'case_split';
  orderQuantityLabel: string;
  committedUnits: number;
  unfilledRemainderUnits: number;
  neededToFillNextCase: number;
  unitPrice: number;
  lineTotal: number;
  lineTotalCents: number;
}

export interface PoolProgressSummary {
  committedPoolTotal: number;      // orderable merchandise (what the supplier ships)
  pendingCaseTotal: number;        // held remainder of partial cases
  combinedPoolTotal: number;       // committed + held = "claimed interest" (display only)
  committedCents: number;
  pendingCents: number;
  minimumProgressRatio: number;
  freeDeliveryProgressRatio: number;
  amountNeededForMinimum: number;
  amountNeededForFreeDelivery: number;
  isMinimumMet: boolean;
  isFreeDeliveryUnlocked: boolean;
  activeBuyerCount: number;
  currentDeliveryFeePerPerson: number;
  deliveryFeeCents: number;
  deliveryShareCentsByUser: Record<string, number>;
  totalPoolSavings: number;
}

export interface SettlementReadiness {
  canLock: boolean;
  minimumOk: boolean;
  unresolvedPartialItems: number;
  blockers: string[];
}

export function sanitizeQuantity(value: unknown): number {
  const n = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(n) || n <= 0) return 0;
  return Math.min(MAX_CLAIM_QUANTITY, Math.floor(n));
}

export function sanitizeCaseSize(item: CatalogItem): number {
  if (item.mode !== 'case_split') return 1;
  const n = Number(item.caseSize);
  if (!Number.isInteger(n) || n < 2 || n > MAX_CASE_SIZE) return 1;
  return n;
}

export function sanitizeMaxCases(item: CatalogItem): number | null {
  const n = Number(item.maxCases);
  if (item.mode !== 'case_split' || !Number.isInteger(n) || n <= 0) return null;
  return Math.min(n, 1000);
}

function itemUnitCents(item: CatalogItem): number {
  return toCents(item.unitPrice) ?? 0;
}

/**
 * Stable, persisted claim priority: oldest first, ties broken by user id so every
 * client (and the server) reaches the same full-case allocation. Claims without a
 * timestamp sort after timestamped claims (they are the newest).
 */
function orderedClaims(item: CatalogItem): ParticipantShare[] {
  return [...item.claims].sort((a, b) => {
    const ta = a.createdAt ?? '\uffff';
    const tb = b.createdAt ?? '\uffff';
    if (ta !== tb) return ta < tb ? -1 : 1;
    return a.userId < b.userId ? -1 : a.userId > b.userId ? 1 : 0;
  });
}

/**
 * Allocates full-case capacity to claims in priority order. Only quantity that
 * fits inside a completed case is "committed"; the trailing remainder is "pending".
 * This is what stops a full-case share from being charged while still pending.
 */
export function allocateItemClaims(item: CatalogItem): ClaimAllocation {
  const caseSize = sanitizeCaseSize(item);
  const ordered = orderedClaims(item);
  const total = ordered.reduce((s, c) => s + sanitizeQuantity(c.quantity), 0);
  const committedUnits = caseSize > 1 ? Math.floor(total / caseSize) * caseSize : total;
  const committedByUser: Record<string, number> = {};
  const pendingByUser: Record<string, number> = {};
  let capacity = committedUnits;

  for (const claim of ordered) {
    const qty = sanitizeQuantity(claim.quantity);
    const committed = Math.min(capacity, qty);
    capacity -= committed;
    committedByUser[claim.userId] = (committedByUser[claim.userId] ?? 0) + committed;
    pendingByUser[claim.userId] = (pendingByUser[claim.userId] ?? 0) + (qty - committed);
  }

  return {
    committedUnits,
    remainderUnits: total - committedUnits,
    caseSize,
    committedByUser,
    pendingByUser,
  };
}

export function getCaseSplitStatus(item: CatalogItem): CaseSplitStatus {
  const allocation = allocateItemClaims(item);
  const totalClaimedUnits = allocation.committedUnits + allocation.remainderUnits;
  const caseSize = allocation.caseSize;
  if (caseSize <= 1) {
    return {
      totalClaimedUnits,
      caseSize: 1,
      fullCasesCount: totalClaimedUnits,
      committedUnits: totalClaimedUnits,
      remainderUnits: 0,
      neededForNextCase: 0,
      isFullyMatched: totalClaimedUnits > 0,
    };
  }
  return {
    totalClaimedUnits,
    caseSize,
    fullCasesCount: allocation.committedUnits / caseSize,
    committedUnits: allocation.committedUnits,
    remainderUnits: allocation.remainderUnits,
    neededForNextCase:
      allocation.remainderUnits === 0 ? 0 : caseSize - allocation.remainderUnits,
    isFullyMatched: totalClaimedUnits > 0 && allocation.remainderUnits === 0,
  };
}

function buyerIds(pool: GroupBuyPool, committedByUser: Record<string, number>): string[] {
  const ids = new Set<string>();
  pool.participants.forEach((p) => {
    if ((committedByUser[p.id] ?? 0) > 0) ids.add(p.id);
  });
  Object.keys(committedByUser).forEach((id) => {
    if (committedByUser[id] > 0) ids.add(id);
  });
  return [...ids].sort();
}

/**
 * Thresholds and free-delivery are earned by orderable merchandise only.
 * The delivery fee is charged once, split in integer cents across committed buyers.
 */
export function getPoolProgressSummary(pool: GroupBuyPool): PoolProgressSummary {
  let committedCents = 0;
  let pendingCents = 0;
  let retailCents = 0;
  const committedByUser: Record<string, number> = {};

  pool.items.forEach((item) => {
    const allocation = allocateItemClaims(item);
    const unitCents = itemUnitCents(item);
    committedCents += multiplyCents(unitCents, allocation.committedUnits);
    pendingCents += multiplyCents(unitCents, allocation.remainderUnits);
    retailCents += multiplyCents(toCents(item.retailPrice) ?? unitCents, allocation.committedUnits + allocation.remainderUnits);
    Object.entries(allocation.committedByUser).forEach(([userId, qty]) => {
      committedByUser[userId] = (committedByUser[userId] ?? 0) + multiplyCents(unitCents, qty);
    });
  });

  const minimumCents = toCents(pool.minimumOrderAmount) ?? 0;
  const freeThresholdCents = toCents(pool.freeDeliveryThreshold) ?? 0;
  const configuredFeeCents = toCents(pool.deliveryFee) ?? 0;

  const isMinimumMet = minimumCents > 0 && committedCents >= minimumCents;
  const isFreeDeliveryUnlocked = freeThresholdCents > 0 && committedCents >= freeThresholdCents;
  const buyers = buyerIds(pool, committedByUser);
  const activeBuyerCount = buyers.length;
  const deliveryFeeCents =
    committedCents === 0 || isFreeDeliveryUnlocked ? 0 : Math.min(configuredFeeCents, configuredFeeCents);

  const shares = splitCents(deliveryFeeCents, buyers.map(() => 1));
  const deliveryShareCentsByUser: Record<string, number> = {};
  buyers.forEach((id, index) => {
    deliveryShareCentsByUser[id] = shares[index] ?? 0;
  });

  return {
    committedPoolTotal: fromCents(committedCents),
    pendingCaseTotal: fromCents(pendingCents),
    combinedPoolTotal: fromCents(committedCents + pendingCents),
    committedCents,
    pendingCents,
    minimumProgressRatio: minimumCents > 0 ? Math.min(1, committedCents / minimumCents) : 0,
    freeDeliveryProgressRatio:
      freeThresholdCents > 0 ? Math.min(1, committedCents / freeThresholdCents) : 0,
    amountNeededForMinimum: fromCents(Math.max(0, minimumCents - committedCents)),
    amountNeededForFreeDelivery: fromCents(Math.max(0, freeThresholdCents - committedCents)),
    isMinimumMet,
    isFreeDeliveryUnlocked,
    activeBuyerCount,
    currentDeliveryFeePerPerson: activeBuyerCount > 0 ? fromCents(shares[0] ?? 0) : 0,
    deliveryFeeCents,
    deliveryShareCentsByUser,
    totalPoolSavings: fromCents(Math.max(0, retailCents - committedCents - pendingCents)),
  };
}

/** Participants plus any claimant the participant list is missing, so totals reconcile. */
function breakdownUserIds(pool: GroupBuyPool): string[] {
  const ids: string[] = [];
  const seen = new Set<string>();
  pool.participants.forEach((p) => {
    if (!seen.has(p.id)) {
      seen.add(p.id);
      ids.push(p.id);
    }
  });
  pool.items.forEach((item) =>
    orderedClaims(item).forEach((c) => {
      if (!seen.has(c.userId)) {
        seen.add(c.userId);
        ids.push(c.userId);
      }
    })
  );
  return ids;
}

export function getParticipantBreakdowns(pool: GroupBuyPool): UserCostBreakdown[] {
  const summary = getPoolProgressSummary(pool);

  return breakdownUserIds(pool).map((userId) => {
    const participant = pool.participants.find((p) => p.id === userId);
    let committedCents = 0;
    let pendingCents = 0;
    let savingsCents = 0;
    const lineItems: UserCostBreakdown['lineItems'] = [];

    pool.items.forEach((item) => {
      const claim = item.claims.find((c) => c.userId === userId);
      const claimedQty = claim ? sanitizeQuantity(claim.quantity) : 0;
      if (claimedQty === 0) return;

      const allocation = allocateItemClaims(item);
      const committedQty = allocation.committedByUser[userId] ?? 0;
      const pendingQty = allocation.pendingByUser[userId] ?? 0;
      const unitCents = itemUnitCents(item);
      const committedSubtotalCents = multiplyCents(unitCents, committedQty);
      const pendingSubtotalCents = multiplyCents(unitCents, pendingQty);

      committedCents += committedSubtotalCents;
      pendingCents += pendingSubtotalCents;
      savingsCents += multiplyCents(
        Math.max(0, (toCents(item.retailPrice) ?? unitCents) - unitCents),
        claimedQty
      );

      const isCaseSplit = item.mode === 'case_split';
      const caseStatus = getCaseSplitStatus(item);
      lineItems.push({
        itemId: item.id,
        itemName: item.name,
        emoji: item.emoji,
        quantity: claimedQty,
        unitPrice: fromCents(unitCents),
        subtotal: fromCents(committedSubtotalCents),
        heldSubtotal: fromCents(pendingSubtotalCents),
        committedQuantity: committedQty,
        pendingQuantity: pendingQty,
        isCaseSplit,
        caseFilled: pendingQty === 0,
        caseProgressText: isCaseSplit
          ? `${caseStatus.committedUnits}/${caseStatus.caseSize} case units in completed cases`
          : undefined,
      });
    });

    const deliveryCents = summary.deliveryShareCentsByUser[userId] ?? 0;
    const totalDueCents = committedCents + deliveryCents;

    return {
      userId,
      userName: participant?.name ?? orderedClaimsName(pool, userId),
      avatarColor: participant?.avatarColor ?? '#64748B',
      committedSubtotal: fromCents(committedCents),
      pendingCaseSubtotal: fromCents(pendingCents),
      estimatedDeliveryShare: fromCents(deliveryCents),
      totalEstimatedSavings: fromCents(savingsCents),
      totalDue: fromCents(totalDueCents),
      paidStatus: participant?.paidStatus ?? 'pending',
      pickedUp: participant?.pickedUp,
      lineItems,
    };
  });
}

function orderedClaimsName(pool: GroupBuyPool, userId: string): string {
  for (const item of pool.items) {
    const claim = item.claims.find((c) => c.userId === userId);
    if (claim) return claim.userName;
  }
  return 'Neighbor';
}

export function getWholesaleOrderManifest(pool: GroupBuyPool): {
  lines: WholesaleManifestLine[];
  partialCaseItems: WholesaleManifestLine[];
  totalSupplierMerchandiseCost: number;
  supplierDeliveryFee: number;
  grandTotalSupplierInvoice: number;
  totalSupplierMerchandiseCents: number;
  grandTotalSupplierInvoiceCents: number;
} {
  const lines: WholesaleManifestLine[] = [];
  const partialCaseItems: WholesaleManifestLine[] = [];

  pool.items.forEach((item) => {
    const allocation = allocateItemClaims(item);
    const total = allocation.committedUnits + allocation.remainderUnits;
    if (total === 0) return;

    const status = getCaseSplitStatus(item);
    const unitCents = itemUnitCents(item);
    const lineTotalCents = multiplyCents(unitCents, allocation.committedUnits);
    const entry: WholesaleManifestLine = {
      itemId: item.id,
      itemName: item.name,
      emoji: item.emoji,
      mode: item.mode,
      orderQuantityLabel:
        item.mode === 'case_split'
          ? `${status.fullCasesCount} full case${status.fullCasesCount === 1 ? '' : 's'} (${allocation.committedUnits} × ${item.unitLabel})`
          : `${allocation.committedUnits} × ${item.unitLabel}`,
      committedUnits: allocation.committedUnits,
      unfilledRemainderUnits: allocation.remainderUnits,
      neededToFillNextCase: status.neededForNextCase,
      unitPrice: fromCents(unitCents),
      lineTotal: fromCents(lineTotalCents),
      lineTotalCents,
    };
    lines.push(entry);
    if (item.mode === 'case_split' && allocation.remainderUnits > 0) partialCaseItems.push(entry);
  });

  const summary = getPoolProgressSummary(pool);
  const merchandiseCents = sumCents(lines.map((l) => l.lineTotalCents));
  const grandTotalCents = merchandiseCents + summary.deliveryFeeCents;

  return {
    lines,
    partialCaseItems,
    totalSupplierMerchandiseCost: fromCents(merchandiseCents),
    supplierDeliveryFee: fromCents(summary.deliveryFeeCents),
    grandTotalSupplierInvoice: fromCents(grandTotalCents),
    totalSupplierMerchandiseCents: merchandiseCents,
    grandTotalSupplierInvoiceCents: grandTotalCents,
  };
}

/** Lock/settle only when the order is placeable and nothing is ambiguous. */
export function getSettlementReadiness(pool: GroupBuyPool): SettlementReadiness {
  const summary = getPoolProgressSummary(pool);
  const manifest = getWholesaleOrderManifest(pool);
  const blockers: string[] = [];

  if (manifest.lines.every((l) => l.committedUnits === 0)) {
    blockers.push('No orderable merchandise claims yet.');
  }
  if (!summary.isMinimumMet) {
    blockers.push(
      `Supplier minimum not met (${formatCentsSafe(summary.amountNeededForMinimum)} short).`
    );
  }
  if (manifest.partialCaseItems.length > 0) {
    blockers.push(
      `${manifest.partialCaseItems.length} partial case(s) must be covered by the host or trimmed.`
    );
  }

  return {
    canLock: blockers.length === 0,
    minimumOk: summary.isMinimumMet,
    unresolvedPartialItems: manifest.partialCaseItems.length,
    blockers,
  };
}

function formatCentsSafe(dollars: number): string {
  return `$${dollars.toFixed(2)}`;
}

/**
 * A changed bill invalidates a prior "paid". Call after every accepted claim
 * mutation with the previous per-user dues (cents).
 */
export function reconcilePayments(
  pool: GroupBuyPool,
  previousDueCents: Record<string, number>
): GroupBuyPool {
  const current = getParticipantBreakdowns(pool);
  return {
    ...pool,
    participants: pool.participants.map((p) => {
      if (p.paidStatus !== 'paid') return p;
      const before = previousDueCents[p.id] ?? 0;
      const after = toCents(
        current.find((b) => b.userId === p.id)?.totalDue ?? 0
      ) ?? 0;
      return before === after ? p : { ...p, paidStatus: 'pending' };
    }),
  };
}

export function buildShareablePoolInviteText(pool: GroupBuyPool): string {
  const summary = getPoolProgressSummary(pool);
  const partialCases = pool.items
    .map((item) => ({ item, status: getCaseSplitStatus(item) }))
    .filter((x) => x.item.mode === 'case_split' && x.status.neededForNextCase > 0);

  const partialLines =
    partialCases.length > 0
      ? `\n📦 Open bulk case splits needing shares:\n` +
        partialCases
          .map(
            (x) =>
              `• ${x.item.emoji} ${x.item.name}: ${x.status.neededForNextCase} more needed (${formatCentsSafe(
                x.item.unitPrice
              )}/${x.item.unitLabel})`
          )
          .join('\n')
      : '';

  return (
    `🥬 Join our neighborhood grocery group buy on PoolCart!\n` +
    `Pool: ${pool.title} (${pool.supplierName})\n` +
    `Host: ${pool.hostName} • Pickup: ${pool.pickupWindow} at ${pool.pickupAddress}\n` +
    `Orderable progress: ${formatCentsSafe(summary.committedPoolTotal)} / ${formatCentsSafe(
      pool.minimumOrderAmount
    )} minimum (${summary.pendingCents > 0 ? `${formatCentsSafe(summary.pendingCaseTotal)} in partial cases is not counted yet; ` : ''}${
      summary.isFreeDeliveryUnlocked
        ? 'free wholesale delivery unlocked'
        : `${formatCentsSafe(summary.amountNeededForFreeDelivery)} from free delivery`
    })\n` +
    `Cutoff: ${pool.cutoffTime}\n` +
    `Invite code: ${pool.joinCode}\n` +
    `Note: opening this code on another phone only works when the pool is synced through Supabase; device-local pools are not discoverable from other devices.` +
    partialLines
  );
}

export function buildSupplierOrderExportText(pool: GroupBuyPool): string {
  const manifest = getWholesaleOrderManifest(pool);
  const breakdowns = getParticipantBreakdowns(pool).filter((b) => b.lineItems.length > 0);

  const itemLines = manifest.lines
    .filter((l) => l.committedUnits > 0)
    .map((l) => `• ${l.emoji} ${l.itemName}: ${l.orderQuantityLabel} — ${formatCentsSafe(l.lineTotal)}`)
    .join('\n');

  const neighborLines = breakdowns
    .map(
      (b) =>
        `• ${b.userName} (${b.paidStatus === 'paid' ? 'PAID' : 'PENDING'}): ${formatCentsSafe(
          b.totalDue
        )}${b.pendingCaseSubtotal > 0 ? ` + ${formatCentsSafe(b.pendingCaseSubtotal)} on hold` : ''} — ` +
        b.lineItems.map((li) => `${li.emoji}×${li.quantity}`).join(', ')
    )
    .join('\n');

  return (
    `📋 WHOLESALE PURCHASE ORDER — ${pool.title}\n` +
    `Supplier: ${pool.supplierName}\n` +
    `Host: ${pool.hostName} | Pickup: ${pool.pickupWindow}\n\n` +
    `--- SUPPLIER MASTER ORDER ---\n` +
    `${itemLines || '(No committed full units yet)'}\n` +
    `Merchandise Subtotal: ${formatCentsSafe(manifest.totalSupplierMerchandiseCost)}\n` +
    `Wholesale Delivery Fee: ${formatCentsSafe(manifest.supplierDeliveryFee)}\n` +
    `Total Supplier Invoice: ${formatCentsSafe(manifest.grandTotalSupplierInvoice)}\n\n` +
    `--- NEIGHBOR PICKUP & SPLIT CHECKLIST ---\n` +
    `${neighborLines}`
  );
}
```

### 3. `src/types/groupBuy.ts` hunks (additive only — keeps every call site compiling)

```ts
export interface ParticipantShare {
  userId: string;
  userName: string;
  avatarColor: string;
  quantity: number;
  paid?: boolean;
  createdAt?: string; // persisted claim sequence for deterministic full-case priority
}
```

```ts
  lineItems: {
    itemId: string;
    itemName: string;
    emoji: string;
    quantity: number;
    unitPrice: number;
    subtotal: number;            // committed (payable) portion
    heldSubtotal?: number;       // remainder portion, not payable yet
    committedQuantity?: number;
    pendingQuantity?: number;
    isCaseSplit: boolean;
    caseFilled: boolean;
    caseProgressText?: string;
  }[];
```

### 4. `supabase/schema.sql` (complete replacement — reviewable, never executed here)

```sql
-- PoolCart hardened schema. Idempotent: safe to re-run on an existing project.
-- Authority: auth.uid(). Display names are cosmetic only.
begin;

create extension if not exists pgcrypto;

create table if not exists public.pools (
  id text primary key,
  join_code text not null,
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
  cutoff_at timestamptz,
  minimum_order_amount numeric(12,2) not null default 200 check (minimum_order_amount >= 0),
  delivery_fee numeric(12,2) not null default 20 check (delivery_fee >= 0),
  free_delivery_threshold numeric(12,2) not null default 300 check (free_delivery_threshold >= 0),
  status text not null default 'open' check (status in ('open','minimum_met','locked')),
  host_id uuid references auth.users(id) on delete restrict,
  created_at timestamptz not null default now()
);

create table if not exists public.pool_participants (
  pool_id text not null references public.pools(id) on delete cascade,
  user_id text not null,                       -- auth.uid()::text; legacy demo ids never match
  user_name text not null,
  neighborhood text not null default '',
  avatar_color text not null default '#0D9488',
  is_host boolean not null default false,
  paid_status text not null default 'pending' check (paid_status in ('pending','paid')),
  picked_up boolean not null default false,
  updated_at timestamptz not null default now(),
  primary key (pool_id, user_id)
);

create table if not exists public.catalog_items (
  id text primary key,
  pool_id text not null references public.pools(id) on delete cascade,
  name text not null,
  category text not null,
  emoji text not null default '🛒',
  mode text not null check (mode in ('individual','case_split')),
  unit_label text not null,
  unit_price numeric(12,2) not null check (unit_price >= 0),
  retail_price numeric(12,2) not null check (retail_price >= 0),
  case_size integer check (case_size is null or (case_size between 2 and 1000)),
  max_cases integer check (max_cases is null or (max_cases between 1 and 1000)),
  created_at timestamptz not null default now()
);
create unique index if not exists catalog_items_id_pool_uidx on public.catalog_items (id, pool_id);

create table if not exists public.item_claims (
  pool_id text not null,
  item_id text not null,
  user_id text not null,
  user_name text not null,
  avatar_color text not null,
  quantity integer not null check (quantity > 0 and quantity <= 10000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (item_id, user_id),
  constraint item_claims_item_pool_fk foreign key (item_id, pool_id)
    references public.catalog_items (id, pool_id) on delete cascade
);

create table if not exists public.pool_messages (
  id text primary key,
  pool_id text not null references public.pools(id) on delete cascade,
  user_id text not null,
  user_name text not null,
  avatar_color text not null default '#0D9488',
  is_host boolean not null default false,
  is_announcement boolean not null default false,
  text text not null check (char_length(text) between 1 and 4000),
  created_at_label text not null,
  created_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Upgrade path for databases created at 78d1061 (all no-ops on a fresh install)
-- ---------------------------------------------------------------------------
alter table public.pools add column if not exists host_id uuid references auth.users(id);
alter table public.pools add column if not exists cutoff_at timestamptz;
alter table public.catalog_items add column if not exists max_cases integer;
alter table public.item_claims add column if not exists created_at timestamptz not null default now();
alter table public.pool_participants alter column neighborhood set default '';
update public.item_claims set created_at = coalesce(updated_at, now()) where created_at is null;

-- Legacy rows: every pre-existing pool has host_id IS NULL and text demo user ids.
-- They are quarantined read-only for authenticated non-members and cannot accept
-- writes until an operator binds a real host via admin_bind_legacy_host().
-- Their participant rows are preserved untouched; legacy text ids never equal auth.uid().

-- Enforce invite-code uniqueness without dropping duplicate legacy rows.
do $$
begin
  if not exists (select 1 from pg_indexes where schemaname = 'public' and indexname = 'pools_join_code_uidx') then
    update public.pools p
       set join_code = p.join_code || '-' || left(md5(p.id), 3)
     where p.id in (
       select id from (
         select id, row_number() over (partition by upper(join_code) order by created_at, id) rn
         from public.pools
       ) d where d.rn > 1
     );
    execute 'create unique index pools_join_code_uidx on public.pools (upper(join_code))';
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- Membership / host predicates
-- ---------------------------------------------------------------------------
create or replace function public.is_pool_member(p_pool_id text)
returns boolean language sql stable security definer set search_path = public, pg_temp as $$
  select exists (
    select 1 from public.pool_participants pp
     where pp.pool_id = p_pool_id and pp.user_id = auth.uid()::text
  );
$$;

create or replace function public.is_pool_host(p_pool_id text)
returns boolean language sql stable security definer set search_path = public, pg_temp as $$
  select exists (select 1 from public.pools p where p.id = p_pool_id and p.host_id = auth.uid());
$$;

-- ---------------------------------------------------------------------------
-- Claim RPC: identity from auth.uid(), first-claim safe, bounded, locked-out
-- ---------------------------------------------------------------------------
create or replace function public.claim_item_share(
  p_pool_id text,
  p_item_id text,
  p_delta integer,
  p_display_name text default null,
  p_avatar_color text default '#0D9488',
  p_neighborhood text default null
) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_uid text := auth.uid()::text;
  v_status text;
  v_cutoff timestamptz;
  v_mode text;
  v_case_size integer;
  v_max_cases integer;
  v_current integer;
  v_other integer;
  v_next_user integer;
  v_next_total integer;
  v_cap_units integer;
  v_capped boolean := false;
  v_prev_cases integer;
  v_next_cases integer;
  v_remainder integer;
  v_unit_price numeric;
begin
  if auth.uid() is null then
    raise exception 'Authentication required' using errcode = '28000';
  end if;
  if p_delta is null or p_delta = 0 or abs(p_delta) > 100 then
    raise exception 'delta must be a non-zero integer within [-100,100]';
  end if;

  select status, cutoff_at into v_status, v_cutoff
    from public.pools where id = p_pool_id for update;
  if not found then raise exception 'Pool not found'; end if;
  if v_status = 'locked' then
    raise exception 'Pool is locked for wholesale ordering; claims cannot be modified.' using errcode = '55000';
  end if;
  if v_cutoff is not null and now() >= v_cutoff then
    raise exception 'Claim cutoff has passed for this pool.' using errcode = '55000';
  end if;
  if not public.is_pool_member(p_pool_id) then
    raise exception 'Join this pool with its invite code before claiming.' using errcode = '42501';
  end if;

  select mode, coalesce(nullif(case_size, 0), 1), max_cases, unit_price
    into v_mode, v_case_size, v_max_cases, v_unit_price
    from public.catalog_items
   where id = p_item_id and pool_id = p_pool_id
   for update;
  if not found then raise exception 'Catalog item not found in pool.'; end if;

  -- Aggregate SELECT always yields one row: no NULL for a first-time claimant.
  select coalesce(sum(quantity), 0) into v_current
    from public.item_claims where item_id = p_item_id and user_id = v_uid;
  select coalesce(sum(quantity), 0) into v_other
    from public.item_claims where item_id = p_item_id and user_id <> v_uid;

  v_next_user := v_current + p_delta;
  if v_next_user < 0 then v_next_user := 0; end if;
  if v_next_user > 10000 then v_next_user := 10000; v_capped := true; end if;

  if v_mode = 'case_split' and v_max_cases is not null and v_max_cases > 0 then
    v_cap_units := v_max_cases * v_case_size;
    if v_other + v_next_user > v_cap_units then
      v_next_user := greatest(0, v_cap_units - v_other);
      v_capped := true;
    end if;
  end if;

  if v_next_user = 0 then
    delete from public.item_claims where item_id = p_item_id and user_id = v_uid;
  else
    insert into public.item_claims (pool_id, item_id, user_id, user_name, avatar_color, quantity)
    values (p_pool_id, p_item_id, v_uid, coalesce(nullif(btrim(p_display_name), ''), 'Neighbor'),
            coalesce(p_avatar_color, '#0D9488'), v_next_user)
    on conflict (item_id, user_id) do update
      set quantity = excluded.quantity,
          user_name = excluded.user_name,
          avatar_color = excluded.avatar_color,
          updated_at = now();
  end if;

  update public.pool_participants
     set user_name = coalesce(nullif(btrim(p_display_name), ''), user_name),
         neighborhood = coalesce(p_neighborhood, neighborhood),
         updated_at = now()
   where pool_id = p_pool_id and user_id = v_uid;

  v_next_total := v_other + v_next_user;
  if v_mode = 'case_split' and v_case_size > 1 then
    v_prev_cases := floor((v_current + v_other)::numeric / v_case_size);
    v_next_cases := floor(v_next_total::numeric / v_case_size);
    v_remainder := mod(v_next_total, v_case_size);
  else
    v_prev_cases := v_current + v_other;
    v_next_cases := v_next_total;
    v_remainder := 0;
  end if;

  return jsonb_build_object(
    'ok', true,
    'actorId', v_uid,
    'newUserQuantity', v_next_user,
    'totalClaimedUnits', v_next_total,
    'fullCasesCount', v_next_cases,
    'remainderUnits', v_remainder,
    'justCompletedCase', (v_mode = 'case_split' and v_case_size > 1 and v_next_cases > v_prev_cases and v_remainder = 0),
    'justOpenedNewCase', (v_mode = 'case_split' and v_case_size > 1 and (v_current + v_other) > 0
                          and mod(v_current + v_other, v_case_size) = 0 and v_next_total > (v_current + v_other)),
    'cappedAtMaxCases', v_capped
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- Join by invite code: the only way to create membership
-- ---------------------------------------------------------------------------
create or replace function public.join_pool_by_code(
  p_code text, p_display_name text, p_avatar_color text default '#0D9488', p_neighborhood text default null
) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_pool public.pools; v_uid text := auth.uid()::text;
begin
  if auth.uid() is null then raise exception 'Authentication required' using errcode = '28000'; end if;
  if p_code is null or btrim(p_code) = '' then raise exception 'Invite code is required'; end if;

  select * into v_pool from public.pools
   where upper(join_code) = upper(btrim(p_code)) limit 1;
  if not found then raise exception 'No pool found for that invite code' using errcode = 'P0002'; end if;
  if v_pool.status = 'locked' then raise exception 'That pool is locked' using errcode = '55000'; end if;
  if v_pool.host_id is null then
    raise exception 'This pool has no verified host yet; join is disabled until an operator binds one.'
      using errcode = '42501';
  end if;

  insert into public.pool_participants (pool_id, user_id, user_name, neighborhood, avatar_color)
  values (v_pool.id, v_uid, coalesce(nullif(btrim(p_display_name), ''), 'Neighbor'),
          coalesce(p_neighborhood, ''), coalesce(p_avatar_color, '#0D9488'))
  on conflict (pool_id, user_id) do update set updated_at = now();

  return jsonb_build_object('ok', true, 'poolId', v_pool.id);
end;
$$;

-- ---------------------------------------------------------------------------
-- Host RPCs (host identity re-derived server-side on every call)
-- ---------------------------------------------------------------------------
create or replace function public.set_paid_status(p_pool_id text, p_user_id text, p_status text)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if auth.uid() is null then raise exception 'Authentication required' using errcode = '28000'; end if;
  if not public.is_pool_host(p_pool_id) then
    raise exception 'Only the pool host can confirm payments' using errcode = '42501';
  end if;
  if p_status not in ('pending','paid') then raise exception 'Invalid paid status'; end if;
  update public.pool_participants
     set paid_status = p_status, updated_at = now()
   where pool_id = p_pool_id and user_id = p_user_id;
  if not found then raise exception 'Participant not found in pool'; end if;
end;
$$;

create or replace function public.set_picked_up(p_pool_id text, p_user_id text, p_picked_up boolean)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if auth.uid() is null then raise exception 'Authentication required' using errcode = '28000'; end if;
  if not public.is_pool_host(p_pool_id) then
    raise exception 'Only the pool host can update pickup status' using errcode = '42501';
  end if;
  update public.pool_participants
     set picked_up = coalesce(p_picked_up, false), updated_at = now()
   where pool_id = p_pool_id and user_id = p_user_id;
  if not found then raise exception 'Participant not found in pool'; end if;
end;
$$;

create or replace function public.set_pool_status(p_pool_id text, p_status text)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_merch numeric := 0; v_min numeric := 0; v_partials integer := 0; v_current text;
begin
  if auth.uid() is null then raise exception 'Authentication required' using errcode = '28000'; end if;
  if p_status not in ('open','minimum_met','locked') then raise exception 'Invalid pool status'; end if;

  select status, minimum_order_amount into v_current, v_min
    from public.pools where id = p_pool_id for update;
  if not found then raise exception 'Pool not found'; end if;
  if not public.is_pool_host(p_pool_id) then
    raise exception 'Only the pool host can change pool status' using errcode = '42501';
  end if;

  if p_status = 'locked' then
    select coalesce(sum(x.committed * x.unit_price), 0) into v_merch
      from (
        select ci.unit_price,
               case when ci.mode = 'case_split' and coalesce(ci.case_size, 1) > 1
                    then floor(coalesce(c.qty, 0)::numeric / ci.case_size) * ci.case_size
                    else coalesce(c.qty, 0) end as committed
          from public.catalog_items ci
          left join (select item_id, sum(quantity) qty from public.item_claims
                      where pool_id = p_pool_id group by item_id) c on c.item_id = ci.id
         where ci.pool_id = p_pool_id
      ) x;

    select count(*) into v_partials
      from (
        select ci.id
          from public.catalog_items ci
          join (select item_id, sum(quantity) qty from public.item_claims
                 where pool_id = p_pool_id group by item_id) c on c.item_id = ci.id
         where ci.pool_id = p_pool_id and ci.mode = 'case_split'
           and coalesce(ci.case_size, 1) > 1 and mod(c.qty, ci.case_size) <> 0
      ) y;

    if v_merch <= 0 then raise exception 'Cannot lock an empty pool.' using errcode = '23514'; end if;
    if v_merch < v_min then
      raise exception 'Cannot lock: orderable merchandise (%) is below the supplier minimum (%)', v_merch, v_min
        using errcode = '23514';
    end if;
    if v_partials > 0 then
      raise exception 'Cannot lock: % partial case(s) must be covered or trimmed first.', v_partials
        using errcode = '23514';
    end if;
  end if;

  update public.pools set status = p_status where id = p_pool_id;
end;
$$;

-- Trim a partial case without deleting claims: only the newest claims are reduced.
-- (NOT deleting then re-inserting; single transaction, row locks held.)
create or replace function public.trim_partial_case(p_pool_id text, p_item_id text)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_case integer; v_total integer; v_remainder integer; v_rec record; v_take integer; v_trimmed integer := 0;
begin
  if auth.uid() is null then raise exception 'Authentication required' using errcode = '28000'; end if;
  if not public.is_pool_host(p_pool_id) then
    raise exception 'Only the pool host can trim partial cases' using errcode = '42501';
  end if;
  select coalesce(case_size, 1) into v_case from public.catalog_items
   where id = p_item_id and pool_id = p_pool_id for update;
  if not found then raise exception 'Catalog item not found in pool'; end if;
  if v_case < 2 then return jsonb_build_object('ok', true, 'trimmedUnits', 0); end if;

  select coalesce(sum(quantity), 0) into v_total from public.item_claims where item_id = p_item_id;
  v_remainder := mod(v_total, v_case);
  if v_remainder = 0 then return jsonb_build_object('ok', true, 'trimmedUnits', 0); end if;

  for v_rec in
    select user_id, quantity from public.item_claims
     where item_id = p_item_id
     order by created_at desc, user_id desc
     for update
  loop
    exit when v_remainder <= 0;
    v_take := least(v_rec.quantity, v_remainder);
    if v_rec.quantity - v_take = 0 then
      delete from public.item_claims where item_id = p_item_id and user_id = v_rec.user_id;
    else
      update public.item_claims
         set quantity = quantity - v_take, updated_at = now()
       where item_id = p_item_id and user_id = v_rec.user_id;
    end if;
    v_remainder := v_remainder - v_take;
    v_trimmed := v_trimmed + v_take;
  end loop;

  return jsonb_build_object('ok', true, 'trimmedUnits', v_trimmed);
end;
$$;

-- Host-only legacy binding. Revoked from anon/authenticated: run with service role.
create or replace function public.admin_bind_legacy_host(p_pool_id text, p_host uuid)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if p_host is null then raise exception 'host is required'; end if;
  update public.pools set host_id = p_host, status = 'open'
   where id = p_pool_id and host_id is null;
  if not found then raise exception 'Pool % is not an unclaimed legacy pool', p_pool_id; end if;
  insert into public.pool_participants (pool_id, user_id, user_name, neighborhood, is_host)
  values (p_pool_id, p_host::text, 'Host', '', true)
  on conflict (pool_id, user_id) do update set is_host = true, updated_at = now();
end;
$$;

-- ---------------------------------------------------------------------------
-- Row Level Security: reads for members/host only; no direct writes at all
-- ---------------------------------------------------------------------------
alter table public.pools enable row level security;
alter table public.pool_participants enable row level security;
alter table public.catalog_items enable row level security;
alter table public.item_claims enable row level security;
alter table public.pool_messages enable row level security;

drop policy if exists "Allow public read/write on pools" on public.pools;
drop policy if exists "Allow public read/write on pool_participants" on public.pool_participants;
drop policy if exists "Allow public read/write on catalog_items" on public.catalog_items;
drop policy if exists "Allow public read/write on item_claims" on public.item_claims;
drop policy if exists "Allow public read/write on pool_messages" on public.pool_messages;
drop policy if exists pools_member_select on public.pools;
drop policy if exists participants_member_select on public.pool_participants;
drop policy if exists items_member_select on public.catalog_items;
drop policy if exists claims_member_select on public.item_claims;
drop policy if exists messages_member_select on public.pool_messages;

create policy pools_member_select on public.pools for select to authenticated
  using (host_id = auth.uid() or (host_id is not null and public.is_pool_member(id)));

create policy participants_member_select on public.pool_participants for select to authenticated
  using (public.is_pool_member(pool_id) or public.is_pool_host(pool_id));

create policy items_member_select on public.catalog_items for select to authenticated
  using (public.is_pool_member(pool_id) or public.is_pool_host(pool_id));

create policy claims_member_select on public.item_claims for select to authenticated
  using (public.is_pool_member(pool_id) or public.is_pool_host(pool_id));

create policy messages_member_select on public.pool_messages for select to authenticated
  using (public.is_pool_member(pool_id) or public.is_pool_host(pool_id));

revoke all on public.pools, public.pool_participants, public.catalog_items,
              public.item_claims, public.pool_messages from anon, authenticated;
grant select on public.pools, public.pool_participants, public.catalog_items,
                public.item_claims, public.pool_messages to authenticated;

revoke all on function public.claim_item_share(text, text, integer, text, text, text) from public, anon;
revoke all on function public.join_pool_by_code(text, text, text, text) from public, anon;
revoke all on function public.set_paid_status(text, text, text) from public, anon;
revoke all on function public.set_picked_up(text, text, boolean) from public, anon;
revoke all on function public.set_pool_status(text, text) from public, anon;
revoke all on function public.trim_partial_case(text, text) from public, anon;
revoke all on function public.admin_bind_legacy_host(text, uuid) from public, anon, authenticated;

grant execute on function public.claim_item_share(text, text, integer, text, text, text) to authenticated;
grant execute on function public.join_pool_by_code(text, text, text, text) to authenticated;
grant execute on function public.set_paid_status(text, text, text) to authenticated;
grant execute on function public.set_picked_up(text, text, boolean) to authenticated;
grant execute on function public.set_pool_status(text, text) to authenticated;
grant execute on function public.trim_partial_case(text, text) to authenticated;

-- ---------------------------------------------------------------------------
-- Realtime (idempotent)
-- ---------------------------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array['pools','pool_participants','catalog_items','item_claims','pool_messages'] loop
    if not exists (select 1 from pg_publication_tables
                    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t) then
      execute format('alter publication supabase_realtime add table public.%I', t);
    end if;
  end loop;
end $$;

commit;
```

### 5. `src/services/repository.ts` hunks

**R1 — replace `syncAtomicClaimDelta` (L480‑510) and delete the fallback.** Fail closed; identity from session.

```ts
  async syncAtomicClaimDelta(
    poolId: string,
    itemId: string,
    user: Participant,
    delta: number,
    _fallbackQuantity?: number   // retained for call-site compatibility; never used
  ): Promise<{ rpcResult?: AtomicClaimResult; error?: string }> {
    const client = getOrCreateSupabaseClient();
    if (!client) return { error: 'Cloud sync is not configured.' };

    const identity = await ensureCloudIdentity(client);
    if (!identity.userId) {
      return { error: identity.error ?? 'Sign-in required before claiming.' };
    }

    const { data, error } = await client.rpc('claim_item_share', {
      p_pool_id: poolId,
      p_item_id: itemId,
      p_delta: delta,
      p_display_name: user.name,
      p_avatar_color: user.avatarColor,
      p_neighborhood: user.neighborhood,
    });

    if (error || !data) {
      // Deliberately no table-write fallback: a rejected claim must never be applied.
      return { error: error?.message ?? 'Claim was rejected by the server.' };
    }
    return { rpcResult: normalizeClaimResult(data) };
  },
```

**R2 — new session helper (insert above `PoolRepository`).**

```ts
let cachedIdentity: { userId: string | null; error?: string } | null = null;

async function ensureCloudIdentity(
  client: SupabaseClient
): Promise<{ userId: string | null; error?: string }> {
  if (cachedIdentity) return cachedIdentity;
  try {
    const { data } = await client.auth.getSession();
    let userId = data.session?.user?.id ?? null;
    if (!userId) {
      const { data: anon, error } = await client.auth.signInAnonymously();
      if (error) {
        cachedIdentity = { userId: null, error: `Anonymous sign-in failed: ${error.message}. Enable Anonymous sign-ins in Supabase Auth.` };
        return cachedIdentity;
      }
      userId = anon.user?.id ?? null;
    }
    if (!userId) {
      cachedIdentity = { userId: null, error: 'No authenticated cloud identity available.' };
      return cachedIdentity;
    }
    cachedIdentity = { userId };
    return cachedIdentity;
  } catch (err: any) {
    cachedIdentity = { userId: null, error: err?.message ?? 'Authentication unavailable.' };
    return cachedIdentity;
  }
}

function normalizeClaimResult(raw: any): AtomicClaimResult {
  const int = (v: any) => (Number.isFinite(Number(v)) ? Math.max(0, Math.floor(Number(v))) : 0);
  return {
    newUserQuantity: int(raw?.newUserQuantity),
    totalClaimedUnits: int(raw?.totalClaimedUnits),
    fullCasesCount: int(raw?.fullCasesCount),
    remainderUnits: int(raw?.remainderUnits),
    justCompletedCase: Boolean(raw?.justCompletedCase),
    justOpenedNewCase: Boolean(raw?.justOpenedNewCase),
    cappedAtMaxCases: Boolean(raw?.cappedAtMaxCases),
    message: typeof raw?.message === 'string' ? raw.message : undefined,
  };
}
```

**R3 — `loadPools`: no demo seeding, no cache overwrite, message errors surfaced, namespaced cache.**

Delete L250‑254 (`if (!poolsRes.data || poolsRes.data.length === 0) { seed…; AsyncStorage.setItem(…); return … }`) and replace with:

```ts
        if (!poolsRes.data || poolsRes.data.length === 0) {
          return {
            pools: [],
            error:
              'Cloud project has no pools yet. Create a pool in the app (host) to initialize it; demo data is never uploaded automatically.',
          };
        }
```

Add after `if (claimsRes.error) throw claimsRes.error;`:

```ts
        if (msgsRes.error) throw msgsRes.error;
```

Replace `await AsyncStorage.setItem(STORAGE_KEY_POOLS, JSON.stringify(assembled));` with `await this.saveCloudCache(assembled);` and map claims with `createdAt: c.created_at`.

**R4 — namespaced storage keys (replace L15‑17 and add helpers).**

```ts
const STORAGE_KEY_POOLS_PREFIX = '@poolcart_pools_v4';
const STORAGE_KEY_SUPABASE_CONFIG = '@poolcart_supabase_config_v1';
const STORAGE_KEY_ACTIVE_USER = '@poolcart_active_user_v1';
const STORAGE_KEY_DEVICE = '@poolcart_device_v1';

let deviceId: string | null = null;

async function getDeviceId(): Promise<string> {
  if (deviceId) return deviceId;
  try {
    const existing = await AsyncStorage.getItem(STORAGE_KEY_DEVICE);
    if (existing) { deviceId = existing; return existing; }
  } catch { /* fall through to a fresh id */ }
  const fresh = `dev_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
  try { await AsyncStorage.setItem(STORAGE_KEY_DEVICE, fresh); } catch { /* keep in memory */ }
  deviceId = fresh;
  return fresh;
}

/** Local demo cache and cloud caches never share a key. */
async function poolsStorageKey(): Promise<string> {
  const config = currentConfig;
  if (!config.enabled || !config.url) return `${STORAGE_KEY_POOLS_PREFIX}:local:${await getDeviceId()}`;
  const client = getOrCreateSupabaseClient();
  const identity = client ? await ensureCloudIdentity(client) : { userId: null as string | null };
  const host = config.url.replace(/^https?:\/\//, '').split('/')[0];
  return `${STORAGE_KEY_POOLS_PREFIX}:supabase:${host}:${identity.userId ?? 'anonymous'}`;
}
```

`loadLocalPools` / `saveLocalPools` must use `await poolsStorageKey()`. `saveLocalPools` must propagate failures:

```ts
  async saveLocalPools(pools: GroupBuyPool[]): Promise<{ error?: string }> {
    try {
      await AsyncStorage.setItem(await poolsStorageKey(), JSON.stringify(pools));
      return {};
    } catch (err: any) {
      return { error: err?.message ?? 'Failed to save pools locally.' };
    }
  },
```

`loadLocalPools` returns seeds **in memory only** when the key is absent (do not write):

```ts
  async loadLocalPools(): Promise<GroupBuyPool[]> {
    try {
      const raw = await AsyncStorage.getItem(await poolsStorageKey());
      if (!raw) return INITIAL_POOLS; // in-memory demo; nothing persisted, nothing uploaded
      return JSON.parse(raw) as GroupBuyPool[];
    } catch {
      return INITIAL_POOLS;
    }
  },
```

**R5 — `resetDemoData` and trim/new-item paths.**

```ts
  async resetDemoData(): Promise<GroupBuyPool[]> {
    await AsyncStorage.removeItem(await poolsStorageKey());
    return INITIAL_POOLS;             // never pushes demo data to the cloud
  },
```

Delete `syncItemClaimsList` body and replace with the transactional RPC:

```ts
  async trimPartialCase(poolId: string, itemId: string): Promise<{ error?: string }> {
    const client = getOrCreateSupabaseClient();
    if (!client) return { error: 'Cloud sync is not configured.' };
    const { error } = await client.rpc('trim_partial_case', {
      p_pool_id: poolId,
      p_item_id: itemId,
    });
    return error ? { error: error.message } : {};
  },
```

**R6 — `syncPaidStatus` / `syncPickedUp` / `syncPoolStatus` through host RPCs** (replace the direct `.from(...).update(...)` calls):

```ts
    const { error } = await client.rpc('set_paid_status', {
      p_pool_id: poolId, p_user_id: userId, p_status: paidStatus,
    });
```

```ts
  async syncPickedUp(poolId: string, userId: string, pickedUp: boolean): Promise<{ error?: string }> {
    const client = getOrCreateSupabaseClient();
    if (!client) return { error: 'Cloud sync is not configured.' };
    const { error } = await client.rpc('set_picked_up', {
      p_pool_id: poolId, p_user_id: userId, p_picked_up: pickedUp,
    });
    return error ? { error: error.message } : {};
  },
```

```ts
    const { error } = await client.rpc('set_pool_status', { p_pool_id: poolId, p_status: status });
```

**R7 — serialize client mutations (module scope; used by App).**

```ts
const poolQueues = new Map<string, Promise<unknown>>();

/** Serializes all mutations for one pool; local demo and cloud share the queue. */
export function withPoolLock<T>(poolId: string, task: () => Promise<T>): Promise<T> {
  const previous = poolQueues.get(poolId) ?? Promise.resolve();
  const next = previous.then(task, task);
  poolQueues.set(poolId, next.catch(() => undefined));
  return next;
}
```

`syncNewItem` must become one RPC (`create_catalog_item`) creating item **and** host claim atomically; `seedSupabasePools` must lose its public role (only `create_pool` RPC). Those RPCs are in the schema list below and are intentionally **not** replaced by client-side multi-write sequences.

### 6. `src/components/SplitLedgerView.tsx` hunks

**S1 — payment never confirms itself; only the host confirms; only self-pays.** Replace L27‑60 with:

```tsx
  const [payee] = useState(pool.hostVenmoHandle ?? '');
  const isHost = pool.participants.some((p) => p.id === currentUserId && p.isHost);

  const handlePayWithVenmo = async (userId: string, amount: number, userName: string) => {
    // Navigation only. Payment is confirmed by the host, never by opening a link.
    if (!payee) {
      Alert.alert(
        'No payment handle set',
        'The host has not configured a payment handle for this pool, so PoolCart will not invent one.'
      );
      return;
    }
    if (userId !== currentUserId) return; // you can only pay your own share
    const amountStr = amount.toFixed(2);
    const note = encodeURIComponent(`PoolCart: ${pool.title} (${userName.split(' ')[0]})`);
    const venmoDeepLink = `venmo://paycharge?txn=pay&recipients=${encodeURIComponent(payee)}&amount=${amountStr}&note=${note}`;
    const venmoWebFallback = `https://venmo.com/${encodeURIComponent(payee)}?txn=pay&amount=${amountStr}&note=${note}`;

    try {
      const supported = await Linking.canOpenURL(venmoDeepLink);
      await Linking.openURL(supported ? venmoDeepLink : venmoWebFallback);
      Alert.alert(
        'Payment not confirmed',
        'PoolCart opened your payment app. The host will mark your share paid once the transfer arrives.'
      );
    } catch {
      Alert.alert(
        'Venmo payment details',
        `Send $${amountStr} to @${payee} with note "${pool.title}". The host confirms receipt.`
      );
    }
  };
```

**S2 — chips are host-only; the pay button is self-only.** Replace the paid chip `onPress` (L113) with `onPress={() => { if (isHost) onTogglePaidStatus(b.userId); }}`, add `disabled={!isHost}` and `accessibilityRole="button"`, `accessibilityLabel={...}`, `accessibilityState={{ disabled: !isHost }}`. Replace the pay button guard (L179) with:

```tsx
                {isMe && b.paidStatus !== 'paid' && b.totalDue > 0 && (
                  <TouchableOpacity
                    style={styles.venmoButton}
                    accessibilityRole="button"
                    accessibilityLabel={`Open Venmo to pay ${b.totalDue.toFixed(2)} dollars to the host`}
                    onPress={() => handlePayWithVenmo(b.userId, b.totalDue, b.userName)}
                  >
```

Also render `b.pendingCaseSubtotal > 0` as a separate "On hold (partial case)" row so the displayed bill matches `totalDue`.

### 7. `App.tsx` hunks

**A1 — replace `handleUpdateQuantity` (L211‑293) with a serialized, reconciled handler.**

```tsx
  const handleUpdateQuantity = async (itemId: string, delta: number) => {
    if (activePool.status === 'locked') return;
    if (!Number.isInteger(delta) || delta === 0 || Math.abs(delta) > 100) return;

    await withPoolLock(activePool.id, async () => {
      const prevPools = pools;
      const prevBreakdownCents = Object.fromEntries(
        getParticipantBreakdowns(activePool).map((b) => [b.userId, Math.round(b.totalDue * 100)])
      );

      const local = prevPools.map((pool) => {
        if (pool.id !== activePool.id) return pool;
        const hasParticipant = pool.participants.some((p) => p.id === activeUser.id);
        return {
          ...pool,
          participants: hasParticipant ? pool.participants : [...pool.participants, activeUser],
          items: pool.items.map((item) =>
            item.id === itemId
              ? { ...item, claims: evaluateAtomicClaimTransition(item, activeUser, delta).updatedClaims }
              : item
          ),
        };
      });

      const cloudEnabled = PoolRepository.getCurrentConfig().enabled;
      let accepted = local;
      let result: AtomicClaimResult | null = null;

      if (cloudEnabled) {
        const { rpcResult, error } = await PoolRepository.syncAtomicClaimDelta(
          activePool.id, itemId, activeUser, delta
        );
        if (error || !rpcResult) {
          // Fail closed: keep the last server-confirmed state, tell the user.
          setPools(prevPools);
          setSyncStatus({ mode: 'supabase_error', lastSyncedAt: formatTimestamp(), errorMessage: error ?? 'Claim rejected.' });
          Alert.alert('Claim not saved', error ?? 'The server rejected this claim. Nothing was changed.');
          return;
        }
        result = rpcResult;
        accepted = applyClaimResult(local, activePool.id, itemId, activeUser.id, rpcResult);
      } else {
        const target = activePool.items.find((i) => i.id === itemId);
        if (!target) return;
        result = evaluateAtomicClaimTransition(target, activeUser, delta).result;
      }

      const reconciled = reconcilePayments(
        accepted.find((p) => p.id === activePool.id) ?? activePool,
        prevBreakdownCents
      );
      const nextPools = accepted.map((p) => (p.id === reconciled.id ? reconciled : p));

      const save = await PoolRepository.saveLocalPools(nextPools);
      if (save.error) {
        setPools(prevPools);
        Alert.alert('Could not save locally', save.error);
        return;
      }
      setPools(nextPools);

      const nextPool = nextPools.find((p) => p.id === activePool.id);
      if (result && nextPool) {
        const triggered = NotificationService.evaluateClaimMilestones(
          activePool, nextPool, targetItemOr(nextPool, itemId), result, notifPrefs
        );
        if (triggered.length > 0) await pushAlerts(triggered);
      }
      if (cloudEnabled) setSyncStatus({ mode: 'supabase_live', lastSyncedAt: formatTimestamp() });
    });
  };
```

Requires imports `withPoolLock`, `applyClaimResult`, `reconcilePayments`, `Alert`. `applyClaimResult` belongs in `repository.ts` (authoritative quantity + claim list) — one function, ~25 lines, and `targetItemOr` is a local helper returning `nextPool.items.find(...)`.

**A2 — settlement guard in `handleToggleLockPool` (L438‑452).**

```tsx
  const handleToggleLockPool = async () => {
    if (activePool.status !== 'locked') {
      const readiness = getSettlementReadiness(activePool);
      if (!readiness.canLock) {
        Alert.alert('Not ready to lock', readiness.blockers.join('\n'));
        return;
      }
    }
    ...
```

**A3 — host-gated paid/pickup.** `handleTogglePaidStatus` and new `handleTogglePickedUp` first `if (!activePool.participants.some((p) => p.id === activeUser.id && p.isHost)) { Alert.alert('Host only', 'Only the host can confirm payments or pickups.'); return; }`; `handleTogglePickedUp` must call `PoolRepository.syncPickedUp` and surface its error (currently cloud pickup changes are never synced).

**A4 — progress displays use orderable total.** Replace `poolSummary.combinedPoolTotal` at L856 with `poolSummary.committedPoolTotal`, and in `handleTriggerCutoffReminder` use `committedPoolTotal`. In `notifications.ts` L156‑165 and the `freeDelivery` bodies, replace `nextSummary.combinedPoolTotal` with `nextSummary.committedPoolTotal` and say "orderable total". `PoolProgressCard.tsx` must do the same at each progress/minimum site (two occurrences; I did not read that file, so treat the line count as unverified).

### 8. Tests — `tests/regression.test.cjs` (new; no dependency changes)

Run with `node --test tests/` (uses the `typescript` dev dependency already present, no network, no Supabase).

```js
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');

const ROOT = path.join(__dirname, '..');
const cache = new Map();
function load(rel) {
  if (cache.has(rel)) return cache.get(rel);
  const file = path.join(ROOT, rel);
  const js = ts.transpileModule(fs.readFileSync(file, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, esModuleInterop: true },
  }).outputText;
  const mod = { exports: {} };
  cache.set(rel, mod.exports);
  const req = (id) => {
    if (id.startsWith('.')) {
      const target = path.posix.normalize(path.posix.join(path.posix.dirname(rel), id));
      const resolved = fs.existsSync(path.join(ROOT, `${target}.ts`)) ? `${target}.ts` : target;
      return load(resolved);
    }
    throw new Error(`Unmocked dependency ${id}`);
  };
  new Function('exports', 'module', 'require', js)(mod.exports, mod, req);
  cache.set(rel, mod.exports);
  return mod.exports;
}

const calc = load('src/utils/calculations.ts');

const claim = (userId, quantity, createdAt) => ({ userId, userName: userId, avatarColor: '#000', quantity, createdAt });
const item = (id, mode, price, claims, caseSize, maxCases) => ({
  id, name: id, category: 't', emoji: 'x', unitLabel: 'u', mode,
  unitPrice: price, retailPrice: price * 2, caseSize, maxCases, claims,
});
const pool = (items, deliveryFee = 24) => ({
  id: 'p', joinCode: 'P-1', title: 't', supplierName: 's', supplierBadge: 'b', category: 'c',
  hostName: 'h', hostVenmoHandle: undefined, neighborhood: 'n', pickupAddress: 'a', pickupWindow: 'w',
  cutoffTime: 'cut', minimumOrderAmount: 300, deliveryFee, freeDeliveryThreshold: 300,
  status: 'open', participants: [], items, messages: [],
});

test('pending case shares do not unlock the supplier minimum', () => {
  const p = pool([item('direct', 'individual', 290, [claim('a', 1)]), item('partial', 'case_split', 15, [claim('a', 1)], 6)]);
  const s = calc.getPoolProgressSummary(p);
  assert.equal(s.committedPoolTotal, 290);
  assert.equal(s.combinedPoolTotal, 305);
  assert.equal(s.isMinimumMet, false);
  assert.equal(s.isFreeDeliveryUnlocked, false);
  assert.equal(calc.getSettlementReadiness(p).canLock, false);
});

test('full-case shares are committed, only the remainder is pending', () => {
  const p = pool([item('c', 'case_split', 3, [claim('a', 7)], 6)]);
  const b = calc.getParticipantBreakdowns(p)[0];
  assert.equal(calc.getPoolProgressSummary(p).committedCents, 1800);
  assert.equal(Math.round(b.committedSubtotal * 100), 1800);
  assert.equal(Math.round(b.pendingCaseSubtotal * 100), 300);
});

test('allocation is deterministic across clients regardless of claim array order', () => {
  const claims = [claim('c', 2, '2026-01-01T00:00:02Z'), claim('a', 2, '2026-01-01T00:00:00Z'), claim('b', 2, '2026-01-01T00:00:01Z'), claim('d', 2, '2026-01-01T00:00:03Z')];
  const forward = calc.allocateItemClaims(item('c', 'case_split', 1, claims, 6));
  const reversed = calc.allocateItemClaims(item('c', 'case_split', 1, [...claims].reverse(), 6));
  assert.deepEqual(forward.committedByUser, reversed.committedByUser);
  assert.equal(forward.committedUnits, 6);
});

test('delivery splits in whole cents and totals reconcile with the invoice', () => {
  const p = pool([item('i', 'individual', 10, [claim('a', 1), claim('b', 1), claim('c', 1)])], 20);
  p.participants = ['a', 'b', 'c'].map((id) => ({ id, name: id, neighborhood: 'n', avatarColor: '#000', paidStatus: 'pending' }));
  const breakdowns = calc.getParticipantBreakdowns(p);
  const due = breakdowns.reduce((sum, b) => sum + Math.round(b.totalDue * 100), 0);
  const manifest = calc.getWholesaleOrderManifest(p);
  assert.equal(manifest.grandTotalSupplierInvoiceCents, 3000 + 2000);
  assert.equal(due, manifest.grandTotalSupplierInvoiceCents);
  assert.deepEqual(breakdowns.map((b) => Math.round(b.estimatedDeliveryShare * 100)).sort((x, y) => x - y), [666, 667, 667]);
});

test('empty pool is never charged and cannot be locked', () => {
  const p = pool([]);
  const s = calc.getPoolProgressSummary(p);
  assert.equal(s.deliveryFeeCents, 0);
  assert.equal(s.activeBuyerCount, 0);
  assert.equal(calc.getParticipantBreakdowns(p).length, 0);
  assert.equal(calc.getSettlementReadiness(p).canLock, false);
});

test('a changed bill clears a prior paid flag', () => {
  const p = pool([item('i', 'individual', 10, [claim('a', 1)])]);
  p.participants = [{ id: 'a', name: 'a', neighborhood: 'n', avatarColor: '#000', paidStatus: 'paid' }];
  const next = { ...p, items: [item('i', 'individual', 10, [claim('a', 2)])] };
  assert.equal(calc.reconcilePayments(next, { a: 1000 }).participants[0].paidStatus, 'pending');
  assert.equal(calc.reconcilePayments(p, { a: 1000 }).participants[0].paidStatus, 'paid');
});

test('schema enforces the migration and authorization invariants', () => {
  const sql = fs.readFileSync(path.join(ROOT, 'supabase/schema.sql'), 'utf8');
  assert.match(sql, /alter table public\.catalog_items add column if not exists max_cases/i);
  assert.match(sql, /host_id uuid references auth\.users/i);
  assert.match(sql, /drop policy if exists "Allow public read\/write/i);
  assert.doesNotMatch(sql, /using \(true\)/i);
  assert.match(sql, /coalesce\(sum\(quantity\), 0\) into v_current/i);
  assert.match(sql, /set search_path = public, pg_temp/i);
  assert.match(sql, /revoke all on public\.item_claims/i);
  assert.doesNotMatch(sql, /p_user_id text/);
  assert.match(sql, /create unique index pools_join_code_uidx/i);
});

test('RPC rejection never falls back to an absolute table write', () => {
  const src = fs.readFileSync(path.join(ROOT, 'src/services/repository.ts'), 'utf8');
  assert.doesNotMatch(src, /syncClaimQuantity\(poolId, itemId, user, fallbackQuantity\)/);
  assert.match(src, /Claim was rejected by the server/);
});
```

Add to `package.json` scripts: `"test": "node --test tests/"`.

---

## Limits (explicit)

- **Not executed:** `tsc --noEmit`, `node --test`, any Postgres/Supabase run, Expo build, device/a11y audit. `npx tsc` and `node node_modules/.../tsc` were both refused by this session's permission mode; no baseline typecheck result exists for either the current or patched tree.
- **Not authored here (remaining work, in my recommended order):**
  1. `ActionModals.tsx`: shared `validateCatalogItem` (finite positive prices, integer `caseSize` 2‑1000, `maxCases` ≥ 1, identity fields), remove `parseFloat(...) || default`, local-invite honesty copy, and add `accessibilityLabel`/`Modal onRequestClose` for Android Back. The invite *redemption* path needs a new `onJoinByCode(code)` prop wiring `join_pool_by_code`; UI copy must state device-local limits.
  2. `HostOrderSheetView.tsx`: pass `getSettlementReadiness` to disable the lock button and show blockers; route "Drop Partial" through `PoolRepository.trimPartialCase`.
  3. Weekly rerun: replace the clone-and-autoclaim with a form for fresh host name, payment handle, pickup address/window, cutoff, minimum/fee/threshold, and **no** auto-claim.
  4. `CatalogItemCard.tsx`: bound `Array.from({length: item.caseSize})` with `Math.min(caseSize, 24)` + numeric summary; add `accessibilityRole="button"`, labels (`Add one share of X`, `Remove one share`, `Increase/share count N`), and `accessibilityState`.
  5. `NotificationCenterModal.tsx` / `SupabaseSetupCard.tsx` / `README.md`: remove "instant push", "automated cutoff countdown", "reseed cloud DB" claims; in-app feed + manual test alerts only.
  6. `create_pool` / `create_catalog_item` / `upsert_message` RPCs are referenced by R7 but not written in this patch; until they exist, `syncNewPool`, `syncNewItem`, `syncNewMessage` should return `{ error: 'Host write RPC not installed' }` rather than writing tables.
  7. `PoolProgressCard.tsx` progress sources (two sites) — mechanical, unverified line numbers.
- **Known behavioral changes to expect:** `combinedPoolTotal` now means *claimed interest* and no longer drives thresholds; `getCaseSplitStatus().isFullyMatched` and `lineItems[].caseFilled` are now per-allocation; cloud mode no longer seeds demo pools; legacy pools are read-only until `admin_bind_legacy_host` is run; anonymous sign-in must be enabled in the Supabase project or cloud writes fail closed.

## Recommended next action

Supervisor: apply §1–§8 on a branch, run `node node_modules/typescript/bin/tsc --noEmit` and `node --test tests/`, then `psql` (or a disposable Supabase branch) apply of `schema.sql` twice to prove both the fresh install and the upgrade path, and against a copy of the legacy data to prove quarantine. Then decide item 1–7 above before calling the QA findings closed.

**Decision for you:** items 1–5 are still required by task-contract acceptance criteria 6–7 (invites/validation/accessibility) and 8 (notification honesty). Do you want me to author those next as a second, equally concrete patch (ActionModals, HostOrderSheetView, CatalogItemCard, notification copy + rerun form), or should the supervisor land this core patch first and re-run QA against a stable tree?