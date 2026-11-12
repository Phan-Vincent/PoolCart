import React, { useState } from 'react';
import {
  Modal,
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  ScrollView,
  Share,
  Linking,
} from 'react-native';
import { GroupBuyPool } from '../types/groupBuy';
import {
  buildShareablePoolInviteText,
  getPoolProgressSummary,
} from '../utils/calculations';

interface Props {
  visible: boolean;
  pool: GroupBuyPool;
  initialView?: 'onboarding' | 'flyer';
  onClose: () => void;
}

export const PilotFlyerModal: React.FC<Props> = ({
  visible,
  pool,
  initialView = 'flyer',
  onClose,
}) => {
  const [tab, setTab] = useState<'flyer' | 'onboarding'>(initialView);
  const summary = getPoolProgressSummary(pool);


  const handleSharePoster = async () => {
    try {
      const invite = buildShareablePoolInviteText(pool);
      await Share.share({
        title: `Join ${pool.title} [${pool.joinCode}] on PoolCart`,
        message: invite,
      });
    } catch (err) {
      console.warn('Share error:', err);
    }
  };

  return (
    <Modal visible={visible} animationType="slide" transparent>
      <View style={styles.overlay}>
        <View style={styles.sheet}>
          <View style={styles.switchRow}>
            <TouchableOpacity
              style={[
                styles.switchBtn,
                tab === 'flyer' && styles.switchBtnActive,
              ]}
              onPress={() => setTab('flyer')}
            >
              <Text
                style={[
                  styles.switchText,
                  tab === 'flyer' && styles.switchTextActive,
                ]}
              >
                Invite Flyer
              </Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={[
                styles.switchBtn,
                tab === 'onboarding' && styles.switchBtnActive,
              ]}
              onPress={() => setTab('onboarding')}
            >
              <Text
                style={[
                  styles.switchText,
                  tab === 'onboarding' && styles.switchTextActive,
                ]}
              >
                👋 How PoolCart Works
              </Text>
            </TouchableOpacity>
          </View>

          <ScrollView style={styles.scrollArea}>
            {tab === 'flyer' ? (
              <View style={styles.posterCard}>
                <Text style={styles.posterKicker}>
                  NEIGHBORHOOD WHOLESALE GROUP BUY
                </Text>
                <Text style={styles.posterTitle}>{pool.title}</Text>
                <Text style={styles.posterSupplier}>
                  {pool.supplierName} • {pool.supplierBadge}
                </Text>

                {/* QR Matrix Visual & Code Box */}
                <View style={styles.qrRow}>
                  <View style={styles.qrBox}>
                    <Text style={{ color: '#0F172A', fontWeight: '800', textAlign: 'center' }}>{'TYPE\nINVITE\nCODE'}</Text>
                  </View>

                  <View style={styles.codeInfoCol}>
                    <Text style={styles.joinCodeLabel}>POOL INVITE CODE</Text>
                    <Text style={styles.joinCodeBig}>{pool.joinCode}</Text>
                    <TouchableOpacity onPress={() => Linking.openURL(`poolcart://join/${encodeURIComponent(pool.joinCode)}`).catch(() => undefined)}>
                      <Text style={styles.deepLinkText}>poolcart://join/{pool.joinCode}</Text>
                    </TouchableOpacity>
                    <Text style={styles.webLinkText}>
                      Manual invite code • QR encoding is not connected
                    </Text>
                  </View>
                </View>

                {/* Flyer Logistics */}
                <View style={styles.logisticsBox}>
                  <Text style={styles.logItem}>
                    👤 <Text style={{ fontWeight: '800' }}>Host:</Text>{' '}
                    {pool.hostName} ({pool.neighborhood})
                  </Text>
                  <Text style={styles.logItem}>
                    📍 <Text style={{ fontWeight: '800' }}>Porch Pickup:</Text>{' '}
                    {pool.pickupAddress}
                  </Text>
                  <Text style={styles.logItem}>
                    🕒 <Text style={{ fontWeight: '800' }}>Window:</Text>{' '}
                    {pool.pickupWindow}
                  </Text>
                  <Text style={styles.logItem}>
                    ⏰ <Text style={{ fontWeight: '800' }}>Order Cutoff:</Text>{' '}
                    {pool.cutoffTime}
                  </Text>
                  <Text style={styles.logHighlight}>
                    🎯 Pool Progress: ${summary.combinedPoolTotal.toFixed(0)} / $
                    {pool.minimumOrderAmount} minimum • Free Delivery at $
                    {pool.freeDeliveryThreshold}
                  </Text>
                </View>

                <TouchableOpacity
                  style={styles.sharePosterBtn}
                  onPress={handleSharePoster}
                >
                  <Text style={styles.sharePosterBtnText}>
                    Share invite text & app link
                  </Text>
                </TouchableOpacity>
              </View>
            ) : (
              <View style={styles.onboardingBox}>
                <Text style={styles.onboardMainTitle}>
                  Combine Grocery Orders with Neighbors
                </Text>
                <Text style={styles.onboardSub}>
                  PoolCart lets neighbors combine grocery orders to unlock
                  restaurant-depot & farm-direct wholesale pricing without buying
                  a 50 lb sack alone.
                </Text>

                <View style={styles.stepCard}>
                  <Text style={styles.stepNum}>1️⃣ Pool Toward the Minimum</Text>
                  <Text style={styles.stepBody}>
                    Direct items and completed cases count toward the neighborhood supplier
                    minimum (e.g., $250) and waives the wholesale delivery fee
                    once the pool crosses the free delivery tier ($300+).
                  </Text>
                </View>

                <View style={styles.stepCard}>
                  <Text style={styles.stepNum}>
                    2️⃣ Split Bulk Cases Automatically
                  </Text>
                  <Text style={styles.stepBody}>
                    Want just 1 carton of Barista Oat Milk from a 6-pack case or
                    10 lb from a 50 lb sack of Jasmine Rice? Claim your share—our
                    atomic case matcher locks the case as soon as all shares are
                    claimed!
                  </Text>
                </View>

                <View style={styles.stepCard}>
                  <Text style={styles.stepNum}>
                    3️⃣ Demo Holds or Manual Settlement
                  </Text>
                  <Text style={styles.stepBody}>
                    Card holds and capture are local simulations with no funds moved. After receipt reconciliation, you may open Venmo separately; the host must verify payment before recording it.
                  </Text>
                </View>

                <View style={styles.stepCard}>
                  <Text style={styles.stepNum}>
                    4️⃣ Porch Cooler Drop-Off
                  </Text>
                  <Text style={styles.stepBody}>
                    When the wholesale truck delivers, the host checks in the
                    porch cooler location & gate PIN so you can swing by during
                    the pickup window and grab your shares.
                  </Text>
                </View>
              </View>
            )}
          </ScrollView>

          <TouchableOpacity style={styles.closeBtn} onPress={onClose}>
            <Text style={styles.closeBtnText}>Got It — Back to Pool</Text>
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  );
};

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(15, 23, 42, 0.55)',
    justifyContent: 'flex-end',
  },
  sheet: {
    backgroundColor: '#FFFFFF',
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    padding: 20,
    maxHeight: '90%',
  },
  switchRow: {
    flexDirection: 'row',
    backgroundColor: '#F1F5F9',
    borderRadius: 12,
    padding: 4,
    marginBottom: 14,
  },
  switchBtn: {
    flex: 1,
    paddingVertical: 8,
    alignItems: 'center',
    borderRadius: 9,
  },
  switchBtnActive: {
    backgroundColor: '#FFFFFF',
    shadowColor: '#000',
    shadowOpacity: 0.06,
    shadowRadius: 3,
    elevation: 1,
  },
  switchText: {
    fontSize: 12,
    fontWeight: '700',
    color: '#64748B',
  },
  switchTextActive: {
    color: '#0F172A',
    fontWeight: '800',
  },
  scrollArea: {
    marginBottom: 14,
  },
  posterCard: {
    backgroundColor: '#0F172A',
    borderRadius: 18,
    padding: 18,
    borderWidth: 2,
    borderColor: '#14B8A6',
  },
  posterKicker: {
    fontSize: 10,
    fontWeight: '900',
    color: '#5EEAD4',
    letterSpacing: 0.8,
  },
  posterTitle: {
    fontSize: 20,
    fontWeight: '900',
    color: '#FFFFFF',
    marginTop: 4,
  },
  posterSupplier: {
    fontSize: 12,
    color: '#CBD5E1',
    marginTop: 2,
    fontWeight: '600',
  },
  qrRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#1E293B',
    borderRadius: 14,
    padding: 14,
    marginTop: 14,
    gap: 14,
  },
  qrBox: {
    backgroundColor: '#FFFFFF',
    padding: 8,
    borderRadius: 10,
  },
  qrLine: {
    flexDirection: 'row',
  },
  qrCell: {
    width: 9,
    height: 9,
    margin: 0.5,
  },
  qrCellDark: {
    backgroundColor: '#0F172A',
  },
  qrCellLight: {
    backgroundColor: '#FFFFFF',
  },
  codeInfoCol: {
    flex: 1,
  },
  joinCodeLabel: {
    fontSize: 10,
    fontWeight: '800',
    color: '#94A3B8',
    letterSpacing: 0.6,
  },
  joinCodeBig: {
    fontSize: 24,
    fontWeight: '900',
    color: '#5EEAD4',
    letterSpacing: 1.2,
    marginTop: 2,
  },
  deepLinkText: {
    fontSize: 11,
    color: '#E2E8F0',
    fontWeight: '700',
    marginTop: 4,
  },
  webLinkText: {
    fontSize: 10,
    color: '#94A3B8',
    marginTop: 2,
  },
  logisticsBox: {
    backgroundColor: '#1E293B',
    borderRadius: 12,
    padding: 12,
    marginTop: 12,
    gap: 4,
  },
  logItem: {
    fontSize: 12,
    color: '#F8FAFC',
    lineHeight: 18,
  },
  logHighlight: {
    fontSize: 12,
    fontWeight: '800',
    color: '#34D399',
    marginTop: 4,
  },
  sharePosterBtn: {
    marginTop: 14,
    backgroundColor: '#0D9488',
    paddingVertical: 12,
    borderRadius: 12,
    alignItems: 'center',
  },
  sharePosterBtnText: {
    color: '#FFFFFF',
    fontSize: 13,
    fontWeight: '800',
  },
  onboardingBox: {
    gap: 10,
  },
  onboardMainTitle: {
    fontSize: 18,
    fontWeight: '900',
    color: '#0F172A',
  },
  onboardSub: {
    fontSize: 13,
    color: '#475569',
    lineHeight: 19,
    marginBottom: 4,
  },
  stepCard: {
    backgroundColor: '#F8FAFC',
    borderRadius: 12,
    padding: 12,
    borderWidth: 1,
    borderColor: '#E2E8F0',
  },
  stepNum: {
    fontSize: 13,
    fontWeight: '800',
    color: '#0F766E',
    marginBottom: 4,
  },
  stepBody: {
    fontSize: 12,
    color: '#334155',
    lineHeight: 18,
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
