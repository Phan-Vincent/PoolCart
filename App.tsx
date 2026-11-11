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
  TextInput,
} from 'react-native';
import {
  CURRENT_USER,
  INITIAL_POOLS,
  PAST_USER_RECEIPTS,
} from './src/data/mockPools';
import {
  AtomicClaimResult,
  CatalogItem,
  GroupBuyPool,
  NotificationPreferences,
  Participant,
  ParticipantShare,
  PastOrderReceipt,
  PoolMessage,
  PoolNotificationAlert,
  ReceiptTrueUp,
  WishlistRequest,
} from './src/types/groupBuy';
import {
  DEMO_PROFILES,
  evaluateAtomicClaimTransition,
  PoolRepository,
  SupabaseConfig,
} from './src/services/repository';
import {
  DEFAULT_NOTIFICATION_PREFS,
  INITIAL_ALERTS,
  NotificationService,
} from './src/services/notifications';
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
import { WishlistSection } from './src/components/WishlistSection';
import { WalletHistoryView } from './src/components/WalletHistoryView';
import {
  AddItemModal,
  CreatePoolModal,
  JoinByCodeModal,
} from './src/components/ActionModals';
import {
  LiveToastBanner,
  NotificationCenterModal,
} from './src/components/NotificationCenterModal';
import { SupabaseSetupCard } from './src/components/SupabaseSetupCard';

type ActiveTab =
  | 'catalog'
  | 'splits'
  | 'chat'
  | 'host_sheet'
  | 'wallet'
  | 'architecture';
type ItemFilter = 'all' | 'individual' | 'case_split';

export default function App() {
  const [pools, setPools] = useState<GroupBuyPool[]>(INITIAL_POOLS);
  const [selectedPoolId, setSelectedPoolId] = useState<string>(
    INITIAL_POOLS[0].id
  );
  const [activeUser, setActiveUser] = useState<Participant>(CURRENT_USER);
  const [activeTab, setActiveTab] = useState<ActiveTab>('catalog');
  const [itemFilter, setItemFilter] = useState<ItemFilter>('all');
  const [selectedCategory, setSelectedCategory] = useState<string>('All');
  const [searchQuery, setSearchQuery] = useState<string>('');

  const [showAddItemModal, setShowAddItemModal] = useState(false);
  const [showCreatePoolModal, setShowCreatePoolModal] = useState(false);
  const [showJoinByCodeModal, setShowJoinByCodeModal] = useState(false);
  const [showNotificationModal, setShowNotificationModal] = useState(false);

  const [alerts, setAlerts] = useState<PoolNotificationAlert[]>(INITIAL_ALERTS);
  const [notifPrefs, setNotifPrefs] = useState<NotificationPreferences>(
    DEFAULT_NOTIFICATION_PREFS
  );
  const [liveToast, setLiveToast] = useState<PoolNotificationAlert | null>(
    null
  );

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

  const pushAlerts = useCallback(
    async (newItems: PoolNotificationAlert[]) => {
      if (newItems.length === 0) return;
      setLiveToast(newItems[0]);
      setAlerts((prev) => {
        const merged = [...newItems, ...prev].slice(0, 40);
        NotificationService.saveAlerts(merged);
        return merged;
      });
    },
    []
  );

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
      const [savedUser, savedAlerts, savedPrefs, cfg] = await Promise.all([
        PoolRepository.loadActiveUser(),
        NotificationService.loadAlerts(),
        NotificationService.loadPreferences(),
        PoolRepository.initConfig(),
      ]);

      setActiveUser(savedUser);
      setAlerts(savedAlerts);
      setNotifPrefs(savedPrefs);

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

  // Determine whether the activeUser is the verified Host of activePool
  const isCurrentUserHost = Boolean(
    (activePool.hostUserId && activePool.hostUserId === activeUser.id) ||
      activePool.participants.find((p) => p.id === activeUser.id)?.isHost ||
      activePool.hostName.toLowerCase().includes(activeUser.name.toLowerCase())
  );

  const handleSelectUser = async (user: Participant) => {
    setActiveUser(user);
    await PoolRepository.saveActiveUser(user);
  };

  const handleSwitchToPoolHost = async () => {
    const hostParticipant =
      activePool.participants.find((p) => p.isHost) ||
      DEMO_PROFILES.find((p) => p.id === activePool.hostUserId) ||
      DEMO_PROFILES[1];
    if (hostParticipant) {
      await handleSelectUser(hostParticipant);
    }
  };

  const handleVerifyOtpEmail = async (email: string) => {
    const updatedUser: Participant = {
      ...activeUser,
      email,
      verifiedAuth: true,
    };
    await handleSelectUser(updatedUser);
    const alert = NotificationService.createAlert(
      activePool,
      'case_locked',
      `🔐 Verified Neighbor Identity: ${updatedUser.name}`,
      `Your profile (${email}) is now OTP-verified for neighborhood pools and host permissions.`
    );
    await pushAlerts([alert]);
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

  /**
   * Race-Condition-Safe Atomic Case-Split & Wholesale Claim Handler
   */
  const handleUpdateQuantity = async (itemId: string, delta: number) => {
    if (activePool.status === 'locked') return;

    const targetItem = activePool.items.find((i) => i.id === itemId);
    if (!targetItem) return;

    const prevPoolSnapshot = activePool;
    let atomicResult: AtomicClaimResult | null = null;
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

        const { updatedClaims, result } = evaluateAtomicClaimTransition(
          item,
          activeUser,
          delta
        );
        atomicResult = result;
        nextQuantityForSync = result.newUserQuantity;

        return { ...item, claims: updatedClaims };
      });

      return {
        ...pool,
        participants: updatedParticipants,
        items: updatedItems,
      };
    });

    setPools(updatedPools);
    await PoolRepository.saveLocalPools(updatedPools);

    const nextPoolSnapshot =
      updatedPools.find((p) => p.id === activePool.id) || activePool;

    if (atomicResult) {
      const triggered = NotificationService.evaluateClaimMilestones(
        prevPoolSnapshot,
        nextPoolSnapshot,
        targetItem,
        atomicResult,
        notifPrefs
      );
      if (triggered.length > 0) {
        await pushAlerts(triggered);
      }
    }

    if (PoolRepository.getCurrentConfig().enabled) {
      const { error } = await PoolRepository.syncAtomicClaimDelta(
        activePool.id,
        itemId,
        activeUser,
        delta,
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

  /**
   * Feature #1: Wishlist Pledges, New Split Requests & Host Promotion to Catalog
   */
  const handlePledgeWishlist = async (wishId: string) => {
    const updatedPools = pools.map((pool) => {
      if (pool.id !== activePool.id) return pool;
      const updatedWish = (pool.wishlist || []).map((w) => {
        if (w.id !== wishId) return w;
        const exists = w.pledgedUserIds.includes(activeUser.id);
        const nextPledges = exists
          ? w.pledgedUserIds.filter((id) => id !== activeUser.id)
          : [...w.pledgedUserIds, activeUser.id];
        return { ...w, pledgedUserIds: nextPledges };
      });
      return { ...pool, wishlist: updatedWish };
    });

    setPools(updatedPools);
    await PoolRepository.saveLocalPools(updatedPools);
  };

  const handleAddWishlistRequest = async (
    req: Omit<WishlistRequest, 'id' | 'poolId'>
  ) => {
    const newWish: WishlistRequest = {
      ...req,
      id: `wish_${Date.now()}`,
      poolId: activePool.id,
    };

    const updatedPools = pools.map((pool) => {
      if (pool.id !== activePool.id) return pool;
      return {
        ...pool,
        wishlist: [newWish, ...(pool.wishlist || [])],
      };
    });

    setPools(updatedPools);
    await PoolRepository.saveLocalPools(updatedPools);
  };

  const handlePromoteWishlistToCatalog = async (wish: WishlistRequest) => {
    // Convert pledged user IDs into initial 1-unit claims
    const initialClaims: ParticipantShare[] = wish.pledgedUserIds.map((uid) => {
      const known =
        activePool.participants.find((p) => p.id === uid) ||
        DEMO_PROFILES.find((p) => p.id === uid);
      return {
        userId: uid,
        userName: known ? known.name : 'Neighbor',
        avatarColor: known ? known.avatarColor : '#0D9488',
        quantity: 1,
      };
    });

    const newItem: CatalogItem = {
      id: `item_wish_${Date.now()}`,
      name: wish.title,
      category: wish.category,
      emoji: wish.emoji,
      mode: 'case_split',
      unitLabel: wish.suggestedUnitLabel,
      unitPrice: wish.estimatedUnitPrice,
      retailPrice: wish.estimatedRetailPrice,
      caseSize: wish.targetCaseSize,
      claims: initialClaims,
    };

    const updatedPools = pools.map((pool) => {
      if (pool.id !== activePool.id) return pool;
      return {
        ...pool,
        items: [newItem, ...pool.items],
        wishlist: (pool.wishlist || []).map((w) =>
          w.id === wish.id ? { ...w, promotedToCatalog: true } : w
        ),
      };
    });

    setPools(updatedPools);
    await PoolRepository.saveLocalPools(updatedPools);

    const alert = NotificationService.createAlert(
      activePool,
      'case_locked',
      `🎉 Wishlist Promoted: ${wish.emoji} ${wish.title}`,
      `Host approved ${wish.title} with ${initialClaims.length}/${wish.targetCaseSize} pledged shares already claimed!`
    );
    await pushAlerts([alert]);
  };

  /**
   * Feature #2: Wholesale Receipt True-Up Handlers
   */
  const handleUpdateItemActualPrice = async (
    itemId: string,
    actualPrice: number | undefined
  ) => {
    const updatedPools = pools.map((pool) => {
      if (pool.id !== activePool.id) return pool;
      return {
        ...pool,
        items: pool.items.map((it) =>
          it.id === itemId ? { ...it, actualUnitPrice: actualPrice } : it
        ),
      };
    });

    setPools(updatedPools);
    await PoolRepository.saveLocalPools(updatedPools);
  };

  const handleUpdateReceiptTrueUp = async (trueUp: ReceiptTrueUp) => {
    const updatedPools = pools.map((pool) => {
      if (pool.id !== activePool.id) return pool;
      return {
        ...pool,
        trueUp,
      };
    });

    setPools(updatedPools);
    await PoolRepository.saveLocalPools(updatedPools);

    const alert = NotificationService.createAlert(
      activePool,
      'minimum_met',
      `🧾 Wholesale Receipt True-Up Reconciled!`,
      `${activePool.title} splits have been updated against the final register receipt (${trueUp.receiptNote}).`
    );
    await pushAlerts([alert]);
  };

  /**
   * Feature #3: 1-Tap Re-Claim Staples from Past Receipts
   */
  const handleReclaimReceiptItems = async (receipt: PastOrderReceipt) => {
    const updatedPools = pools.map((pool) => {
      if (pool.id !== activePool.id) return pool;

      const hasParticipant = pool.participants.some(
        (p) => p.id === activeUser.id
      );
      const nextParticipants = hasParticipant
        ? pool.participants
        : [...pool.participants, activeUser];

      const nextItems = [...pool.items];

      receipt.items.forEach((pastItem) => {
        const existingIdx = nextItems.findIndex(
          (i) => i.name.toLowerCase() === pastItem.name.toLowerCase()
        );

        if (existingIdx >= 0) {
          const item = nextItems[existingIdx];
          const existingClaim = item.claims.find(
            (c) => c.userId === activeUser.id
          );
          const nextClaims = existingClaim
            ? item.claims.map((c) =>
                c.userId === activeUser.id
                  ? { ...c, quantity: c.quantity + pastItem.quantity }
                  : c
              )
            : [
                ...item.claims,
                {
                  userId: activeUser.id,
                  userName: activeUser.name,
                  avatarColor: activeUser.avatarColor,
                  quantity: pastItem.quantity,
                },
              ];
          nextItems[existingIdx] = { ...item, claims: nextClaims };
        } else {
          nextItems.unshift({
            id: `item_reclaim_${Date.now()}_${Math.random().toString(36).slice(2, 5)}`,
            name: pastItem.name,
            category: 'Re-Ordered Staple',
            emoji: pastItem.emoji,
            mode: pastItem.mode,
            unitLabel: pastItem.unitLabel,
            unitPrice: pastItem.unitPrice,
            retailPrice: pastItem.retailPrice,
            caseSize: pastItem.caseSize,
            claims: [
              {
                userId: activeUser.id,
                userName: activeUser.name,
                avatarColor: activeUser.avatarColor,
                quantity: pastItem.quantity,
              },
            ],
          });
        }
      });

      return {
        ...pool,
        participants: nextParticipants,
        items: nextItems,
      };
    });

    setPools(updatedPools);
    await PoolRepository.saveLocalPools(updatedPools);

    const alert = NotificationService.createAlert(
      activePool,
      'case_locked',
      `🔁 Re-Claimed ${receipt.items.length} Weekly Staples!`,
      `Added your items from "${receipt.poolTitle}" into ${activePool.title}.`
    );
    await pushAlerts([alert]);
  };

  const handleSendMessage = async (text: string, isAnnouncement: boolean) => {
    const newMsg: PoolMessage = {
      id: `msg_${Date.now()}`,
      poolId: activePool.id,
      userId: activeUser.id,
      userName: activeUser.name,
      avatarColor: activeUser.avatarColor,
      isHost: isCurrentUserHost,
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

    if (isAnnouncement && notifPrefs.porchDropArrival) {
      const alert = NotificationService.createAlert(
        activePool,
        'porch_pickup_ready',
        `📢 Host Announcement (${activePool.joinCode})`,
        text
      );
      await pushAlerts([alert]);
    }

    if (PoolRepository.getCurrentConfig().enabled) {
      await PoolRepository.syncNewMessage(newMsg);
    }
  };

  const handleTriggerCutoffReminder = async () => {
    const summary = getPoolProgressSummary(activePool);
    const openCases = activePool.items
      .map((i) => ({ item: i, status: getCaseSplitStatus(i) }))
      .filter((x) => x.item.mode === 'case_split' && x.status.neededForNextCase > 0);

    const caseDetail =
      openCases.length > 0
        ? ` ${openCases[0].item.emoji} ${openCases[0].item.name} only needs ${openCases[0].status.neededForNextCase} more share(s) to lock the case!`
        : '';

    const alert = NotificationService.createAlert(
      activePool,
      'cutoff_reminder',
      `⏰ 2 Hours Until Cutoff (${activePool.cutoffTime})`,
      `Pool is at $${summary.combinedPoolTotal.toFixed(2)} / $${activePool.minimumOrderAmount} min.${caseDetail}`
    );
    await pushAlerts([alert]);
  };

  const handleTriggerPorchReadyAlert = async () => {
    const alert = NotificationService.createAlert(
      activePool,
      'porch_pickup_ready',
      `🛍️ Porch Pickup Ready: ${activePool.title}!`,
      `Wholesale order has been sorted at ${activePool.pickupAddress}. Pickup window: ${activePool.pickupWindow}.`
    );
    await pushAlerts([alert]);
  };

  const handleToggleNotifPref = async (key: keyof NotificationPreferences) => {
    const updated = { ...notifPrefs, [key]: !notifPrefs[key] };
    setNotifPrefs(updated);
    await NotificationService.savePreferences(updated);
  };

  const handleMarkAllAlertsRead = async () => {
    const updated = alerts.map((a) => ({ ...a, read: true }));
    setAlerts(updated);
    await NotificationService.saveAlerts(updated);
  };

  const handleRerunWeeklyPool = async () => {
    const nowTs = Date.now();
    const prefix = activePool.joinCode.split('-')[0] || 'POOL';
    const nextCode = `${prefix}-${Math.floor(10 + Math.random() * 89)}`;

    const clonedItems: CatalogItem[] = activePool.items.map((item, idx) => ({
      ...item,
      id: `item_${nowTs}_${idx}`,
      actualUnitPrice: undefined,
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
      hostUserId: activeUser.id,
      hostName: activeUser.name,
      title: `${activePool.title.replace(/ \(Next Week\)$/, '')} (Next Week)`,
      status: 'open',
      trueUp: undefined,
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
    const targetItem = activePool.items.find((i) => i.id === itemId);
    const prevPoolSnapshot = activePool;

    let syncedQty = neededQty;
    let atomicResult: AtomicClaimResult | null = null;

    const updatedPools: GroupBuyPool[] = pools.map((pool) => {
      if (pool.id !== activePool.id) return pool;

      const updatedItems = pool.items.map((item) => {
        if (item.id !== itemId) return item;
        const { updatedClaims, result } = evaluateAtomicClaimTransition(
          item,
          hostParticipant,
          neededQty
        );
        atomicResult = result;
        syncedQty = result.newUserQuantity;
        return { ...item, claims: updatedClaims };
      });

      return { ...pool, items: updatedItems };
    });

    setPools(updatedPools);
    await PoolRepository.saveLocalPools(updatedPools);

    const nextPoolSnapshot =
      updatedPools.find((p) => p.id === activePool.id) || activePool;
    if (atomicResult && targetItem) {
      const triggered = NotificationService.evaluateClaimMilestones(
        prevPoolSnapshot,
        nextPoolSnapshot,
        targetItem,
        atomicResult,
        notifPrefs
      );
      if (triggered.length > 0) {
        await pushAlerts(triggered);
      }
    }

    if (PoolRepository.getCurrentConfig().enabled) {
      await PoolRepository.syncAtomicClaimDelta(
        activePool.id,
        itemId,
        hostParticipant,
        neededQty,
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

    const prevPoolSnapshot = activePool;
    let simulatedNextQty = 1;
    let atomicResult: AtomicClaimResult | null = null;

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
        const { updatedClaims, result } = evaluateAtomicClaimTransition(
          item,
          randomNeighbor,
          1
        );
        atomicResult = result;
        simulatedNextQty = result.newUserQuantity;
        return { ...item, claims: updatedClaims };
      });

      return {
        ...pool,
        participants: updatedParticipants,
        items: updatedItems,
      };
    });

    setPools(updatedPools);
    await PoolRepository.saveLocalPools(updatedPools);

    const nextPoolSnapshot =
      updatedPools.find((p) => p.id === activePool.id) || activePool;
    if (atomicResult) {
      const triggered = NotificationService.evaluateClaimMilestones(
        prevPoolSnapshot,
        nextPoolSnapshot,
        targetItem,
        atomicResult,
        notifPrefs
      );
      if (triggered.length > 0) {
        await pushAlerts(triggered);
      }
    }

    if (PoolRepository.getCurrentConfig().enabled) {
      await PoolRepository.syncAtomicClaimDelta(
        activePool.id,
        targetItem.id,
        randomNeighbor,
        1,
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
    const poolWithHostId: GroupBuyPool = {
      ...newPool,
      hostUserId: activeUser.id,
    };
    const updatedPools = [poolWithHostId, ...pools];
    setPools(updatedPools);
    setSelectedPoolId(poolWithHostId.id);
    setActiveTab('catalog');
    await PoolRepository.saveLocalPools(updatedPools);

    if (PoolRepository.getCurrentConfig().enabled) {
      await PoolRepository.syncNewPool(poolWithHostId);
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

  // Build dynamic categories for the active pool
  const availableCategories = [
    'All',
    ...Array.from(new Set(activePool.items.map((i) => i.category))),
  ];

  // Apply Search Query + Mode Filter + Category Filter
  const filteredItems = activePool.items.filter((i) => {
    const matchesMode = itemFilter === 'all' ? true : i.mode === itemFilter;
    const matchesCat =
      selectedCategory === 'All' ? true : i.category === selectedCategory;
    const matchesQuery =
      !searchQuery.trim() ||
      i.name.toLowerCase().includes(searchQuery.trim().toLowerCase()) ||
      i.category.toLowerCase().includes(searchQuery.trim().toLowerCase());
    return matchesMode && matchesCat && matchesQuery;
  });

  const myBreakdown = getParticipantBreakdowns(activePool).find(
    (b) => b.userId === activeUser.id
  );
  const summary = getPoolProgressSummary(activePool);
  const messageCount = (activePool.messages || []).length;
  const unreadAlertsCount = alerts.filter((a) => !a.read).length;

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
              {isCurrentUserHost ? '(Host) ' : ''}• Code:{' '}
              <Text style={{ fontWeight: '800', color: '#0D9488' }}>
                {activePool.joinCode}
              </Text>
            </Text>
          </TouchableOpacity>
        </View>

        <View style={styles.headerActions}>
          <TouchableOpacity
            style={styles.bellButton}
            onPress={() => setShowNotificationModal(true)}
          >
            <Text style={styles.bellButtonText}>
              🔔{unreadAlertsCount > 0 ? ` ${unreadAlertsCount}` : ''}
            </Text>
          </TouchableOpacity>

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
            <Text style={styles.sharePoolButtonText}>📤</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={styles.newPoolButton}
            onPress={() => setShowCreatePoolModal(true)}
          >
            <Text style={styles.newPoolButtonText}>+ Host</Text>
          </TouchableOpacity>
        </View>
      </View>

      {/* Live Milestone Toast Banner */}
      <LiveToastBanner
        alert={liveToast}
        onDismiss={() => setLiveToast(null)}
        onPressBanner={() => {
          setLiveToast(null);
          setShowNotificationModal(true);
        }}
      />

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
                onPress={() => {
                  setSelectedPoolId(pool.id);
                  setSelectedCategory('All');
                }}
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
              🛒 Shop
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
              activeTab === 'wallet' && styles.tabButtonActive,
            ]}
            onPress={() => setActiveTab('wallet')}
          >
            <Text
              style={[
                styles.tabButtonText,
                activeTab === 'wallet' && styles.tabButtonTextActive,
              ]}
            >
              💰 Wallet
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
            {/* Feature #1: Search Bar & Category Pills */}
            <View style={styles.searchRow}>
              <TextInput
                style={styles.searchInput}
                placeholder="🔍 Search wholesale items or bulk splits..."
                value={searchQuery}
                onChangeText={setSearchQuery}
              />
              {searchQuery.length > 0 && (
                <TouchableOpacity
                  style={styles.clearSearchBtn}
                  onPress={() => setSearchQuery('')}
                >
                  <Text style={styles.clearSearchText}>✕</Text>
                </TouchableOpacity>
              )}
            </View>

            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              style={styles.categoryScroll}
              contentContainerStyle={{ gap: 6, paddingBottom: 6 }}
            >
              {availableCategories.map((cat) => (
                <TouchableOpacity
                  key={cat}
                  style={[
                    styles.catPill,
                    selectedCategory === cat && styles.catPillActive,
                  ]}
                  onPress={() => setSelectedCategory(cat)}
                >
                  <Text
                    style={[
                      styles.catPillText,
                      selectedCategory === cat && styles.catPillTextActive,
                    ]}
                  >
                    {cat}
                  </Text>
                </TouchableOpacity>
              ))}
            </ScrollView>

            {/* Filter & Pitch Item Bar */}
            <View style={styles.filterRow}>
              <View style={styles.filterPills}>
                {(
                  [
                    { key: 'all', label: 'All Modes' },
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

            {/* Feature #1: Neighbor Bulk Split Wishlist & Upvotes */}
            <WishlistSection
              pool={activePool}
              activeUser={activeUser}
              isCurrentUserHost={isCurrentUserHost}
              onPledgeWishlist={handlePledgeWishlist}
              onPromoteWishlistToCatalog={handlePromoteWishlistToCatalog}
              onAddWishlistRequest={handleAddWishlistRequest}
            />
          </View>
        )}

        {activeTab === 'splits' && (
          <SplitLedgerView
            pool={activePool}
            currentUserId={activeUser.id}
            isCurrentUserHost={isCurrentUserHost}
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
            activeUser={activeUser}
            isCurrentUserHost={isCurrentUserHost}
            onSwitchToHostProfile={handleSwitchToPoolHost}
            onToggleLockPool={handleToggleLockPool}
            onRerunWeeklyPool={handleRerunWeeklyPool}
            onHostCoverRemainder={handleHostCoverRemainder}
            onTrimPartialCase={handleTrimPartialCase}
            onUpdateItemActualPrice={handleUpdateItemActualPrice}
            onUpdateReceiptTrueUp={handleUpdateReceiptTrueUp}
            onTogglePaidStatus={handleTogglePaidStatus}
            onTogglePickedUp={handleTogglePickedUp}
          />
        )}

        {activeTab === 'wallet' && (
          <WalletHistoryView
            pools={pools}
            activePool={activePool}
            activeUser={activeUser}
            pastReceipts={PAST_USER_RECEIPTS}
            onReclaimReceiptItems={handleReclaimReceiptItems}
            onVerifyOtpEmail={handleVerifyOtpEmail}
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

      <NotificationCenterModal
        visible={showNotificationModal}
        pool={activePool}
        alerts={alerts}
        prefs={notifPrefs}
        onClose={() => setShowNotificationModal(false)}
        onTogglePref={handleToggleNotifPref}
        onTriggerCutoffReminder={handleTriggerCutoffReminder}
        onTriggerPorchReadyAlert={handleTriggerPorchReadyAlert}
        onMarkAllRead={handleMarkAllAlertsRead}
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
  bellButton: {
    backgroundColor: '#FEF3C7',
    borderWidth: 1,
    borderColor: '#FCD34D',
    paddingHorizontal: 8,
    paddingVertical: 7,
    borderRadius: 9,
  },
  bellButtonText: {
    color: '#92400E',
    fontWeight: '800',
    fontSize: 11,
  },
  codeJoinButton: {
    backgroundColor: '#F1F5F9',
    borderWidth: 1,
    borderColor: '#CBD5E1',
    paddingHorizontal: 8,
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
    paddingHorizontal: 8,
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
    fontSize: 10,
    fontWeight: '700',
    color: '#475569',
  },
  tabButtonTextActive: {
    color: '#0F172A',
    fontWeight: '800',
  },
  searchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 8,
  },
  searchInput: {
    flex: 1,
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#CBD5E1',
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 9,
    fontSize: 13,
    color: '#0F172A',
  },
  clearSearchBtn: {
    marginLeft: 8,
    backgroundColor: '#E2E8F0',
    paddingHorizontal: 10,
    paddingVertical: 8,
    borderRadius: 10,
  },
  clearSearchText: {
    fontSize: 12,
    fontWeight: '800',
    color: '#475569',
  },
  categoryScroll: {
    marginBottom: 8,
  },
  catPill: {
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#CBD5E1',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 999,
  },
  catPillActive: {
    backgroundColor: '#0D9488',
    borderColor: '#0D9488',
  },
  catPillText: {
    fontSize: 11,
    fontWeight: '700',
    color: '#475569',
  },
  catPillTextActive: {
    color: '#FFFFFF',
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
