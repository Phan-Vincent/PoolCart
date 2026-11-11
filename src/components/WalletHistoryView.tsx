import React, { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  TextInput,
} from 'react-native';
import { GroupBuyPool, Participant, PastOrderReceipt } from '../types/groupBuy';
import { getParticipantBreakdowns } from '../utils/calculations';

interface Props {
  pools: GroupBuyPool[];
  activePool: GroupBuyPool;
  activeUser: Participant;
  pastReceipts: PastOrderReceipt[];
  onReclaimReceiptItems: (receipt: PastOrderReceipt) => void;
  onVerifyOtpEmail: (email: string) => void;
}

export const WalletHistoryView: React.FC<Props> = ({
  pools,
  activePool,
  activeUser,
  pastReceipts,
  onReclaimReceiptItems,
  onVerifyOtpEmail,
}) => {
  const [emailInput, setEmailInput] = useState(
    activeUser.email || 'vincent@poolcart.app'
  );
  const [otpInput, setOtpInput] = useState('');
  const [otpSent, setOtpSent] = useState(false);
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
  const totalRunsCount = pastReceipts.length + (activePoolsSpend > 0 ? 1 : 0);

  const handleSendMagicCode = () => {
    if (!emailInput.trim()) return;
    setOtpSent(true);
    setOtpInput('849201');
  };

  const handleConfirmOtp = () => {
    onVerifyOtpEmail(emailInput.trim());
    setOtpSent(false);
  };

  return (
    <View style={styles.container}>
      {/* Lifetime Wholesale Savings Hero Card */}
      <View style={styles.heroCard}>
        <Text style={styles.heroLabel}>
          💰 {activeUser.name.toUpperCase()} LIFETIME WHOLESALE SAVINGS
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

      {/* Feature #4: Verified Neighbor & Host Auth Status */}
      <View style={styles.authCard}>
        <View style={styles.authHeaderRow}>
          <View style={{ flex: 1 }}>
            <Text style={styles.authTitle}>
              🔐 Verified Neighbor Identity & Host Permissions
            </Text>
            <Text style={styles.authSub}>
              Signed in as <Text style={{ fontWeight: '800' }}>{activeUser.name}</Text>{' '}
              ({activeUser.email || 'Unverified email'})
            </Text>
          </View>
          <View
            style={[
              styles.verifiedBadge,
              activeUser.verifiedAuth
                ? styles.verifiedBadgeGreen
                : styles.verifiedBadgeAmber,
            ]}
          >
            <Text
              style={[
                styles.verifiedBadgeText,
                activeUser.verifiedAuth
                  ? { color: '#15803D' }
                  : { color: '#B45309' },
              ]}
            >
              {activeUser.verifiedAuth ? '✓ Verified OTP' : 'Guest Profile'}
            </Text>
          </View>
        </View>

        <View style={styles.authInputRow}>
          <TextInput
            style={[styles.input, { flex: 1, marginRight: 8 }]}
            placeholder="Email or Phone for Magic OTP"
            autoCapitalize="none"
            value={emailInput}
            onChangeText={setEmailInput}
          />
          {!otpSent ? (
            <TouchableOpacity
              style={styles.otpBtn}
              onPress={handleSendMagicCode}
            >
              <Text style={styles.otpBtnText}>Send OTP</Text>
            </TouchableOpacity>
          ) : (
            <TouchableOpacity
              style={[styles.otpBtn, { backgroundColor: '#0D9488' }]}
              onPress={handleConfirmOtp}
            >
              <Text style={styles.otpBtnText}>Verify ({otpInput})</Text>
            </TouchableOpacity>
          )}
        </View>
      </View>

      {/* Past Runs & 1-Tap Re-Claim Staples */}
      <Text style={styles.sectionHeader}>
        🧾 PAST NEIGHBORHOOD RECEIPTS & 1-TAP RE-ORDER ({pastReceipts.length})
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
                  ${rec.totalPaid.toFixed(2)} paid
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
  authHeaderRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: 10,
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
  verifiedBadge: {
    paddingHorizontal: 9,
    paddingVertical: 4,
    borderRadius: 999,
  },
  verifiedBadgeGreen: {
    backgroundColor: '#DCFCE7',
  },
  verifiedBadgeAmber: {
    backgroundColor: '#FEF3C7',
  },
  verifiedBadgeText: {
    fontSize: 10,
    fontWeight: '800',
  },
  authInputRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  input: {
    backgroundColor: '#F8FAFC',
    borderWidth: 1,
    borderColor: '#CBD5E1',
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 8,
    fontSize: 12,
    color: '#0F172A',
  },
  otpBtn: {
    backgroundColor: '#0F172A',
    paddingHorizontal: 12,
    paddingVertical: 9,
    borderRadius: 10,
  },
  otpBtnText: {
    color: '#FFFFFF',
    fontSize: 11,
    fontWeight: '800',
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
