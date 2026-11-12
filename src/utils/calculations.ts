import { CatalogItem, GroupBuyPool, UserCostBreakdown } from '../types/groupBuy';

export interface CaseSplitStatus {
  totalClaimedUnits: number;
  caseSize: number;
  fullCasesCount: number;
  committedUnits: number; // Units that are part of full cases
  remainderUnits: number; // Units waiting to fill the next case
  neededForNextCase: number;
  isFullyMatched: boolean;
}

export interface WholesaleManifestLine {
  itemId: string;
  itemName: string;
  emoji: string;
  mode: 'individual' | 'case_split';
  orderQuantityLabel: string; // e.g. "4 units (12-ct bag)" or "1 full case (6 units)"
  committedUnits: number;
  unfilledRemainderUnits: number;
  neededToFillNextCase: number;
  quotedUnitPrice: number;
  effectiveUnitPrice: number;
  lineTotal: number;
}

export function getEffectiveUnitPrice(item: CatalogItem): number {
  return typeof item.actualUnitPrice === 'number' && Number.isFinite(item.actualUnitPrice) && item.actualUnitPrice > 0
    ? item.actualUnitPrice
    : item.unitPrice;
}

export function extractPoolCodeFromUrl(rawUrl: string | null | undefined): string | null {
  if (!rawUrl) return null;
  try {
    const queryMatch = rawUrl.match(/[?&](?:pool|code)=([A-Za-z0-9_-]+)/i);
    if (queryMatch && queryMatch[1]) {
      return queryMatch[1].toUpperCase();
    }
    const pathMatch = rawUrl.match(/\/join\/([A-Za-z0-9_-]+)/i);
    if (pathMatch && pathMatch[1]) {
      return pathMatch[1].toUpperCase();
    }
  } catch {
    return null;
  }
  return null;
}

/**
 * Calculates how many full cases are formed for a `case_split` item,
 * and how many units are still needed to complete the current partial case.
 */
export function getCaseSplitStatus(item: CatalogItem): CaseSplitStatus {
  const totalClaimedUnits = item.claims.reduce((sum, c) => sum + c.quantity, 0);
  if (item.mode !== 'case_split' || !item.caseSize || item.caseSize <= 1) {
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

  const caseSize = item.caseSize;
  const fullCasesCount = Math.floor(totalClaimedUnits / caseSize);
  const committedUnits = fullCasesCount * caseSize;
  const remainderUnits = totalClaimedUnits % caseSize;
  const neededForNextCase = remainderUnits === 0 ? 0 : caseSize - remainderUnits;

  return {
    totalClaimedUnits,
    caseSize,
    fullCasesCount,
    committedUnits,
    remainderUnits,
    neededForNextCase,
    isFullyMatched: totalClaimedUnits > 0 && remainderUnits === 0,
  };
}

/**
 * Calculates pool-wide wholesale progress (respecting Receipt True-Up prices when entered)
 */
export function money(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

/** Stable largest-remainder allocation. All returned amounts are exact cents. */
export function allocateCents(total: number, weights: { id: string; weight: number }[]): Map<string, number> {
  const eligible = weights.filter((w) => w.weight > 0);
  const weightSum = eligible.reduce((sum, w) => sum + w.weight, 0);
  const cents = Math.round(Math.abs(total) * 100);
  const rows = eligible.map((w) => {
    const exact = cents * w.weight / weightSum;
    return { id: w.id, cents: Math.floor(exact), fraction: exact - Math.floor(exact) };
  });
  let remaining = cents - rows.reduce((sum, r) => sum + r.cents, 0);
  rows.sort((a, b) => b.fraction - a.fraction || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  for (const row of rows) if (remaining-- > 0) row.cents += 1;
  return new Map(rows.map((r) => [r.id, (total < 0 ? -1 : 1) * r.cents / 100]));
}

/** Claim-array order is the allocation order; trimming removes from its end. */
export function getCommittedQuantity(item: CatalogItem, userId: string): number {
  let remaining = getCaseSplitStatus(item).committedUnits;
  for (const claim of item.claims) {
    const quantity = Math.min(claim.quantity, Math.max(0, remaining));
    if (claim.userId === userId) return quantity;
    remaining -= quantity;
  }
  return 0;
}

export function getPoolProgressSummary(pool: GroupBuyPool) {
  let committedPoolTotal = 0;
  let pendingCaseTotal = 0;
  let quotedCombinedTotal = 0;
  let totalRetailValue = 0;
  const activeParticipantIds = new Set<string>();
  pool.items.forEach((item) => {
    const status = getCaseSplitStatus(item);
    const price = getEffectiveUnitPrice(item);
    committedPoolTotal += money(status.committedUnits * price);
    pendingCaseTotal += money(status.remainderUnits * price);
    quotedCombinedTotal += money(status.committedUnits * item.unitPrice);
    totalRetailValue += money(status.committedUnits * item.retailPrice);
    item.claims.forEach((c) => {
      if (getCommittedQuantity(item, c.userId) > 0) activeParticipantIds.add(c.userId);
    });
  });
  committedPoolTotal = money(committedPoolTotal);
  pendingCaseTotal = money(pendingCaseTotal);
  quotedCombinedTotal = money(quotedCombinedTotal);
  // Historical callers use combinedPoolTotal; it now means orderable merchandise only.
  const combinedPoolTotal = committedPoolTotal;
  const hasOrder = activeParticipantIds.size > 0;
  const isMinimumMet = hasOrder && committedPoolTotal >= pool.minimumOrderAmount;
  const isFreeDeliveryUnlocked = hasOrder && committedPoolTotal >= pool.freeDeliveryThreshold;
  const effectiveDeliveryFee = !hasOrder ? 0 : money(pool.trueUp?.actualDeliveryFee ??
    (isFreeDeliveryUnlocked ? 0 : pool.deliveryFee));
  const extraTaxOrBagFee = hasOrder ? money(pool.trueUp?.taxOrBagFee ?? 0) : 0;
  return {
    committedPoolTotal, pendingCaseTotal, combinedPoolTotal, quotedCombinedTotal,
    minimumProgressRatio: pool.minimumOrderAmount > 0 ? Math.min(1, combinedPoolTotal / pool.minimumOrderAmount) : (hasOrder ? 1 : 0),
    freeDeliveryProgressRatio: pool.freeDeliveryThreshold > 0 ? Math.min(1, combinedPoolTotal / pool.freeDeliveryThreshold) : (hasOrder ? 1 : 0),
    amountNeededForMinimum: money(Math.max(0, pool.minimumOrderAmount - combinedPoolTotal)),
    amountNeededForFreeDelivery: money(Math.max(0, pool.freeDeliveryThreshold - combinedPoolTotal)),
    isMinimumMet, isFreeDeliveryUnlocked,
    activeBuyerCount: activeParticipantIds.size,
    effectiveDeliveryFee,
    currentDeliveryFeePerPerson: hasOrder ? effectiveDeliveryFee / activeParticipantIds.size : 0,
    extraTaxOrBagFee,
    totalPoolSavings: money(totalRetailValue - committedPoolTotal - effectiveDeliveryFee - extraTaxOrBagFee),
  };
}

export function getParticipantBreakdowns(pool: GroupBuyPool): UserCostBreakdown[] {
  const summary = getPoolProgressSummary(pool);
  const rows = pool.participants.map((participant) => {
    const lineItems: UserCostBreakdown['lineItems'] = [];
    let committedSubtotal = 0;
    let pendingCaseSubtotal = 0;
    let quotedSubtotal = 0;
    let retailSubtotal = 0;
    pool.items.forEach((item) => {
      const claim = item.claims.find((c) => c.userId === participant.id);
      if (!claim || claim.quantity <= 0) return;
      const committedQuantity = getCommittedQuantity(item, participant.id);
      const pendingQuantity = claim.quantity - committedQuantity;
      const effectiveUnitPrice = getEffectiveUnitPrice(item);
      const subtotal = money(committedQuantity * effectiveUnitPrice);
      const pendingSubtotal = money(pendingQuantity * effectiveUnitPrice);
      committedSubtotal += subtotal;
      pendingCaseSubtotal += pendingSubtotal;
      quotedSubtotal += money(committedQuantity * item.unitPrice);
      retailSubtotal += money(committedQuantity * item.retailPrice);
      lineItems.push({
        itemId: item.id, itemName: item.name, emoji: item.emoji,
        quantity: claim.quantity, committedQuantity, pendingQuantity, pendingSubtotal,
        quotedUnitPrice: item.unitPrice, effectiveUnitPrice, subtotal,
        isCaseSplit: item.mode === 'case_split', caseFilled: pendingQuantity === 0,
        caseProgressText: `${committedQuantity} committed; ${pendingQuantity} pending (not payable)`,
      });
    });
    return { participant, lineItems, committedSubtotal: money(committedSubtotal),
      pendingCaseSubtotal: money(pendingCaseSubtotal), quotedSubtotal: money(quotedSubtotal), retailSubtotal: money(retailSubtotal) };
  });
  const weights = rows.map((r) => ({ id: r.participant.id, weight: r.committedSubtotal }));
  const buyers = rows.map((r) => ({ id: r.participant.id, weight: r.lineItems.some((li) => li.committedQuantity > 0) ? 1 : 0 }));
  const delivery = allocateCents(summary.effectiveDeliveryFee, buyers);
  const taxes = allocateCents(summary.extraTaxOrBagFee, weights);
  const originalDelivery = allocateCents(summary.quotedCombinedTotal >= pool.freeDeliveryThreshold ? 0 : pool.deliveryFee, buyers);
  return rows.map((r) => {
    const estimatedDeliveryShare = delivery.get(r.participant.id) ?? 0;
    const proRataTaxOrAdjustment = taxes.get(r.participant.id) ?? 0;
    const totalDue = money(r.committedSubtotal + estimatedDeliveryShare + proRataTaxOrAdjustment);
    return {
      userId: r.participant.id, userName: r.participant.name, avatarColor: r.participant.avatarColor,
      committedSubtotal: r.committedSubtotal, pendingCaseSubtotal: r.pendingCaseSubtotal,
      estimatedDeliveryShare, proRataTaxOrAdjustment, totalDue,
      netTrueUpDelta: money(totalDue - r.quotedSubtotal - (originalDelivery.get(r.participant.id) ?? 0)),
      totalEstimatedSavings: money(r.retailSubtotal - totalDue),
      paidStatus: r.participant.paidStatus, demoHoldId: r.participant.demoHoldId,
      pickedUp: r.participant.pickedUp, lineItems: r.lineItems,
    };
  });
}

/**
 * Generates the Host Wholesale Supplier Purchase Order Manifest
 */
export function getWholesaleOrderManifest(pool: GroupBuyPool): {
  lines: WholesaleManifestLine[];
  partialCaseItems: WholesaleManifestLine[];
  totalSupplierMerchandiseCost: number;
  supplierDeliveryFee: number;
  extraTaxOrBagFee: number;
  grandTotalSupplierInvoice: number;
} {
  const summary = getPoolProgressSummary(pool);
  const lines: WholesaleManifestLine[] = [];
  const partialCaseItems: WholesaleManifestLine[] = [];

  pool.items.forEach((item) => {
    const status = getCaseSplitStatus(item);
    if (status.totalClaimedUnits === 0) return;

    const effectivePrice = getEffectiveUnitPrice(item);
    const lineTotal = money(status.committedUnits * effectivePrice);
    const orderQuantityLabel =
      item.mode === 'case_split'
        ? `${status.fullCasesCount} full case${status.fullCasesCount === 1 ? '' : 's'} (${status.committedUnits} × ${item.unitLabel})`
        : `${status.committedUnits} × ${item.unitLabel}`;

    const entry: WholesaleManifestLine = {
      itemId: item.id,
      itemName: item.name,
      emoji: item.emoji,
      mode: item.mode,
      orderQuantityLabel,
      committedUnits: status.committedUnits,
      unfilledRemainderUnits: status.remainderUnits,
      neededToFillNextCase: status.neededForNextCase,
      quotedUnitPrice: item.unitPrice,
      effectiveUnitPrice: effectivePrice,
      lineTotal,
    };

    lines.push(entry);
    if (item.mode === 'case_split' && status.remainderUnits > 0) {
      partialCaseItems.push(entry);
    }
  });

  const totalSupplierMerchandiseCost = money(lines.reduce((sum, l) => sum + l.lineTotal, 0));
  const supplierDeliveryFee = summary.effectiveDeliveryFee;
  const extraTaxOrBagFee = summary.extraTaxOrBagFee;
  const grandTotalSupplierInvoice =
    money(totalSupplierMerchandiseCost + supplierDeliveryFee + extraTaxOrBagFee);

  return {
    lines,
    partialCaseItems,
    totalSupplierMerchandiseCost,
    supplierDeliveryFee,
    extraTaxOrBagFee,
    grandTotalSupplierInvoice,
  };
}

/**
 * Generates formatted text for native iOS/Android sharing (invite neighbors or export supplier manifest)
 */
export function buildShareablePoolInviteText(pool: GroupBuyPool): string {
  const summary = getPoolProgressSummary(pool);
  const partialCases = pool.items
    .map((item) => ({ item, status: getCaseSplitStatus(item) }))
    .filter((x) => x.item.mode === 'case_split' && x.status.neededForNextCase > 0);

  const partialLines =
    partialCases.length > 0
      ? `\n📦 Open Bulk Case Splits needing shares:\n` +
        partialCases
          .map(
            (x) =>
              `• ${x.item.emoji} ${x.item.name}: ${x.status.neededForNextCase} more needed ($${getEffectiveUnitPrice(
                x.item
              ).toFixed(2)}/${x.item.unitLabel})`
          )
          .join('\n')
      : '';

  return (
    `🥬 Join our neighborhood grocery group buy on PoolCart!\n` +
    `🔑 Pool Invite Code: ${pool.joinCode}\n` +
    `Open in installed app: poolcart://join/${encodeURIComponent(pool.joinCode)}\n` +
    `Pool: ${pool.title} (${pool.supplierName})\n` +
    `Host: ${pool.hostName} • Pickup: ${pool.pickupWindow}\n` +
    `Progress: $${summary.combinedPoolTotal.toFixed(2)} / $${pool.minimumOrderAmount} minimum (${
      summary.isFreeDeliveryUnlocked
        ? 'FREE wholesale delivery unlocked!'
        : `$${summary.amountNeededForFreeDelivery.toFixed(2)} away from free delivery`
    })\n` +
    `Cutoff: ${pool.cutoffTime}` +
    partialLines
  );
}

export function buildSupplierOrderExportText(pool: GroupBuyPool): string {
  const manifest = getWholesaleOrderManifest(pool);
  const breakdowns = getParticipantBreakdowns(pool).filter((b) => b.lineItems.length > 0);

  const itemLines = manifest.lines
    .filter((l) => l.committedUnits > 0)
    .map(
      (l) =>
        `• ${l.emoji} ${l.itemName}: ${l.orderQuantityLabel} @ $${l.effectiveUnitPrice.toFixed(
          2
        )} — $${l.lineTotal.toFixed(2)}`
    )
    .join('\n');

  const neighborLines = breakdowns
    .map(
      (b) =>
        `• ${b.userName} (${b.paidStatus === 'paid' ? 'PAID' : 'PENDING'}): $${b.totalDue.toFixed(2)} — ` +
        b.lineItems.filter((li) => li.committedQuantity > 0).map((li) => `${li.emoji}×${li.committedQuantity}`).join(', ')
    )
    .join('\n');

  return (
    `📋 WHOLESALE PURCHASE ORDER — ${pool.title} [${pool.joinCode}]\n` +
    `Supplier: ${pool.supplierName}\n` +
    `Host: ${pool.hostName} | Pickup: ${pool.pickupWindow}\n\n` +
    `--- SUPPLIER MASTER ORDER ---\n` +
    `${itemLines || '(No committed full units yet)'}\n` +
    `Merchandise Subtotal: $${manifest.totalSupplierMerchandiseCost.toFixed(2)}\n` +
    `Wholesale Delivery Fee: $${manifest.supplierDeliveryFee.toFixed(2)}\n` +
    (manifest.extraTaxOrBagFee !== 0
      ? `Receipt Tax / Weight Adjustment: $${manifest.extraTaxOrBagFee.toFixed(2)}\n`
      : '') +
    `Total Supplier Invoice: $${manifest.grandTotalSupplierInvoice.toFixed(2)}\n\n` +
    `--- NEIGHBOR PICKUP & SPLIT CHECKLIST ---\n` +
    `${neighborLines}`
  );
}
