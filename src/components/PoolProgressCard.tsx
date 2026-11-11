import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { GroupBuyPool } from '../types/groupBuy';
import { getPoolProgressSummary } from '../utils/calculations';

interface Props {
  pool: GroupBuyPool;
}

export const PoolProgressCard: React.FC<Props> = ({ pool }) => {
  const summary = getPoolProgressSummary(pool);
  const minPercent = Math.round(summary.minimumProgressRatio * 100);
  const freeDelivPercent = Math.round(summary.freeDeliveryProgressRatio * 100);

  return (
    <View style={styles.card}>
      <View style={styles.topRow}>
        <View>
          <Text style={styles.label}>POOL WHOLESALE TOTAL</Text>
          <View style={styles.amountRow}>
            <Text style={styles.currentAmount}>${summary.combinedPoolTotal.toFixed(2)}</Text>
            <Text style={styles.targetAmount}> / ${pool.minimumOrderAmount} min</Text>
          </View>
        </View>
        <View
          style={[
            styles.statusBadge,
            summary.isMinimumMet ? styles.statusSuccess : styles.statusPending,
          ]}
        >
          <Text
            style={[
              styles.statusText,
              summary.isMinimumMet ? styles.statusTextSuccess : styles.statusTextPending,
            ]}
          >
            {summary.isMinimumMet
              ? '✓ Minimum Met!'
              : `$${summary.amountNeededForMinimum.toFixed(2)} to unlock`}
          </Text>
        </View>
      </View>

      {/* Wholesale Minimum Progress Bar */}
      <View style={styles.progressTrack}>
        <View
          style={[
            styles.progressFill,
            { width: `${minPercent}%` },
            summary.isMinimumMet ? styles.fillGreen : styles.fillTeal,
          ]}
        />
      </View>

      {/* Free Delivery Tier Progress */}
      <View style={styles.tierRow}>
        <Text style={styles.tierLabel}>
          {summary.isFreeDeliveryUnlocked
            ? `🎉 Free wholesale delivery unlocked! ($${pool.freeDeliveryThreshold}+ reached)`
            : `🚚 Add $${summary.amountNeededForFreeDelivery.toFixed(2)} more to waive the $${pool.deliveryFee} delivery fee (${freeDelivPercent}%)`}
        </Text>
      </View>

      {/* Quick Stats */}
      <View style={styles.statsFooter}>
        <View style={styles.statBox}>
          <Text style={styles.statValue}>{summary.activeBuyerCount} Neighbors</Text>
          <Text style={styles.statSub}>Pooling orders</Text>
        </View>
        <View style={styles.divider} />
        <View style={styles.statBox}>
          <Text style={styles.statValue}>
            {summary.isFreeDeliveryUnlocked
              ? '$0.00'
              : `$${summary.currentDeliveryFeePerPerson.toFixed(2)}/person`}
          </Text>
          <Text style={styles.statSub}>Est. delivery split</Text>
        </View>
        <View style={styles.divider} />
        <View style={styles.statBox}>
          <Text style={[styles.statValue, { color: '#059669' }]}>
            ${summary.totalPoolSavings.toFixed(2)}
          </Text>
          <Text style={styles.statSub}>Group savings</Text>
        </View>
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  card: {
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    padding: 16,
    marginBottom: 14,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    shadowColor: '#0F172A',
    shadowOpacity: 0.04,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 2 },
    elevation: 2,
  },
  topRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: 10,
  },
  label: {
    fontSize: 11,
    fontWeight: '700',
    color: '#64748B',
    letterSpacing: 0.6,
    marginBottom: 2,
  },
  amountRow: {
    flexDirection: 'row',
    alignItems: 'baseline',
  },
  currentAmount: {
    fontSize: 26,
    fontWeight: '800',
    color: '#0F172A',
  },
  targetAmount: {
    fontSize: 14,
    fontWeight: '600',
    color: '#64748B',
  },
  statusBadge: {
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 20,
  },
  statusSuccess: {
    backgroundColor: '#DCFCE7',
  },
  statusPending: {
    backgroundColor: '#FEF3C7',
  },
  statusText: {
    fontSize: 12,
    fontWeight: '700',
  },
  statusTextSuccess: {
    color: '#15803D',
  },
  statusTextPending: {
    color: '#B45309',
  },
  progressTrack: {
    height: 10,
    backgroundColor: '#F1F5F9',
    borderRadius: 999,
    overflow: 'hidden',
    marginBottom: 10,
  },
  progressFill: {
    height: '100%',
    borderRadius: 999,
  },
  fillTeal: {
    backgroundColor: '#0D9488',
  },
  fillGreen: {
    backgroundColor: '#10B981',
  },
  tierRow: {
    backgroundColor: '#F8FAFC',
    borderRadius: 10,
    paddingVertical: 8,
    paddingHorizontal: 10,
    marginBottom: 12,
  },
  tierLabel: {
    fontSize: 12,
    color: '#334155',
    fontWeight: '600',
  },
  statsFooter: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    borderTopWidth: 1,
    borderTopColor: '#F1F5F9',
    paddingTop: 12,
  },
  statBox: {
    flex: 1,
    alignItems: 'center',
  },
  statValue: {
    fontSize: 14,
    fontWeight: '700',
    color: '#0F172A',
  },
  statSub: {
    fontSize: 11,
    color: '#64748B',
    marginTop: 2,
  },
  divider: {
    width: 1,
    height: 26,
    backgroundColor: '#E2E8F0',
  },
});
