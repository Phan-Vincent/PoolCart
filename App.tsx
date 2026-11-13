import React, { useEffect, useState, useCallback, useRef } from 'react';
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
  Linking,
  Platform,
  Alert,
} from 'react-native';
import {
  CURRENT_USER,
  INITIAL_POOLS,
  PAST_USER_RECEIPTS,
} from './src/data/mockPools';
import {
  CatalogItem,
  GroupBuyPool,
  NotificationPreferences,
  Participant,
  PastOrderReceipt,
  PoolNotificationAlert,
  PorchDropCheckIn,
  ReceiptTrueUp,
  WishlistRequest,
} from './src/types/groupBuy';
import {
  DEMO_PROFILES,
  evaluateAtomicClaimTransition,
  PoolRepository,
  SupabaseConfig,
  SyncStatusInfo,
} from './src/services/repository';
import {
  DEFAULT_NOTIFICATION_PREFS,
  INITIAL_ALERTS,
  NotificationService,
} from './src/services/notifications';
import {
  buildShareablePoolInviteText,
  extractPoolCodeFromUrl,
  getParticipantBreakdowns,
  getPoolProgressSummary,
} from './src/utils/calculations';
import {
  applyPoolAction,
  isPoolHost,
  newId,
  normalizePools,
  PoolAction,
} from './src/utils/poolActions';
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
import { PilotFlyerModal } from './src/components/PilotFlyerModal';
import { BulkImportModal } from './src/components/BulkImportModal';
import { SupabaseSetupCard } from './src/components/SupabaseSetupCard';
import { AuthScreen } from './src/components/AuthScreen';
import { getPrivacyPolicyUrl, isHostedBuild } from './src/config/appMode';

// Store builds bundle the production backend and hide local demo features.
const HOSTED_BUILD = isHostedBuild();

type ActiveTab =
  | 'catalog'
  | 'splits'
  | 'chat'
  | 'host_sheet'
  | 'wallet'
  | 'architecture';
type ItemFilter = 'all' | 'individual' | 'case_split';
type RadiusFilter = 'all' | 'under_05mi' | 'under_2mi';

export default function App() {
  const [pools, setPoolState] = useState<GroupBuyPool[]>(() =>
    HOSTED_BUILD ? [] : normalizePools(INITIAL_POOLS)
  );
  // Invite link opened before sign-in; joined right after the user signs in.
  const pendingInviteCodeRef = useRef<string | null>(null);
  const poolsRef = useRef(pools);
  const [ready, setReady] = useState(false);
  const [storageError, setStorageError] = useState('');
  const [actionError, setActionError] = useState('');
  const [paymentConfirmation, setPaymentConfirmation] = useState<{
    poolId: string;
    userId: string;
    amount: number;
  } | null>(null);
  const [rerunSource, setRerunSource] = useState<GroupBuyPool | null>(null);

  const setPools = (next: GroupBuyPool[]) => {
    poolsRef.current = next;
    setPoolState(next);
    if (next.length > 0) {
      PoolRepository.saveLocalPools(next)
        .then(() => setStorageError(''))
        .catch((error) => setStorageError(String(error.message || error)));
    }
  };

  const [selectedPoolId, setSelectedPoolId] = useState<string>(
    INITIAL_POOLS[0].id
  );
  const [localDemoUser, setLocalDemoUser] = useState<Participant>(CURRENT_USER);
  const [cloudAuthUser, setCloudAuthUser] = useState<Participant | null>(null);

  const [activeTab, setActiveTab] = useState<ActiveTab>('catalog');
  const [itemFilter, setItemFilter] = useState<ItemFilter>('all');
  const [radiusFilter, setRadiusFilter] = useState<RadiusFilter>('all');
  const [selectedCategory, setSelectedCategory] = useState<string>('All');
  const [searchQuery, setSearchQuery] = useState<string>('');

  const [showAddItemModal, setShowAddItemModal] = useState(false);
  const [showCreatePoolModal, setShowCreatePoolModal] = useState(false);
  const [showJoinByCodeModal, setShowJoinByCodeModal] = useState(false);
  const [showNotificationModal, setShowNotificationModal] = useState(false);
  const [showPilotFlyerModal, setShowPilotFlyerModal] = useState(false);
  const [showBulkImportModal, setShowBulkImportModal] = useState(false);
  const [bulkImportMode, setBulkImportMode] = useState<
    'catalog_import' | 'receipt_ocr'
  >('catalog_import');

  const [alerts, setAlerts] = useState<PoolNotificationAlert[]>(INITIAL_ALERTS);
  const [notifPrefs, setNotifPrefs] = useState<NotificationPreferences>(
    DEFAULT_NOTIFICATION_PREFS
  );
  const [liveToast, setLiveToast] = useState<PoolNotificationAlert | null>(
    null
  );

  const [syncStatus, setSyncStatus] = useState<SyncStatusInfo>({
    mode: 'local',
    label: 'Local demo mode — on-device storage',
    lastSyncedAt: null,
    pendingLocalEditsCount: 0,
    authenticatedUser: null,
  });

  const isCloudMode = PoolRepository.getCurrentConfig().enabled;
  const activeUser: Participant =
    isCloudMode && cloudAuthUser ? cloudAuthUser : localDemoUser;

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
        NotificationService.saveAlerts(merged).catch((error) =>
          setStorageError(`Alert feed: ${String(error)}`)
        );
        return merged;
      });
    },
    []
  );

  const refreshPools = useCallback(
    async (realtimeTable?: string, initialDeepLinkCode?: string | null) => {
      const cfg = PoolRepository.getCurrentConfig();
      const {
        pools: loaded,
        cloudState,
        authenticatedUser,
        pendingEditsCount,
        error,
      } = await PoolRepository.loadPools();

      setCloudAuthUser(authenticatedUser ?? null);

      if (cloudState === 'empty_cloud' || (HOSTED_BUILD && !authenticatedUser)) {
        poolsRef.current = [];
        setPoolState([]);
      } else if (loaded && loaded.length > 0) {
        poolsRef.current = loaded;
        setPoolState(loaded);
        if (!initialDeepLinkCode) {
          setSelectedPoolId((prev) =>
            loaded.some((p) => p.id === prev) ? prev : loaded[0].id
          );
        }
      }

      if (cfg.enabled && cfg.url && cfg.anonKey) {
        const modeMap: Record<typeof cloudState, SyncStatusInfo['mode']> = {
          local_mode: 'local',
          auth_required: 'supabase_auth_required',
          empty_cloud: 'supabase_empty',
          synced: 'supabase_live',
          auth_rejected: 'supabase_auth_rejected',
          network_unavailable: 'supabase_offline',
          schema_or_query_error: 'supabase_error',
        };
        const labelMap: Record<typeof cloudState, string> = {
          local_mode: 'Local demo mode — on-device storage',
          auth_required: 'Cloud configured — sign in required to sync shared pools',
          empty_cloud:
            'Cloud connected (0 joined pools) — join by invite code or host a new pool',
          synced: 'Supabase Cloud Connected (Authenticated Member Sync)',
          auth_rejected:
            'Cloud authorization rejected — local changes preserved on device',
          network_unavailable:
            'Cloud network unavailable — offline local fallback active',
          schema_or_query_error:
            'Supabase cloud query/schema error — local fallback active',
        };
        setSyncStatus((prev) => ({
          mode: modeMap[cloudState],
          label: labelMap[cloudState],
          lastSyncedAt: formatTimestamp(),
          errorMessage: error,
          pendingLocalEditsCount: pendingEditsCount,
          authenticatedUser: authenticatedUser ?? null,
          lastRealtimeEvent: realtimeTable
            ? `Table '${realtimeTable}' updated`
            : prev.lastRealtimeEvent,
        }));
      } else {
        setSyncStatus({
          mode: 'local',
          label: 'Local demo mode — on-device storage',
          lastSyncedAt: formatTimestamp(),
          pendingLocalEditsCount: pendingEditsCount,
          authenticatedUser: null,
        });
      }

      if (initialDeepLinkCode && HOSTED_BUILD && !authenticatedUser) {
        pendingInviteCodeRef.current = initialDeepLinkCode;
      } else if (initialDeepLinkCode) {
        const matched = loaded.find(
          (p) =>
            p.joinCode.toUpperCase() === initialDeepLinkCode.toUpperCase() ||
            p.id.toUpperCase() === initialDeepLinkCode.toUpperCase()
        );
        if (matched) {
          setSelectedPoolId(matched.id);
          setActiveTab('catalog');
        } else if (cfg.enabled && authenticatedUser) {
          const joinRes = await PoolRepository.joinCloudPoolByInvite(
            initialDeepLinkCode,
            authenticatedUser
          );
          if (joinRes.poolId) {
            await refreshPools();
            setSelectedPoolId(joinRes.poolId);
            setActiveTab('catalog');
          } else {
            setActionError(
              joinRes.error ||
                `Could not join cloud pool with code ${initialDeepLinkCode}.`
            );
          }
        } else {
          setActionError(
            `No locally available pool matches invite code ${initialDeepLinkCode}. ${
              cfg.enabled
                ? 'Sign in to your cloud account to join shared pools by code.'
                : 'Shared-cloud lookup is not connected.'
            }`
          );
        }
      }
    },
    []
  );

  useEffect(() => {
    let unsubscribeRealtime = () => {};

    const bootstrap = async () => {
      try {
        const [savedUser, savedAlerts, savedPrefs, cfg, initialUrl] =
          await Promise.all([
            PoolRepository.loadActiveUser(),
            NotificationService.loadAlerts(),
            NotificationService.loadPreferences(),
            PoolRepository.initConfig(),
            Linking.getInitialURL().catch(() => null),
          ]);

        setLocalDemoUser(savedUser);
        setAlerts(savedAlerts);
        setNotifPrefs(savedPrefs);

        const codeFromUrl = extractPoolCodeFromUrl(initialUrl);
        await refreshPools(undefined, codeFromUrl);

        if (cfg.enabled) {
          unsubscribeRealtime = PoolRepository.subscribeToRealtime((table) => {
            refreshPools(table);
          });
        }
        setReady(true);
      } catch (error) {
        setStorageError(String(error));
      }
    };

    bootstrap();

    const sub = Linking.addEventListener('url', (event) => {
      const code = extractPoolCodeFromUrl(event.url);
      if (code) {
        refreshPools(undefined, code);
      }
    });

    return () => {
      unsubscribeRealtime();
      sub.remove();
    };
  }, [refreshPools]);

  useEffect(() => {
    setSelectedCategory('All');
    setSearchQuery('');
    setItemFilter('all');
    setShowAddItemModal(false);
    setShowBulkImportModal(false);
    setPaymentConfirmation(null);
  }, [selectedPoolId, activeUser.id]);

  const visiblePools = pools.filter((p) => {
    const dist = p.distanceMiles ?? Infinity;
    if (radiusFilter === 'under_05mi') return dist <= 0.5;
    if (radiusFilter === 'under_2mi') return dist <= 2.0;
    return true;
  });

  const activePool: GroupBuyPool | undefined =
    pools.find((p) => p.id === selectedPoolId) ||
    visiblePools[0] ||
    pools[0];

  const isCurrentUserHost = activePool
    ? isPoolHost(activePool, activeUser.id)
    : false;

  const reportError = (error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    setActionError(message);
    Alert.alert('Action not completed', message);
  };

  const mutate = async (
    action: PoolAction
  ): Promise<{ pool: GroupBuyPool | null; cloudRejected?: boolean }> => {
    if (!ready) return { pool: null };
    try {
      const current = poolsRef.current.find((p) => p.id === selectedPoolId);
      if (!current) throw new Error('The selected pool is no longer available.');

      if (isCloudMode) {
        if (!cloudAuthUser) {
          throw new Error(
            'Sign in with an authenticated cloud account on the Sync tab before modifying shared pools.'
          );
        }
        if (action.type === 'authorizeDemo' || action.type === 'captureDemo') {
          throw new Error(
            'Simulated card holds are local-demo-only and cannot be used in cloud mode.'
          );
        }
      }

      const next = applyPoolAction(current, activeUser, action);
      const updatedList = poolsRef.current.map((p) =>
        p.id === current.id ? next : p
      );
      setActionError('');
      setPools(updatedList);

      if (isCloudMode && cloudAuthUser) {
        const syncRes = await PoolRepository.syncCloudPoolAction(
          current,
          cloudAuthUser,
          action
        );
        if (syncRes.error) {
          const pending = await PoolRepository.loadPendingCloudEdits();
          setSyncStatus((prev) => ({
            ...prev,
            mode:
              syncRes.state === 'auth_rejected'
                ? 'supabase_auth_rejected'
                : syncRes.state === 'network_unavailable'
                ? 'supabase_offline'
                : 'supabase_error',
            label:
              syncRes.state === 'auth_rejected'
                ? 'Cloud authorization rejected — local edit preserved as unsaved'
                : syncRes.state === 'network_unavailable'
                ? 'Cloud offline — local edit queued on device'
                : 'Cloud sync error — local edit preserved on device',
            errorMessage: syncRes.error,
            pendingLocalEditsCount: pending.length,
          }));
          reportError(
            new Error(
              `Cloud rejected or could not save this change (${syncRes.error}). Your pending edit is preserved locally on this device.`
            )
          );
          return { pool: next, cloudRejected: true };
        }
        await refreshPools();
      }

      return { pool: next };
    } catch (error) {
      reportError(error);
      return { pool: null };
    }
  };

  const announce = (pool: GroupBuyPool, title: string, body: string) =>
    pushAlerts([
      NotificationService.createAlert(pool, 'case_locked', title, body),
    ]);

  const handleSelectUser = async (user: Participant) => {
    if (isCloudMode) {
      reportError(
        new Error(
          'Demo profile switching is disabled while cloud sync is active.'
        )
      );
      return;
    }
    const profile = { ...user, verifiedAuth: false };
    setLocalDemoUser(profile);
    try {
      await PoolRepository.saveActiveUser(profile);
    } catch (error) {
      setStorageError(String(error));
    }
  };

  const handleSwitchToPoolHost = async () => {
    if (!activePool) return;
    if (isCloudMode) {
      reportError(
        new Error(
          'In cloud mode, host permissions require signing in as the pool host account.'
        )
      );
      return;
    }
    const host =
      activePool.participants.find((p) => p.id === activePool.hostUserId) ||
      activePool.participants.find((p) => p.isHost);
    if (host) await handleSelectUser(host);
  };

  const handleConfigSaved = async (config: SupabaseConfig) => {
    try {
      await PoolRepository.saveSupabaseConfig(config);
      await refreshPools();
    } catch (error) {
      reportError(error);
    }
  };

  const handleCloudSignIn = async (
    email: string,
    password: string,
    displayName: string,
    neighborhood: string
  ) => {
    const { user } = await PoolRepository.signInCloudWithPassword(
      email,
      password,
      displayName,
      neighborhood
    );
    setCloudAuthUser(user);
    await refreshPoolsAfterSignIn();
  };

  const refreshPoolsAfterSignIn = async () => {
    const code = pendingInviteCodeRef.current;
    pendingInviteCodeRef.current = null;
    await refreshPools(undefined, code);
  };

  const handleCloudSignUp = async (
    email: string,
    password: string,
    displayName: string,
    neighborhood: string
  ) => {
    const { user, requiresEmailConfirmation } =
      await PoolRepository.signUpCloudAccount(
        email,
        password,
        displayName,
        neighborhood
      );
    if (requiresEmailConfirmation) {
      Alert.alert(
        'Check your email',
        'Confirmation link sent. Sign in once your account is confirmed.'
      );
      return;
    }
    setCloudAuthUser(user);
    await refreshPoolsAfterSignIn();
  };

  const handleCloudSignOut = async () => {
    await PoolRepository.signOutCloud();
    setCloudAuthUser(null);
    await refreshPools();
  };

  const handleDeleteAccount = async () => {
    await PoolRepository.deleteCloudAccount();
    setCloudAuthUser(null);
    poolsRef.current = [];
    setPoolState([]);
    await refreshPools();
    Alert.alert(
      'Account deleted',
      'Your PoolCart account and its data have been permanently deleted.'
    );
  };

  const handleFlushPendingEdits = async () => {
    if (!cloudAuthUser) {
      reportError(
        new Error('Sign in to your cloud account before retrying pending edits.')
      );
      return;
    }
    const res = await PoolRepository.flushPendingCloudEdits(
      poolsRef.current,
      cloudAuthUser
    );
    await refreshPools();
    if (res.error) {
      reportError(new Error(`Pending edit retry failed: ${res.error}`));
    }
  };

  const handleJoinByInviteCode = async (
    code: string
  ): Promise<{ poolId?: string; error?: string }> => {
    if (!isCloudMode) {
      const matched = poolsRef.current.find(
        (p) =>
          p.joinCode.toUpperCase() === code.toUpperCase() ||
          p.id.toUpperCase() === code.toUpperCase()
      );
      return matched
        ? { poolId: matched.id }
        : { error: `No local pool found with code "${code}".` };
    }
    if (!cloudAuthUser) {
      return {
        error:
          'Sign in with an authenticated cloud account on the Sync tab before joining a cloud pool.',
      };
    }
    const res = await PoolRepository.joinCloudPoolByInvite(code, cloudAuthUser);
    if (res.poolId) {
      await refreshPools();
      return { poolId: res.poolId };
    }
    return { error: res.error || 'Could not join cloud pool.' };
  };

  const handleSharePoolInvite = async () => {
    if (!activePool) return;
    try {
      await Share.share({
        title: activePool.title,
        message: buildShareablePoolInviteText(activePool),
      });
    } catch (error) {
      reportError(error);
    }
  };

  const handleUpdateQuantity = async (itemId: string, delta: number) => {
    const before = poolsRef.current.find((p) => p.id === selectedPoolId);
    const item = before?.items.find((i) => i.id === itemId);
    if (!before || !item) return;
    const result = evaluateAtomicClaimTransition(item, activeUser, delta).result;
    const { pool: next, cloudRejected } = await mutate({
      type: 'claim',
      itemId,
      delta,
    });
    if (next && !cloudRejected) {
      await pushAlerts(
        NotificationService.evaluateClaimMilestones(
          before,
          next,
          item,
          result,
          notifPrefs
        )
      );
    }
  };

  const handleOpenBulkImportModal = (mode: 'catalog_import' | 'receipt_ocr') => {
    if (!activePool) return;
    if (mode === 'receipt_ocr' && !isCurrentUserHost) return;
    if (mode === 'catalog_import' && activePool.status === 'locked') return;
    setBulkImportMode(mode);
    setShowBulkImportModal(true);
  };

  const handleImportCatalogItems = async (items: CatalogItem[]) => {
    const { pool: next, cloudRejected } = await mutate({
      type: 'addItems',
      items,
    });
    if (next && !cloudRejected) {
      await announce(
        next,
        `Imported ${items.length} items`,
        'No shares were automatically claimed by this import.'
      );
    }
  };

  const handleApplyParsedReceipt = async (
    prices: { itemId: string; newPrice: number }[],
    taxOrBagFee: number,
    receiptNote: string
  ) => {
    const current = poolsRef.current.find((p) => p.id === selectedPoolId);
    if (!current) return;
    const { pool: next, cloudRejected } = await mutate({
      type: 'receipt',
      prices,
      trueUp: {
        ...current.trueUp,
        taxOrBagFee,
        receiptNote,
        reconciledAt: formatTimestamp(),
      },
    });
    if (next && !cloudRejected) {
      await announce(
        next,
        'Receipt text applied',
        'Review the updated ledger. Changed settlement amounts require confirmation again.'
      );
    }
  };

  const handleAuthorizeDemoHold = async (userId: string, _amount: number) => {
    const { pool: next, cloudRejected } = await mutate({
      type: 'authorizeDemo',
      userId,
    });
    if (next && !cloudRejected) {
      await announce(
        next,
        'Demo hold recorded',
        'Simulation only. No card was authorized and no funds moved.'
      );
    }
  };

  const handleCaptureAllDemoHolds = async () => {
    const { pool: next, cloudRejected } = await mutate({ type: 'captureDemo' });
    if (next && !cloudRejected) {
      await announce(
        next,
        'Demo capture completed',
        'Simulation only. Demo status is separate from manually confirmed payment.'
      );
    }
  };

  const handleUpdatePorchCheckIn = async (checkIn: PorchDropCheckIn) => {
    const { pool: next, cloudRejected } = await mutate({
      type: 'porch',
      checkIn,
    });
    if (
      next &&
      !cloudRejected &&
      checkIn.status === 'ready_on_porch' &&
      notifPrefs.porchDropArrival
    ) {
      await pushAlerts([
        NotificationService.createAlert(
          next,
          'porch_pickup_ready',
          'Porch pickup ready (local alert)',
          checkIn.coolerLocationNote
        ),
      ]);
    }
  };

  const handlePledgeWishlist = async (wishId: string) => {
    await mutate({ type: 'pledge', wishId });
  };
  const handleAddWishlistRequest = async (
    req: Omit<WishlistRequest, 'id' | 'poolId'>
  ) => {
    if (!activePool) return;
    await mutate({
      type: 'request',
      wish: { ...req, id: newId('wish'), poolId: activePool.id },
    });
  };
  const handlePromoteWishlistToCatalog = async (wish: WishlistRequest) => {
    await mutate({ type: 'promote', wishId: wish.id });
  };
  const handleUpdateItemActualPrice = async (
    itemId: string,
    price: number | undefined
  ) => {
    await mutate({ type: 'price', itemId, price });
  };
  const handleUpdateReceiptTrueUp = async (trueUp: ReceiptTrueUp) => {
    await mutate({ type: 'receipt', trueUp });
  };
  const handleReclaimReceiptItems = async (receipt: PastOrderReceipt) => {
    await mutate({ type: 'reorder', receipt });
  };
  const handleSendMessage = async (text: string, isAnnouncement: boolean) => {
    if (!activePool) return;
    const { pool: next, cloudRejected } = await mutate({
      type: 'message',
      message: {
        id: newId('msg'),
        poolId: activePool.id,
        userId: activeUser.id,
        userName: activeUser.name,
        avatarColor: activeUser.avatarColor,
        isAnnouncement,
        text,
        createdAt: formatTimestamp(),
      },
    });
    if (next && !cloudRejected && isAnnouncement && notifPrefs.porchDropArrival) {
      await announce(next, 'Host announcement (local alert)', text);
    }
  };

  const handleTriggerCutoffReminder = async () => {
    if (!activePool || !notifPrefs.cutoffReminder2h) return;
    await pushAlerts([
      NotificationService.createAlert(
        activePool,
        'cutoff_reminder',
        'Cutoff reminder (manual, local)',
        `Order cutoff: ${activePool.cutoffTime}. No scheduled notification was sent.`
      ),
    ]);
  };

  const handleTriggerPorchReadyAlert = async () => {
    if (
      !activePool ||
      !isCurrentUserHost ||
      !notifPrefs.porchDropArrival ||
      activePool.porchCheckIn?.status !== 'ready_on_porch'
    )
      return;
    await pushAlerts([
      NotificationService.createAlert(
        activePool,
        'porch_pickup_ready',
        'Porch pickup ready (local alert)',
        activePool.pickupWindow
      ),
    ]);
  };

  const handleToggleNotifPref = async (key: keyof NotificationPreferences) => {
    const updated = { ...notifPrefs, [key]: !notifPrefs[key] };
    setNotifPrefs(updated);
    try {
      await NotificationService.savePreferences(updated);
    } catch (error) {
      reportError(error);
    }
  };

  const handleMarkAllAlertsRead = async () => {
    const updated = alerts.map((a) => ({ ...a, read: true }));
    setAlerts(updated);
    try {
      await NotificationService.saveAlerts(updated);
    } catch (error) {
      reportError(error);
    }
  };

  const handleRerunWeeklyPool = async () => {
    if (!activePool || !isCurrentUserHost) return;
    setRerunSource(activePool);
    setShowCreatePoolModal(true);
  };
  const handleToggleLockPool = async () => {
    await mutate({ type: 'lock' });
  };
  const handleHostCoverRemainder = async (
    itemId: string,
    _neededQty: number
  ) => {
    await mutate({ type: 'cover', itemId });
  };
  const handleTrimPartialCase = async (itemId: string) => {
    await mutate({ type: 'trim', itemId });
  };
  const handleSimulateNeighborAction = async () => {
    if (isCloudMode) return;
    const neighbor = DEMO_PROFILES.find((p) => p.id !== activeUser.id);
    if (neighbor) await handleSelectUser(neighbor);
  };
  const handleAddItem = async (item: CatalogItem) => {
    await mutate({ type: 'addItems', items: [item] });
  };

  const handleCreatePool = async (pool: GroupBuyPool) => {
    try {
      if (isCloudMode) {
        if (!cloudAuthUser) {
          throw new Error(
            'Sign in with an authenticated cloud account before hosting a cloud pool.'
          );
        }
        const cloudPool: GroupBuyPool = {
          ...pool,
          hostUserId: cloudAuthUser.id,
          hostName: cloudAuthUser.name,
          participants: [
            {
              ...cloudAuthUser,
              isHost: true,
              paidStatus: 'pending',
              pickedUp: false,
            },
          ],
        };
        const res = await PoolRepository.createCloudPool(cloudPool);
        if (res.error) {
          const next = normalizePools([cloudPool, ...poolsRef.current]);
          setPools(next);
          setSelectedPoolId(cloudPool.id);
          reportError(
            new Error(
              `Cloud pool creation could not complete (${res.error}). Preserved locally as a pending edit.`
            )
          );
          return;
        }
        await refreshPools();
        setSelectedPoolId(res.poolId || cloudPool.id);
      } else {
        const next = normalizePools([
          { ...pool, hostUserId: activeUser.id },
          ...poolsRef.current,
        ]);
        setPools(next);
        setSelectedPoolId(pool.id);
      }
      setSelectedCategory('All');
      setSearchQuery('');
      setActiveTab('catalog');
      setRerunSource(null);
    } catch (error) {
      reportError(error);
    }
  };

  const handleTogglePaidStatus = async (userId: string) => {
    if (!activePool || !isCurrentUserHost) return;
    const amount =
      getParticipantBreakdowns(activePool).find((b) => b.userId === userId)
        ?.totalDue ?? 0;
    setPaymentConfirmation({ poolId: activePool.id, userId, amount });
  };
  const handleTogglePickedUp = async (userId: string) => {
    await mutate({ type: 'pickup', userId });
  };
  const handleResetDemo = async () => {
    try {
      const fresh = await PoolRepository.resetDemoData();
      poolsRef.current = fresh;
      setPoolState(fresh);
      setSelectedPoolId(fresh[0].id);
      setStorageError('');
    } catch (error) {
      reportError(error);
    }
  };

  if (!ready) {
    return (
      <SafeAreaView style={{ flex: 1, padding: 24 }}>
        <Text>
          {storageError
            ? `Saved data could not be loaded: ${storageError}. It has not been overwritten. Restart after restoring a valid backup.`
            : 'Loading saved pools…'}
        </Text>
      </SafeAreaView>
    );
  }

  if (HOSTED_BUILD && !cloudAuthUser) {
    return (
      <AuthScreen
        onSignIn={(email, password) => handleCloudSignIn(email, password, '', '')}
        onSignUp={handleCloudSignUp}
        privacyPolicyUrl={getPrivacyPolicyUrl()}
        notice={
          pendingInviteCodeRef.current
            ? `Sign in or create an account to join pool ${pendingInviteCodeRef.current}.`
            : undefined
        }
      />
    );
  }

  // Empty cloud state when connected to Supabase with 0 joined pools
  if (!activePool) {
    return (
      <View style={styles.outerShell}>
        <SafeAreaView style={styles.safeArea}>
          <StatusBar barStyle="dark-content" />
          <View style={styles.header}>
            <Text style={styles.brandTitle}>
              {HOSTED_BUILD ? '🥬 PoolCart' : '🥬 PoolCart Cloud'}
            </Text>
            <View style={styles.headerActions}>
              <TouchableOpacity
                style={styles.codeJoinButton}
                onPress={() => setShowJoinByCodeModal(true)}
              >
                <Text style={styles.codeJoinButtonText}>🔑 Join by Code</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.newPoolButton}
                onPress={() => {
                  setRerunSource(null);
                  setShowCreatePoolModal(true);
                }}
              >
                <Text style={styles.newPoolButtonText}>+ Host Pool</Text>
              </TouchableOpacity>
            </View>
          </View>
          <ScrollView contentContainerStyle={{ padding: 16 }}>
            <View
              style={{
                backgroundColor: '#FFFFFF',
                borderRadius: 16,
                padding: 16,
                marginBottom: 14,
                borderWidth: 1,
                borderColor: '#E2E8F0',
              }}
            >
              <Text style={{ fontSize: 16, fontWeight: '800', color: '#0F172A' }}>
                No Joined Cloud Pools Yet
              </Text>
              <Text style={{ fontSize: 12, color: '#64748B', marginTop: 6 }}>
                {HOSTED_BUILD
                  ? 'Enter an invite code from a neighbor, or host a new pool for your block.'
                  : 'Sample demo fixtures are never uploaded automatically to your cloud database. Enter a neighbor invite code or host a new pool to begin.'}
              </Text>
            </View>
            <SupabaseSetupCard
              activeUser={activeUser}
              onSelectUser={handleSelectUser}
              syncStatus={syncStatus}
              onConfigSaved={handleConfigSaved}
              onCloudSignIn={handleCloudSignIn}
              onCloudSignUp={handleCloudSignUp}
              onCloudSignOut={handleCloudSignOut}
              onDeleteAccount={handleDeleteAccount}
              onFlushPendingEdits={handleFlushPendingEdits}
              onSimulateNeighborAction={handleSimulateNeighborAction}
              onResetDemo={handleResetDemo}
            />
          </ScrollView>
          <CreatePoolModal
            key={'empty_new_' + activeUser.id + String(showCreatePoolModal)}
            visible={showCreatePoolModal}
            activeUser={activeUser}
            onClose={() => setShowCreatePoolModal(false)}
            onCreatePool={handleCreatePool}
          />
          <JoinByCodeModal
            visible={showJoinByCodeModal}
            pools={pools}
            isCloudMode={isCloudMode}
            onClose={() => setShowJoinByCodeModal(false)}
            onSelectPoolId={(poolId) => {
              setSelectedPoolId(poolId);
              setActiveTab('catalog');
            }}
            onJoinByInviteCode={handleJoinByInviteCode}
          />
        </SafeAreaView>
      </View>
    );
  }

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
    <View style={styles.outerShell}>
      <SafeAreaView style={styles.safeArea}>
        <StatusBar barStyle="dark-content" />

        <Text style={{ padding: 8, backgroundColor: '#FEF3C7', fontSize: 11 }}>
          {isCloudMode
            ? `Cloud mode (${syncStatus.label}) • card holds remain local-only • manual settlement requires host verification`
            : 'Local demo • profiles are simulated • card actions move no funds • cloud sync available in Sync tab'}
        </Text>
        {!!actionError && (
          <View style={{ padding: 10, backgroundColor: '#FEE2E2' }}>
            <Text>Action not completed: {actionError}</Text>
            <TouchableOpacity onPress={() => setActionError('')}>
              <Text>Dismiss</Text>
            </TouchableOpacity>
          </View>
        )}
        {!!storageError && (
          <View style={{ padding: 10, backgroundColor: '#FEE2E2' }}>
            <Text>Changes are not saved: {storageError}</Text>
            <TouchableOpacity onPress={() => setPools(poolsRef.current)}>
              <Text>Retry saving pools</Text>
            </TouchableOpacity>
          </View>
        )}
        {paymentConfirmation && (
          <View style={{ padding: 12, backgroundColor: '#FEF3C7' }}>
            <Text>
              Record or remove a manual payment confirmation for $
              {paymentConfirmation.amount.toFixed(2)}? Verify the received funds
              independently first. Demo holds and opening Venmo are not payment
              evidence.
            </Text>
            <TouchableOpacity
              onPress={async () => {
                const pending = paymentConfirmation;
                const current = poolsRef.current.find(
                  (p) => p.id === selectedPoolId
                )!;
                if (
                  pending.poolId !== selectedPoolId ||
                  getParticipantBreakdowns(current).find(
                    (b) => b.userId === pending.userId
                  )?.totalDue !== pending.amount
                ) {
                  reportError(
                    new Error(
                      'The pool or amount changed. Review the ledger and confirm again.'
                    )
                  );
                } else {
                  await mutate({ type: 'paid', userId: pending.userId });
                }
                setPaymentConfirmation(null);
              }}
            >
              <Text>Confirm manual record</Text>
            </TouchableOpacity>
            <TouchableOpacity onPress={() => setPaymentConfirmation(null)}>
              <Text>Cancel</Text>
            </TouchableOpacity>
          </View>
        )}

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
                  {syncStatus.mode === 'supabase_live' ? 'Cloud Live' : isCloudMode ? 'Cloud' : 'Local'}
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
              style={styles.qrFlyerButton}
              onPress={() => setShowPilotFlyerModal(true)}
            >
              <Text style={styles.qrFlyerButtonText}>Invite</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={styles.codeJoinButton}
              onPress={() => setShowJoinByCodeModal(true)}
            >
              <Text style={styles.codeJoinButtonText}>🔑 Code</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={styles.newPoolButton}
              onPress={() => {
                setRerunSource(null);
                setShowCreatePoolModal(true);
              }}
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

        {/* Track #4: Neighborhood Radius Filter & Horizontal Pool Selector */}
        <View style={styles.poolSelectorWrap}>
          <View style={styles.radiusFilterBar}>
            <Text style={styles.radiusLabel}>📍 Drop-Points Near You:</Text>
            {(
              [
                { key: 'all', label: 'All Rancho Cucamonga' },
                { key: 'under_05mi', label: '< 0.5 mi (Walkable)' },
                { key: 'under_2mi', label: '< 2.0 mi' },
              ] as const
            ).map((r) => (
              <TouchableOpacity
                key={r.key}
                style={[
                  styles.radiusChip,
                  radiusFilter === r.key && styles.radiusChipActive,
                ]}
                onPress={() => setRadiusFilter(r.key)}
              >
                <Text
                  style={[
                    styles.radiusChipText,
                    radiusFilter === r.key && styles.radiusChipTextActive,
                  ]}
                >
                  {r.label}
                </Text>
              </TouchableOpacity>
            ))}
          </View>

          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.poolScrollContent}
          >
            {visiblePools.map((pool) => {
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
                    [{pool.joinCode}] •{' '}
                    {pool.distanceMiles !== undefined
                      ? `${pool.distanceMiles} mi`
                      : 'distance unknown'}{' '}
                    • ${poolSummary.combinedPoolTotal.toFixed(0)}/$
                    {pool.minimumOrderAmount}
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
            <View style={{ flex: 1, paddingRight: 8 }}>
              <Text style={styles.supplierBadgeText}>
                {activePool.status === 'locked'
                  ? '🔒 POOL LOCKED • READY FOR ORDER & PICKUP'
                  : `${activePool.supplierBadge} • CODE: ${activePool.joinCode}`}
              </Text>
              <Text style={styles.poolMainTitle}>{activePool.title}</Text>
              <Text style={styles.supplierSubText}>
                Supplier: {activePool.supplierName} • Host:{' '}
                {activePool.hostName} (
                {activePool.distanceMiles !== undefined
                  ? `${activePool.distanceMiles} mi`
                  : 'distance unknown'}
                )
              </Text>
            </View>

            <TouchableOpacity
              style={styles.howItWorksPill}
              onPress={() => setShowPilotFlyerModal(true)}
            >
              <Text style={styles.howItWorksText}>👋 Guide & Invite</Text>
            </TouchableOpacity>
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

              {/* Filter & Pitch / Bulk Import Bar */}
              <View style={styles.filterRow}>
                <View style={styles.filterPills}>
                  {(
                    [
                      { key: 'all', label: 'All' },
                      { key: 'individual', label: 'Direct' },
                      { key: 'case_split', label: 'Case Splits' },
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
                  <View style={{ flexDirection: 'row', gap: 6 }}>
                    <TouchableOpacity
                      style={styles.bulkPasteBtn}
                      onPress={() =>
                        handleOpenBulkImportModal('catalog_import')
                      }
                    >
                      <Text style={styles.bulkPasteBtnText}>📋 Bulk Paste</Text>
                    </TouchableOpacity>

                    <TouchableOpacity
                      style={styles.pitchItemBtn}
                      onPress={() => setShowAddItemModal(true)}
                    >
                      <Text style={styles.pitchItemBtnText}>+ Add Item</Text>
                    </TouchableOpacity>
                  </View>
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
                key={activePool.id + activeUser.id}
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
              key={activePool.id + activeUser.id}
              pool={activePool}
              currentUserId={activeUser.id}
              isCurrentUserHost={isCurrentUserHost}
              onTogglePaidStatus={handleTogglePaidStatus}
              onAuthorizeDemoHold={handleAuthorizeDemoHold}
              demoPaymentsEnabled={!isCloudMode}
            />
          )}

          {activeTab === 'chat' && (
            <PoolChatView
              key={activePool.id + activeUser.id}
              pool={activePool}
              activeUser={activeUser}
              onSendMessage={handleSendMessage}
            />
          )}

          {activeTab === 'host_sheet' && (
            <HostOrderSheetView
              key={
                activePool.id +
                activeUser.id +
                JSON.stringify(activePool.trueUp) +
                JSON.stringify(activePool.porchCheckIn)
              }
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
              onOpenBulkImportModal={handleOpenBulkImportModal}
              onCaptureAllDemoHolds={handleCaptureAllDemoHolds}
              localDemo={!isCloudMode}
              onUpdatePorchCheckIn={handleUpdatePorchCheckIn}
              onTogglePaidStatus={handleTogglePaidStatus}
              onTogglePickedUp={handleTogglePickedUp}
            />
          )}

          {activeTab === 'wallet' && (
            <WalletHistoryView
              key={activePool.id + activeUser.id}
              pools={pools}
              activePool={activePool}
              activeUser={activeUser}
              pastReceipts={
                activeUser.id === CURRENT_USER.id ? PAST_USER_RECEIPTS : []
              }
              onReclaimReceiptItems={handleReclaimReceiptItems}
            />
          )}

          {activeTab === 'architecture' && (
            <SupabaseSetupCard
              activeUser={activeUser}
              onSelectUser={handleSelectUser}
              syncStatus={syncStatus}
              onConfigSaved={handleConfigSaved}
              onCloudSignIn={handleCloudSignIn}
              onCloudSignUp={handleCloudSignUp}
              onCloudSignOut={handleCloudSignOut}
              onDeleteAccount={handleDeleteAccount}
              onFlushPendingEdits={handleFlushPendingEdits}
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
          key={activePool.id + activeUser.id + String(showAddItemModal)}
          visible={showAddItemModal}
          activeUser={activeUser}
          onClose={() => setShowAddItemModal(false)}
          onAddItem={handleAddItem}
        />

        <CreatePoolModal
          key={
            (rerunSource?.id || 'new') +
            activeUser.id +
            String(showCreatePoolModal)
          }
          sourcePool={rerunSource ?? undefined}
          visible={showCreatePoolModal}
          activeUser={activeUser}
          onClose={() => setShowCreatePoolModal(false)}
          onCreatePool={handleCreatePool}
        />

        <JoinByCodeModal
          visible={showJoinByCodeModal}
          pools={pools}
          isCloudMode={isCloudMode}
          onClose={() => setShowJoinByCodeModal(false)}
          onSelectPoolId={(poolId) => {
            setSelectedPoolId(poolId);
            setActiveTab('catalog');
          }}
          onJoinByInviteCode={handleJoinByInviteCode}
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
          canNotifyPorch={
            isCurrentUserHost &&
            activePool.porchCheckIn?.status === 'ready_on_porch'
          }
          onMarkAllRead={handleMarkAllAlertsRead}
        />

        <PilotFlyerModal
          visible={showPilotFlyerModal}
          pool={activePool}
          onClose={() => setShowPilotFlyerModal(false)}
        />

        <BulkImportModal
          key={
            activePool.id +
            activeUser.id +
            bulkImportMode +
            String(showBulkImportModal)
          }
          isCurrentUserHost={isCurrentUserHost}
          visible={showBulkImportModal}
          pool={activePool}
          activeUser={activeUser}
          initialMode={bulkImportMode}
          onClose={() => setShowBulkImportModal(false)}
          onImportCatalogItems={handleImportCatalogItems}
          onApplyParsedReceipt={handleApplyParsedReceipt}
        />
      </SafeAreaView>
    </View>
  );
}

const styles = StyleSheet.create({
  outerShell: {
    flex: 1,
    backgroundColor: Platform.OS === 'web' ? '#E2E8F0' : '#F8FAFC',
    alignItems: 'center',
  },
  safeArea: {
    flex: 1,
    width: '100%',
    maxWidth: Platform.OS === 'web' ? 500 : undefined,
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
  qrFlyerButton: {
    backgroundColor: '#F0FDFA',
    borderWidth: 1,
    borderColor: '#5EEAD4',
    paddingHorizontal: 8,
    paddingVertical: 7,
    borderRadius: 9,
  },
  qrFlyerButtonText: {
    color: '#0F766E',
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
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: '#E2E8F0',
  },
  radiusFilterBar: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    marginBottom: 8,
    gap: 6,
    flexWrap: 'wrap',
  },
  radiusLabel: {
    fontSize: 11,
    fontWeight: '800',
    color: '#475569',
    marginRight: 2,
  },
  radiusChip: {
    backgroundColor: '#F1F5F9',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 999,
  },
  radiusChipActive: {
    backgroundColor: '#0F172A',
  },
  radiusChipText: {
    fontSize: 10,
    fontWeight: '700',
    color: '#475569',
  },
  radiusChipTextActive: {
    color: '#FFFFFF',
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
    justifyContent: 'space-between',
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
  howItWorksPill: {
    backgroundColor: '#F0FDFA',
    borderWidth: 1,
    borderColor: '#5EEAD4',
    paddingHorizontal: 10,
    paddingVertical: 7,
    borderRadius: 10,
  },
  howItWorksText: {
    fontSize: 11,
    fontWeight: '800',
    color: '#0F766E',
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
  bulkPasteBtn: {
    backgroundColor: '#F0FDFA',
    borderWidth: 1,
    borderColor: '#5EEAD4',
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 999,
  },
  bulkPasteBtnText: {
    fontSize: 11,
    fontWeight: '800',
    color: '#0F766E',
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
