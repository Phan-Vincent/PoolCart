export type ItemMode = 'individual' | 'case_split';

export interface ParticipantShare {
  userId: string;
  userName: string;
  avatarColor: string;
  quantity: number; // In individual mode: number of items. In case_split mode: number of shares/units claimed.
  paid?: boolean;
}

export interface CatalogItem {
  id: string;
  name: string;
  category: string;
  emoji: string;
  mode: ItemMode;
  unitLabel: string; // e.g. "5 lb bag" or "1 bottle (from 6-pack case)"
  unitPrice: number; // Estimated wholesale price per unit/share
  actualUnitPrice?: number; // True-up final receipt price per unit/share (if adjusted on delivery day)
  retailPrice: number; // Typical store retail price per unit for savings comparison
  caseSize?: number; // For case_split items: how many units make 1 full wholesale case (e.g., 6)
  maxCases?: number; // Optional cap on how many full cases can be opened
  claims: ParticipantShare[];
}

export interface WishlistRequest {
  id: string;
  poolId: string;
  title: string;
  emoji: string;
  category: string;
  suggestedUnitLabel: string;
  estimatedUnitPrice: number;
  estimatedRetailPrice: number;
  targetCaseSize: number;
  requestedByUserId: string;
  requestedByUserName: string;
  pledgedUserIds: string[]; // Neighbors who upvoted / pledged to take a share if added
  promotedToCatalog?: boolean;
}

export interface ReceiptTrueUp {
  actualDeliveryFee?: number;
  taxOrBagFee?: number; // Extra wholesale tax/crv/ice fee split proportionally
  receiptNote?: string;
  reconciledAt?: string;
}

export interface PorchDropCheckIn {
  status: 'waiting_delivery' | 'sorting' | 'ready_on_porch';
  coolerLocationNote: string;
  accessCodeOrPin?: string;
  photoLabel?: string;
  updatedAt?: string;
}

export type PaidStatus = 'pending' | 'demo_authorized' | 'demo_paid' | 'paid';

export interface Participant {
  id: string;
  name: string;
  email?: string;
  neighborhood: string;
  avatarColor: string;
  isHost?: boolean;
  verifiedAuth?: boolean;
  paidStatus: PaidStatus;
  demoHoldId?: string;
  demoAuthorizedAmount?: number;
  pickedUp?: boolean;
  settledAmount?: number;
}

export type PoolStatus = 'open' | 'minimum_met' | 'locked';

export interface PoolMessage {
  id: string;
  poolId: string;
  userId: string;
  userName: string;
  avatarColor: string;
  isHost?: boolean;
  isAnnouncement?: boolean;
  text: string;
  createdAt: string;
}

export type AlertCategory =
  | 'case_locked'
  | 'minimum_met'
  | 'free_delivery_near'
  | 'free_delivery_unlocked'
  | 'cutoff_reminder'
  | 'porch_pickup_ready';

export interface PoolNotificationAlert {
  id: string;
  poolId: string;
  poolTitle: string;
  category: AlertCategory;
  title: string;
  body: string;
  createdAt: string;
  read: boolean;
}

export interface NotificationPreferences {
  cutoffReminder2h: boolean;
  freeDeliveryProximity: boolean;
  caseSplitCompletion: boolean;
  porchDropArrival: boolean;
}

export interface AtomicClaimResult {
  newUserQuantity: number;
  totalClaimedUnits: number;
  fullCasesCount: number;
  remainderUnits: number;
  justCompletedCase: boolean;
  justOpenedNewCase: boolean;
  cappedAtMaxCases: boolean;
  message?: string;
}

export interface PastOrderReceipt {
  id: string;
  poolTitle: string;
  supplierName: string;
  completedDate: string;
  totalPaid: number;
  totalSaved: number;
  items: {
    name: string;
    emoji: string;
    unitLabel: string;
    unitPrice: number;
    retailPrice: number;
    quantity: number;
    mode: ItemMode;
    caseSize?: number;
  }[];
}

export interface SupplierCatalogTemplate {
  id: string;
  name: string;
  supplierName: string;
  supplierBadge: string;
  category: string;
  emoji: string;
  defaultMinimumOrder: number;
  defaultDeliveryFee: number;
  defaultFreeThreshold: number;
  items: Omit<CatalogItem, 'id' | 'claims'>[];
}

export interface GroupBuyPool {
  id: string;
  joinCode: string; // e.g. "VG-FARM" or "WEEE-88"
  title: string;
  supplierName: string;
  supplierBadge: string;
  category: string;
  hostUserId?: string; // Verified host owner ID for role permissions
  hostName: string;
  hostVenmoHandle?: string;
  neighborhood: string;
  distanceMiles?: number; // e.g. 0.4 or 1.1 for neighborhood radius filtering
  pickupAddress: string;
  pickupWindow: string;
  cutoffTime: string;
  minimumOrderAmount: number;
  deliveryFee: number; // Waived or split among participants
  freeDeliveryThreshold: number;
  status: PoolStatus;
  trueUp?: ReceiptTrueUp;
  porchCheckIn?: PorchDropCheckIn;
  participants: Participant[];
  items: CatalogItem[];
  wishlist?: WishlistRequest[];
  messages: PoolMessage[];
}

export interface UserCostBreakdown {
  userId: string;
  userName: string;
  avatarColor: string;
  committedSubtotal: number; // Active items + filled cases (using actualUnitPrice if reconciled)
  pendingCaseSubtotal: number; // Unfilled case shares (held until case fills)
  estimatedDeliveryShare: number;
  proRataTaxOrAdjustment: number; // Pro-rata share of receipt tax/bag fee or weight adjustment
  netTrueUpDelta: number; // Difference vs initial pre-receipt estimate
  totalEstimatedSavings: number;
  totalDue: number;
  paidStatus: PaidStatus;
  demoHoldId?: string;
  pickedUp?: boolean;
  lineItems: {
    itemId: string;
    itemName: string;
    emoji: string;
    quantity: number;
    committedQuantity: number;
    pendingQuantity: number;
    pendingSubtotal: number;
    quotedUnitPrice: number;
    effectiveUnitPrice: number;
    subtotal: number;
    isCaseSplit: boolean;
    caseFilled: boolean;
    caseProgressText?: string;
  }[];
}
