import React from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Share,
} from 'react-native';
import { GroupBuyPool } from '../types/groupBuy';
import {
  buildSupplierOrderExportText,
  getParticipantBreakdowns,
  getPoolProgressSummary,
  getWholesaleOrderManifest,
} from '../utils/calculations';

interface Props {
  pool: GroupBuyPool;
  onToggleLockPool: () => void;
  onRerunWeeklyPool: () => void;
  onHostCoverRemainder: (itemId: string, neededQty: number) => void;
  onTrimPartialCase: (itemId: string) => void;
  onTogglePaidStatus: (userId: string) => void;
  onTogglePickedUp: (userId: string) => void;
}

export const HostOrderSheetView: React.FC<Props> = ({
  pool,
  onToggleLockPool,
  onRerunWeeklyPool,
  onHostCoverRemainder,
  onTrimPartialCase,
  onTogglePaidStatus,
  onTogglePickedUp,
}) => {
  const summary = getPoolProgressSummary(pool);
  const manifest = getWholesaleOrderManifest(pool);
  const breakdowns = getParticipantBreakdowns(pool).filter(
    (b) => b.lineItems.length > 0
  );

  const isLocked = pool.status === 'locked';

  const handleExportManifest = async () => {
    try {
      const text = buildSupplierOrderExportText(pool);
      await Share.share({
        title: `${pool.title} — Wholesale Order Manifest`,
        message: text,
      });
    } catch (err) {
      console.warn('Share error:', err);
    }
  };

  return (
    <View style={styles.container}>
      {/* Host Cutoff & Lock Control Card */}
      <View
        style={[
          styles.controlCard,
          isLocked ? styles.controlCardLocked : styles.controlCardOpen,
        ]}
      >
        <View style={styles.controlHeaderRow}>
          <View style={{ flex: 1, paddingRight: 10 }}>
            <Text style={styles.controlBadge}>
              {isLocked
                ? '🔒 POOL LOCKED FOR WHOLESALE ORDER'
                : '🟢 POOL OPEN FOR NEIGHBOR CLAIMS'}
            </Text>
            <Text style={styles.controlTitle}>
              {isLocked
                ? 'Cutoff Reached — Ready to Order & Distribute'
                : `Order Cutoff: ${pool.cutoffTime}`}
            </Text>
            <Text style={styles.controlSub}>
              {isLocked
                ? 'Claims are frozen so you can place the supplier order and check off neighbor pickups.'
                : summary.isMinimumMet
                ? 'Wholesale minimum is met! Lock the pool when you are ready to finalize the order.'
                : `Pool is $${summary.amountNeededForMinimum.toFixed(2)} away from the $${pool.minimumOrderAmount} supplier minimum.`}
            </Text>
          </View>

          <TouchableOpacity
            style={[
              styles.lockButton,
              isLocked ? styles.unlockButton : styles.lockNowButton,
            ]}
            onPress={onToggleLockPool}
          >
            <Text style={styles.lockButtonText}>
              {isLocked ? '🔓 Reopen Pool' : '🔒 Lock Pool'}
            </Text>
          </TouchableOpacity>
        </View>

        <View style={styles.rerunRow}>
          <Text style={styles.rerunHint}>
            Want to run this exact supplier catalog again next week?
          </Text>
          <TouchableOpacity
            style={styles.rerunBtn}
            onPress={onRerunWeeklyPool}
          >
            <Text style={styles.rerunBtnText}>🔁 Rerun Next Week</Text>
          </TouchableOpacity>
        </View>
      </View>

      {/* Partial Bulk Cases Resolution Alert */}
      {manifest.partialCaseItems.length > 0 && (
        <View style={styles.partialAlertCard}>
          <Text style={styles.partialAlertTitle}>
            ⚠️ Unfilled Bulk Cases Need Resolution ({manifest.partialCaseItems.length})
          </Text>
          <Text style={styles.partialAlertSub}>
            Wholesale suppliers only ship full cases. Before placing the supplier
            order, either claim the remaining units as Host or trim the partial case:
          </Text>

          {manifest.partialCaseItems.map((pItem) => (
            <View key={pItem.itemId} style={styles.partialItemRow}>
              <View style={{ flex: 1, paddingRight: 8 }}>
                <Text style={styles.partialItemName}>
                  {pItem.emoji} {pItem.itemName}
                </Text>
                <Text style={styles.partialItemMeta}>
                  {pItem.unfilledRemainderUnits} unit(s) waiting • Need{' '}
                  <Text style={{ fontWeight: '800' }}>
                    {pItem.neededToFillNextCase} more
                  </Text>{' '}
                  (${(pItem.neededToFillNextCase * pItem.unitPrice).toFixed(2)})
                  to complete case
                </Text>
              </View>

              <View style={styles.partialActionBtns}>
                <TouchableOpacity
                  style={styles.coverBtn}
                  onPress={() =>
                    onHostCoverRemainder(
                      pItem.itemId,
                      pItem.neededToFillNextCase
                    )
                  }
                >
                  <Text style={styles.coverBtnText}>
                    + Cover {pItem.neededToFillNextCase}
                  </Text>
                </TouchableOpacity>

                <TouchableOpacity
                  style={styles.trimBtn}
                  onPress={() => onTrimPartialCase(pItem.itemId)}
                >
                  <Text style={styles.trimBtnText}>Drop Partial</Text>
                </TouchableOpacity>
              </View>
            </View>
          ))}
        </View>
      )}

      {/* Master Wholesale Purchase Order Manifest */}
      <View style={styles.manifestCard}>
        <View style={styles.manifestHeaderRow}>
          <View>
            <Text style={styles.sectionLabel}>SUPPLIER PURCHASE ORDER</Text>
            <Text style={styles.manifestSupplier}>{pool.supplierName}</Text>
          </View>
          <TouchableOpacity
            style={styles.exportButton}
            onPress={handleExportManifest}
          >
            <Text style={styles.exportButtonText}>📤 Share Order Sheet</Text>
          </TouchableOpacity>
        </View>

        {manifest.lines.filter((l) => l.committedUnits > 0).length === 0 ? (
          <Text style={styles.emptyText}>
            No full wholesale items or completed cases yet.
          </Text>
        ) : (
          manifest.lines
            .filter((l) => l.committedUnits > 0)
            .map((line) => (
              <View key={line.itemId} style={styles.manifestLine}>
                <View style={{ flex: 1, paddingRight: 8 }}>
                  <Text style={styles.manifestItemName}>
                    {line.emoji} {line.itemName}
                  </Text>
                  <Text style={styles.manifestQtySub}>
                    Order qty: {line.orderQuantityLabel}
                  </Text>
                </View>
                <Text style={styles.manifestLineTotal}>
                  ${line.lineTotal.toFixed(2)}
                </Text>
              </View>
            ))
        )}

        <View style={styles.invoiceSummary}>
          <View style={styles.invoiceRow}>
            <Text style={styles.invoiceLabel}>Wholesale Merchandise</Text>
            <Text style={styles.invoiceValue}>
              ${manifest.totalSupplierMerchandiseCost.toFixed(2)}
            </Text>
          </View>
          <View style={styles.invoiceRow}>
            <Text style={styles.invoiceLabel}>Supplier Delivery Fee</Text>
            <Text style={styles.invoiceValue}>
              {manifest.supplierDeliveryFee === 0
                ? 'FREE (Waived)'
                : `$${manifest.supplierDeliveryFee.toFixed(2)}`}
            </Text>
          </View>
          <View style={[styles.invoiceRow, styles.invoiceGrandRow]}>
            <Text style={styles.invoiceGrandLabel}>
              Est. Supplier Invoice Total
            </Text>
            <Text style={styles.invoiceGrandValue}>
              ${manifest.grandTotalSupplierInvoice.toFixed(2)}
            </Text>
          </View>
        </View>
      </View>

      {/* Porch Pickup & Distribution Checklist */}
      <View style={styles.manifestCard}>
        <Text style={styles.sectionLabel}>
          PORCH PICKUP & NEIGHBOR DISTRIBUTION CHECKLIST
        </Text>
        <Text style={styles.pickupSub}>
          {pool.pickupAddress} • {pool.pickupWindow}
        </Text>

        {breakdowns.map((b) => (
          <View key={b.userId} style={styles.pickupMemberRow}>
            <View style={{ flex: 1, paddingRight: 8 }}>
              <View style={styles.pickupNameWrap}>
                <View
                  style={[styles.dot, { backgroundColor: b.avatarColor }]}
                />
                <Text style={styles.pickupMemberName}>{b.userName}</Text>
                <Text style={styles.pickupMemberTotal}>
                  • ${b.totalDue.toFixed(2)}
                </Text>
              </View>
              <Text style={styles.pickupItemsSummary}>
                {b.lineItems
                  .map((li) => `${li.emoji} ${li.itemName} ×${li.quantity}`)
                  .join('  |  ')}
              </Text>
            </View>

            <View style={styles.pickupChipsCol}>
              <TouchableOpacity
                style={[
                  styles.smallStatusChip,
                  b.paidStatus === 'paid'
                    ? styles.chipGreen
                    : styles.chipAmber,
                ]}
                onPress={() => onTogglePaidStatus(b.userId)}
              >
                <Text
                  style={[
                    styles.smallChipText,
                    b.paidStatus === 'paid'
                      ? styles.chipTextGreen
                      : styles.chipTextAmber,
                  ]}
                >
                  {b.paidStatus === 'paid' ? '✓ Paid' : 'Unpaid'}
                </Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={[
                  styles.smallStatusChip,
                  b.pickedUp ? styles.chipTeal : styles.chipGray,
                ]}
                onPress={() => onTogglePickedUp(b.userId)}
              >
                <Text
                  style={[
                    styles.smallChipText,
                    b.pickedUp ? styles.chipTextTeal : styles.chipTextGray,
                  ]}
                >
                  {b.pickedUp ? '🛍️ Picked Up' : 'Mark Picked Up'}
                </Text>
              </TouchableOpacity>
            </View>
          </View>
        ))}
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    paddingBottom: 28,
  },
  controlCard: {
    borderRadius: 16,
    padding: 16,
    marginBottom: 14,
    borderWidth: 1,
  },
  controlCardOpen: {
    backgroundColor: '#F0FDFA',
    borderColor: '#99F6E4',
  },
  controlCardLocked: {
    backgroundColor: '#FFFBEB',
    borderColor: '#FDE68A',
  },
  controlHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  controlBadge: {
    fontSize: 10,
    fontWeight: '800',
    letterSpacing: 0.5,
    color: '#0F766E',
    marginBottom: 4,
  },
  controlTitle: {
    fontSize: 15,
    fontWeight: '800',
    color: '#0F172A',
  },
  controlSub: {
    fontSize: 12,
    color: '#475569',
    marginTop: 4,
    lineHeight: 17,
  },
  lockButton: {
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 10,
  },
  lockNowButton: {
    backgroundColor: '#0F172A',
  },
  unlockButton: {
    backgroundColor: '#D97706',
  },
  lockButtonText: {
    color: '#FFFFFF',
    fontWeight: '800',
    fontSize: 12,
  },
  rerunRow: {
    marginTop: 12,
    paddingTop: 10,
    borderTopWidth: 1,
    borderTopColor: 'rgba(15, 118, 110, 0.15)',
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  rerunHint: {
    fontSize: 11,
    fontWeight: '600',
    color: '#334155',
    flex: 1,
    paddingRight: 8,
  },
  rerunBtn: {
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#0D9488',
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 8,
  },
  rerunBtnText: {
    fontSize: 11,
    fontWeight: '800',
    color: '#0F766E',
  },
  partialAlertCard: {
    backgroundColor: '#FAF5FF',
    borderRadius: 16,
    padding: 16,
    marginBottom: 14,
    borderWidth: 1,
    borderColor: '#D8B4FE',
  },
  partialAlertTitle: {
    fontSize: 14,
    fontWeight: '800',
    color: '#6B21A8',
  },
  partialAlertSub: {
    fontSize: 12,
    color: '#581C87',
    marginTop: 4,
    marginBottom: 10,
    lineHeight: 17,
  },
  partialItemRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: '#FFFFFF',
    padding: 10,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#E9D5FF',
    marginTop: 8,
  },
  partialItemName: {
    fontSize: 13,
    fontWeight: '700',
    color: '#0F172A',
  },
  partialItemMeta: {
    fontSize: 11,
    color: '#6B21A8',
    marginTop: 2,
  },
  partialActionBtns: {
    flexDirection: 'row',
    gap: 6,
  },
  coverBtn: {
    backgroundColor: '#7E22CE',
    paddingHorizontal: 10,
    paddingVertical: 7,
    borderRadius: 8,
  },
  coverBtnText: {
    color: '#FFFFFF',
    fontSize: 11,
    fontWeight: '800',
  },
  trimBtn: {
    backgroundColor: '#F3E8FF',
    paddingHorizontal: 10,
    paddingVertical: 7,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#D8B4FE',
  },
  trimBtnText: {
    color: '#6B21A8',
    fontSize: 11,
    fontWeight: '700',
  },
  manifestCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    padding: 16,
    marginBottom: 14,
    borderWidth: 1,
    borderColor: '#E2E8F0',
  },
  manifestHeaderRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
  },
  sectionLabel: {
    fontSize: 11,
    fontWeight: '800',
    color: '#64748B',
    letterSpacing: 0.6,
  },
  manifestSupplier: {
    fontSize: 16,
    fontWeight: '800',
    color: '#0F172A',
    marginTop: 2,
  },
  exportButton: {
    backgroundColor: '#0D9488',
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 10,
  },
  exportButtonText: {
    color: '#FFFFFF',
    fontSize: 12,
    fontWeight: '800',
  },
  emptyText: {
    fontSize: 12,
    color: '#94A3B8',
    fontStyle: 'italic',
  },
  manifestLine: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 9,
    borderBottomWidth: 1,
    borderBottomColor: '#F1F5F9',
  },
  manifestItemName: {
    fontSize: 14,
    fontWeight: '700',
    color: '#0F172A',
  },
  manifestQtySub: {
    fontSize: 12,
    color: '#0D9488',
    fontWeight: '600',
    marginTop: 2,
  },
  manifestLineTotal: {
    fontSize: 14,
    fontWeight: '800',
    color: '#0F172A',
  },
  invoiceSummary: {
    marginTop: 12,
    paddingTop: 10,
    backgroundColor: '#F8FAFC',
    borderRadius: 10,
    padding: 12,
  },
  invoiceRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 6,
  },
  invoiceLabel: {
    fontSize: 12,
    color: '#475569',
    fontWeight: '600',
  },
  invoiceValue: {
    fontSize: 12,
    color: '#0F172A',
    fontWeight: '700',
  },
  invoiceGrandRow: {
    marginTop: 6,
    paddingTop: 8,
    borderTopWidth: 1,
    borderTopColor: '#E2E8F0',
    marginBottom: 0,
  },
  invoiceGrandLabel: {
    fontSize: 14,
    fontWeight: '800',
    color: '#0F172A',
  },
  invoiceGrandValue: {
    fontSize: 16,
    fontWeight: '900',
    color: '#0D9488',
  },
  pickupSub: {
    fontSize: 12,
    color: '#475569',
    marginTop: 2,
    marginBottom: 10,
    fontWeight: '500',
  },
  pickupMemberRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 10,
    borderTopWidth: 1,
    borderTopColor: '#F1F5F9',
  },
  pickupNameWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  dot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  pickupMemberName: {
    fontSize: 14,
    fontWeight: '700',
    color: '#0F172A',
  },
  pickupMemberTotal: {
    fontSize: 13,
    fontWeight: '800',
    color: '#0D9488',
  },
  pickupItemsSummary: {
    fontSize: 12,
    color: '#64748B',
    marginTop: 4,
  },
  pickupChipsCol: {
    alignItems: 'flex-end',
    gap: 6,
  },
  smallStatusChip: {
    paddingHorizontal: 9,
    paddingVertical: 4,
    borderRadius: 999,
  },
  chipGreen: {
    backgroundColor: '#DCFCE7',
  },
  chipAmber: {
    backgroundColor: '#FEF3C7',
  },
  chipTeal: {
    backgroundColor: '#CCFBF1',
  },
  chipGray: {
    backgroundColor: '#F1F5F9',
  },
  smallChipText: {
    fontSize: 11,
    fontWeight: '700',
  },
  chipTextGreen: {
    color: '#15803D',
  },
  chipTextAmber: {
    color: '#B45309',
  },
  chipTextTeal: {
    color: '#0F766E',
  },
  chipTextGray: {
    color: '#475569',
  },
});
