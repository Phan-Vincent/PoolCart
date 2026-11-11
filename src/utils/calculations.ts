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
  unitPrice: number;
  lineTotal: number;
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
 * Calculates pool-wide wholesale progress:
 * - committedPoolTotal: subtotal of all individual items + completed cases
 * - pendingCaseTotal: subtotal of partial cases waiting for more neighbors
 * - delivery fee status (waived once freeDeliveryThreshold is reached, otherwise split evenly among active buyers)
 */
export function getPoolProgressSummary(pool: GroupBuyPool) {
  let committedPoolTotal = 0;
  let pendingCaseTotal = 0;
  let totalRetailValue = 0;

  pool.items.forEach((item) => {
    const status = getCaseSplitStatus(item);
    committedPoolTotal += status.committedUnits * item.unitPrice;
    pendingCaseTotal += status.remainderUnits * item.unitPrice;
    totalRetailValue += status.totalClaimedUnits * item.retailPrice;
  });

  const combinedPoolTotal = committedPoolTotal + pendingCaseTotal;
  const minimumProgressRatio = Math.min(1, combinedPoolTotal / pool.minimumOrderAmount);
  const freeDeliveryProgressRatio = Math.min(1, combinedPoolTotal / pool.freeDeliveryThreshold);

  const amountNeededForMinimum = Math.max(0, pool.minimumOrderAmount - combinedPoolTotal);
  const amountNeededForFreeDelivery = Math.max(0, pool.freeDeliveryThreshold - combinedPoolTotal);

  const isMinimumMet = combinedPoolTotal >= pool.minimumOrderAmount;
  const isFreeDeliveryUnlocked = combinedPoolTotal >= pool.freeDeliveryThreshold;

  // Count participants who have claimed at least 1 unit across any item
  const activeParticipantIds = new Set<string>();
  pool.items.forEach((item) => {
    item.claims.forEach((c) => {
      if (c.quantity > 0) activeParticipantIds.add(c.userId);
    });
  });

  const activeBuyerCount = Math.max(1, activeParticipantIds.size);
  const currentDeliveryFeePerPerson = isFreeDeliveryUnlocked
    ? 0
    : pool.deliveryFee / activeBuyerCount;

  const totalPoolSavings = Math.max(0, totalRetailValue - combinedPoolTotal);

  return {
    committedPoolTotal,
    pendingCaseTotal,
    combinedPoolTotal,
    minimumProgressRatio,
    freeDeliveryProgressRatio,
    amountNeededForMinimum,
    amountNeededForFreeDelivery,
    isMinimumMet,
    isFreeDeliveryUnlocked,
    activeBuyerCount,
    currentDeliveryFeePerPerson,
    totalPoolSavings,
  };
}

/**
 * Generates per-participant itemized ledger and totals for checkout & host tracking.
 */
export function getParticipantBreakdowns(pool: GroupBuyPool): UserCostBreakdown[] {
  const summary = getPoolProgressSummary(pool);

  return pool.participants.map((participant) => {
    let committedSubtotal = 0;
    let pendingCaseSubtotal = 0;
    let totalEstimatedSavings = 0;
    const lineItems: UserCostBreakdown['lineItems'] = [];

    pool.items.forEach((item) => {
      const claim = item.claims.find((c) => c.userId === participant.id);
      if (!claim || claim.quantity <= 0) return;

      const status = getCaseSplitStatus(item);
      const itemSubtotal = claim.quantity * item.unitPrice;
      const itemSavings = claim.quantity * Math.max(0, item.retailPrice - item.unitPrice);
      totalEstimatedSavings += itemSavings;

      const isCaseSplit = item.mode === 'case_split';
      const caseFilled = !isCaseSplit || status.remainderUnits === 0;

      if (caseFilled) {
        committedSubtotal += itemSubtotal;
      } else {
        pendingCaseSubtotal += itemSubtotal;
      }

      lineItems.push({
        itemId: item.id,
        itemName: item.name,
        emoji: item.emoji,
        quantity: claim.quantity,
        unitPrice: item.unitPrice,
        subtotal: itemSubtotal,
        isCaseSplit,
        caseFilled,
        caseProgressText: isCaseSplit
          ? `${status.totalClaimedUnits}/${status.caseSize} case units claimed`
          : undefined,
      });
    });

    const hasItems = lineItems.length > 0;
    const estimatedDeliveryShare = hasItems ? summary.currentDeliveryFeePerPerson : 0;
    const totalDue = committedSubtotal + pendingCaseSubtotal + estimatedDeliveryShare;

    return {
      userId: participant.id,
      userName: participant.name,
      avatarColor: participant.avatarColor,
      committedSubtotal,
      pendingCaseSubtotal,
      estimatedDeliveryShare,
      totalEstimatedSavings,
      totalDue,
      paidStatus: participant.paidStatus,
      pickedUp: participant.pickedUp,
      lineItems,
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
  grandTotalSupplierInvoice: number;
} {
  const summary = getPoolProgressSummary(pool);
  const lines: WholesaleManifestLine[] = [];
  const partialCaseItems: WholesaleManifestLine[] = [];

  pool.items.forEach((item) => {
    const status = getCaseSplitStatus(item);
    if (status.totalClaimedUnits === 0) return;

    const lineTotal = status.committedUnits * item.unitPrice;
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
      unitPrice: item.unitPrice,
      lineTotal,
    };

    lines.push(entry);
    if (item.mode === 'case_split' && status.remainderUnits > 0) {
      partialCaseItems.push(entry);
    }
  });

  const totalSupplierMerchandiseCost = lines.reduce((sum, l) => sum + l.lineTotal, 0);
  const supplierDeliveryFee = summary.isFreeDeliveryUnlocked ? 0 : pool.deliveryFee;
  const grandTotalSupplierInvoice = totalSupplierMerchandiseCost + supplierDeliveryFee;

  return {
    lines,
    partialCaseItems,
    totalSupplierMerchandiseCost,
    supplierDeliveryFee,
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
              `• ${x.item.emoji} ${x.item.name}: ${x.status.neededForNextCase} more needed ($${x.item.unitPrice.toFixed(2)}/${x.item.unitLabel})`
          )
          .join('\n')
      : '';

  return (
    `🥬 Join our neighborhood grocery group buy on PoolCart!\n` +
    `Pool: ${pool.title} (${pool.supplierName})\n` +
    `Host: ${pool.hostName} • Pickup: ${pool.pickupWindow} at ${pool.pickupAddress}\n` +
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
        `• ${l.emoji} ${l.itemName}: ${l.orderQuantityLabel} — $${l.lineTotal.toFixed(2)}`
    )
    .join('\n');

  const neighborLines = breakdowns
    .map(
      (b) =>
        `• ${b.userName} (${b.paidStatus === 'paid' ? 'PAID' : 'PENDING'}): $${b.totalDue.toFixed(2)} — ` +
        b.lineItems.map((li) => `${li.emoji}×${li.quantity}`).join(', ')
    )
    .join('\n');

  return (
    `📋 WHOLESALE PURCHASE ORDER — ${pool.title}\n` +
    `Supplier: ${pool.supplierName}\n` +
    `Host: ${pool.hostName} | Pickup: ${pool.pickupWindow}\n\n` +
    `--- SUPPLIER MASTER ORDER ---\n` +
    `${itemLines || '(No committed full units yet)'}\n` +
    `Merchandise Subtotal: $${manifest.totalSupplierMerchandiseCost.toFixed(2)}\n` +
    `Wholesale Delivery Fee: $${manifest.supplierDeliveryFee.toFixed(2)}\n` +
    `Total Supplier Invoice: $${manifest.grandTotalSupplierInvoice.toFixed(2)}\n\n` +
    `--- NEIGHBOR PICKUP & SPLIT CHECKLIST ---\n` +
    `${neighborLines}`
  );
}
