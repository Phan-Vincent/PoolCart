import React, { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
} from 'react-native';
import { GroupBuyPool, Participant, PastOrderReceipt } from '../types/groupBuy';
import { getParticipantBreakdowns } from '../utils/calculations';

interface Props {
  pools: GroupBuyPool[];
  activePool: GroupBuyPool;
  activeUser: Participant;
  pastReceipts: PastOrderReceipt[];
  onReclaimReceiptItems: (receipt: PastOrderReceipt) => void;
}

export const WalletHistoryView: React.FC<Props> = ({
  pools,
  activePool,
  activeUser,
  pastReceipts,
  onReclaimReceiptItems,
}) => {
  const [reclaimedId, setReclaimedId] = useState<string | null>(null);

  // Calculate active savings across all open pools for activeUser
  let activePoolsSavings = 0;
  let activePoolsSpend = 0;

  pools.forEach((p) => {
    const myB = getParticipantBreakdowns(p).find(
      (b) => b.userId === activeUser.id
    );
    if (myB) {
      activePoolsSavings += myB.totalEstimatedSavings;
      activePoolsSpend += myB.totalDue;
    }
  });

  const historicalSavings = pastReceipts.reduce(
    (sum, r) => sum + r.totalSaved,
    0
  );
  const historicalSpend = pastReceipts.reduce((sum, r) => sum + r.totalPaid, 0);

  const lifetimeSaved = historicalSavings + activePoolsSavings;
  const lifetimeWholesaleSpend = historicalSpend + activePoolsSpend;
  const totalRunsCount = pastReceipts.length + pools.filter((p) => (getParticipantBreakdowns(p).find((b) => b.userId === activeUser.id)?.totalDue ?? 0) > 0).length;

  return (
    <View style={styles.container}>
      {/* Lifetime Wholesale Savings Hero Card */}
      <View style={styles.heroCard}>
        <Text style={styles.heroLabel}>
          💰 {activeUser.name.toUpperCase()} ESTIMATED SAVINGS + SAMPLE HISTORY
        </Text>
        <Text style={styles.heroSavingsAmount}>
          ${lifetimeSaved.toFixed(2)} Saved
        </Text>
        <Text style={styles.heroSub}>
          Across {totalRunsCount} neighborhood group buys (${lifetimeWholesaleSpend.toFixed(2)}{' '}
          total wholesale spend vs. ${(lifetimeWholesaleSpend + lifetimeSaved).toFixed(2)}{' '}
          store retail)
        </Text>

        <View style={styles.heroStatsRow}>
          <View style={styles.heroStatItem}>
            <Text style={styles.heroStatVal}>
              ${activePoolsSavings.toFixed(2)}
            </Text>
            <Text style={styles.heroStatLbl}>Active Pool Savings</Text>
          </View>
          <View style={styles.heroDivider} />
          <View style={styles.heroStatItem}>
            <Text style={styles.heroStatVal}>
              ${historicalSavings.toFixed(2)}
            </Text>
            <Text style={styles.heroStatLbl}>Past Runs Saved</Text>
          </View>
          <View style={styles.heroDivider} />
          <View style={styles.heroStatItem}>
            <Text style={styles.heroStatVal}>
              {Math.round(
                (lifetimeSaved /
                  Math.max(1, lifetimeWholesaleSpend + lifetimeSaved)) *
                  100
              )}
              %
            </Text>
            <Text style={styles.heroStatLbl}>Avg Wholesale Discount</Text>
          </View>
        </View>
      </View>

      <View style={styles.authCard}>
        <Text style={styles.authTitle}>
          {activeUser.verifiedAuth
            ? `Authenticated cloud session: ${activeUser.name}`
            : `Local demo profile: ${activeUser.name}`}
        </Text>
        <Text style={styles.authSub}>
          {activeUser.verifiedAuth
            ? `Signed in via Supabase Auth (${activeUser.email || activeUser.id}). Pool membership and host permissions are enforced on the server.`
            : 'No authenticated sign-in or OTP service is active in local demo mode. Host permissions here only organize the local demo.'}
        </Text>
      </View>
      {/* Past Runs & 1-Tap Re-Claim Staples */}
      <Text style={styles.sectionHeader}>
        🧾 SAMPLE HISTORICAL RECEIPTS & 1-TAP RE-ORDER ({pastReceipts.length})
      </Text>

      {pastReceipts.map((rec) => {
        const isReclaimed = reclaimedId === rec.id;
        return (
          <View key={rec.id} style={styles.receiptCard}>
            <View style={styles.receiptTopRow}>
              <View style={{ flex: 1, paddingRight: 8 }}>
                <Text style={styles.receiptDate}>{rec.completedDate}</Text>
                <Text style={styles.receiptPoolTitle}>{rec.poolTitle}</Text>
                <Text style={styles.receiptSupplier}>{rec.supplierName}</Text>
              </View>
              <View style={{ alignItems: 'flex-end' }}>
                <Text style={styles.receiptPaid}>
                  ${rec.totalPaid.toFixed(2)} sample total
                </Text>
                <Text style={styles.receiptSaved}>
                  Saved ${rec.totalSaved.toFixed(2)}
                </Text>
              </View>
            </View>

            <View style={styles.receiptItemsBox}>
              {rec.items.map((it, idx) => (
                <View key={idx} style={styles.receiptItemRow}>
                  <Text style={styles.receiptItemText}>
                    {it.emoji} {it.name} ×{it.quantity}
                  </Text>
                  <Text style={styles.receiptItemPrice}>
                    ${(it.unitPrice * it.quantity).toFixed(2)}
                  </Text>
                </View>
              ))}
            </View>

            <TouchableOpacity
              style={[
                styles.reclaimButton,
                isReclaimed && styles.reclaimButtonSuccess,
              ]}
              disabled={activePool.status === 'locked'}
              onPress={() => {
                onReclaimReceiptItems(rec);
                setReclaimedId(rec.id);
              }}
            >
              <Text style={styles.reclaimButtonText}>
                {isReclaimed
                  ? `✓ Added ${rec.items.length} Staples to ${activePool.joinCode}!`
                  : `🔁 Re-Claim These ${rec.items.length} Staples in Active Pool (${activePool.joinCode})`}
              </Text>
            </TouchableOpacity>
          </View>
        );
      })}
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    paddingBottom: 28,
  },
  heroCard: {
    backgroundColor: '#0F172A',
    borderRadius: 18,
    padding: 18,
    marginBottom: 14,
  },
  heroLabel: {
    fontSize: 10,
    fontWeight: '800',
    color: '#5EEAD4',
    letterSpacing: 0.7,
  },
  heroSavingsAmount: {
    fontSize: 32,
    fontWeight: '900',
    color: '#FFFFFF',
    marginTop: 4,
  },
  heroSub: {
    fontSize: 12,
    color: '#CBD5E1',
    marginTop: 4,
    lineHeight: 17,
  },
  heroStatsRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: 14,
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: '#1E293B',
  },
  heroStatItem: {
    flex: 1,
    alignItems: 'center',
  },
  heroStatVal: {
    fontSize: 15,
    fontWeight: '800',
    color: '#34D399',
  },
  heroStatLbl: {
    fontSize: 10,
    color: '#94A3B8',
    marginTop: 2,
  },
  heroDivider: {
    width: 1,
    height: 24,
    backgroundColor: '#1E293B',
  },
  authCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    padding: 14,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: '#E2E8F0',
  },
  authTitle: {
    fontSize: 14,
    fontWeight: '800',
    color: '#0F172A',
  },
  authSub: {
    fontSize: 12,
    color: '#64748B',
    marginTop: 2,
  },
  sectionHeader: {
    fontSize: 11,
    fontWeight: '800',
    color: '#64748B',
    letterSpacing: 0.6,
    marginBottom: 10,
  },
  receiptCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    padding: 14,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: '#E2E8F0',
  },
  receiptTopRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: 10,
  },
  receiptDate: {
    fontSize: 10,
    fontWeight: '800',
    color: '#0D9488',
    textTransform: 'uppercase',
  },
  receiptPoolTitle: {
    fontSize: 15,
    fontWeight: '800',
    color: '#0F172A',
    marginTop: 2,
  },
  receiptSupplier: {
    fontSize: 12,
    color: '#64748B',
  },
  receiptPaid: {
    fontSize: 15,
    fontWeight: '900',
    color: '#0F172A',
  },
  receiptSaved: {
    fontSize: 11,
    fontWeight: '700',
    color: '#059669',
    marginTop: 2,
  },
  receiptItemsBox: {
    backgroundColor: '#F8FAFC',
    borderRadius: 10,
    padding: 10,
    marginBottom: 10,
  },
  receiptItemRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 4,
  },
  receiptItemText: {
    fontSize: 12,
    color: '#334155',
    fontWeight: '600',
  },
  receiptItemPrice: {
    fontSize: 12,
    color: '#0F172A',
    fontWeight: '700',
  },
  reclaimButton: {
    backgroundColor: '#F0FDFA',
    borderWidth: 1,
    borderColor: '#5EEAD4',
    paddingVertical: 10,
    borderRadius: 10,
    alignItems: 'center',
  },
  reclaimButtonSuccess: {
    backgroundColor: '#DCFCE7',
    borderColor: '#86EFAC',
  },
  reclaimButtonText: {
    color: '#0F766E',
    fontSize: 12,
    fontWeight: '800',
  },
});
