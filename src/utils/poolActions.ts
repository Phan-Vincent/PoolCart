import { CatalogItem, GroupBuyPool, Participant, PastOrderReceipt, PoolMessage, PorchDropCheckIn, ReceiptTrueUp, WishlistRequest } from '../types/groupBuy';
import { getCaseSplitStatus, getParticipantBreakdowns, getPoolProgressSummary, money } from './calculations';

export { getParticipantBreakdowns };

export function newId(prefix: string): string {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 12)}`;
}
export function isPoolHost(pool: GroupBuyPool, userId: string): boolean {
  return pool.hostUserId ? pool.hostUserId === userId : pool.participants.some((p) => p.id === userId && p.isHost === true);
}
export function requireNumber(value: number, label: string, min = 0, integer = false, max = 1_000_000): number {
  if (!Number.isFinite(value) || value < min || value > max || (integer && !Number.isInteger(value))) {
    throw new Error(`${label} must be ${integer ? 'a whole number' : 'a finite number'} between ${min} and ${max}.`);
  }
  if (!integer && Math.abs(value * 100 - Math.round(value * 100)) > 0.000001) throw new Error(`${label} must use at most two decimal places.`);
  return value;
}
function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}
export function validatePool(pool: GroupBuyPool): void {
  assert(pool.id && pool.title.trim() && /^[A-Za-z0-9_-]+$/.test(pool.joinCode), 'Pool title and a valid invite code are required.');
  assert(['open', 'minimum_met', 'locked'].includes(pool.status), 'Invalid pool status.');
  for (const participant of pool.participants) {
    assert(['pending', 'demo_authorized', 'demo_paid', 'paid'].includes(participant.paidStatus), 'Invalid payment status.');
  }
  requireNumber(pool.minimumOrderAmount, 'Minimum order', 0.01);
  requireNumber(pool.deliveryFee, 'Delivery fee');
  requireNumber(pool.freeDeliveryThreshold, 'Free-delivery threshold', pool.minimumOrderAmount);
  assert(new Set(pool.participants.map((p) => p.id)).size === pool.participants.length, 'Duplicate participants.');
  assert(new Set(pool.items.map((i) => i.id)).size === pool.items.length, 'Duplicate catalog items.');
  const participants = new Set(pool.participants.map((p) => p.id));
  if (pool.hostUserId) assert(participants.has(pool.hostUserId), 'Host must be a participant.');
  for (const item of pool.items) {
    assert(item.id && item.name.trim() && item.unitLabel.trim(), 'Each item needs a name and unit label.');
    assert(item.mode === 'individual' || item.mode === 'case_split', 'Invalid item mode.');
    requireNumber(item.unitPrice, 'Wholesale unit price', 0.01);
    requireNumber(item.retailPrice, 'Retail unit price', 0.01);
    if (item.actualUnitPrice !== undefined) requireNumber(item.actualUnitPrice, 'Actual unit price', 0.01);
    if (item.mode === 'case_split') {
      requireNumber(item.caseSize ?? 0, 'Shares per case', 2, true, 1000);
      if (item.maxCases !== undefined) requireNumber(item.maxCases, 'Maximum cases', 1, true, 1000);
    }
    assert(new Set(item.claims.map((c) => c.userId)).size === item.claims.length, 'Duplicate claims for one participant.');
    for (const c of item.claims) {
      assert(participants.has(c.userId), 'Every claim must belong to a pool participant.');
      requireNumber(c.quantity, 'Claim quantity', 1, true, 1_000_000);
    }
    if (item.mode === 'case_split' && item.maxCases) assert(getCaseSplitStatus(item).totalClaimedUnits <= item.maxCases * item.caseSize!, 'This item has reached its case cap.');
  }
  if (pool.trueUp?.actualDeliveryFee !== undefined) requireNumber(pool.trueUp.actualDeliveryFee, 'Actual delivery fee');
  if (pool.trueUp?.taxOrBagFee !== undefined) requireNumber(pool.trueUp.taxOrBagFee, 'Receipt fees');
  for (const wish of pool.wishlist ?? []) {
    assert(wish.title.trim(), 'Wishlist title is required.');
    requireNumber(wish.targetCaseSize, 'Wishlist shares per case', 2, true, 1000);
    requireNumber(wish.estimatedUnitPrice, 'Wishlist unit price', 0.01);
    requireNumber(wish.estimatedRetailPrice, 'Wishlist retail price', 0.01);
  }
}

/** Migrate only known legacy fields. Do not silently replace unreadable user data. */
export function normalizePools(value: unknown): GroupBuyPool[] {
  assert(Array.isArray(value) && value.length > 0, 'Saved pool data must contain at least one pool.');
  const pools = JSON.parse(JSON.stringify(value)) as GroupBuyPool[];
  for (const pool of pools) {
    pool.messages ??= [];
    pool.wishlist ??= [];
    pool.hostUserId ??= pool.participants.find((p) => p.isHost)?.id;
    const known = new Set(pool.participants.map((p) => p.id));
    for (const item of pool.items) for (const claim of item.claims) {
      if (!known.has(claim.userId)) {
        pool.participants.push({ id: claim.userId, name: claim.userName, avatarColor: claim.avatarColor, neighborhood: pool.neighborhood, paidStatus: 'pending' });
        known.add(claim.userId);
      }
    }
    for (const participant of pool.participants) {
      const old = participant as Participant & { stripeHoldId?: string; stripeAuthorizedAmount?: number };
      if (String(participant.paidStatus) === 'stripe_authorized') {
        participant.paidStatus = 'demo_authorized';
        participant.demoHoldId = old.stripeHoldId;
        participant.demoAuthorizedAmount = old.stripeAuthorizedAmount;
      }
      delete old.stripeHoldId; delete old.stripeAuthorizedAmount;
      // Old paid flags had no confirmation evidence and could come from opening Venmo.
      if (participant.paidStatus === 'paid' && participant.settledAmount === undefined) participant.paidStatus = 'pending';
      participant.verifiedAuth = false;
    }
    validatePool(pool);
  }
  assert(new Set(pools.map((p) => p.id)).size === pools.length, 'Duplicate pool IDs.');
  assert(new Set(pools.map((p) => p.joinCode.toUpperCase())).size === pools.length, 'Duplicate invite codes.');
  return pools;
}

export type PoolAction =
  | { type: 'claim'; itemId: string; delta: number }
  | { type: 'addItems'; items: CatalogItem[] }
  | { type: 'reorder'; receipt: PastOrderReceipt }
  | { type: 'pledge'; wishId: string }
  | { type: 'request'; wish: WishlistRequest }
  | { type: 'promote'; wishId: string }
  | { type: 'price'; itemId: string; price?: number }
  | { type: 'receipt'; trueUp: ReceiptTrueUp; prices?: { itemId: string; newPrice: number }[] }
  | { type: 'porch'; checkIn: PorchDropCheckIn }
  | { type: 'message'; message: PoolMessage }
  | { type: 'lock' }
  | { type: 'cover' | 'trim'; itemId: string }
  | { type: 'authorizeDemo'; userId: string }
  | { type: 'captureDemo' }
  | { type: 'paid' | 'pickup'; userId: string };

export function applyPoolAction(previous: GroupBuyPool, user: Participant, action: PoolAction): GroupBuyPool {
  const pool = JSON.parse(JSON.stringify(previous)) as GroupBuyPool;
  const host = isPoolHost(pool, user.id);
  const hostActions = ['promote', 'price', 'receipt', 'porch', 'lock', 'cover', 'trim', 'captureDemo', 'paid', 'pickup'];
  if (hostActions.includes(action.type)) assert(host, 'Only the pool host can perform this action.');
  if (['claim', 'addItems', 'reorder', 'pledge', 'request', 'promote', 'cover', 'trim'].includes(action.type)) assert(pool.status !== 'locked', 'Reopen the pool before changing orders or wishlist claims.');
  function ensureParticipant(profile: Participant) {
    if (!pool.participants.some((p) => p.id === profile.id)) pool.participants.push({ ...profile, isHost: false, verifiedAuth: Boolean(profile.verifiedAuth), paidStatus: 'pending', demoHoldId: undefined, demoAuthorizedAmount: undefined, settledAmount: undefined, pickedUp: false });
  }
  function itemById(id: string) {
    const item = pool.items.find((i) => i.id === id);
    assert(item, 'Catalog item no longer exists.');
    return item;
  }
  function changeClaim(item: CatalogItem, quantity: number, profile = user) {
    ensureParticipant(profile);
    const claim = item.claims.find((c) => c.userId === profile.id);
    if (quantity <= 0) item.claims = item.claims.filter((c) => c.userId !== profile.id);
    else if (claim) claim.quantity = quantity;
    else item.claims.push({ userId: profile.id, userName: profile.name, avatarColor: profile.avatarColor, quantity });
  }
  const readyToSettle = () => {
    assert(pool.status === 'locked', 'Lock the finalized pool before recording settlement or pickup.');
    assert(getPoolProgressSummary(pool).isMinimumMet && pool.items.every((i) => getCaseSplitStatus(i).remainderUnits === 0), 'Resolve partial cases and meet the supplier minimum first.');
  };
  switch (action.type) {
    case 'claim': {
      assert(action.delta === 1 || action.delta === -1, 'Claims change one share at a time.');
      const item = itemById(action.itemId);
      changeClaim(item, Math.max(0, (item.claims.find((c) => c.userId === user.id)?.quantity ?? 0) + action.delta));
      break;
    }
    case 'addItems':
      ensureParticipant(user);
      // A submitted item cannot claim shares on another neighbor's behalf.
      for (const item of action.items) assert(item.claims.every((c) => c.userId === user.id), 'An added item can only contain your own claim.');
      pool.items.unshift(...action.items);
      break;
    case 'reorder':
      for (const past of action.receipt.items) {
        let item = pool.items.find((i) => i.name.toLowerCase() === past.name.toLowerCase());
        if (!item) {
          item = { ...past, id: newId('item'), category: 'Re-Ordered Staple', claims: [] };
          pool.items.push(item);
        }
        requireNumber(past.quantity, 'Reorder quantity', 1, true);
        changeClaim(item, (item.claims.find((c) => c.userId === user.id)?.quantity ?? 0) + past.quantity);
      }
      break;
    case 'pledge': {
      const wish = pool.wishlist?.find((w) => w.id === action.wishId && !w.promotedToCatalog);
      assert(wish, 'Wishlist request is no longer available.');
      ensureParticipant(user);
      wish.pledgedUserIds = wish.pledgedUserIds.includes(user.id) ? wish.pledgedUserIds.filter((id) => id !== user.id) : [...wish.pledgedUserIds, user.id];
      break;
    }
    case 'request':
      ensureParticipant(user);
      pool.wishlist = [{ ...action.wish, id: newId('wish'), poolId: pool.id, requestedByUserId: user.id, requestedByUserName: user.name, pledgedUserIds: [user.id], promotedToCatalog: false }, ...(pool.wishlist ?? [])];
      break;
    case 'promote': {
      const wish = pool.wishlist?.find((w) => w.id === action.wishId && !w.promotedToCatalog);
      assert(wish, 'Wishlist request was already promoted or removed.');
      const claims = [...new Set(wish.pledgedUserIds)].map((id) => {
        let participant = pool.participants.find((p) => p.id === id);
        if (!participant) {
          participant = { id, name: id === wish.requestedByUserId ? wish.requestedByUserName : 'Neighbor', avatarColor: '#0D9488', neighborhood: pool.neighborhood, paidStatus: 'pending' };
          pool.participants.push(participant);
        }
        return { userId: id, userName: participant.name, avatarColor: participant.avatarColor, quantity: 1 };
      });
      pool.items.unshift({ id: newId('item'), name: wish.title, emoji: wish.emoji, category: wish.category, unitLabel: wish.suggestedUnitLabel, unitPrice: wish.estimatedUnitPrice, retailPrice: wish.estimatedRetailPrice, mode: 'case_split', caseSize: wish.targetCaseSize, claims });
      wish.promotedToCatalog = true;
      break;
    }
    case 'price': itemById(action.itemId).actualUnitPrice = action.price; break;
    case 'receipt':
      pool.trueUp = action.trueUp;
      for (const update of action.prices ?? []) itemById(update.itemId).actualUnitPrice = update.newPrice;
      break;
    case 'porch': pool.porchCheckIn = action.checkIn; break;
    case 'message':
      assert(!action.message.isAnnouncement || host, 'Only the host can pin an announcement.');
      assert(action.message.text.trim() && action.message.text.length <= 4000, 'Messages must contain 1–4000 characters.');
      pool.messages.push({ ...action.message, poolId: pool.id, userId: user.id, userName: user.name, avatarColor: user.avatarColor, isHost: host });
      break;
    case 'lock':
      if (pool.status === 'locked') pool.status = 'open';
      else {
        assert(getPoolProgressSummary(pool).isMinimumMet, 'The committed order must meet the supplier minimum before locking.');
        assert(pool.items.every((i) => getCaseSplitStatus(i).remainderUnits === 0), 'Cover or drop every partial case before locking.');
        pool.status = 'locked';
      }
      break;
    case 'cover': {
      const item = itemById(action.itemId);
      const needed = getCaseSplitStatus(item).neededForNextCase;
      changeClaim(item, (item.claims.find((c) => c.userId === user.id)?.quantity ?? 0) + needed);
      break;
    }
    case 'trim': {
      const item = itemById(action.itemId);
      let remove = getCaseSplitStatus(item).remainderUnits;
      for (const claim of [...item.claims].reverse()) {
        const quantity = Math.min(remove, claim.quantity);
        claim.quantity -= quantity; remove -= quantity;
      }
      item.claims = item.claims.filter((c) => c.quantity > 0);
      break;
    }
    case 'authorizeDemo': {
      assert(action.userId === user.id, 'You can only simulate a hold for your own share.');
      const participant = pool.participants.find((p) => p.id === user.id);
      const due = getParticipantBreakdowns(pool).find((b) => b.userId === user.id)?.totalDue ?? 0;
      assert(participant && due > 0, 'There is no committed amount to authorize.');
      assert(participant.paidStatus !== 'paid', 'This share is already recorded as paid.');
      participant.paidStatus = 'demo_authorized'; participant.demoHoldId = newId('demo'); participant.demoAuthorizedAmount = due;
      break;
    }
    case 'captureDemo':
      readyToSettle();
      for (const participant of pool.participants) if (participant.paidStatus === 'demo_authorized') {
        const due = getParticipantBreakdowns(pool).find((b) => b.userId === participant.id)!.totalDue;
        assert(participant.demoAuthorizedAmount === due, 'A demo hold is stale; authorize the current amount again.');
        participant.paidStatus = 'demo_paid'; participant.settledAmount = due;
      }
      break;
    case 'paid': {
      readyToSettle();
      const participant = pool.participants.find((p) => p.id === action.userId);
      const due = getParticipantBreakdowns(pool).find((b) => b.userId === action.userId)?.totalDue ?? 0;
      assert(participant && due > 0, 'No payable share for this neighbor.');
      participant.paidStatus = participant.paidStatus === 'paid' ? 'pending' : 'paid';
      participant.settledAmount = participant.paidStatus === 'paid' ? due : undefined;
      participant.demoHoldId = undefined; participant.demoAuthorizedAmount = undefined;
      break;
    }
    case 'pickup': {
      readyToSettle();
      const participant = pool.participants.find((p) => p.id === action.userId);
      assert(participant, 'Participant not found.');
      participant.pickedUp = !participant.pickedUp;
      break;
    }
  }
  validatePool(pool);
  // A changed order invalidates status evidence even if the new dollar total is equal.
  const before = getParticipantBreakdowns(previous);
  const after = getParticipantBreakdowns(pool);
  for (const participant of pool.participants) {
    const a = before.find((b) => b.userId === participant.id);
    const b = after.find((b) => b.userId === participant.id)!;
    const order = (r: typeof b | undefined) => JSON.stringify(r?.lineItems.map((li) => [li.itemId, li.quantity, li.committedQuantity, li.effectiveUnitPrice]) ?? []);
    if (a && (money(a.totalDue) !== money(b.totalDue) || order(a) !== order(b))) {
      participant.paidStatus = 'pending'; participant.demoHoldId = undefined; participant.demoAuthorizedAmount = undefined; participant.settledAmount = undefined; participant.pickedUp = false;
    }
  }
  return pool;
}
