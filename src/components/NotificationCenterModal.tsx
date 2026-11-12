import React from 'react';
import {
  Modal,
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  ScrollView,
} from 'react-native';
import {
  GroupBuyPool,
  NotificationPreferences,
  PoolNotificationAlert,
} from '../types/groupBuy';

interface ToastBannerProps {
  alert: PoolNotificationAlert | null;
  onDismiss: () => void;
  onPressBanner: () => void;
}

export const LiveToastBanner: React.FC<ToastBannerProps> = ({
  alert,
  onDismiss,
  onPressBanner,
}) => {
  if (!alert) return null;

  return (
    <TouchableOpacity
      style={styles.toastWrap}
      activeOpacity={0.9}
      onPress={onPressBanner}
    >
      <View style={styles.toastContent}>
        <Text style={styles.toastTitle} numberOfLines={1}>
          {alert.title}
        </Text>
        <Text style={styles.toastBody} numberOfLines={2}>
          {alert.body}
        </Text>
      </View>
      <TouchableOpacity style={styles.toastClose} onPress={onDismiss}>
        <Text style={styles.toastCloseText}>✕</Text>
      </TouchableOpacity>
    </TouchableOpacity>
  );
};

interface NotificationCenterModalProps {
  visible: boolean;
  canNotifyPorch: boolean;
  pool: GroupBuyPool;
  alerts: PoolNotificationAlert[];
  prefs: NotificationPreferences;
  onClose: () => void;
  onTogglePref: (key: keyof NotificationPreferences) => void;
  onTriggerCutoffReminder: () => void;
  onTriggerPorchReadyAlert: () => void;
  onMarkAllRead: () => void;
}

export const NotificationCenterModal: React.FC<NotificationCenterModalProps> = ({
  visible,
  canNotifyPorch,
  pool,
  alerts,
  prefs,
  onClose,
  onTogglePref,
  onTriggerCutoffReminder,
  onTriggerPorchReadyAlert,
  onMarkAllRead,
}) => {
  return (
    <Modal visible={visible} animationType="slide" transparent>
      <View style={styles.overlay}>
        <View style={styles.sheet}>
          <View style={styles.headerRow}>
            <View>
              <Text style={styles.title}>🔔 Local Pool Alerts & Preferences</Text>
              <Text style={styles.subtitle}>
                On-device feed only. No background scheduler or push service is connected.
              </Text>
            </View>
            <TouchableOpacity style={styles.markReadBtn} onPress={onMarkAllRead}>
              <Text style={styles.markReadText}>Mark Read</Text>
            </TouchableOpacity>
          </View>

          <ScrollView style={styles.scrollArea}>
            {/* Host & Demo Instant Push Broadcast Triggers */}
            <View style={styles.sectionBox}>
              <Text style={styles.sectionHeader}>
                ⚡ CREATE LOCAL REMINDERS ({pool.joinCode})
              </Text>
              <View style={styles.triggerRow}>
                <TouchableOpacity
                  style={styles.triggerBtnAmber}
                  onPress={onTriggerCutoffReminder}
                  disabled={!prefs.cutoffReminder2h}
                >
                  <Text style={styles.triggerBtnAmberText}>
                    Show Cutoff Reminder
                  </Text>
                </TouchableOpacity>

                <TouchableOpacity
                  style={styles.triggerBtnTeal}
                  onPress={onTriggerPorchReadyAlert}
                  disabled={!canNotifyPorch || !prefs.porchDropArrival}
                >
                  <Text style={styles.triggerBtnTealText}>
                    Show Porch Ready Alert
                  </Text>
                </TouchableOpacity>
              </View>
            </View>

            {/* Notification Preferences Toggles */}
            <View style={styles.sectionBox}>
              <Text style={styles.sectionHeader}>
                ⚙️ LOCAL ALERT PREFERENCES
              </Text>

              {(
                [
                  {
                    key: 'caseSplitCompletion',
                    label: '📦 Bulk Case Locked & New Case Rollover Alerts',
                  },
                  {
                    key: 'freeDeliveryProximity',
                    label: '🚚 Within $30 of Free Wholesale Delivery Tier',
                  },
                  {
                    key: 'cutoffReminder2h',
                    label: '⏰ Manual Cutoff Reminders',
                  },
                  {
                    key: 'porchDropArrival',
                    label: '🛍️ Host Porch Cooler Drop & Pickup Window Alerts',
                  },
                ] as const
              ).map((item) => {
                const enabled = prefs[item.key];
                return (
                  <TouchableOpacity
                    key={item.key}
                    style={styles.prefRow}
                    onPress={() => onTogglePref(item.key)}
                  >
                    <Text style={styles.prefLabel}>{item.label}</Text>
                    <View
                      style={[
                        styles.togglePill,
                        enabled ? styles.toggleOn : styles.toggleOff,
                      ]}
                    >
                      <Text
                        style={[
                          styles.toggleText,
                          enabled ? styles.toggleTextOn : styles.toggleTextOff,
                        ]}
                      >
                        {enabled ? 'ON' : 'OFF'}
                      </Text>
                    </View>
                  </TouchableOpacity>
                );
              })}
            </View>

            {/* Recent Alert Feed */}
            <Text style={styles.sectionHeader}>
              📬 RECENT POOL NOTIFICATIONS ({alerts.length})
            </Text>

            {alerts.map((a) => (
              <View
                key={a.id}
                style={[styles.alertCard, !a.read && styles.alertCardUnread]}
              >
                <View style={styles.alertTopRow}>
                  <Text style={styles.alertPoolTag}>{a.poolTitle}</Text>
                  <Text style={styles.alertTime}>{a.createdAt}</Text>
                </View>
                <Text style={styles.alertTitle}>{a.title}</Text>
                <Text style={styles.alertBody}>{a.body}</Text>
              </View>
            ))}
          </ScrollView>

          <TouchableOpacity style={styles.closeBtn} onPress={onClose}>
            <Text style={styles.closeBtnText}>Done</Text>
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  );
};

const styles = StyleSheet.create({
  toastWrap: {
    marginHorizontal: 14,
    marginTop: 8,
    backgroundColor: '#0F172A',
    borderRadius: 14,
    paddingVertical: 11,
    paddingHorizontal: 14,
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#14B8A6',
    shadowColor: '#000',
    shadowOpacity: 0.18,
    shadowRadius: 8,
    elevation: 4,
  },
  toastContent: {
    flex: 1,
    paddingRight: 8,
  },
  toastTitle: {
    fontSize: 13,
    fontWeight: '800',
    color: '#5EEAD4',
  },
  toastBody: {
    fontSize: 12,
    color: '#F8FAFC',
    marginTop: 2,
    lineHeight: 16,
  },
  toastClose: {
    padding: 6,
  },
  toastCloseText: {
    color: '#94A3B8',
    fontSize: 14,
    fontWeight: '800',
  },
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(15, 23, 42, 0.5)',
    justifyContent: 'flex-end',
  },
  sheet: {
    backgroundColor: '#FFFFFF',
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    padding: 20,
    maxHeight: '88%',
  },
  headerRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: 12,
  },
  title: {
    fontSize: 18,
    fontWeight: '800',
    color: '#0F172A',
  },
  subtitle: {
    fontSize: 12,
    color: '#64748B',
    marginTop: 2,
  },
  markReadBtn: {
    backgroundColor: '#F1F5F9',
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 8,
  },
  markReadText: {
    fontSize: 11,
    fontWeight: '700',
    color: '#334155',
  },
  scrollArea: {
    marginBottom: 14,
  },
  sectionBox: {
    backgroundColor: '#F8FAFC',
    borderRadius: 14,
    padding: 12,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    marginBottom: 14,
  },
  sectionHeader: {
    fontSize: 10,
    fontWeight: '800',
    color: '#64748B',
    letterSpacing: 0.6,
    marginBottom: 8,
  },
  triggerRow: {
    flexDirection: 'row',
    gap: 8,
  },
  triggerBtnAmber: {
    flex: 1,
    backgroundColor: '#FEF3C7',
    borderWidth: 1,
    borderColor: '#FCD34D',
    paddingVertical: 10,
    paddingHorizontal: 8,
    borderRadius: 10,
    alignItems: 'center',
  },
  triggerBtnAmberText: {
    fontSize: 11,
    fontWeight: '800',
    color: '#92400E',
    textAlign: 'center',
  },
  triggerBtnTeal: {
    flex: 1,
    backgroundColor: '#CCFBF1',
    borderWidth: 1,
    borderColor: '#5EEAD4',
    paddingVertical: 10,
    paddingHorizontal: 8,
    borderRadius: 10,
    alignItems: 'center',
  },
  triggerBtnTealText: {
    fontSize: 11,
    fontWeight: '800',
    color: '#0F766E',
    textAlign: 'center',
  },
  prefRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 8,
    borderTopWidth: 1,
    borderTopColor: '#E2E8F0',
  },
  prefLabel: {
    fontSize: 12,
    fontWeight: '600',
    color: '#1E293B',
    flex: 1,
    paddingRight: 8,
  },
  togglePill: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 999,
  },
  toggleOn: {
    backgroundColor: '#DCFCE7',
  },
  toggleOff: {
    backgroundColor: '#E2E8F0',
  },
  toggleText: {
    fontSize: 11,
    fontWeight: '800',
  },
  toggleTextOn: {
    color: '#15803D',
  },
  toggleTextOff: {
    color: '#64748B',
  },
  alertCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 12,
    padding: 12,
    marginBottom: 8,
    borderWidth: 1,
    borderColor: '#E2E8F0',
  },
  alertCardUnread: {
    borderColor: '#0D9488',
    backgroundColor: '#F0FDFA',
  },
  alertTopRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 4,
  },
  alertPoolTag: {
    fontSize: 10,
    fontWeight: '800',
    color: '#0D9488',
    textTransform: 'uppercase',
  },
  alertTime: {
    fontSize: 10,
    color: '#64748B',
  },
  alertTitle: {
    fontSize: 13,
    fontWeight: '800',
    color: '#0F172A',
    marginBottom: 2,
  },
  alertBody: {
    fontSize: 12,
    color: '#334155',
    lineHeight: 17,
  },
  closeBtn: {
    backgroundColor: '#0F172A',
    paddingVertical: 12,
    borderRadius: 12,
    alignItems: 'center',
  },
  closeBtnText: {
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: '800',
  },
});
