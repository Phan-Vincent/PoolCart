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
  unitPrice: number; // Price per unit/share
  retailPrice: number; // Typical store retail price per unit for savings comparison
  caseSize?: number; // For case_split items: how many units make 1 full wholesale case (e.g., 6)
  maxCases?: number; // Optional cap on how many full cases can be opened (prevents accidental overflow)
  claims: ParticipantShare[];
}

export interface Participant {
  id: string;
  name: string;
  neighborhood: string;
  avatarColor: string;
  isHost?: boolean;
  paidStatus: 'pending' | 'paid';
  pickedUp?: boolean;
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
  hostName: string;
  hostVenmoHandle?: string;
  neighborhood: string;
  pickupAddress: string;
  pickupWindow: string;
  cutoffTime: string;
  minimumOrderAmount: number;
  deliveryFee: number; // Waived or split among participants
  freeDeliveryThreshold: number;
  status: PoolStatus;
  participants: Participant[];
  items: CatalogItem[];
  messages: PoolMessage[];
}

export interface UserCostBreakdown {
  userId: string;
  userName: string;
  avatarColor: string;
  committedSubtotal: number; // Active items + filled cases
  pendingCaseSubtotal: number; // Unfilled case shares (held until case fills)
  estimatedDeliveryShare: number;
  totalEstimatedSavings: number;
  totalDue: number;
  paidStatus: 'pending' | 'paid';
  pickedUp?: boolean;
  lineItems: {
    itemId: string;
    itemName: string;
    emoji: string;
    quantity: number;
    unitPrice: number;
    subtotal: number;
    isCaseSplit: boolean;
    caseFilled: boolean;
    caseProgressText?: string;
  }[];
}
