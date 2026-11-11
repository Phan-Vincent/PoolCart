import React from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Linking,
  Alert,
} from 'react-native';
import { GroupBuyPool } from '../types/groupBuy';
import { getParticipantBreakdowns } from '../utils/calculations';

interface Props {
  pool: GroupBuyPool;
  currentUserId: string;
  isCurrentUserHost: boolean;
  onTogglePaidStatus: (userId: string) => void;
}

export const SplitLedgerView: React.FC<Props> = ({
  pool,
  currentUserId,
  isCurrentUserHost,
  onTogglePaidStatus,
}) => {
  const breakdowns = getParticipantBreakdowns(pool);
  const venmoHandle = pool.hostVenmoHandle || 'PoolCart-Host';

  const handlePayWithVenmo = async (
    userId: string,
    amount: number,
    userName: string
  ) => {
    const note = encodeURIComponent(
      `PoolCart: ${pool.title} (${userName.split(' ')[0]})`
    );
    const amountStr = amount.toFixed(2);
    const venmoDeepLink = `venmo://paycharge?txn=pay&recipients=${encodeURIComponent(
      venmoHandle
    )}&amount=${amountStr}&note=${note}`;
    const venmoWebFallback = `https://venmo.com/${encodeURIComponent(
      venmoHandle
    )}?txn=pay&amount=${amountStr}&note=${note}`;

    try {
      const supported = await Linking.canOpenURL(venmoDeepLink);
      if (supported) {
        await Linking.openURL(venmoDeepLink);
      } else {
        await Linking.openURL(venmoWebFallback);
      }
      if (pool.participants.find((p) => p.id === userId)?.paidStatus !== 'paid') {
        onTogglePaidStatus(userId);
      }
    } catch {
      Alert.alert(
        'Venmo Payment Details',
        `Send $${amountStr} to @${venmoHandle} with note "${pool.title}".`
      );
    }
  };

  return (
    <View style={styles.container}>
      <View style={styles.pickupBanner}>
        <Text style={styles.pickupTitle}>📍 Pickup & Drop-off Logistics</Text>
        <Text style={styles.pickupDetail}>
          Host: {pool.hostName} (@{venmoHandle})
        </Text>
        <Text style={styles.pickupDetail}>Address: {pool.pickupAddress}</Text>
        <Text style={styles.pickupDetail}>Window: {pool.pickupWindow}</Text>
        <Text style={styles.cutoffNote}>
          {pool.status === 'locked'
            ? '🔒 Pool Locked — Ready for Settlement & Pickup'
            : `Order Cutoff: ${pool.cutoffTime}`}
        </Text>
        {pool.trueUp?.reconciledAt && (
          <Text style={styles.trueUpBannerNote}>
            🧾 Receipt True-Up Applied ({pool.trueUp.reconciledAt}): "{pool.trueUp.receiptNote}"
          </Text>
        )}
      </View>

      <Text style={styles.sectionHeader}>
        NEIGHBOR COST SPLIT & SETTLEMENT LEDGER
      </Text>

      {breakdowns.map((b) => {
        const isMe = b.userId === currentUserId;
        const canTogglePaid = isCurrentUserHost || isMe;
        const hasTrueUpDelta = Math.abs(b.netTrueUpDelta) >= 0.01;

        return (
          <View
            key={b.userId}
            style={[styles.memberCard, isMe && styles.myMemberCard]}
          >
            <View style={styles.memberHeader}>
              <View style={styles.memberNameRow}>
                <View
                  style={[styles.avatar, { backgroundColor: b.avatarColor }]}
                >
                  <Text style={styles.avatarInitial}>
                    {b.userName.charAt(0).toUpperCase()}
                  </Text>
                </View>
                <View>
                  <Text style={styles.memberName}>{b.userName}</Text>
                  <Text style={styles.savingsSub}>
                    Saving ${b.totalEstimatedSavings.toFixed(2)} vs. retail
                  </Text>
                </View>
              </View>

              <TouchableOpacity
                style={[
                  styles.paidChip,
                  b.paidStatus === 'paid'
                    ? styles.paidChipGreen
                    : styles.paidChipAmber,
                  !canTogglePaid && { opacity: 0.5 },
                ]}
                onPress={() => onTogglePaidStatus(b.userId)}
                disabled={!canTogglePaid}
              >
                <Text
                  style={[
                    styles.paidChipText,
                    b.paidStatus === 'paid'
                      ? styles.paidTextGreen
                      : styles.paidTextAmber,
                  ]}
                >
                  {b.paidStatus === 'paid' ? '✓ Paid' : 'Mark Paid'}
                </Text>
              </TouchableOpacity>
            </View>

            {/* Line Items */}
            {b.lineItems.length === 0 ? (
              <Text style={styles.emptyItemsText}>
                No items claimed in this pool yet.
              </Text>
            ) : (
              <View style={styles.itemsList}>
                {b.lineItems.map((li) => {
                  const priceAdjusted =
                    li.effectiveUnitPrice !== li.quotedUnitPrice;
                  return (
                    <View key={li.itemId} style={styles.lineItemRow}>
                      <View style={styles.lineItemLeft}>
                        <Text style={styles.lineItemTitle}>
                          {li.emoji} {li.itemName} (×{li.quantity})
                        </Text>
                        {priceAdjusted && (
                          <Text style={styles.trueUpPriceSub}>
                            🧾 Receipt price: ${li.effectiveUnitPrice.toFixed(2)}/unit
                            (was ${li.quotedUnitPrice.toFixed(2)})
                          </Text>
                        )}
                        {li.isCaseSplit && (
                          <Text
                            style={[
                              styles.caseSubNote,
                              li.caseFilled
                                ? { color: '#15803D' }
                                : { color: '#9333EA' },
                            ]}
                          >
                            {li.caseFilled
                              ? '✓ Case filled'
                              : `⏳ Waiting for case to fill (${li.caseProgressText})`}
                          </Text>
                        )}
                      </View>
                      <Text style={styles.lineItemPrice}>
                        ${li.subtotal.toFixed(2)}
                      </Text>
                    </View>
                  );
                })}

                <View style={styles.feeRow}>
                  <Text style={styles.feeLabel}>Shared Wholesale Delivery</Text>
                  <Text style={styles.feeValue}>
                    {b.estimatedDeliveryShare === 0
                      ? 'FREE (Waived)'
                      : `$${b.estimatedDeliveryShare.toFixed(2)}`}
                  </Text>
                </View>

                {b.proRataTaxOrAdjustment !== 0 && (
                  <View style={styles.feeRow}>
                    <Text style={styles.feeLabel}>
                      Pro-Rata Receipt Tax / CRV / Weight Adj.
                    </Text>
                    <Text style={styles.feeValue}>
                      ${b.proRataTaxOrAdjustment.toFixed(2)}
                    </Text>
                  </View>
                )}

                <View style={styles.totalRow}>
                  <View>
                    <Text style={styles.totalLabel}>Total Pool Share</Text>
                    {hasTrueUpDelta && (
                      <Text style={styles.deltaSubNote}>
                        {b.netTrueUpDelta < 0
                          ? `↓ $${Math.abs(b.netTrueUpDelta).toFixed(2)} lower after receipt true-up`
                          : `↑ +$${b.netTrueUpDelta.toFixed(2)} after receipt true-up`}
                      </Text>
                    )}
                  </View>
                  <Text style={styles.totalValue}>
                    ${b.totalDue.toFixed(2)}
                  </Text>
                </View>

                {/* 1-Tap Venmo Deep Link Settlement Button */}
                {b.paidStatus !== 'paid' && b.totalDue > 0 && (
                  <TouchableOpacity
                    style={styles.venmoButton}
                    onPress={() =>
                      handlePayWithVenmo(b.userId, b.totalDue, b.userName)
                    }
                  >
                    <Text style={styles.venmoButtonText}>
                      💸 Pay ${b.totalDue.toFixed(2)} to @{venmoHandle} via Venmo
                    </Text>
                  </TouchableOpacity>
                )}
              </View>
            )}
          </View>
        );
      })}
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    paddingBottom: 24,
  },
  pickupBanner: {
    backgroundColor: '#F0FDFA',
    borderRadius: 14,
    padding: 14,
    borderWidth: 1,
    borderColor: '#99F6E4',
    marginBottom: 16,
  },
  pickupTitle: {
    fontSize: 14,
    fontWeight: '800',
    color: '#0F766E',
    marginBottom: 6,
  },
  pickupDetail: {
    fontSize: 13,
    color: '#134E4A',
    marginBottom: 2,
    fontWeight: '500',
  },
  cutoffNote: {
    fontSize: 12,
    fontWeight: '700',
    color: '#B45309',
    marginTop: 6,
  },
  trueUpBannerNote: {
    fontSize: 11,
    fontWeight: '700',
    color: '#0F766E',
    marginTop: 4,
  },
  sectionHeader: {
    fontSize: 11,
    fontWeight: '800',
    color: '#64748B',
    letterSpacing: 0.6,
    marginBottom: 10,
  },
  memberCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 14,
    padding: 14,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: '#E2E8F0',
  },
  myMemberCard: {
    borderColor: '#0D9488',
    borderWidth: 1.5,
  },
  memberHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 10,
  },
  memberNameRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  avatar: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarInitial: {
    color: '#FFFFFF',
    fontWeight: '800',
    fontSize: 15,
  },
  memberName: {
    fontSize: 15,
    fontWeight: '700',
    color: '#0F172A',
  },
  savingsSub: {
    fontSize: 12,
    color: '#059669',
    fontWeight: '600',
  },
  paidChip: {
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 999,
  },
  paidChipGreen: {
    backgroundColor: '#DCFCE7',
  },
  paidChipAmber: {
    backgroundColor: '#FEF3C7',
  },
  paidChipText: {
    fontSize: 12,
    fontWeight: '700',
  },
  paidTextGreen: {
    color: '#15803D',
  },
  paidTextAmber: {
    color: '#B45309',
  },
  emptyItemsText: {
    fontSize: 12,
    color: '#94A3B8',
    fontStyle: 'italic',
  },
  itemsList: {
    borderTopWidth: 1,
    borderTopColor: '#F1F5F9',
    paddingTop: 10,
  },
  lineItemRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: 8,
  },
  lineItemLeft: {
    flex: 1,
    paddingRight: 10,
  },
  lineItemTitle: {
    fontSize: 13,
    fontWeight: '600',
    color: '#334155',
  },
  trueUpPriceSub: {
    fontSize: 11,
    fontWeight: '700',
    color: '#0D9488',
    marginTop: 2,
  },
  caseSubNote: {
    fontSize: 11,
    fontWeight: '600',
    marginTop: 2,
  },
  lineItemPrice: {
    fontSize: 13,
    fontWeight: '700',
    color: '#0F172A',
  },
  feeRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingTop: 6,
    borderTopWidth: 1,
    borderTopColor: '#F8FAFC',
    marginTop: 4,
  },
  feeLabel: {
    fontSize: 12,
    color: '#64748B',
  },
  feeValue: {
    fontSize: 12,
    fontWeight: '700',
    color: '#0F766E',
  },
  totalRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: 8,
    paddingTop: 8,
    borderTopWidth: 1,
    borderTopColor: '#E2E8F0',
  },
  totalLabel: {
    fontSize: 14,
    fontWeight: '800',
    color: '#0F172A',
  },
  deltaSubNote: {
    fontSize: 10,
    fontWeight: '700',
    color: '#0D9488',
    marginTop: 1,
  },
  totalValue: {
    fontSize: 16,
    fontWeight: '800',
    color: '#0D9488',
  },
  venmoButton: {
    marginTop: 12,
    backgroundColor: '#008CFF',
    paddingVertical: 11,
    borderRadius: 10,
    alignItems: 'center',
  },
  venmoButtonText: {
    color: '#FFFFFF',
    fontSize: 13,
    fontWeight: '800',
  },
});
