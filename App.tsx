import React, { useEffect, useState, useCallback } from 'react';
import {
  SafeAreaView,
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  StatusBar,
  Share,
} from 'react-native';
import { CURRENT_USER, INITIAL_POOLS } from './src/data/mockPools';
import {
  CatalogItem,
  GroupBuyPool,
  Participant,
  ParticipantShare,
  PoolMessage,
} from './src/types/groupBuy';
import {
  DEMO_PROFILES,
  PoolRepository,
  SupabaseConfig,
} from './src/services/repository';
import {
  buildShareablePoolInviteText,
  getCaseSplitStatus,
  getParticipantBreakdowns,
  getPoolProgressSummary,
} from './src/utils/calculations';
import { PoolProgressCard } from './src/components/PoolProgressCard';
import { CatalogItemCard } from './src/components/CatalogItemCard';
import { SplitLedgerView } from './src/components/SplitLedgerView';
import { HostOrderSheetView } from './src/components/HostOrderSheetView';
import { PoolChatView } from './src/components/PoolChatView';
import {
  AddItemModal,
  CreatePoolModal,
  JoinByCodeModal,
} from './src/components/ActionModals';
import { SupabaseSetupCard } from './src/components/SupabaseSetupCard';

type ActiveTab = 'catalog' | 'splits' | 'chat' | 'host_sheet' | 'architecture';
type ItemFilter = 'all' | 'individual' | 'case_split';

export default function App() {
  const [pools, setPools] = useState<GroupBuyPool[]>(INITIAL_POOLS);
  const [selectedPoolId, setSelectedPoolId] = useState<string>(
    INITIAL_POOLS[0].id
  );
  const [activeUser, setActiveUser] = useState<Participant>(CURRENT_USER);
  const [activeTab, setActiveTab] = useState<ActiveTab>('catalog');
  const [itemFilter, setItemFilter] = useState<ItemFilter>('all');
  const [showAddItemModal, setShowAddItemModal] = useState(false);
  const [showCreatePoolModal, setShowCreatePoolModal] = useState(false);
  const [showJoinByCodeModal, setShowJoinByCodeModal] = useState(false);

  const [syncStatus, setSyncStatus] = useState<{
    mode: 'local' | 'supabase_live' | 'supabase_error';
    lastSyncedAt: string | null;
    errorMessage?: string;
    lastRealtimeEvent?: string | null;
  }>({
    mode: 'local',
    lastSyncedAt: null,
  });

  const formatTimestamp = () => {
    const now = new Date();
    return now.toLocaleTimeString([], {
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  const refreshPools = useCallback(async (realtimeTable?: string) => {
    const cfg = PoolRepository.getCurrentConfig();
    const { pools: loaded, error } = await PoolRepository.loadPools();

    if (loaded && loaded.length > 0) {
      setPools(loaded);
      setSelectedPoolId((prev) =>
        loaded.some((p) => p.id === prev) ? prev : loaded[0].id
      );
    }

    if (cfg.enabled && cfg.url && cfg.anonKey) {
      if (error) {
        setSyncStatus({
          mode: 'supabase_error',
          lastSyncedAt: formatTimestamp(),
          errorMessage: error,
        });
      } else {
        setSyncStatus((prev) => ({
          mode: 'supabase_live',
          lastSyncedAt: formatTimestamp(),
          lastRealtimeEvent: realtimeTable
            ? `Table '${realtimeTable}' updated`
            : prev.lastRealtimeEvent,
        }));
      }
    } else {
      setSyncStatus({
        mode: 'local',
        lastSyncedAt: formatTimestamp(),
      });
    }
  }, []);

  useEffect(() => {
    let unsubscribeRealtime = () => {};

    const bootstrap = async () => {
      const savedUser = await PoolRepository.loadActiveUser();
      setActiveUser(savedUser);

      const cfg = await PoolRepository.initConfig();
      await refreshPools();

      if (cfg.enabled) {
        unsubscribeRealtime = PoolRepository.subscribeToRealtime((table) => {
          refreshPools(table);
        });
      }
    };

    bootstrap();

    return () => {
      unsubscribeRealtime();
    };
  }, [refreshPools]);

  const activePool =
    pools.find((p) => p.id === selectedPoolId) || pools[0];

  const handleSelectUser = async (user: Participant) => {
    setActiveUser(user);
    await PoolRepository.saveActiveUser(user);
  };

  const handleConfigSaved = async (newConfig: SupabaseConfig) => {
    await PoolRepository.saveSupabaseConfig(newConfig);
    await refreshPools();
    if (newConfig.enabled) {
      PoolRepository.subscribeToRealtime((table) => {
        refreshPools(table);
      });
    }
  };

  const handleSharePoolInvite = async () => {
    try {
      const message = buildShareablePoolInviteText(activePool);
      await Share.share({
        title: `Join ${activePool.title} (${activePool.joinCode}) on PoolCart`,
        message,
      });
    } catch (err) {
      console.warn('Share error:', err);
    }
  };

  const handleUpdateQuantity = async (itemId: string, delta: number) => {
    if (activePool.status === 'locked') return;

    let nextQuantityForSync = 0;

    const updatedPools: GroupBuyPool[] = pools.map((pool) => {
      if (pool.id !== activePool.id) return pool;

      const hasParticipant = pool.participants.some(
        (p) => p.id === activeUser.id
      );
      const updatedParticipants = hasParticipant
        ? pool.participants
        : [...pool.participants, activeUser];

      const updatedItems = pool.items.map((item) => {
        if (item.id !== itemId) return item;

        const existingClaim = item.claims.find(
          (c) => c.userId === activeUser.id
        );
        let newClaims = [...item.claims];

        if (existingClaim) {
          const nextQty = Math.max(0, existingClaim.quantity + delta);
          nextQuantityForSync = nextQty;
          if (nextQty === 0) {
            newClaims = newClaims.filter((c) => c.userId !== activeUser.id);
          } else {
            newClaims = newClaims.map((c) =>
              c.userId === activeUser.id ? { ...c, quantity: nextQty } : c
            );
          }
        } else if (delta > 0) {
          nextQuantityForSync = delta;
          newClaims.push({
            userId: activeUser.id,
            userName: activeUser.name,
            avatarColor: activeUser.avatarColor,
            quantity: delta,
          });
        }

        return { ...item, claims: newClaims };
      });

      return {
        ...pool,
        participants: updatedParticipants,
        items: updatedItems,
      };
    });

    setPools(updatedPools);
    await PoolRepository.saveLocalPools(updatedPools);

    if (PoolRepository.getCurrentConfig().enabled) {
      const { error } = await PoolRepository.syncClaimQuantity(
        activePool.id,
        itemId,
        activeUser,
        nextQuantityForSync
      );
      if (error) {
        setSyncStatus((prev) => ({
          ...prev,
          mode: 'supabase_error',
          errorMessage: error,
        }));
      } else {
        setSyncStatus((prev) => ({
          ...prev,
          mode: 'supabase_live',
          lastSyncedAt: formatTimestamp(),
        }));
      }
    }
  };

  const handleSendMessage = async (text: string, isAnnouncement: boolean) => {
    const newMsg: PoolMessage = {
      id: `msg_${Date.now()}`,
      poolId: activePool.id,
      userId: activeUser.id,
      userName: activeUser.name,
      avatarColor: activeUser.avatarColor,
      isHost: Boolean(activeUser.isHost),
      isAnnouncement,
      text,
      createdAt: formatTimestamp(),
    };

    const updatedPools: GroupBuyPool[] = pools.map((pool) => {
      if (pool.id !== activePool.id) return pool;
      return {
        ...pool,
        messages: [...(pool.messages || []), newMsg],
      };
    });

    setPools(updatedPools);
    await PoolRepository.saveLocalPools(updatedPools);

    if (PoolRepository.getCurrentConfig().enabled) {
      await PoolRepository.syncNewMessage(newMsg);
    }
  };

  /**
   * 1-Tap Rerun Weekly Pool: Clones the current pool's wholesale catalog items with fresh 0 claims
   * and generates a new invite code for next week's run.
   */
  const handleRerunWeeklyPool = async () => {
    const nowTs = Date.now();
    const prefix = activePool.joinCode.split('-')[0] || 'POOL';
    const nextCode = `${prefix}-${Math.floor(10 + Math.random() * 89)}`;

    const clonedItems: CatalogItem[] = activePool.items.map((item, idx) => ({
      ...item,
      id: `item_${nowTs}_${idx}`,
      claims:
        idx === 0
          ? [
              {
                userId: activeUser.id,
                userName: activeUser.name,
                avatarColor: activeUser.avatarColor,
                quantity: 1,
              },
            ]
          : [],
    }));

    const rerunPool: GroupBuyPool = {
      ...activePool,
      id: `pool_${nowTs}`,
      joinCode: nextCode,
      title: `${activePool.title.replace(/ \(Next Week\)$/, '')} (Next Week)`,
      status: 'open',
      participants: [
        {
          ...activeUser,
          isHost: true,
          paidStatus: 'paid',
          pickedUp: false,
        },
      ],
      items: clonedItems,
      messages: [
        {
          id: `msg_${nowTs}`,
          poolId: `pool_${nowTs}`,
          userId: activeUser.id,
          userName: activeUser.name,
          avatarColor: activeUser.avatarColor,
          isHost: true,
          isAnnouncement: true,
          text: `New weekly run launched from our ${activePool.supplierName} catalog! Invite code: ${nextCode}`,
          createdAt: formatTimestamp(),
        },
      ],
    };

    const updatedPools = [rerunPool, ...pools];
    setPools(updatedPools);
    setSelectedPoolId(rerunPool.id);
    setActiveTab('catalog');
    await PoolRepository.saveLocalPools(updatedPools);

    if (PoolRepository.getCurrentConfig().enabled) {
      await PoolRepository.syncNewPool(rerunPool);
    }
  };

  const handleToggleLockPool = async () => {
    const nextStatus: 'open' | 'locked' =
      activePool.status === 'locked' ? 'open' : 'locked';

    const updatedPools: GroupBuyPool[] = pools.map((pool) =>
      pool.id === activePool.id ? { ...pool, status: nextStatus } : pool
    );

    setPools(updatedPools);
    await PoolRepository.saveLocalPools(updatedPools);

    if (PoolRepository.getCurrentConfig().enabled) {
      await PoolRepository.syncPoolStatus(activePool.id, nextStatus);
    }
  };

  const handleHostCoverRemainder = async (
    itemId: string,
    neededQty: number
  ) => {
    const hostParticipant =
      activePool.participants.find((p) => p.isHost) || activeUser;

    let syncedQty = neededQty;

    const updatedPools: GroupBuyPool[] = pools.map((pool) => {
      if (pool.id !== activePool.id) return pool;

      const updatedItems = pool.items.map((item) => {
        if (item.id !== itemId) return item;
        const existing = item.claims.find(
          (c) => c.userId === hostParticipant.id
        );
        let newClaims = [...item.claims];
        if (existing) {
          syncedQty = existing.quantity + neededQty;
          newClaims = newClaims.map((c) =>
            c.userId === hostParticipant.id ? { ...c, quantity: syncedQty } : c
          );
        } else {
          syncedQty = neededQty;
          newClaims.push({
            userId: hostParticipant.id,
            userName: hostParticipant.name,
            avatarColor: hostParticipant.avatarColor,
            quantity: neededQty,
          });
        }
        return { ...item, claims: newClaims };
      });

      return { ...pool, items: updatedItems };
    });

    setPools(updatedPools);
    await PoolRepository.saveLocalPools(updatedPools);

    if (PoolRepository.getCurrentConfig().enabled) {
      await PoolRepository.syncClaimQuantity(
        activePool.id,
        itemId,
        hostParticipant,
        syncedQty
      );
    }
  };

  const handleTrimPartialCase = async (itemId: string) => {
    let trimmedClaimsForSync: ParticipantShare[] = [];

    const updatedPools: GroupBuyPool[] = pools.map((pool) => {
      if (pool.id !== activePool.id) return pool;

      const updatedItems = pool.items.map((item) => {
        if (item.id !== itemId) return item;
        const status = getCaseSplitStatus(item);
        if (status.remainderUnits === 0) return item;

        let toRemove = status.remainderUnits;
        const reversed = [...item.claims].reverse();
        const adjustedReversed: ParticipantShare[] = [];

        for (const claim of reversed) {
          if (toRemove <= 0) {
            adjustedReversed.push(claim);
          } else if (claim.quantity <= toRemove) {
            toRemove -= claim.quantity;
          } else {
            adjustedReversed.push({
              ...claim,
              quantity: claim.quantity - toRemove,
            });
            toRemove = 0;
          }
        }

        trimmedClaimsForSync = adjustedReversed.reverse();
        return { ...item, claims: trimmedClaimsForSync };
      });

      return { ...pool, items: updatedItems };
    });

    setPools(updatedPools);
    await PoolRepository.saveLocalPools(updatedPools);

    if (PoolRepository.getCurrentConfig().enabled) {
      await PoolRepository.syncItemClaimsList(
        activePool.id,
        itemId,
        trimmedClaimsForSync
      );
    }
  };

  const handleSimulateNeighborAction = async () => {
    const otherNeighbors = DEMO_PROFILES.filter((p) => p.id !== activeUser.id);
    const randomNeighbor =
      otherNeighbors[Math.floor(Math.random() * otherNeighbors.length)] ||
      DEMO_PROFILES[1];

    const targetItem =
      activePool.items.find((i) => i.mode === 'case_split') ||
      activePool.items[0];
    if (!targetItem) return;

    let simulatedNextQty = 1;

    const updatedPools: GroupBuyPool[] = pools.map((pool) => {
      if (pool.id !== activePool.id) return pool;

      const hasNeighbor = pool.participants.some(
        (p) => p.id === randomNeighbor.id
      );
      const updatedParticipants = hasNeighbor
        ? pool.participants
        : [...pool.participants, randomNeighbor];

      const updatedItems = pool.items.map((item) => {
        if (item.id !== targetItem.id) return item;
        const existing = item.claims.find(
          (c) => c.userId === randomNeighbor.id
        );
        let newClaims = [...item.claims];
        if (existing) {
          simulatedNextQty = existing.quantity + 1;
          newClaims = newClaims.map((c) =>
            c.userId === randomNeighbor.id
              ? { ...c, quantity: simulatedNextQty }
              : c
          );
        } else {
          simulatedNextQty = 1;
          newClaims.push({
            userId: randomNeighbor.id,
            userName: randomNeighbor.name,
            avatarColor: randomNeighbor.avatarColor,
            quantity: 1,
          });
        }
        return { ...item, claims: newClaims };
      });

      return {
        ...pool,
        participants: updatedParticipants,
        items: updatedItems,
      };
    });

    setPools(updatedPools);
    await PoolRepository.saveLocalPools(updatedPools);

    if (PoolRepository.getCurrentConfig().enabled) {
      await PoolRepository.syncClaimQuantity(
        activePool.id,
        targetItem.id,
        randomNeighbor,
        simulatedNextQty
      );
    }

    setSyncStatus((prev) => ({
      ...prev,
      lastSyncedAt: formatTimestamp(),
      lastRealtimeEvent: `${randomNeighbor.name.split(' ')[0]} claimed +1 ${targetItem.emoji}`,
    }));
  };

  const handleAddItem = async (newItem: CatalogItem) => {
    const updatedPools = pools.map((pool) => {
      if (pool.id !== activePool.id) return pool;
      const hasParticipant = pool.participants.some(
        (p) => p.id === activeUser.id
      );
      return {
        ...pool,
        participants: hasParticipant
          ? pool.participants
          : [...pool.participants, activeUser],
        items: [newItem, ...pool.items],
      };
    });

    setPools(updatedPools);
    await PoolRepository.saveLocalPools(updatedPools);

    if (PoolRepository.getCurrentConfig().enabled) {
      await PoolRepository.syncNewItem(activePool.id, newItem, activeUser);
    }
  };

  const handleCreatePool = async (newPool: GroupBuyPool) => {
    const updatedPools = [newPool, ...pools];
    setPools(updatedPools);
    setSelectedPoolId(newPool.id);
    setActiveTab('catalog');
    await PoolRepository.saveLocalPools(updatedPools);

    if (PoolRepository.getCurrentConfig().enabled) {
      await PoolRepository.syncNewPool(newPool);
    }
  };

  const handleTogglePaidStatus = async (userId: string) => {
    let nextStatus: 'pending' | 'paid' = 'paid';

    const updatedPools: GroupBuyPool[] = pools.map((pool) => {
      if (pool.id !== activePool.id) return pool;
      return {
        ...pool,
        participants: pool.participants.map((p) => {
          if (p.id !== userId) return p;
          nextStatus = p.paidStatus === 'paid' ? 'pending' : 'paid';
          return {
            ...p,
            paidStatus: nextStatus,
          };
        }),
      };
    });

    setPools(updatedPools);
    await PoolRepository.saveLocalPools(updatedPools);

    if (PoolRepository.getCurrentConfig().enabled) {
      await PoolRepository.syncPaidStatus(activePool.id, userId, nextStatus);
    }
  };

  const handleTogglePickedUp = async (userId: string) => {
    const updatedPools: GroupBuyPool[] = pools.map((pool) => {
      if (pool.id !== activePool.id) return pool;
      return {
        ...pool,
        participants: pool.participants.map((p) =>
          p.id === userId ? { ...p, pickedUp: !p.pickedUp } : p
        ),
      };
    });

    setPools(updatedPools);
    await PoolRepository.saveLocalPools(updatedPools);
  };

  const handleResetDemo = async () => {
    const fresh = await PoolRepository.resetDemoData();
    setPools(fresh);
    setSelectedPoolId(fresh[0].id);
  };

  const filteredItems = activePool.items.filter((i) =>
    itemFilter === 'all' ? true : i.mode === itemFilter
  );

  const myBreakdown = getParticipantBreakdowns(activePool).find(
    (b) => b.userId === activeUser.id
  );
  const summary = getPoolProgressSummary(activePool);
  const messageCount = (activePool.messages || []).length;

  return (
    <SafeAreaView style={styles.safeArea}>
      <StatusBar barStyle="dark-content" />

      {/* Header */}
      <View style={styles.header}>
        <View style={{ flex: 1 }}>
          <View style={styles.brandRow}>
            <Text style={styles.brandTitle}>🥬 PoolCart</Text>
            <TouchableOpacity
              style={[
                styles.syncPill,
                syncStatus.mode === 'supabase_live'
                  ? styles.syncPillLive
                  : styles.syncPillLocal,
              ]}
              onPress={() => setActiveTab('architecture')}
            >
              <View
                style={[
                  styles.syncDot,
                  syncStatus.mode === 'supabase_live'
                    ? { backgroundColor: '#10B981' }
                    : { backgroundColor: '#0D9488' },
                ]}
              />
              <Text style={styles.syncPillText}>
                {syncStatus.mode === 'supabase_live' ? 'Live' : 'Local'}
              </Text>
            </TouchableOpacity>
          </View>
          <TouchableOpacity onPress={() => setActiveTab('architecture')}>
            <Text style={styles.locationSub}>
              👤{' '}
              <Text style={{ fontWeight: '800', color: '#0F172A' }}>
                {activeUser.name}
              </Text>{' '}
              • Code:{' '}
              <Text style={{ fontWeight: '800', color: '#0D9488' }}>
                {activePool.joinCode}
              </Text>
            </Text>
          </TouchableOpacity>
        </View>

        <View style={styles.headerActions}>
          <TouchableOpacity
            style={styles.codeJoinButton}
            onPress={() => setShowJoinByCodeModal(true)}
          >
            <Text style={styles.codeJoinButtonText}>🔑 Code</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={styles.sharePoolButton}
            onPress={handleSharePoolInvite}
          >
            <Text style={styles.sharePoolButtonText}>📤 Invite</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={styles.newPoolButton}
            onPress={() => setShowCreatePoolModal(true)}
          >
            <Text style={styles.newPoolButtonText}>+ Host</Text>
          </TouchableOpacity>
        </View>
      </View>

      {/* Horizontal Pool Selector */}
      <View style={styles.poolSelectorWrap}>
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.poolScrollContent}
        >
          {pools.map((pool) => {
            const isSelected = pool.id === activePool.id;
            const poolSummary = getPoolProgressSummary(pool);
            return (
              <TouchableOpacity
                key={pool.id}
                style={[
                  styles.poolPill,
                  isSelected && styles.poolPillSelected,
                ]}
                onPress={() => setSelectedPoolId(pool.id)}
              >
                <Text
                  style={[
                    styles.poolPillTitle,
                    isSelected && styles.poolPillTitleSelected,
                  ]}
                  numberOfLines={1}
                >
                  {pool.status === 'locked' ? '🔒 ' : ''}
                  {pool.title}
                </Text>
                <Text
                  style={[
                    styles.poolPillMeta,
                    isSelected && styles.poolPillMetaSelected,
                  ]}
                >
                  [{pool.joinCode}] ${poolSummary.combinedPoolTotal.toFixed(0)} / $
                  {pool.minimumOrderAmount} min
                </Text>
              </TouchableOpacity>
            );
          })}
        </ScrollView>
      </View>

      {/* Main Content */}
      <ScrollView
        style={styles.mainScroll}
        contentContainerStyle={styles.mainScrollContent}
      >
        {/* Active Pool Banner */}
        <View style={styles.supplierHeader}>
          <View style={{ flex: 1 }}>
            <Text style={styles.supplierBadgeText}>
              {activePool.status === 'locked'
                ? '🔒 POOL LOCKED • READY FOR ORDER & PICKUP'
                : `${activePool.supplierBadge} • CODE: ${activePool.joinCode}`}
            </Text>
            <Text style={styles.poolMainTitle}>{activePool.title}</Text>
            <Text style={styles.supplierSubText}>
              Supplier: {activePool.supplierName} • Host: {activePool.hostName}
            </Text>
          </View>
        </View>

        {/* Live Wholesale Minimum & Free Delivery Progress Bar */}
        <PoolProgressCard pool={activePool} />

        {/* Navigation Tabs */}
        <View style={styles.tabBar}>
          <TouchableOpacity
            style={[
              styles.tabButton,
              activeTab === 'catalog' && styles.tabButtonActive,
            ]}
            onPress={() => setActiveTab('catalog')}
          >
            <Text
              style={[
                styles.tabButtonText,
                activeTab === 'catalog' && styles.tabButtonTextActive,
              ]}
            >
              🛒 Items ({activePool.items.length})
            </Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[
              styles.tabButton,
              activeTab === 'splits' && styles.tabButtonActive,
            ]}
            onPress={() => setActiveTab('splits')}
          >
            <Text
              style={[
                styles.tabButtonText,
                activeTab === 'splits' && styles.tabButtonTextActive,
              ]}
            >
              💸 Splits
            </Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[
              styles.tabButton,
              activeTab === 'chat' && styles.tabButtonActive,
            ]}
            onPress={() => setActiveTab('chat')}
          >
            <Text
              style={[
                styles.tabButtonText,
                activeTab === 'chat' && styles.tabButtonTextActive,
              ]}
            >
              💬 Chat ({messageCount})
            </Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[
              styles.tabButton,
              activeTab === 'host_sheet' && styles.tabButtonActive,
            ]}
            onPress={() => setActiveTab('host_sheet')}
          >
            <Text
              style={[
                styles.tabButtonText,
                activeTab === 'host_sheet' && styles.tabButtonTextActive,
              ]}
            >
              📋 Host
            </Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[
              styles.tabButton,
              activeTab === 'architecture' && styles.tabButtonActive,
            ]}
            onPress={() => setActiveTab('architecture')}
          >
            <Text
              style={[
                styles.tabButtonText,
                activeTab === 'architecture' && styles.tabButtonTextActive,
              ]}
            >
              ⚡ Sync
            </Text>
          </TouchableOpacity>
        </View>

        {activeTab === 'catalog' && (
          <View>
            {/* Filter & Pitch Item Bar */}
            <View style={styles.filterRow}>
              <View style={styles.filterPills}>
                {(
                  [
                    { key: 'all', label: 'All Items' },
                    { key: 'individual', label: 'Direct Wholesale' },
                    { key: 'case_split', label: 'Bulk Case Splits' },
                  ] as const
                ).map((f) => (
                  <TouchableOpacity
                    key={f.key}
                    style={[
                      styles.filterChip,
                      itemFilter === f.key && styles.filterChipActive,
                    ]}
                    onPress={() => setItemFilter(f.key)}
                  >
                    <Text
                      style={[
                        styles.filterChipText,
                        itemFilter === f.key && styles.filterChipTextActive,
                      ]}
                    >
                      {f.label}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>

              {activePool.status !== 'locked' && (
                <TouchableOpacity
                  style={styles.pitchItemBtn}
                  onPress={() => setShowAddItemModal(true)}
                >
                  <Text style={styles.pitchItemBtnText}>+ Add Item</Text>
                </TouchableOpacity>
              )}
            </View>

            {/* Items List */}
            {filteredItems.map((item) => (
              <CatalogItemCard
                key={item.id}
                item={item}
                currentUserId={activeUser.id}
                isPoolLocked={activePool.status === 'locked'}
                onUpdateQuantity={handleUpdateQuantity}
              />
            ))}
          </View>
        )}

        {activeTab === 'splits' && (
          <SplitLedgerView
            pool={activePool}
            currentUserId={activeUser.id}
            onTogglePaidStatus={handleTogglePaidStatus}
          />
        )}

        {activeTab === 'chat' && (
          <PoolChatView
            pool={activePool}
            activeUser={activeUser}
            onSendMessage={handleSendMessage}
          />
        )}

        {activeTab === 'host_sheet' && (
          <HostOrderSheetView
            pool={activePool}
            onToggleLockPool={handleToggleLockPool}
            onRerunWeeklyPool={handleRerunWeeklyPool}
            onHostCoverRemainder={handleHostCoverRemainder}
            onTrimPartialCase={handleTrimPartialCase}
            onTogglePaidStatus={handleTogglePaidStatus}
            onTogglePickedUp={handleTogglePickedUp}
          />
        )}

        {activeTab === 'architecture' && (
          <SupabaseSetupCard
            activeUser={activeUser}
            onSelectUser={handleSelectUser}
            syncStatus={syncStatus}
            onConfigSaved={handleConfigSaved}
            onSimulateNeighborAction={handleSimulateNeighborAction}
            onResetDemo={handleResetDemo}
          />
        )}
      </ScrollView>

      {/* Sticky Personal Cart Footer */}
      {myBreakdown && myBreakdown.totalDue > 0 && (
        <View style={styles.stickyFooter}>
          <View>
            <Text style={styles.footerLabel}>
              {activeUser.name.toUpperCase()} POOL SHARE (
              {myBreakdown.lineItems.length} items)
            </Text>
            <View style={styles.footerPriceRow}>
              <Text style={styles.footerTotal}>
                ${myBreakdown.totalDue.toFixed(2)}
              </Text>
              <Text style={styles.footerSavings}>
                {' '}
                • Saving ${myBreakdown.totalEstimatedSavings.toFixed(2)}
              </Text>
            </View>
          </View>

          <TouchableOpacity
            style={styles.viewSplitButton}
            onPress={() =>
              setActiveTab(activeTab === 'splits' ? 'catalog' : 'splits')
            }
          >
            <Text style={styles.viewSplitButtonText}>
              {activeTab === 'splits'
                ? 'Back to Items'
                : summary.isMinimumMet
                ? 'Pay / Split ✓'
                : 'View Split Ledger'}
            </Text>
          </TouchableOpacity>
        </View>
      )}

      {/* Modals */}
      <AddItemModal
        visible={showAddItemModal}
        activeUser={activeUser}
        onClose={() => setShowAddItemModal(false)}
        onAddItem={handleAddItem}
      />

      <CreatePoolModal
        visible={showCreatePoolModal}
        activeUser={activeUser}
        onClose={() => setShowCreatePoolModal(false)}
        onCreatePool={handleCreatePool}
      />

      <JoinByCodeModal
        visible={showJoinByCodeModal}
        pools={pools}
        onClose={() => setShowJoinByCodeModal(false)}
        onSelectPoolId={(poolId) => {
          setSelectedPoolId(poolId);
          setActiveTab('catalog');
        }}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: '#F8FAFC',
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 14,
    paddingTop: 10,
    paddingBottom: 10,
    backgroundColor: '#FFFFFF',
    borderBottomWidth: 1,
    borderBottomColor: '#E2E8F0',
  },
  brandRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  brandTitle: {
    fontSize: 19,
    fontWeight: '900',
    color: '#0F172A',
  },
  syncPill: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 7,
    paddingVertical: 3,
    borderRadius: 999,
    borderWidth: 1,
  },
  syncPillLive: {
    backgroundColor: '#ECFDF5',
    borderColor: '#6EE7B7',
  },
  syncPillLocal: {
    backgroundColor: '#F0FDFA',
    borderColor: '#99F6E4',
  },
  syncDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    marginRight: 4,
  },
  syncPillText: {
    fontSize: 10,
    fontWeight: '800',
    color: '#0F766E',
  },
  locationSub: {
    fontSize: 11,
    color: '#64748B',
    fontWeight: '600',
    marginTop: 2,
  },
  headerActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
  },
  codeJoinButton: {
    backgroundColor: '#F1F5F9',
    borderWidth: 1,
    borderColor: '#CBD5E1',
    paddingHorizontal: 9,
    paddingVertical: 7,
    borderRadius: 9,
  },
  codeJoinButtonText: {
    color: '#0F172A',
    fontWeight: '800',
    fontSize: 11,
  },
  sharePoolButton: {
    backgroundColor: '#F0FDFA',
    borderWidth: 1,
    borderColor: '#5EEAD4',
    paddingHorizontal: 9,
    paddingVertical: 7,
    borderRadius: 9,
  },
  sharePoolButtonText: {
    color: '#0F766E',
    fontWeight: '800',
    fontSize: 11,
  },
  newPoolButton: {
    backgroundColor: '#0F172A',
    paddingHorizontal: 10,
    paddingVertical: 7,
    borderRadius: 9,
  },
  newPoolButtonText: {
    color: '#FFFFFF',
    fontWeight: '700',
    fontSize: 11,
  },
  poolSelectorWrap: {
    backgroundColor: '#FFFFFF',
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: '#E2E8F0',
  },
  poolScrollContent: {
    paddingHorizontal: 16,
    gap: 10,
  },
  poolPill: {
    backgroundColor: '#F1F5F9',
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    maxWidth: 260,
  },
  poolPillSelected: {
    backgroundColor: '#0D9488',
    borderColor: '#0D9488',
  },
  poolPillTitle: {
    fontSize: 13,
    fontWeight: '800',
    color: '#1E293B',
  },
  poolPillTitleSelected: {
    color: '#FFFFFF',
  },
  poolPillMeta: {
    fontSize: 11,
    color: '#64748B',
    marginTop: 2,
    fontWeight: '600',
  },
  poolPillMetaSelected: {
    color: '#CCFBF1',
  },
  mainScroll: {
    flex: 1,
  },
  mainScrollContent: {
    padding: 16,
    paddingBottom: 100,
  },
  supplierHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 12,
  },
  supplierBadgeText: {
    fontSize: 11,
    fontWeight: '800',
    color: '#0D9488',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  poolMainTitle: {
    fontSize: 20,
    fontWeight: '900',
    color: '#0F172A',
    marginTop: 2,
  },
  supplierSubText: {
    fontSize: 12,
    color: '#475569',
    marginTop: 2,
    fontWeight: '500',
  },
  tabBar: {
    flexDirection: 'row',
    backgroundColor: '#E2E8F0',
    borderRadius: 12,
    padding: 4,
    marginBottom: 14,
  },
  tabButton: {
    flex: 1,
    paddingVertical: 8,
    alignItems: 'center',
    borderRadius: 9,
  },
  tabButtonActive: {
    backgroundColor: '#FFFFFF',
    shadowColor: '#000',
    shadowOpacity: 0.06,
    shadowRadius: 3,
    elevation: 1,
  },
  tabButtonText: {
    fontSize: 10.5,
    fontWeight: '700',
    color: '#475569',
  },
  tabButtonTextActive: {
    color: '#0F172A',
    fontWeight: '800',
  },
  filterRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
    flexWrap: 'wrap',
    gap: 8,
  },
  filterPills: {
    flexDirection: 'row',
    gap: 6,
  },
  filterChip: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 999,
    backgroundColor: '#E2E8F0',
  },
  filterChipActive: {
    backgroundColor: '#0F172A',
  },
  filterChipText: {
    fontSize: 11,
    fontWeight: '700',
    color: '#475569',
  },
  filterChipTextActive: {
    color: '#FFFFFF',
  },
  pitchItemBtn: {
    backgroundColor: '#F3E8FF',
    borderWidth: 1,
    borderColor: '#D8B4FE',
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 999,
  },
  pitchItemBtnText: {
    fontSize: 11,
    fontWeight: '800',
    color: '#7E22CE',
  },
  stickyFooter: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    backgroundColor: '#0F172A',
    paddingHorizontal: 18,
    paddingVertical: 14,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  footerLabel: {
    fontSize: 10,
    fontWeight: '800',
    color: '#94A3B8',
    letterSpacing: 0.5,
  },
  footerPriceRow: {
    flexDirection: 'row',
    alignItems: 'baseline',
    marginTop: 2,
  },
  footerTotal: {
    fontSize: 20,
    fontWeight: '900',
    color: '#FFFFFF',
  },
  footerSavings: {
    fontSize: 12,
    fontWeight: '700',
    color: '#34D399',
  },
  viewSplitButton: {
    backgroundColor: '#0D9488',
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 10,
  },
  viewSplitButtonText: {
    color: '#FFFFFF',
    fontWeight: '800',
    fontSize: 13,
  },
});
