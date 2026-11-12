import {
  getParticipantBreakdowns,
  normalizePools,
  PoolAction,
  requireNumber,
  validatePool,
} from '../utils/poolActions';
import { createWriteQueue } from './storageQueue';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { createClient, RealtimeChannel, SupabaseClient } from '@supabase/supabase-js';
import { CURRENT_USER, INITIAL_POOLS } from '../data/mockPools';
import {
  AtomicClaimResult,
  CatalogItem,
  GroupBuyPool,
  Participant,
  ParticipantShare,
  PoolMessage,
  PorchDropCheckIn,
  ReceiptTrueUp,
  WishlistRequest,
} from '../types/groupBuy';

declare const process: { env: Record<string, string | undefined> };

export const CLOUD_SYNC_AVAILABLE = true;
const enqueueWrite = createWriteQueue();

const STORAGE_KEY_POOLS = '@poolcart_pools_v3';
const STORAGE_KEY_SUPABASE_CONFIG = '@poolcart_supabase_config_v1';
const STORAGE_KEY_ACTIVE_USER = '@poolcart_active_user_v1';
const STORAGE_KEY_PENDING_CLOUD_EDITS = '@poolcart_pending_cloud_edits_v1';

export interface SupabaseConfig {
  url: string;
  anonKey: string;
  enabled: boolean;
}

export type CloudLoadState =
  | 'local_mode'
  | 'auth_required'
  | 'empty_cloud'
  | 'synced'
  | 'auth_rejected'
  | 'network_unavailable'
  | 'schema_or_query_error';

export interface SyncStatusInfo {
  mode:
    | 'local'
    | 'supabase_connecting'
    | 'supabase_auth_required'
    | 'supabase_empty'
    | 'supabase_live'
    | 'supabase_auth_rejected'
    | 'supabase_offline'
    | 'supabase_error';
  label: string;
  lastSyncedAt: string | null;
  errorMessage?: string;
  pendingLocalEditsCount?: number;
  authenticatedUser?: Participant | null;
  lastRealtimeEvent?: string | null;
}

export interface PendingCloudEdit {
  id: string;
  poolId: string;
  createdAt: string;
  kind: 'action' | 'create_pool' | 'join_invite';
  action?: PoolAction;
  poolSnapshot?: GroupBuyPool;
  joinCode?: string;
  lastError?: string;
}

let activeClient: SupabaseClient | null = null;
let activeChannel: RealtimeChannel | null = null;
let currentConfig: SupabaseConfig = {
  url: process.env.EXPO_PUBLIC_SUPABASE_URL || '',
  anonKey: process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY || '',
  enabled: Boolean(
    process.env.EXPO_PUBLIC_SUPABASE_URL && process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY
  ),
};

export const DEMO_PROFILES: Participant[] = [
  CURRENT_USER,
  {
    id: 'u_maya',
    name: 'Maya Lin (Host)',
    neighborhood: 'Victoria Gardens',
    avatarColor: '#E11D48',
    isHost: true,
    paidStatus: 'paid',
  },
  {
    id: 'u_marcus',
    name: 'Marcus T.',
    neighborhood: 'Alta Loma',
    avatarColor: '#2563EB',
    paidStatus: 'paid',
  },
  {
    id: 'u_priya',
    name: 'Priya K.',
    neighborhood: 'Terra Vista',
    avatarColor: '#7C3AED',
    paidStatus: 'pending',
  },
];

function getOrCreateSupabaseClient(): SupabaseClient | null {
  if (!CLOUD_SYNC_AVAILABLE || !currentConfig.enabled || !currentConfig.url || !currentConfig.anonKey) {
    return null;
  }
  if (!activeClient) {
    activeClient = createClient(currentConfig.url.trim(), currentConfig.anonKey.trim(), {
      auth: {
        storage: AsyncStorage,
        autoRefreshToken: true,
        persistSession: true,
        detectSessionInUrl: false,
      },
    });
  }
  return activeClient;
}

export function classifyCloudError(err: unknown): {
  state: 'auth_rejected' | 'network_unavailable' | 'schema_or_query_error';
  message: string;
} {
  const raw =
    typeof err === 'object' && err !== null && 'message' in err
      ? String((err as { message: unknown }).message)
      : String(err ?? 'Unknown cloud error');
  const code =
    typeof err === 'object' && err !== null && 'code' in err
      ? String((err as { code: unknown }).code)
      : '';
  const status =
    typeof err === 'object' && err !== null && 'status' in err
      ? Number((err as { status: unknown }).status)
      : 0;

  if (
    status === 401 ||
    status === 403 ||
    code === '42501' ||
    code === 'PGRST301' ||
    /permission denied|row-level security|authentication required|forged identity|access denied|only the pool host|only the host|not a member|jwt/i.test(
      raw
    )
  ) {
    return { state: 'auth_rejected', message: raw };
  }

  if (
    /network|fetch failed|failed to fetch|offline|timed out|timeout|econnrefused|enotfound|socket|unreachable/i.test(
      raw
    )
  ) {
    return { state: 'network_unavailable', message: raw };
  }

  return { state: 'schema_or_query_error', message: raw };
}

/**
 * Strip simulated demo hold statuses before writing or reading cloud records so
 * simulated card holds are never treated as real payment records in cloud mode.
 */
export function sanitizePoolForCloud(pool: GroupBuyPool): GroupBuyPool {
  const copy = JSON.parse(JSON.stringify(pool)) as GroupBuyPool;
  for (const part of copy.participants) {
    if (part.paidStatus === 'demo_authorized' || part.paidStatus === 'demo_paid') {
      part.paidStatus = 'pending';
    }
    delete part.demoHoldId;
    delete part.demoAuthorizedAmount;
    if (part.paidStatus === 'paid' && (typeof part.settledAmount !== 'number' || part.settledAmount <= 0)) {
      part.paidStatus = 'pending';
      part.settledAmount = undefined;
    }
  }
  return copy;
}

/**
 * Assemble and validate full rich domain state from Supabase table rows.
 */
export function assembleCloudPoolsFromRows(
  poolRows: any[],
  participantRows: any[],
  itemRows: any[],
  claimRows: any[],
  messageRows: any[]
): GroupBuyPool[] {
  const assembled: GroupBuyPool[] = poolRows.map((row: any) => {
    const poolParticipants: Participant[] = (participantRows || [])
      .filter((p: any) => p.pool_id === row.id)
      .map((p: any) => {
        const hasSettled =
          p.settled_amount !== null &&
          p.settled_amount !== undefined &&
          Number(p.settled_amount) > 0;
        const isPaid = p.paid_status === 'paid' && hasSettled;
        return {
          id: String(p.user_id),
          name: String(p.user_name || 'Neighbor'),
          neighborhood: String(p.neighborhood || row.neighborhood || 'Victoria Gardens'),
          avatarColor: String(p.avatar_color || '#0D9488'),
          isHost: Boolean(p.is_host),
          verifiedAuth: !p.legacy_unclaimed,
          paidStatus: isPaid ? 'paid' : 'pending',
          settledAmount: isPaid ? Number(p.settled_amount) : undefined,
          pickedUp: Boolean(p.picked_up),
        };
      });

    const hostUserId =
      row.host_user_id ||
      poolParticipants.find((p) => p.isHost)?.id ||
      undefined;

    const sortedClaims = [...(claimRows || [])].sort(
      (a: any, b: any) => Number(a.claim_seq ?? 0) - Number(b.claim_seq ?? 0)
    );

    const poolItems: CatalogItem[] = (itemRows || [])
      .filter((i: any) => i.pool_id === row.id)
      .map((i: any) => {
        const itemClaims: ParticipantShare[] = sortedClaims
          .filter((c: any) => c.item_id === i.id && Number(c.quantity) > 0)
          .map((c: any) => ({
            userId: String(c.user_id),
            userName: String(c.user_name || 'Neighbor'),
            avatarColor: String(c.avatar_color || '#0D9488'),
            quantity: Number(c.quantity),
          }));

        return {
          id: String(i.id),
          name: String(i.name),
          category: String(i.category || 'Wholesale'),
          emoji: String(i.emoji || '🛒'),
          mode: i.mode === 'case_split' ? 'case_split' : 'individual',
          unitLabel: String(i.unit_label || '1 unit'),
          unitPrice: Number(i.unit_price),
          actualUnitPrice:
            i.actual_unit_price !== null && i.actual_unit_price !== undefined
              ? Number(i.actual_unit_price)
              : undefined,
          retailPrice: Number(i.retail_price),
          caseSize:
            i.case_size !== null && i.case_size !== undefined
              ? Number(i.case_size)
              : undefined,
          maxCases:
            i.max_cases !== null && i.max_cases !== undefined
              ? Number(i.max_cases)
              : undefined,
          claims: itemClaims,
        };
      });

    const poolMessages: PoolMessage[] = (messageRows || [])
      .filter((m: any) => m.pool_id === row.id)
      .map((m: any) => ({
        id: String(m.id),
        poolId: String(m.pool_id),
        userId: String(m.user_id),
        userName: String(m.user_name || 'Neighbor'),
        avatarColor: String(m.avatar_color || '#0D9488'),
        isHost: Boolean(m.is_host),
        isAnnouncement: Boolean(m.is_announcement),
        text: String(m.text || ''),
        createdAt: String(m.created_at_label || 'Just now'),
      }));

    const trueUp: ReceiptTrueUp | undefined =
      row.true_up && typeof row.true_up === 'object'
        ? {
            actualDeliveryFee:
              row.true_up.actualDeliveryFee !== undefined &&
              row.true_up.actualDeliveryFee !== null
                ? Number(row.true_up.actualDeliveryFee)
                : undefined,
            taxOrBagFee:
              row.true_up.taxOrBagFee !== undefined && row.true_up.taxOrBagFee !== null
                ? Number(row.true_up.taxOrBagFee)
                : undefined,
            receiptNote: row.true_up.receiptNote
              ? String(row.true_up.receiptNote)
              : undefined,
            reconciledAt: row.true_up.reconciledAt
              ? String(row.true_up.reconciledAt)
              : undefined,
          }
        : undefined;

    const porchCheckIn: PorchDropCheckIn | undefined =
      row.porch_check_in && typeof row.porch_check_in === 'object'
        ? {
            status:
              row.porch_check_in.status === 'ready_on_porch' ||
              row.porch_check_in.status === 'sorting'
                ? row.porch_check_in.status
                : 'waiting_delivery',
            coolerLocationNote: String(row.porch_check_in.coolerLocationNote || ''),
            accessCodeOrPin: row.porch_check_in.accessCodeOrPin
              ? String(row.porch_check_in.accessCodeOrPin)
              : undefined,
            photoLabel: row.porch_check_in.photoLabel
              ? String(row.porch_check_in.photoLabel)
              : undefined,
            updatedAt: row.porch_check_in.updatedAt
              ? String(row.porch_check_in.updatedAt)
              : undefined,
          }
        : undefined;

    const wishlist: WishlistRequest[] = Array.isArray(row.wishlist)
      ? row.wishlist.map((w: any) => ({
          id: String(w.id),
          poolId: String(w.poolId || row.id),
          title: String(w.title || ''),
          emoji: String(w.emoji || '📦'),
          category: String(w.category || 'Neighbor Request'),
          suggestedUnitLabel: String(w.suggestedUnitLabel || '1 share'),
          estimatedUnitPrice: Number(w.estimatedUnitPrice),
          estimatedRetailPrice: Number(w.estimatedRetailPrice),
          targetCaseSize: Number(w.targetCaseSize),
          requestedByUserId: String(w.requestedByUserId),
          requestedByUserName: String(w.requestedByUserName || 'Neighbor'),
          pledgedUserIds: Array.isArray(w.pledgedUserIds)
            ? w.pledgedUserIds.map((id: any) => String(id))
            : [],
          promotedToCatalog: Boolean(w.promotedToCatalog),
        }))
      : [];

    // Ensure every claim user has a participant entry
    const knownUserIds = new Set(poolParticipants.map((p) => p.id));
    for (const item of poolItems) {
      for (const claim of item.claims) {
        if (!knownUserIds.has(claim.userId)) {
          poolParticipants.push({
            id: claim.userId,
            name: claim.userName,
            avatarColor: claim.avatarColor,
            neighborhood: String(row.neighborhood || 'Victoria Gardens'),
            paidStatus: 'pending',
            verifiedAuth: false,
          });
          knownUserIds.add(claim.userId);
        }
      }
    }

    const pool: GroupBuyPool = {
      id: String(row.id),
      joinCode: String(row.join_code || 'POOL-01'),
      title: String(row.title),
      supplierName: String(row.supplier_name),
      supplierBadge: String(row.supplier_badge),
      category: String(row.category),
      hostUserId,
      hostName: String(row.host_name),
      hostVenmoHandle: row.host_venmo_handle ? String(row.host_venmo_handle) : undefined,
      neighborhood: String(row.neighborhood),
      distanceMiles:
        row.distance_miles !== null && row.distance_miles !== undefined
          ? Number(row.distance_miles)
          : undefined,
      pickupAddress: String(row.pickup_address),
      pickupWindow: String(row.pickup_window),
      cutoffTime: String(row.cutoff_time),
      minimumOrderAmount: Number(row.minimum_order_amount),
      deliveryFee: Number(row.delivery_fee),
      freeDeliveryThreshold: Number(row.free_delivery_threshold),
      status:
        row.status === 'locked' || row.status === 'minimum_met' ? row.status : 'open',
      trueUp,
      porchCheckIn,
      participants: poolParticipants,
      items: poolItems,
      wishlist,
      messages: poolMessages,
    };

    validatePool(pool);
    return pool;
  });

  return assembled;
}

/**
 * Local in-memory / AsyncStorage equivalent of the Postgres `claim_item_share` RPC:
 * Enforces `maxCases` cap, computes whether a case just locked (`justCompletedCase`)
 * or rolled over into a new case (`justOpenedNewCase`).
 */
export function evaluateAtomicClaimTransition(
  item: CatalogItem,
  user: Participant,
  delta: number
): {
  updatedClaims: ParticipantShare[];
  result: AtomicClaimResult;
} {
  requireNumber(Math.abs(delta), 'Claim delta', 0, true);
  const existingUserClaim = item.claims.find((c) => c.userId === user.id);
  const currentUserQty = existingUserClaim ? existingUserClaim.quantity : 0;
  const otherUsersQty = item.claims
    .filter((c) => c.userId !== user.id)
    .reduce((sum, c) => sum + c.quantity, 0);

  const prevTotal = currentUserQty + otherUsersQty;
  let nextUserQty = Math.max(0, currentUserQty + delta);
  let nextTotal = otherUsersQty + nextUserQty;
  let cappedAtMaxCases = false;

  const caseSize = item.mode === 'case_split' && item.caseSize ? item.caseSize : 1;

  if (item.mode === 'case_split' && item.maxCases && item.maxCases > 0) {
    const maxAllowedUnits = item.maxCases * caseSize;
    if (nextTotal > maxAllowedUnits) {
      nextUserQty = Math.max(0, maxAllowedUnits - otherUsersQty);
      nextTotal = otherUsersQty + nextUserQty;
      cappedAtMaxCases = true;
    }
  }

  let updatedClaims = [...item.claims];
  if (nextUserQty <= 0) {
    updatedClaims = updatedClaims.filter((c) => c.userId !== user.id);
  } else if (existingUserClaim) {
    updatedClaims = updatedClaims.map((c) =>
      c.userId === user.id ? { ...c, quantity: nextUserQty } : c
    );
  } else {
    updatedClaims.push({
      userId: user.id,
      userName: user.name,
      avatarColor: user.avatarColor,
      quantity: nextUserQty,
    });
  }

  const prevFullCases =
    item.mode === 'case_split' && caseSize > 1
      ? Math.floor(prevTotal / caseSize)
      : prevTotal;
  const nextFullCases =
    item.mode === 'case_split' && caseSize > 1
      ? Math.floor(nextTotal / caseSize)
      : nextTotal;
  const remainderUnits =
    item.mode === 'case_split' && caseSize > 1 ? nextTotal % caseSize : 0;

  const justCompletedCase =
    item.mode === 'case_split' &&
    caseSize > 1 &&
    nextFullCases > prevFullCases &&
    remainderUnits === 0;

  const justOpenedNewCase =
    item.mode === 'case_split' &&
    caseSize > 1 &&
    prevTotal > 0 &&
    prevTotal % caseSize === 0 &&
    nextTotal > prevTotal;

  return {
    updatedClaims,
    result: {
      newUserQuantity: nextUserQty,
      totalClaimedUnits: nextTotal,
      fullCasesCount: nextFullCases,
      remainderUnits,
      justCompletedCase,
      justOpenedNewCase,
      cappedAtMaxCases,
    },
  };
}

export const PoolRepository = {
  /** Override client in tests without opening real sockets. */
  setTestSupabaseClient(client: SupabaseClient | null, config?: SupabaseConfig) {
    activeClient = client;
    if (config) {
      currentConfig = { ...config };
    }
  },

  async initConfig(): Promise<SupabaseConfig> {
    try {
      const saved = await AsyncStorage.getItem(STORAGE_KEY_SUPABASE_CONFIG);
      if (saved) {
        const parsed = JSON.parse(saved) as Partial<SupabaseConfig>;
        if (typeof parsed.url === 'string' && typeof parsed.anonKey === 'string') {
          currentConfig = {
            url: parsed.url.trim(),
            anonKey: parsed.anonKey.trim(),
            enabled: Boolean(parsed.enabled && parsed.url.trim() && parsed.anonKey.trim()),
          };
          activeClient = null;
        }
      }
    } catch (err) {
      console.warn('Failed to load Supabase config:', err);
    }
    return currentConfig;
  },

  getCurrentConfig(): SupabaseConfig {
    return currentConfig;
  },

  async saveSupabaseConfig(config: SupabaseConfig): Promise<void> {
    const trimmedUrl = config.url.trim();
    const trimmedKey = config.anonKey.trim();
    if (config.enabled && (!trimmedUrl || !trimmedKey)) {
      throw new Error('Supabase Project URL and Anon Key are required to enable cloud mode.');
    }
    if (config.enabled && !/^https?:\/\//i.test(trimmedUrl)) {
      throw new Error('Supabase Project URL must start with https:// or http://.');
    }
    currentConfig = {
      url: trimmedUrl,
      anonKey: trimmedKey,
      enabled: Boolean(config.enabled && trimmedUrl && trimmedKey),
    };
    activeClient = null;
    if (activeChannel) {
      await activeChannel.unsubscribe();
      activeChannel = null;
    }
    const payload = JSON.stringify(currentConfig);
    await enqueueWrite(() => AsyncStorage.setItem(STORAGE_KEY_SUPABASE_CONFIG, payload));
  },

  /**
   * Resolves the authenticated cloud user strictly from the Supabase Auth session
   * and server-side `user_profiles` / `upsert_my_profile` RPC—never from local demo profiles.
   */
  async getAuthenticatedCloudUser(): Promise<{
    user: Participant | null;
    error?: string;
  }> {
    const client = getOrCreateSupabaseClient();
    if (!client) return { user: null };

    try {
      const { data: sessionData, error: sessionErr } = await client.auth.getSession();
      if (sessionErr) throw sessionErr;
      const sessionUser = sessionData?.session?.user;
      if (!sessionUser || !sessionUser.id) {
        return { user: null };
      }

      const meta = (sessionUser.user_metadata || {}) as Record<string, unknown>;
      const fallbackName =
        (typeof meta.display_name === 'string' && meta.display_name.trim()) ||
        (typeof meta.full_name === 'string' && meta.full_name.trim()) ||
        (sessionUser.email ? sessionUser.email.split('@')[0] : 'Neighbor');
      const fallbackHood =
        (typeof meta.neighborhood === 'string' && meta.neighborhood.trim()) ||
        'Victoria Gardens';
      const fallbackColor =
        (typeof meta.avatar_color === 'string' && meta.avatar_color.trim()) ||
        '#0D9488';

      const { data: profileData, error: rpcErr } = await client.rpc('upsert_my_profile', {
        p_display_name: fallbackName,
        p_neighborhood: fallbackHood,
        p_avatar_color: fallbackColor,
      });

      if (!rpcErr && profileData && typeof profileData === 'object') {
        const p = profileData as Record<string, unknown>;
        return {
          user: {
            id: String(sessionUser.id),
            name: String(p.name || fallbackName),
            email: sessionUser.email || undefined,
            neighborhood: String(p.neighborhood || fallbackHood),
            avatarColor: String(p.avatarColor || fallbackColor),
            verifiedAuth: true,
            paidStatus: 'pending',
          },
        };
      }

      return {
        user: {
          id: String(sessionUser.id),
          name: fallbackName,
          email: sessionUser.email || undefined,
          neighborhood: fallbackHood,
          avatarColor: fallbackColor,
          verifiedAuth: true,
          paidStatus: 'pending',
        },
      };
    } catch (err: any) {
      return {
        user: null,
        error: err?.message || 'Failed to verify authenticated cloud session.',
      };
    }
  },

  async signInCloudWithPassword(
    email: string,
    password: string,
    displayName?: string,
    neighborhood?: string
  ): Promise<{ user: Participant; error?: string }> {
    const client = getOrCreateSupabaseClient();
    if (!client) {
      throw new Error('Enable and save your Supabase URL and Anon Key first.');
    }
    const cleanEmail = email.trim().toLowerCase();
    if (!cleanEmail || !password) {
      throw new Error('Email and password are required for cloud sign-in.');
    }

    const { data, error } = await client.auth.signInWithPassword({
      email: cleanEmail,
      password,
    });
    if (error || !data?.user) {
      throw new Error(error?.message || 'Cloud sign-in failed.');
    }

    if (displayName?.trim() || neighborhood?.trim()) {
      await client.rpc('upsert_my_profile', {
        p_display_name: displayName?.trim() || cleanEmail.split('@')[0],
        p_neighborhood: neighborhood?.trim() || 'Victoria Gardens',
        p_avatar_color: '#0D9488',
      });
    }

    const { user, error: profileErr } = await this.getAuthenticatedCloudUser();
    if (!user) {
      throw new Error(profileErr || 'Signed in, but could not resolve cloud profile.');
    }
    return { user };
  },

  async signUpCloudAccount(
    email: string,
    password: string,
    displayName: string,
    neighborhood: string
  ): Promise<{ user: Participant | null; requiresEmailConfirmation?: boolean }> {
    const client = getOrCreateSupabaseClient();
    if (!client) {
      throw new Error('Enable and save your Supabase URL and Anon Key first.');
    }
    const cleanEmail = email.trim().toLowerCase();
    const cleanName = displayName.trim();
    const cleanHood = neighborhood.trim() || 'Victoria Gardens';
    if (!cleanEmail || !password || !cleanName) {
      throw new Error('Display name, email, and password are required to create a cloud account.');
    }

    const colors = ['#0D9488', '#E11D48', '#2563EB', '#7C3AED', '#D97706', '#059669'];
    const avatarColor = colors[cleanName.length % colors.length];

    const { data, error } = await client.auth.signUp({
      email: cleanEmail,
      password,
      options: {
        data: {
          display_name: cleanName,
          neighborhood: cleanHood,
          avatar_color: avatarColor,
        },
      },
    });
    if (error) {
      throw new Error(error.message);
    }

    if (!data?.session) {
      return { user: null, requiresEmailConfirmation: true };
    }

    await client.rpc('upsert_my_profile', {
      p_display_name: cleanName,
      p_neighborhood: cleanHood,
      p_avatar_color: avatarColor,
    });

    const { user } = await this.getAuthenticatedCloudUser();
    return { user };
  },

  async signOutCloud(): Promise<void> {
    const client = getOrCreateSupabaseClient();
    if (client) {
      await client.auth.signOut();
    }
  },

  async loadActiveUser(): Promise<Participant> {
    try {
      const raw = await AsyncStorage.getItem(STORAGE_KEY_ACTIVE_USER);
      if (raw) {
        const user = JSON.parse(raw) as Participant;
        if (!user.id || !user.name) throw new Error('Invalid saved profile.');
        return { ...user, verifiedAuth: false };
      }
    } catch (err) {
      console.warn('Failed to load active user profile:', err);
    }
    return CURRENT_USER;
  },

  async saveActiveUser(user: Participant): Promise<void> {
    if (currentConfig.enabled) {
      throw new Error(
        'Demo profile switching is disabled while cloud sync is active. Use your authenticated cloud account or switch back to local demo mode.'
      );
    }
    await enqueueWrite(() =>
      AsyncStorage.setItem(
        STORAGE_KEY_ACTIVE_USER,
        JSON.stringify({ ...user, verifiedAuth: false })
      )
    );
  },

  async loadPendingCloudEdits(): Promise<PendingCloudEdit[]> {
    try {
      const raw = await AsyncStorage.getItem(STORAGE_KEY_PENDING_CLOUD_EDITS);
      if (!raw) return [];
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? (parsed as PendingCloudEdit[]) : [];
    } catch {
      return [];
    }
  },

  async savePendingCloudEdits(edits: PendingCloudEdit[]): Promise<void> {
    const payload = JSON.stringify(edits);
    await enqueueWrite(() =>
      AsyncStorage.setItem(STORAGE_KEY_PENDING_CLOUD_EDITS, payload)
    );
  },

  async queuePendingCloudEdit(edit: PendingCloudEdit): Promise<PendingCloudEdit[]> {
    const existing = await this.loadPendingCloudEdits();
    const updated = [...existing, edit];
    await this.savePendingCloudEdits(updated);
    return updated;
  },

  async clearPendingCloudEdits(): Promise<void> {
    await this.savePendingCloudEdits([]);
  },

  /**
   * Loads pools from Supabase when cloud mode is enabled and authenticated.
   * Never automatically seeds sample fixtures on connection or empty cloud database.
   * Explicitly distinguishes:
   *   - `local_mode`
   *   - `auth_required`
   *   - `empty_cloud`
   *   - `synced`
   *   - `auth_rejected`
   *   - `network_unavailable`
   *   - `schema_or_query_error`
   */
  async loadPools(): Promise<{
    pools: GroupBuyPool[];
    cloudState: CloudLoadState;
    authenticatedUser?: Participant | null;
    pendingEditsCount: number;
    error?: string;
  }> {
    const pendingEdits = await this.loadPendingCloudEdits();
    const client = getOrCreateSupabaseClient();

    if (client) {
      const { user: cloudUser, error: authErr } = await this.getAuthenticatedCloudUser();
      if (!cloudUser) {
        const localFallback = await this.loadLocalPools();
        return {
          pools: localFallback,
          cloudState: authErr ? 'auth_rejected' : 'auth_required',
          authenticatedUser: null,
          pendingEditsCount: pendingEdits.length,
          error:
            authErr ||
            'Sign in with an authenticated cloud account to view or sync shared pools. Local demo profiles are not used in cloud mode.',
        };
      }

      try {
        const [poolsRes, partsRes, itemsRes, claimsRes, msgsRes] = await Promise.all([
          client.from('pools').select('*').order('created_at', { ascending: true }),
          client.from('pool_participants').select('*'),
          client.from('catalog_items').select('*').order('created_at', { ascending: true }),
          client.from('item_claims').select('*'),
          client.from('pool_messages').select('*').order('created_at', { ascending: true }),
        ]);

        if (poolsRes.error) throw poolsRes.error;
        if (partsRes.error) throw partsRes.error;
        if (itemsRes.error) throw itemsRes.error;
        if (claimsRes.error) throw claimsRes.error;
        if (msgsRes.error) throw msgsRes.error;

        if (!poolsRes.data || poolsRes.data.length === 0) {
          // Never auto-upload sample fixtures on an empty database!
          return {
            pools: [],
            cloudState: 'empty_cloud',
            authenticatedUser: cloudUser,
            pendingEditsCount: pendingEdits.length,
          };
        }

        const assembled = assembleCloudPoolsFromRows(
          poolsRes.data,
          partsRes.data || [],
          itemsRes.data || [],
          claimsRes.data || [],
          msgsRes.data || []
        );

        // Only overwrite local storage cache when there are no unsaved pending local edits
        if (pendingEdits.length === 0 && assembled.length > 0) {
          await this.saveLocalPools(assembled);
        }

        return {
          pools: assembled,
          cloudState: 'synced',
          authenticatedUser: cloudUser,
          pendingEditsCount: pendingEdits.length,
        };
      } catch (err: any) {
        const classified = classifyCloudError(err);
        const fallback = await this.loadLocalPools().catch(() => []);
        return {
          pools: fallback,
          cloudState: classified.state,
          authenticatedUser: cloudUser,
          pendingEditsCount: pendingEdits.length,
          error: classified.message,
        };
      }
    }

    const localPools = await this.loadLocalPools();
    return {
      pools: localPools,
      cloudState: 'local_mode',
      authenticatedUser: null,
      pendingEditsCount: pendingEdits.length,
    };
  },

  async loadLocalPools(): Promise<GroupBuyPool[]> {
    const raw = await AsyncStorage.getItem(STORAGE_KEY_POOLS);
    const pools = normalizePools(raw === null ? INITIAL_POOLS : JSON.parse(raw));
    if (raw === null) await this.saveLocalPools(pools);
    return pools;
  },

  async saveLocalPools(pools: GroupBuyPool[]): Promise<void> {
    // Validate and capture bytes before enqueueing, so later mutations cannot alter this save.
    const payload = JSON.stringify(normalizePools(pools));
    await enqueueWrite(() => AsyncStorage.setItem(STORAGE_KEY_POOLS, payload));
  },

  /**
   * Joins a cloud pool by invite code via the server-enforced `join_pool_by_invite` RPC.
   */
  async joinCloudPoolByInvite(
    joinCode: string,
    user: Participant
  ): Promise<{ poolId?: string; joinCode?: string; error?: string; state?: CloudLoadState }> {
    const client = getOrCreateSupabaseClient();
    if (!client) {
      return { error: 'Cloud mode is not enabled.', state: 'local_mode' };
    }
    const cleanCode = joinCode.trim().toUpperCase();
    if (!cleanCode) {
      return { error: 'Enter a valid invite code.', state: 'schema_or_query_error' };
    }

    try {
      const { data, error } = await client.rpc('join_pool_by_invite', {
        p_join_code: cleanCode,
        p_display_name: user.name,
        p_neighborhood: user.neighborhood,
        p_avatar_color: user.avatarColor,
      });

      if (error) throw error;
      if (!data || typeof data !== 'object' || !(data as any).poolId) {
        throw new Error('Invite join RPC returned no pool ID.');
      }
      return {
        poolId: String((data as any).poolId),
        joinCode: String((data as any).joinCode || cleanCode),
        state: 'synced',
      };
    } catch (err: any) {
      const classified = classifyCloudError(err);
      if (classified.state === 'network_unavailable') {
        await this.queuePendingCloudEdit({
          id: `edit_${Date.now()}`,
          poolId: cleanCode,
          createdAt: new Date().toISOString(),
          kind: 'join_invite',
          joinCode: cleanCode,
          lastError: classified.message,
        });
      }
      return { error: classified.message, state: classified.state };
    }
  },

  /**
   * Creates a new pool or rerun pool in cloud mode via `create_pool_with_catalog` RPC.
   * Strips any simulated demo payment fields first.
   */
  async createCloudPool(
    pool: GroupBuyPool
  ): Promise<{ poolId?: string; error?: string; state?: CloudLoadState }> {
    const client = getOrCreateSupabaseClient();
    if (!client) return { state: 'local_mode' };

    const cleanPool = sanitizePoolForCloud(pool);
    try {
      const { data, error } = await client.rpc('create_pool_with_catalog', {
        p_pool: cleanPool,
      });
      if (error) throw error;
      if (!data || typeof data !== 'object' || !(data as any).poolId) {
        throw new Error('Create pool RPC returned no pool ID.');
      }
      return { poolId: String((data as any).poolId), state: 'synced' };
    } catch (err: any) {
      const classified = classifyCloudError(err);
      await this.queuePendingCloudEdit({
        id: `edit_${Date.now()}`,
        poolId: cleanPool.id,
        createdAt: new Date().toISOString(),
        kind: 'create_pool',
        poolSnapshot: cleanPool,
        lastError: classified.message,
      });
      return { error: classified.message, state: classified.state };
    }
  },

  /**
   * Calls the PostgreSQL `claim_item_share` RPC (`FOR UPDATE` row-level lock) when
   * connected to Supabase. Missing or rejecting RPCs fail closed with no unrestricted fallback.
   */
  async syncAtomicClaimDelta(
    poolId: string,
    itemId: string,
    user: Participant,
    delta: number,
    _fallbackQuantity?: number
  ): Promise<{ rpcResult?: AtomicClaimResult; error?: string; state?: CloudLoadState }> {
    const client = getOrCreateSupabaseClient();
    if (!client) return { state: 'local_mode' };

    try {
      const { data, error } = await client.rpc('claim_item_share', {
        p_pool_id: poolId,
        p_item_id: itemId,
        p_user_id: user.id,
        p_user_name: user.name,
        p_avatar_color: user.avatarColor,
        p_neighborhood: user.neighborhood,
        p_delta: delta,
      });

      if (error) throw error;
      if (!data) {
        throw new Error('Claim RPC returned no result; no fallback write was attempted.');
      }

      return { rpcResult: data as AtomicClaimResult, state: 'synced' };
    } catch (err: any) {
      const classified = classifyCloudError(err);
      await this.queuePendingCloudEdit({
        id: `edit_${Date.now()}`,
        poolId,
        createdAt: new Date().toISOString(),
        kind: 'action',
        action: { type: 'claim', itemId, delta },
        lastError: classified.message,
      });
      return { error: classified.message, state: classified.state };
    }
  },

  /**
   * Executes a multi-row or host-guarded domain mutation via the transactional
   * `apply_pool_action_rpc` stored procedure. Never falls back to direct table writes.
   */
  async syncCloudPoolAction(
    pool: GroupBuyPool,
    user: Participant,
    action: PoolAction
  ): Promise<{ rpcResult?: AtomicClaimResult; error?: string; state?: CloudLoadState }> {
    const client = getOrCreateSupabaseClient();
    if (!client) return { state: 'local_mode' };

    if (action.type === 'claim') {
      return this.syncAtomicClaimDelta(pool.id, action.itemId, user, action.delta);
    }

    if (action.type === 'authorizeDemo' || action.type === 'captureDemo') {
      return {
        error:
          'Simulated card holds are confined to local demo mode and are never sent to cloud payment records.',
        state: 'auth_rejected',
      };
    }

    try {
      let payload: Record<string, unknown> = { ...action };
      if (action.type === 'paid') {
        const due =
          getParticipantBreakdowns(pool).find((b) => b.userId === action.userId)?.totalDue ?? 0;
        payload = { ...action, settledAmount: due };
      }

      const { data, error } = await client.rpc('apply_pool_action_rpc', {
        p_pool_id: pool.id,
        p_action: payload,
      });

      if (error) throw error;
      if (!data) {
        throw new Error('Pool action RPC returned no confirmation; no fallback write was attempted.');
      }
      return { state: 'synced' };
    } catch (err: any) {
      const classified = classifyCloudError(err);
      await this.queuePendingCloudEdit({
        id: `edit_${Date.now()}`,
        poolId: pool.id,
        createdAt: new Date().toISOString(),
        kind: 'action',
        action,
        lastError: classified.message,
      });
      return { error: classified.message, state: classified.state };
    }
  },

  /**
   * Replays queued pending local edits against the cloud RPCs in order.
   * Stops at the first failure so remaining edits are preserved without data loss.
   */
  async flushPendingCloudEdits(
    currentPools: GroupBuyPool[],
    user: Participant
  ): Promise<{ remaining: number; error?: string }> {
    const client = getOrCreateSupabaseClient();
    if (!client) {
      const edits = await this.loadPendingCloudEdits();
      return { remaining: edits.length, error: 'Cloud mode is not enabled.' };
    }

    const edits = await this.loadPendingCloudEdits();
    if (edits.length === 0) return { remaining: 0 };

    const remainingEdits = [...edits];
    while (remainingEdits.length > 0) {
      const current = remainingEdits[0];
      let err: string | undefined;

      if (current.kind === 'create_pool' && current.poolSnapshot) {
        const { data, error } = await client.rpc('create_pool_with_catalog', {
          p_pool: sanitizePoolForCloud(current.poolSnapshot),
        });
        if (error || !data) err = error?.message || 'Failed to replay pool creation.';
      } else if (current.kind === 'join_invite' && current.joinCode) {
        const { data, error } = await client.rpc('join_pool_by_invite', {
          p_join_code: current.joinCode,
          p_display_name: user.name,
          p_neighborhood: user.neighborhood,
          p_avatar_color: user.avatarColor,
        });
        if (error || !data) err = error?.message || 'Failed to replay invite join.';
      } else if (current.kind === 'action' && current.action) {
        if (current.action.type === 'claim') {
          const { data, error } = await client.rpc('claim_item_share', {
            p_pool_id: current.poolId,
            p_item_id: current.action.itemId,
            p_user_id: user.id,
            p_user_name: user.name,
            p_avatar_color: user.avatarColor,
            p_neighborhood: user.neighborhood,
            p_delta: current.action.delta,
          });
          if (error || !data) err = error?.message || 'Failed to replay claim delta.';
        } else {
          const targetPool = currentPools.find((p) => p.id === current.poolId);
          let payload: Record<string, unknown> = { ...current.action };
          if (current.action.type === 'paid' && targetPool) {
            const due =
              getParticipantBreakdowns(targetPool).find(
                (b) => b.userId === (current.action as any).userId
              )?.totalDue ?? 0;
            payload = { ...current.action, settledAmount: due };
          }
          const { data, error } = await client.rpc('apply_pool_action_rpc', {
            p_pool_id: current.poolId,
            p_action: payload,
          });
          if (error || !data) err = error?.message || 'Failed to replay pool action.';
        }
      }

      if (err) {
        remainingEdits[0] = { ...current, lastError: err };
        await this.savePendingCloudEdits(remainingEdits);
        return { remaining: remainingEdits.length, error: err };
      }

      remainingEdits.shift();
      await this.savePendingCloudEdits(remainingEdits);
    }

    return { remaining: 0 };
  },

  async syncItemClaimsList(
    _poolId: string,
    _itemId: string,
    _claims: ParticipantShare[]
  ): Promise<{ error?: string }> {
    return {
      error:
        'Cloud claim replacement requires an authorized transactional RPC; no delete or upsert was attempted.',
    };
  },

  subscribeToRealtime(onRemoteChange: (eventTable: string) => void): () => void {
    const client = getOrCreateSupabaseClient();
    if (!client) {
      return () => {};
    }

    if (activeChannel) {
      activeChannel.unsubscribe();
      activeChannel = null;
    }

    const channel = client
      .channel('poolcart-live-sync')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'item_claims' },
        () => onRemoteChange('item_claims')
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'catalog_items' },
        () => onRemoteChange('catalog_items')
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'pool_participants' },
        () => onRemoteChange('pool_participants')
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'pools' },
        () => onRemoteChange('pools')
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'pool_messages' },
        () => onRemoteChange('pool_messages')
      )
      .subscribe();

    activeChannel = channel;

    return () => {
      channel.unsubscribe();
      if (activeChannel === channel) {
        activeChannel = null;
      }
    };
  },

  async resetDemoData(): Promise<GroupBuyPool[]> {
    if (currentConfig.enabled) {
      throw new Error(
        'Demo fixture reset is only available in local demo mode and never uploads fixtures to a cloud project.'
      );
    }
    const fresh = normalizePools(INITIAL_POOLS);
    await this.saveLocalPools(fresh);
    return fresh;
  },
};
