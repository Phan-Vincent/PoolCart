import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  AlertCategory,
  AtomicClaimResult,
  CatalogItem,
  GroupBuyPool,
  NotificationPreferences,
  PoolNotificationAlert,
} from '../types/groupBuy';
import { getPoolProgressSummary } from '../utils/calculations';

const STORAGE_KEY_ALERTS = '@poolcart_alerts_v1';
const STORAGE_KEY_PREFS = '@poolcart_notif_prefs_v1';

export const DEFAULT_NOTIFICATION_PREFS: NotificationPreferences = {
  cutoffReminder2h: true,
  freeDeliveryProximity: true,
  caseSplitCompletion: true,
  porchDropArrival: true,
};

export const INITIAL_ALERTS: PoolNotificationAlert[] = [
  {
    id: 'alert_init_1',
    poolId: 'pool_farm_box',
    poolTitle: 'Inland Valley Organic Farm Direct',
    category: 'case_locked',
    title: '📦 Case #1 Locked: California Olive Oil!',
    body: 'All 4/4 tin shares of Cold-Pressed California Olive Oil are claimed ($18.00/tin). Next claim automatically opens Case #2.',
    createdAt: '6:42 PM',
    read: false,
  },
  {
    id: 'alert_init_2',
    poolId: 'pool_farm_box',
    poolTitle: 'Inland Valley Organic Farm Direct',
    category: 'cutoff_reminder',
    title: '⏰ 1 Share Needed Before Cutoff: Barista Oat Milk',
    body: 'Barista Organic Oat Milk is at 5/6 cartons claimed! Claim 1 more carton ($3.25) so the full case ships.',
    createdAt: '7:10 PM',
    read: false,
  },
];

function nowTimeLabel(): string {
  const now = new Date();
  return now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

export const NotificationService = {
  async loadAlerts(): Promise<PoolNotificationAlert[]> {
    try {
      const raw = await AsyncStorage.getItem(STORAGE_KEY_ALERTS);
      if (!raw) {
        await AsyncStorage.setItem(STORAGE_KEY_ALERTS, JSON.stringify(INITIAL_ALERTS));
        return INITIAL_ALERTS;
      }
      return JSON.parse(raw) as PoolNotificationAlert[];
    } catch {
      return INITIAL_ALERTS;
    }
  },

  async saveAlerts(alerts: PoolNotificationAlert[]): Promise<void> {
    try {
      await AsyncStorage.setItem(STORAGE_KEY_ALERTS, JSON.stringify(alerts.slice(0, 40)));
    } catch (err) {
      console.warn('Failed to save alerts:', err);
    }
  },

  async loadPreferences(): Promise<NotificationPreferences> {
    try {
      const raw = await AsyncStorage.getItem(STORAGE_KEY_PREFS);
      if (!raw) return DEFAULT_NOTIFICATION_PREFS;
      return { ...DEFAULT_NOTIFICATION_PREFS, ...JSON.parse(raw) };
    } catch {
      return DEFAULT_NOTIFICATION_PREFS;
    }
  },

  async savePreferences(prefs: NotificationPreferences): Promise<void> {
    try {
      await AsyncStorage.setItem(STORAGE_KEY_PREFS, JSON.stringify(prefs));
    } catch (err) {
      console.warn('Failed to save notification prefs:', err);
    }
  },

  createAlert(
    pool: GroupBuyPool,
    category: AlertCategory,
    title: string,
    body: string
  ): PoolNotificationAlert {
    return {
      id: `alert_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      poolId: pool.id,
      poolTitle: pool.title,
      category,
      title,
      body,
      createdAt: nowTimeLabel(),
      read: false,
    };
  },

  /**
   * Evaluates pool & case-split threshold transitions after an atomic claim update
   * and returns any newly triggered alerts (e.g., Case Locked, Minimum Met, <=$25 to Free Delivery, Free Delivery Unlocked).
   */
  evaluateClaimMilestones(
    prevPool: GroupBuyPool,
    nextPool: GroupBuyPool,
    item: CatalogItem,
    claimResult: AtomicClaimResult,
    prefs: NotificationPreferences
  ): PoolNotificationAlert[] {
    const newAlerts: PoolNotificationAlert[] = [];
    const prevSummary = getPoolProgressSummary(prevPool);
    const nextSummary = getPoolProgressSummary(nextPool);

    // 1. Bulk Case Completion or Rollover
    if (prefs.caseSplitCompletion) {
      if (claimResult.cappedAtMaxCases) {
        newAlerts.push(
          this.createAlert(
            nextPool,
            'case_locked',
            `🛑 Max Case Cap Reached: ${item.emoji} ${item.name}`,
            `Host capped this bulk item at ${item.maxCases} full case(s) (${claimResult.totalClaimedUnits} units total).`
          )
        );
      } else if (claimResult.justCompletedCase) {
        newAlerts.push(
          this.createAlert(
            nextPool,
            'case_locked',
            `📦 Case #${claimResult.fullCasesCount} Locked: ${item.emoji} ${item.name}!`,
            `All ${item.caseSize}/${item.caseSize} shares claimed! Full wholesale case is now locked into the supplier order.`
          )
        );
      } else if (claimResult.justOpenedNewCase) {
        newAlerts.push(
          this.createAlert(
            nextPool,
            'case_locked',
            `🆕 Case #${claimResult.fullCasesCount + 1} Opened: ${item.emoji} ${item.name}`,
            `Case #${claimResult.fullCasesCount} is full! Started Case #${claimResult.fullCasesCount + 1} (1/${item.caseSize} claimed).`
          )
        );
      }
    }

    // 2. Wholesale Minimum Order Met
    if (!prevSummary.isMinimumMet && nextSummary.isMinimumMet) {
      newAlerts.push(
        this.createAlert(
          nextPool,
          'minimum_met',
          `🎯 Wholesale Minimum Met ($${nextPool.minimumOrderAmount}+)!`,
          `${nextPool.title} reached $${nextSummary.combinedPoolTotal.toFixed(2)}! This week's wholesale delivery is officially a go.`
        )
      );
    }

    // 3. Free Delivery Unlocked or Within $30 Proximity
    if (prefs.freeDeliveryProximity) {
      if (
        !prevSummary.isFreeDeliveryUnlocked &&
        nextSummary.isFreeDeliveryUnlocked
      ) {
        newAlerts.push(
          this.createAlert(
            nextPool,
            'free_delivery_unlocked',
            `🎉 FREE Wholesale Delivery Unlocked!`,
            `${nextPool.title} passed $${nextPool.freeDeliveryThreshold}! The $${nextPool.deliveryFee} supplier delivery fee is now $0.00 for all neighbors.`
          )
        );
      } else if (
        !nextSummary.isFreeDeliveryUnlocked &&
        prevSummary.amountNeededForFreeDelivery > 30 &&
        nextSummary.amountNeededForFreeDelivery <= 30 &&
        nextSummary.amountNeededForFreeDelivery > 0
      ) {
        newAlerts.push(
          this.createAlert(
            nextPool,
            'free_delivery_near',
            `🚚 Only $${nextSummary.amountNeededForFreeDelivery.toFixed(2)} Away from Free Delivery!`,
            `Add $${nextSummary.amountNeededForFreeDelivery.toFixed(2)} more to ${nextPool.title} to waive the $${nextPool.deliveryFee} delivery fee for everyone.`
          )
        );
      }
    }

    return newAlerts;
  },
};
