import AsyncStorage from '@react-native-async-storage/async-storage';
import { createClient, RealtimeChannel, SupabaseClient } from '@supabase/supabase-js';
import { CURRENT_USER, INITIAL_POOLS } from '../data/mockPools';
import { CatalogItem, GroupBuyPool, Participant, ParticipantShare } from '../types/groupBuy';

declare const process: { env: Record<string, string | undefined> };

const STORAGE_KEY_POOLS = '@poolcart_pools_v2';
const STORAGE_KEY_SUPABASE_CONFIG = '@poolcart_supabase_config_v1';
const STORAGE_KEY_ACTIVE_USER = '@poolcart_active_user_v1';

export interface SupabaseConfig {
  url: string;
  anonKey: string;
  enabled: boolean;
}

export interface SyncStatusInfo {
  mode: 'local' | 'supabase_connecting' | 'supabase_live' | 'supabase_error';
  label: string;
  lastSyncedAt: string | null;
  errorMessage?: string;
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
  if (!currentConfig.enabled || !currentConfig.url || !currentConfig.anonKey) {
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

export const PoolRepository = {
  /**
   * Loads saved Supabase credentials from AsyncStorage (or falls back to .env)
   */
  async initConfig(): Promise<SupabaseConfig> {
    try {
      const saved = await AsyncStorage.getItem(STORAGE_KEY_SUPABASE_CONFIG);
      if (saved) {
        const parsed = JSON.parse(saved) as SupabaseConfig;
        if (parsed.url && parsed.anonKey) {
          currentConfig = parsed;
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
    currentConfig = {
      url: config.url.trim(),
      anonKey: config.anonKey.trim(),
      enabled: config.enabled && Boolean(config.url.trim() && config.anonKey.trim()),
    };
    activeClient = null;
    if (activeChannel) {
      await activeChannel.unsubscribe();
      activeChannel = null;
    }
    await AsyncStorage.setItem(STORAGE_KEY_SUPABASE_CONFIG, JSON.stringify(currentConfig));
  },

  async loadActiveUser(): Promise<Participant> {
    try {
      const raw = await AsyncStorage.getItem(STORAGE_KEY_ACTIVE_USER);
      if (raw) {
        return JSON.parse(raw) as Participant;
      }
    } catch (err) {
      console.warn('Failed to load active user profile:', err);
    }
    return CURRENT_USER;
  },

  async saveActiveUser(user: Participant): Promise<void> {
    try {
      await AsyncStorage.setItem(STORAGE_KEY_ACTIVE_USER, JSON.stringify(user));
    } catch (err) {
      console.warn('Failed to save active user profile:', err);
    }
  },

  /**
   * Fetches all pools. If Supabase is configured & enabled, fetches relational rows
   * from `pools`, `pool_participants`, `catalog_items`, and `item_claims`.
   * If tables are empty on first connect, automatically seeds `INITIAL_POOLS`.
   */
  async loadPools(): Promise<{ pools: GroupBuyPool[]; error?: string }> {
    const client = getOrCreateSupabaseClient();
    if (client) {
      try {
        const [poolsRes, partsRes, itemsRes, claimsRes] = await Promise.all([
          client.from('pools').select('*').order('created_at', { ascending: true }),
          client.from('pool_participants').select('*'),
          client.from('catalog_items').select('*').order('created_at', { ascending: true }),
          client.from('item_claims').select('*'),
        ]);

        if (poolsRes.error) throw poolsRes.error;
        if (partsRes.error) throw partsRes.error;
        if (itemsRes.error) throw itemsRes.error;
        if (claimsRes.error) throw claimsRes.error;

        // If the Supabase database has 0 pools, seed it with INITIAL_POOLS automatically
        if (!poolsRes.data || poolsRes.data.length === 0) {
          await this.seedSupabasePools(INITIAL_POOLS);
          await AsyncStorage.setItem(STORAGE_KEY_POOLS, JSON.stringify(INITIAL_POOLS));
          return { pools: INITIAL_POOLS };
        }

        const assembled: GroupBuyPool[] = poolsRes.data.map((row: any) => {
          const poolParticipants: Participant[] = (partsRes.data || [])
            .filter((p: any) => p.pool_id === row.id)
            .map((p: any) => ({
              id: p.user_id,
              name: p.user_name,
              neighborhood: p.neighborhood || 'Victoria Gardens',
              avatarColor: p.avatar_color || '#0D9488',
              isHost: Boolean(p.is_host),
              paidStatus: (p.paid_status === 'paid' ? 'paid' : 'pending') as 'pending' | 'paid',
            }));

          const poolItems: CatalogItem[] = (itemsRes.data || [])
            .filter((i: any) => i.pool_id === row.id)
            .map((i: any) => {
              const itemClaims: ParticipantShare[] = (claimsRes.data || [])
                .filter((c: any) => c.item_id === i.id && Number(c.quantity) > 0)
                .map((c: any) => ({
                  userId: c.user_id,
                  userName: c.user_name,
                  avatarColor: c.avatar_color,
                  quantity: Number(c.quantity),
                }));

              return {
                id: i.id,
                name: i.name,
                category: i.category,
                emoji: i.emoji || '🛒',
                mode: i.mode === 'case_split' ? 'case_split' : 'individual',
                unitLabel: i.unit_label,
                unitPrice: Number(i.unit_price),
                retailPrice: Number(i.retail_price),
                caseSize: i.case_size ? Number(i.case_size) : undefined,
                claims: itemClaims,
              };
            });

          return {
            id: row.id,
            title: row.title,
            supplierName: row.supplier_name,
            supplierBadge: row.supplier_badge,
            category: row.category,
            hostName: row.host_name,
            neighborhood: row.neighborhood,
            pickupAddress: row.pickup_address,
            pickupWindow: row.pickup_window,
            cutoffTime: row.cutoff_time,
            minimumOrderAmount: Number(row.minimum_order_amount),
            deliveryFee: Number(row.delivery_fee),
            freeDeliveryThreshold: Number(row.free_delivery_threshold),
            status: row.status || 'open',
            participants: poolParticipants,
            items: poolItems,
          };
        });

        await AsyncStorage.setItem(STORAGE_KEY_POOLS, JSON.stringify(assembled));
        return { pools: assembled };
      } catch (err: any) {
        const msg = err?.message || 'Supabase fetch failed. Check schema & credentials.';
        const fallback = await this.loadLocalPools();
        return { pools: fallback, error: msg };
      }
    }

    const localPools = await this.loadLocalPools();
    return { pools: localPools };
  },

  async loadLocalPools(): Promise<GroupBuyPool[]> {
    try {
      const raw = await AsyncStorage.getItem(STORAGE_KEY_POOLS);
      if (!raw) {
        await AsyncStorage.setItem(STORAGE_KEY_POOLS, JSON.stringify(INITIAL_POOLS));
        return INITIAL_POOLS;
      }
      return JSON.parse(raw) as GroupBuyPool[];
    } catch {
      return INITIAL_POOLS;
    }
  },

  async saveLocalPools(pools: GroupBuyPool[]): Promise<void> {
    try {
      await AsyncStorage.setItem(STORAGE_KEY_POOLS, JSON.stringify(pools));
    } catch (err) {
      console.warn('Failed to save pools locally:', err);
    }
  },

  /**
   * Seeds initial pools, participants, items, and claims into Supabase
   */
  async seedSupabasePools(pools: GroupBuyPool[]): Promise<{ error?: string }> {
    const client = getOrCreateSupabaseClient();
    if (!client) return {};

    try {
      const poolRows = pools.map((p) => ({
        id: p.id,
        title: p.title,
        supplier_name: p.supplierName,
        supplier_badge: p.supplierBadge,
        category: p.category,
        host_name: p.hostName,
        neighborhood: p.neighborhood,
        pickup_address: p.pickupAddress,
        pickup_window: p.pickupWindow,
        cutoff_time: p.cutoffTime,
        minimum_order_amount: p.minimumOrderAmount,
        delivery_fee: p.deliveryFee,
        free_delivery_threshold: p.freeDeliveryThreshold,
        status: p.status,
      }));

      const participantRows = pools.flatMap((p) =>
        p.participants.map((part) => ({
          pool_id: p.id,
          user_id: part.id,
          user_name: part.name,
          neighborhood: part.neighborhood,
          avatar_color: part.avatarColor,
          is_host: Boolean(part.isHost),
          paid_status: part.paidStatus,
        }))
      );

      const itemRows = pools.flatMap((p) =>
        p.items.map((item) => ({
          id: item.id,
          pool_id: p.id,
          name: item.name,
          category: item.category,
          emoji: item.emoji,
          mode: item.mode,
          unit_label: item.unitLabel,
          unit_price: item.unitPrice,
          retail_price: item.retailPrice,
          case_size: item.caseSize ?? null,
        }))
      );

      const claimRows = pools.flatMap((p) =>
        p.items.flatMap((item) =>
          item.claims.map((c) => ({
            pool_id: p.id,
            item_id: item.id,
            user_id: c.userId,
            user_name: c.userName,
            avatar_color: c.avatarColor,
            quantity: c.quantity,
          }))
        )
      );

      const r1 = await client.from('pools').upsert(poolRows, { onConflict: 'id' });
      if (r1.error) throw r1.error;

      const r2 = await client
        .from('pool_participants')
        .upsert(participantRows, { onConflict: 'pool_id,user_id' });
      if (r2.error) throw r2.error;

      const r3 = await client.from('catalog_items').upsert(itemRows, { onConflict: 'id' });
      if (r3.error) throw r3.error;

      const r4 = await client
        .from('item_claims')
        .upsert(claimRows, { onConflict: 'item_id,user_id' });
      if (r4.error) throw r4.error;

      return {};
    } catch (err: any) {
      return { error: err?.message || 'Failed to seed Supabase database' };
    }
  },

  /**
   * Syncs a single claim update to Supabase (and ensures participant is in pool_participants)
   */
  async syncClaimQuantity(
    poolId: string,
    itemId: string,
    user: Participant,
    nextQuantity: number
  ): Promise<{ error?: string }> {
    const client = getOrCreateSupabaseClient();
    if (!client) return {};

    try {
      await client.from('pool_participants').upsert(
        {
          pool_id: poolId,
          user_id: user.id,
          user_name: user.name,
          neighborhood: user.neighborhood,
          avatar_color: user.avatarColor,
          is_host: Boolean(user.isHost),
          paid_status: user.paidStatus,
        },
        { onConflict: 'pool_id,user_id' }
      );

      if (nextQuantity <= 0) {
        const { error } = await client
          .from('item_claims')
          .delete()
          .match({ item_id: itemId, user_id: user.id });
        if (error) throw error;
      } else {
        const { error } = await client.from('item_claims').upsert(
          {
            pool_id: poolId,
            item_id: itemId,
            user_id: user.id,
            user_name: user.name,
            avatar_color: user.avatarColor,
            quantity: nextQuantity,
            updated_at: new Date().toISOString(),
          },
          { onConflict: 'item_id,user_id' }
        );
        if (error) throw error;
      }
      return {};
    } catch (err: any) {
      return { error: err?.message || 'Failed to sync item claim' };
    }
  },

  async syncNewItem(
    poolId: string,
    item: CatalogItem,
    creator: Participant
  ): Promise<{ error?: string }> {
    const client = getOrCreateSupabaseClient();
    if (!client) return {};

    try {
      const { error: itemErr } = await client.from('catalog_items').insert({
        id: item.id,
        pool_id: poolId,
        name: item.name,
        category: item.category,
        emoji: item.emoji,
        mode: item.mode,
        unit_label: item.unitLabel,
        unit_price: item.unitPrice,
        retail_price: item.retailPrice,
        case_size: item.caseSize ?? null,
      });
      if (itemErr) throw itemErr;

      const firstClaim = item.claims[0];
      if (firstClaim) {
        await this.syncClaimQuantity(poolId, item.id, creator, firstClaim.quantity);
      }
      return {};
    } catch (err: any) {
      return { error: err?.message || 'Failed to sync new item' };
    }
  },

  async syncNewPool(pool: GroupBuyPool): Promise<{ error?: string }> {
    return this.seedSupabasePools([pool]);
  },

  async syncPaidStatus(
    poolId: string,
    userId: string,
    paidStatus: 'pending' | 'paid'
  ): Promise<{ error?: string }> {
    const client = getOrCreateSupabaseClient();
    if (!client) return {};

    try {
      const { error } = await client
        .from('pool_participants')
        .update({ paid_status: paidStatus, updated_at: new Date().toISOString() })
        .match({ pool_id: poolId, user_id: userId });
      if (error) throw error;
      return {};
    } catch (err: any) {
      return { error: err?.message || 'Failed to update paid status' };
    }
  },

  async syncPoolStatus(
    poolId: string,
    status: 'open' | 'minimum_met' | 'locked'
  ): Promise<{ error?: string }> {
    const client = getOrCreateSupabaseClient();
    if (!client) return {};

    try {
      const { error } = await client
        .from('pools')
        .update({ status })
        .match({ id: poolId });
      if (error) throw error;
      return {};
    } catch (err: any) {
      return { error: err?.message || 'Failed to update pool status' };
    }
  },

  async syncItemClaimsList(
    poolId: string,
    itemId: string,
    claims: ParticipantShare[]
  ): Promise<{ error?: string }> {
    const client = getOrCreateSupabaseClient();
    if (!client) return {};

    try {
      await client.from('item_claims').delete().match({ item_id: itemId });
      if (claims.length > 0) {
        const rows = claims.map((c) => ({
          pool_id: poolId,
          item_id: itemId,
          user_id: c.userId,
          user_name: c.userName,
          avatar_color: c.avatarColor,
          quantity: c.quantity,
          updated_at: new Date().toISOString(),
        }));
        const { error } = await client
          .from('item_claims')
          .upsert(rows, { onConflict: 'item_id,user_id' });
        if (error) throw error;
      }
      return {};
    } catch (err: any) {
      return { error: err?.message || 'Failed to sync item claims list' };
    }
  },

  /**
   * Subscribes to Supabase Postgres Changes across `pools`, `pool_participants`,
   * `catalog_items`, and `item_claims` so all connected phones update immediately.
   */
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
    await AsyncStorage.setItem(STORAGE_KEY_POOLS, JSON.stringify(INITIAL_POOLS));
    if (currentConfig.enabled) {
      await this.seedSupabasePools(INITIAL_POOLS);
    }
    return INITIAL_POOLS;
  },
};
