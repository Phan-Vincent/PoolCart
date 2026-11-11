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

export interface GroupBuyPool {
  id: string;
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
