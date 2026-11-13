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
  onAuthorizeDemoHold: (userId: string, amount: number) => void;
  /** Local demo builds only: show simulated card-hold controls. */
  demoPaymentsEnabled?: boolean;
}

export const SplitLedgerView: React.FC<Props> = ({
  pool,
  currentUserId,
  isCurrentUserHost,
  onTogglePaidStatus,
  onAuthorizeDemoHold,
  demoPaymentsEnabled = true,
}) => {
  const breakdowns = getParticipantBreakdowns(pool);
  const venmoHandle = pool.hostVenmoHandle?.trim().replace(/^@/, '') || '';

  const porch = pool.porchCheckIn;

  const handlePayWithVenmo = async (
    userId: string,
    amount: number,
    userName: string
  ) => {
    if (userId !== currentUserId || !venmoHandle) return;
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

    } catch {
      Alert.alert(
        'Venmo Payment Details',
        `Send $${amountStr} to @${venmoHandle} with note "${pool.title}".`
      );
    }
  };

  return (
    <View style={styles.container}>
      {/* Pickup & Live Porch Cooler Drop-Off Banner */}
      <View style={styles.pickupBanner}>
        <View style={styles.pickupTopRow}>
          <Text style={styles.pickupTitle}>📍 Pickup & Porch Cooler Status</Text>
          {porch && (
            <View
              style={[
                styles.porchStatusBadge,
                porch.status === 'ready_on_porch'
                  ? styles.porchReady
                  : porch.status === 'sorting'
                  ? styles.porchSorting
                  : styles.porchWaiting,
              ]}
            >
              <Text style={styles.porchStatusText}>
                {porch.status === 'ready_on_porch'
                  ? '🧊 READY ON PORCH'
                  : porch.status === 'sorting'
                  ? '📦 HOST SORTING'
                  : '🚚 AWAITING DELIVERY'}
              </Text>
            </View>
          )}
        </View>

        <Text style={styles.pickupDetail}>
          Host: {pool.hostName} (@{venmoHandle})
        </Text>
        <Text style={styles.pickupDetail}>Address: {pool.pickupAddress}</Text>
        <Text style={styles.pickupDetail}>Window: {pool.pickupWindow}</Text>

        {porch && (
          <View style={styles.coolerCard}>
            <Text style={styles.coolerPhotoTag}>
              Porch location note • Access:{' '}
              <Text style={{ fontWeight: '800' }}>
                {porch.accessCodeOrPin || 'Open Porch'}
              </Text>
            </Text>
            <Text style={styles.coolerNote}>"{porch.coolerLocationNote}"</Text>
          </View>
        )}

        <Text style={styles.cutoffNote}>
          {pool.status === 'locked'
            ? '🔒 Pool Locked — Ready for Settlement & Pickup'
            : `Order Cutoff: ${pool.cutoffTime}`}
        </Text>
        {pool.trueUp?.reconciledAt && (
          <Text style={styles.trueUpBannerNote}>
            🧾 Receipt True-Up Applied ({pool.trueUp.reconciledAt}): "
            {pool.trueUp.receiptNote}"
          </Text>
        )}
      </View>

      <Text style={styles.sectionHeader}>
        NEIGHBOR COST SPLIT & SETTLEMENT LEDGER
      </Text>

      {breakdowns.map((b) => {
        const isMe = b.userId === currentUserId;
        const canTogglePaid = isCurrentUserHost && pool.status === 'locked' && b.totalDue > 0;
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
                    : b.paidStatus === 'demo_authorized'
                    ? styles.paidChipPurple
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
                      : b.paidStatus === 'demo_authorized'
                      ? styles.paidTextPurple
                      : styles.paidTextAmber,
                  ]}
                >
                  {b.paidStatus === 'paid'
                    ? '✓ Payment confirmed'
                    : b.paidStatus === 'demo_authorized'
                    ? 'Demo hold (no funds)'
                    : b.paidStatus === 'demo_paid' ? 'Demo captured (no funds)'
                    : 'Confirm payment'}
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
                          {li.emoji} {li.itemName} (×{li.committedQuantity} payable, {li.pendingQuantity} pending)
                        </Text>
                        {priceAdjusted && (
                          <Text style={styles.trueUpPriceSub}>
                            🧾 Receipt price: ${li.effectiveUnitPrice.toFixed(2)}
                            /unit (was ${li.quotedUnitPrice.toFixed(2)})
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
                              : `⏳ ${li.caseProgressText}`}
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

                {b.pendingCaseSubtotal > 0 && <Text style={{ color: '#6B21A8', marginTop: 8 }}>Pending shares: ${b.pendingCaseSubtotal.toFixed(2)} — excluded from payment.</Text>}
                {/* Track #3: Dual Settlement Buttons (Stripe Pre-Auth Hold + 1-Tap Venmo) */}
                {isMe && b.paidStatus !== 'paid' && b.paidStatus !== 'demo_paid' && b.totalDue > 0 && (
                  <View style={styles.paymentButtonsWrap}>
                    {!demoPaymentsEnabled ? null : b.paidStatus !== 'demo_authorized' ? (
                      <TouchableOpacity
                        style={styles.stripeHoldButton}
                        onPress={() =>
                          onAuthorizeDemoHold(b.userId, b.totalDue)
                        }
                      >
                        <Text style={styles.stripeHoldButtonText}>
                          Simulate card hold (${b.totalDue.toFixed(2)})
                        </Text>
                        <Text style={styles.stripeHoldSubText}>
                          Demo only • no card is connected and no funds move
                        </Text>
                      </TouchableOpacity>
                    ) : (
                      <View style={styles.stripeAuthorizedBanner}>
                        <Text style={styles.stripeAuthorizedText}>
                          Demo hold (${b.totalDue.toFixed(2)}) • no funds authorized
                        </Text>
                      </View>
                    )}

                    <TouchableOpacity
                      disabled={!venmoHandle || pool.status !== 'locked'}
                      style={styles.venmoButton}
                      onPress={() =>
                        handlePayWithVenmo(b.userId, b.totalDue, b.userName)
                      }
                    >
                      <Text style={styles.venmoButtonText}>
                        {!venmoHandle ? 'Host has not provided a Venmo handle' : pool.status !== 'locked' ? 'Finalize the pool before paying' : `Open Venmo for $${b.totalDue.toFixed(2)} to @${venmoHandle}`}
                      </Text>
                    </TouchableOpacity>
                  </View>
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
  pickupTopRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 6,
  },
  pickupTitle: {
    fontSize: 14,
    fontWeight: '800',
    color: '#0F766E',
  },
  porchStatusBadge: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
  },
  porchReady: {
    backgroundColor: '#DCFCE7',
  },
  porchSorting: {
    backgroundColor: '#FEF3C7',
  },
  porchWaiting: {
    backgroundColor: '#E0F2FE',
  },
  porchStatusText: {
    fontSize: 9,
    fontWeight: '900',
    color: '#0F172A',
  },
  pickupDetail: {
    fontSize: 13,
    color: '#134E4A',
    marginBottom: 2,
    fontWeight: '500',
  },
  coolerCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 10,
    padding: 10,
    marginTop: 8,
    borderWidth: 1,
    borderColor: '#5EEAD4',
  },
  coolerPhotoTag: {
    fontSize: 11,
    fontWeight: '700',
    color: '#0F766E',
  },
  coolerNote: {
    fontSize: 12,
    color: '#1E293B',
    fontStyle: 'italic',
    marginTop: 3,
  },
  cutoffNote: {
    fontSize: 12,
    fontWeight: '700',
    color: '#B45309',
    marginTop: 8,
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
  paidChipPurple: {
    backgroundColor: '#EDE9FE',
  },
  paidChipAmber: {
    backgroundColor: '#FEF3C7',
  },
  paidChipText: {
    fontSize: 11,
    fontWeight: '800',
  },
  paidTextGreen: {
    color: '#15803D',
  },
  paidTextPurple: {
    color: '#6D28D9',
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
  paymentButtonsWrap: {
    marginTop: 12,
    gap: 8,
  },
  stripeHoldButton: {
    backgroundColor: '#4F46E5',
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderRadius: 10,
    alignItems: 'center',
  },
  stripeHoldButtonText: {
    color: '#FFFFFF',
    fontSize: 13,
    fontWeight: '800',
  },
  stripeHoldSubText: {
    color: '#E0E7FF',
    fontSize: 10,
    fontWeight: '600',
    marginTop: 2,
  },
  stripeAuthorizedBanner: {
    backgroundColor: '#EDE9FE',
    borderWidth: 1,
    borderColor: '#C4B5FD',
    paddingVertical: 9,
    paddingHorizontal: 12,
    borderRadius: 10,
    alignItems: 'center',
  },
  stripeAuthorizedText: {
    color: '#5B21B6',
    fontSize: 12,
    fontWeight: '800',
  },
  venmoButton: {
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
