import React, { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Share,
  TextInput,
} from 'react-native';
import {
  GroupBuyPool,
  Participant,
  PorchDropCheckIn,
  ReceiptTrueUp,
} from '../types/groupBuy';
import {
  buildSupplierOrderExportText,
  getEffectiveUnitPrice,
  getParticipantBreakdowns,
  getPoolProgressSummary,
  getWholesaleOrderManifest,
} from '../utils/calculations';

interface Props {
  pool: GroupBuyPool;
  activeUser: Participant;
  isCurrentUserHost: boolean;
  onSwitchToHostProfile: () => void;
  onToggleLockPool: () => void;
  onRerunWeeklyPool: () => void;
  onHostCoverRemainder: (itemId: string, neededQty: number) => void;
  onTrimPartialCase: (itemId: string) => void;
  onUpdateItemActualPrice: (itemId: string, actualPrice: number | undefined) => void;
  onUpdateReceiptTrueUp: (trueUp: ReceiptTrueUp) => void;
  onOpenBulkImportModal: (mode: 'catalog_import' | 'receipt_ocr') => void;
  onCaptureAllDemoHolds: () => void;
  onUpdatePorchCheckIn: (checkIn: PorchDropCheckIn) => void;
  onTogglePaidStatus: (userId: string) => void;
  onTogglePickedUp: (userId: string) => void;
}

export const HostOrderSheetView: React.FC<Props> = ({
  pool,
  activeUser,
  isCurrentUserHost,
  onSwitchToHostProfile,
  onToggleLockPool,
  onRerunWeeklyPool,
  onHostCoverRemainder,
  onTrimPartialCase,
  onUpdateItemActualPrice,
  onUpdateReceiptTrueUp,
  onOpenBulkImportModal,
  onCaptureAllDemoHolds,
  onUpdatePorchCheckIn,
  onTogglePaidStatus,
  onTogglePickedUp,
}) => {
  const [taxFeeInput, setTaxFeeInput] = useState(
    pool.trueUp?.taxOrBagFee !== undefined ? String(pool.trueUp.taxOrBagFee) : '0'
  );
  const [deliveryOverrideInput, setDeliveryOverrideInput] = useState(
    pool.trueUp?.actualDeliveryFee !== undefined
      ? String(pool.trueUp.actualDeliveryFee)
      : ''
  );
  const [receiptNoteInput, setReceiptNoteInput] = useState(
    pool.trueUp?.receiptNote || ''
  );

  const [coolerNoteInput, setCoolerNoteInput] = useState(
    pool.porchCheckIn?.coolerLocationNote || ''
  );
  const [accessPinInput, setAccessPinInput] = useState(
    pool.porchCheckIn?.accessCodeOrPin || ''
  );
  const [porchStatus, setPorchStatus] = useState<PorchDropCheckIn['status']>(
    pool.porchCheckIn?.status || 'waiting_delivery'
  );

  const summary = getPoolProgressSummary(pool);
  const manifest = getWholesaleOrderManifest(pool);
  const breakdowns = getParticipantBreakdowns(pool).filter(
    (b) => b.lineItems.length > 0
  );

  const stripeAuthorizedMembers = breakdowns.filter(
    (b) => b.paidStatus === 'demo_authorized'
  );
  const totalAuthorizedHoldAmount = stripeAuthorizedMembers.reduce(
    (sum, b) => sum + b.totalDue,
    0
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

  const handleApplyTrueUp = () => {
    const parsedTax = taxFeeInput.trim() ? Number(taxFeeInput) : 0;
    const parsedDeliv =
      deliveryOverrideInput.trim() !== ''
        ? Number(deliveryOverrideInput)
        : undefined;

    onUpdateReceiptTrueUp({
      taxOrBagFee: parsedTax,
      actualDeliveryFee:
        parsedDeliv,
      receiptNote:
        receiptNoteInput.trim() ||
        'Reconciled against final wholesale register receipt',
      reconciledAt: new Date().toLocaleTimeString([], {
        hour: '2-digit',
        minute: '2-digit',
      }),
    });
  };

  const handleSavePorchCheckIn = (nextStatus: PorchDropCheckIn['status']) => {
    setPorchStatus(nextStatus);
    onUpdatePorchCheckIn({
      status: nextStatus,
      coolerLocationNote: coolerNoteInput.trim(),
      accessCodeOrPin: accessPinInput.trim(),
      photoLabel:
        nextStatus === 'ready_on_porch'
          ? 'Porch location note (no photo)'
          : 'Porch location note (no photo)',
      updatedAt: new Date().toLocaleTimeString([], {
        hour: '2-digit',
        minute: '2-digit',
      }),
    });
  };

  const handleApplyQuickDiscount = (
    itemId: string,
    quotedPrice: number,
    delta: number
  ) => {
    const next = Math.max(0.5, Number((quotedPrice + delta).toFixed(2)));
    onUpdateItemActualPrice(itemId, next);
  };

  return (
    <View style={styles.container}>
      {/* Feature #4: Role Permission Guard Banner */}
      {!isCurrentUserHost && (
        <View style={styles.roleGuardBanner}>
          <View style={{ flex: 1, paddingRight: 10 }}>
            <Text style={styles.roleGuardTitle}>
              🔒 Neighbor view — local demo permissions
            </Text>
            <Text style={styles.roleGuardSub}>
              You are viewing as{' '}
              <Text style={{ fontWeight: '800' }}>{activeUser.name}</Text>. Only
              the selected demo Pool Host (
              <Text style={{ fontWeight: '800' }}>{pool.hostName}</Text>) can
              lock the pool, reconcile receipts, or capture payment holds.
            </Text>
          </View>
          <TouchableOpacity
            style={styles.switchHostBtn}
            onPress={onSwitchToHostProfile}
          >
            <Text style={styles.switchHostBtnText}>
              Switch demo profile: {pool.hostName.split(' ')[0]}
            </Text>
          </TouchableOpacity>
        </View>
      )}

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
              !isCurrentUserHost && styles.disabledBtn,
            ]}
            onPress={onToggleLockPool}
            disabled={!isCurrentUserHost}
          >
            <Text style={styles.lockButtonText}>
              {isLocked ? '🔓 Reopen Pool' : '🔒 Lock Pool'}
            </Text>
          </TouchableOpacity>
        </View>

        <View style={styles.rerunRow}>
          <TouchableOpacity
            style={[
              styles.importShortcutBtn,
              !isCurrentUserHost && styles.disabledBtn,
            ]}
            onPress={() => onOpenBulkImportModal('catalog_import')}
            disabled={!isCurrentUserHost || isLocked}
          >
            <Text style={styles.importShortcutText}>
              📋 Bulk Paste Supplier List
            </Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[styles.rerunBtn, !isCurrentUserHost && styles.disabledBtn]}
            onPress={onRerunWeeklyPool}
            disabled={!isCurrentUserHost}
          >
            <Text style={styles.rerunBtnText}>🔁 Rerun Next Week</Text>
          </TouchableOpacity>
        </View>
      </View>

      {/* Track #3: Stripe Pre-Authorization Hold Batch Capture Card */}
      <View style={styles.stripeCaptureCard}>
        <View style={styles.controlHeaderRow}>
          <View style={{ flex: 1, paddingRight: 10 }}>
            <Text style={styles.stripeBadge}>
              DEMO CARD HOLDS — NO FUNDS MOVE
            </Text>
            <Text style={styles.stripeTitle}>
              {stripeAuthorizedMembers.length > 0
                ? `${stripeAuthorizedMembers.length} Demo hold(s) ($${totalAuthorizedHoldAmount.toFixed(2)})`
                : 'No simulated holds'}
            </Text>
            <Text style={styles.stripeSub}>
              {summary.isMinimumMet
                ? 'Simulate capture after the finalized pool is locked. This does not record a real payment.'
                : `Demo holds require a locked pool meeting the $${pool.minimumOrderAmount} wholesale minimum.`}
            </Text>
          </View>

          <TouchableOpacity
            style={[
              styles.captureAllBtn,
              (!isCurrentUserHost ||
                stripeAuthorizedMembers.length === 0 ||
                !summary.isMinimumMet || !isLocked) &&
                styles.disabledBtn,
            ]}
            onPress={onCaptureAllDemoHolds}
            disabled={
              !isCurrentUserHost ||
              stripeAuthorizedMembers.length === 0 ||
              !summary.isMinimumMet || !isLocked
            }
          >
            <Text style={styles.captureAllBtnText}>Simulate capture</Text>
          </TouchableOpacity>
        </View>
      </View>

      {/* Partial Bulk Cases Resolution Alert */}
      {manifest.partialCaseItems.length > 0 && (
        <View style={styles.partialAlertCard}>
          <Text style={styles.partialAlertTitle}>
            ⚠️ Unfilled Bulk Cases Need Resolution (
            {manifest.partialCaseItems.length})
          </Text>
          <Text style={styles.partialAlertSub}>
            Wholesale suppliers only ship full cases. Before placing the supplier
            order, either claim the remaining units as Host or trim the partial
            case:
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
                  ($
                  {(
                    pItem.neededToFillNextCase * pItem.effectiveUnitPrice
                  ).toFixed(2)}
                  ) to complete case
                </Text>
              </View>

              <View style={styles.partialActionBtns}>
                <TouchableOpacity
                  style={[
                    styles.coverBtn,
                    !isCurrentUserHost && styles.disabledBtn,
                  ]}
                  onPress={() =>
                    onHostCoverRemainder(
                      pItem.itemId,
                      pItem.neededToFillNextCase
                    )
                  }
                  disabled={!isCurrentUserHost || isLocked}
                >
                  <Text style={styles.coverBtnText}>
                    + Cover {pItem.neededToFillNextCase}
                  </Text>
                </TouchableOpacity>

                <TouchableOpacity
                  style={[
                    styles.trimBtn,
                    !isCurrentUserHost && styles.disabledBtn,
                  ]}
                  onPress={() => onTrimPartialCase(pItem.itemId)}
                  disabled={!isCurrentUserHost || isLocked}
                >
                  <Text style={styles.trimBtnText}>Drop Partial</Text>
                </TouchableOpacity>
              </View>
            </View>
          ))}
        </View>
      )}

      {/* Feature #2 + Track #2: Wholesale Receipt True-Up + Smart Receipt OCR Scanner */}
      <View style={styles.manifestCard}>
        <View style={styles.manifestHeaderRow}>
          <View style={{ flex: 1, paddingRight: 8 }}>
            <Text style={styles.sectionLabel}>
              🧾 WHOLESALE RECEIPT TRUE-UP
            </Text>
            <Text style={styles.trueUpSub}>
              Adjust unit prices or paste explicit per-unit receipt text so
              every neighbor’s split updates pro-rata automatically.
            </Text>
          </View>

          <TouchableOpacity
            style={[
              styles.ocrScanButton,
              !isCurrentUserHost && styles.disabledBtn,
            ]}
            onPress={() => onOpenBulkImportModal('receipt_ocr')}
            disabled={!isCurrentUserHost}
          >
            <Text style={styles.ocrScanButtonText}>Paste receipt text</Text>
          </TouchableOpacity>
        </View>

        {pool.items.map((item) => {
          const eff = getEffectiveUnitPrice(item);
          const isAdjusted = eff !== item.unitPrice;
          return (
            <View key={item.id} style={styles.trueUpItemRow}>
              <View style={{ flex: 1, paddingRight: 8 }}>
                <Text style={styles.trueUpItemName}>
                  {item.emoji} {item.name}
                </Text>
                <Text style={styles.trueUpItemSub}>
                  Quoted: ${item.unitPrice.toFixed(2)} •{' '}
                  <Text
                    style={{
                      fontWeight: '800',
                      color: isAdjusted ? '#0D9488' : '#334155',
                    }}
                  >
                    Receipt: ${eff.toFixed(2)}
                  </Text>
                </Text>
              </View>

              <View style={styles.trueUpBtnsRow}>
                <TouchableOpacity
                  style={[
                    styles.adjChip,
                    !isCurrentUserHost && styles.disabledBtn,
                  ]}
                  onPress={() => handleApplyQuickDiscount(item.id, eff, -0.5)}
                  disabled={!isCurrentUserHost}
                >
                  <Text style={styles.adjChipText}>-$0.50</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[
                    styles.adjChip,
                    !isCurrentUserHost && styles.disabledBtn,
                  ]}
                  onPress={() => handleApplyQuickDiscount(item.id, eff, 0.5)}
                  disabled={!isCurrentUserHost}
                >
                  <Text style={styles.adjChipText}>+$0.50</Text>
                </TouchableOpacity>
                {isAdjusted && (
                  <TouchableOpacity
                    style={styles.resetChip}
                    onPress={() => onUpdateItemActualPrice(item.id, undefined)}
                    disabled={!isCurrentUserHost}
                  >
                    <Text style={styles.resetChipText}>Reset</Text>
                  </TouchableOpacity>
                )}
              </View>
            </View>
          );
        })}

        <View style={styles.trueUpInputsRow}>
          <View style={{ flex: 1, marginRight: 8 }}>
            <Text style={styles.inputLbl}>Extra Tax / Ice / CRV ($)</Text>
            <TextInput
              style={styles.input}
              keyboardType="decimal-pad"
              editable={isCurrentUserHost}
              value={taxFeeInput}
              onChangeText={setTaxFeeInput}
            />
          </View>
          <View style={{ flex: 1, marginRight: 8 }}>
            <Text style={styles.inputLbl}>Actual Delivery Fee ($)</Text>
            <TextInput
              style={styles.input}
              keyboardType="decimal-pad"
              placeholder={String(summary.effectiveDeliveryFee)}
              editable={isCurrentUserHost}
              value={deliveryOverrideInput}
              onChangeText={setDeliveryOverrideInput}
            />
          </View>
          <TouchableOpacity
            style={[
              styles.applyTrueUpBtn,
              !isCurrentUserHost && styles.disabledBtn,
            ]}
            onPress={handleApplyTrueUp}
            disabled={!isCurrentUserHost}
          >
            <Text style={styles.applyTrueUpBtnText}>Apply True-Up</Text>
          </TouchableOpacity>
        </View>

        <TextInput
          style={[styles.input, { marginTop: 8 }]}
          placeholder="Receipt note (e.g. 'Avocados were $1 off per bag at dock')"
          editable={isCurrentUserHost}
          value={receiptNoteInput}
          onChangeText={setReceiptNoteInput}
        />

        {pool.trueUp?.reconciledAt && (
          <Text style={styles.reconciledBadge}>
            ✓ Receipt reconciled at {pool.trueUp.reconciledAt}: "
            {pool.trueUp.receiptNote}"
          </Text>
        )}
      </View>

      {/* Track #4: Porch Cooler Drop-Off Check-In & Gate PIN */}
      <View style={styles.manifestCard}>
        <Text style={styles.sectionLabel}>
          🧊 PORCH COOLER DROP-OFF CHECK-IN & ACCESS PIN
        </Text>
        <Text style={styles.trueUpSub}>
          Let neighbors know where the insulated coolers are placed and record locally
          when shares are sorted and ready for pickup:
        </Text>

        <View style={styles.porchStatusRow}>
          {(
            [
              { key: 'waiting_delivery', label: '🚚 Awaiting Truck' },
              { key: 'sorting', label: '📦 Sorting Shares' },
              { key: 'ready_on_porch', label: '🧊 Ready on Porch!' },
            ] as const
          ).map((st) => (
            <TouchableOpacity
              key={st.key}
              style={[
                styles.porchStatusBtn,
                porchStatus === st.key && styles.porchStatusBtnActive,
                !isCurrentUserHost && styles.disabledBtn,
              ]}
              onPress={() => handleSavePorchCheckIn(st.key)}
              disabled={!isCurrentUserHost}
            >
              <Text
                style={[
                  styles.porchStatusBtnText,
                  porchStatus === st.key && styles.porchStatusBtnTextActive,
                ]}
              >
                {st.label}
              </Text>
            </TouchableOpacity>
          ))}
        </View>

        <View style={styles.trueUpInputsRow}>
          <View style={{ flex: 2, marginRight: 8 }}>
            <Text style={styles.inputLbl}>Cooler / Drop Location Note</Text>
            <TextInput
              style={styles.input}
              editable={isCurrentUserHost}
              value={coolerNoteInput}
              onChangeText={setCoolerNoteInput}
            />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={styles.inputLbl}>Gate / Access PIN</Text>
            <TextInput
              style={styles.input}
              editable={isCurrentUserHost}
              value={accessPinInput}
              onChangeText={setAccessPinInput}
            />
          </View>
        </View>
      </View>

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
                    Order qty: {line.orderQuantityLabel} @ $
                    {line.effectiveUnitPrice.toFixed(2)}
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
          {manifest.extraTaxOrBagFee !== 0 && (
            <View style={styles.invoiceRow}>
              <Text style={styles.invoiceLabel}>
                Receipt Tax / CRV / Weight Adj.
              </Text>
              <Text style={styles.invoiceValue}>
                ${manifest.extraTaxOrBagFee.toFixed(2)}
              </Text>
            </View>
          )}
          <View style={[styles.invoiceRow, styles.invoiceGrandRow]}>
            <Text style={styles.invoiceGrandLabel}>
              Final Supplier Invoice Total
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
                  .map((li) => `${li.emoji} ${li.itemName} ×${li.committedQuantity} (${li.pendingQuantity} pending)`)
                  .join('  |  ')}
              </Text>
            </View>

            <View style={styles.pickupChipsCol}>
              <TouchableOpacity
                style={[
                  styles.smallStatusChip,
                  b.paidStatus === 'paid'
                    ? styles.chipGreen
                    : b.paidStatus === 'demo_authorized'
                    ? styles.chipPurple
                    : styles.chipAmber,
                ]}
                onPress={() => onTogglePaidStatus(b.userId)}
                disabled={!isCurrentUserHost || !isLocked}
              >
                <Text
                  style={[
                    styles.smallChipText,
                    b.paidStatus === 'paid'
                      ? styles.chipTextGreen
                      : b.paidStatus === 'demo_authorized'
                      ? styles.chipTextPurple
                      : styles.chipTextAmber,
                  ]}
                >
                  {b.paidStatus === 'paid'
                    ? '✓ Manually confirmed'
                    : b.paidStatus === 'demo_authorized'
                    ? 'Demo hold'
                    : b.paidStatus === 'demo_paid' ? 'Demo captured'
                    : 'Unpaid'}
                </Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={[
                  styles.smallStatusChip,
                  b.pickedUp ? styles.chipTeal : styles.chipGray,
                ]}
                onPress={() => onTogglePickedUp(b.userId)}
                disabled={!isCurrentUserHost || !isLocked}
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
  roleGuardBanner: {
    backgroundColor: '#FEF2F2',
    borderColor: '#FCA5A5',
    borderWidth: 1,
    borderRadius: 14,
    padding: 12,
    marginBottom: 14,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  roleGuardTitle: {
    fontSize: 12,
    fontWeight: '800',
    color: '#991B1B',
  },
  roleGuardSub: {
    fontSize: 11,
    color: '#7F1D1D',
    marginTop: 2,
    lineHeight: 15,
  },
  switchHostBtn: {
    backgroundColor: '#991B1B',
    paddingHorizontal: 10,
    paddingVertical: 8,
    borderRadius: 9,
  },
  switchHostBtnText: {
    color: '#FFFFFF',
    fontSize: 11,
    fontWeight: '800',
  },
  disabledBtn: {
    opacity: 0.45,
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
    gap: 8,
  },
  importShortcutBtn: {
    backgroundColor: '#0F172A',
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 8,
  },
  importShortcutText: {
    fontSize: 11,
    fontWeight: '800',
    color: '#5EEAD4',
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
  stripeCaptureCard: {
    backgroundColor: '#EEF2FF',
    borderRadius: 16,
    padding: 16,
    marginBottom: 14,
    borderWidth: 1,
    borderColor: '#C7D2FE',
  },
  stripeBadge: {
    fontSize: 10,
    fontWeight: '800',
    color: '#4338CA',
    letterSpacing: 0.5,
    marginBottom: 3,
  },
  stripeTitle: {
    fontSize: 15,
    fontWeight: '800',
    color: '#1E1B4B',
  },
  stripeSub: {
    fontSize: 11,
    color: '#3730A3',
    marginTop: 3,
    lineHeight: 16,
  },
  captureAllBtn: {
    backgroundColor: '#4F46E5',
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 10,
  },
  captureAllBtnText: {
    color: '#FFFFFF',
    fontSize: 12,
    fontWeight: '800',
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
    marginBottom: 10,
  },
  sectionLabel: {
    fontSize: 11,
    fontWeight: '800',
    color: '#64748B',
    letterSpacing: 0.6,
  },
  trueUpSub: {
    fontSize: 11,
    color: '#64748B',
    marginTop: 3,
    lineHeight: 16,
  },
  ocrScanButton: {
    backgroundColor: '#F3E8FF',
    borderWidth: 1,
    borderColor: '#D8B4FE',
    paddingHorizontal: 10,
    paddingVertical: 7,
    borderRadius: 9,
  },
  ocrScanButtonText: {
    color: '#6B21A8',
    fontSize: 11,
    fontWeight: '800',
  },
  trueUpItemRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: '#F1F5F9',
  },
  trueUpItemName: {
    fontSize: 13,
    fontWeight: '700',
    color: '#0F172A',
  },
  trueUpItemSub: {
    fontSize: 11,
    color: '#64748B',
    marginTop: 1,
  },
  trueUpBtnsRow: {
    flexDirection: 'row',
    gap: 5,
  },
  adjChip: {
    backgroundColor: '#F1F5F9',
    borderWidth: 1,
    borderColor: '#CBD5E1',
    paddingHorizontal: 8,
    paddingVertical: 5,
    borderRadius: 7,
  },
  adjChipText: {
    fontSize: 11,
    fontWeight: '700',
    color: '#0F172A',
  },
  resetChip: {
    backgroundColor: '#FEE2E2',
    paddingHorizontal: 8,
    paddingVertical: 5,
    borderRadius: 7,
  },
  resetChipText: {
    fontSize: 10,
    fontWeight: '700',
    color: '#991B1B',
  },
  trueUpInputsRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    marginTop: 10,
  },
  inputLbl: {
    fontSize: 10,
    fontWeight: '700',
    color: '#475569',
    marginBottom: 4,
  },
  input: {
    backgroundColor: '#F8FAFC',
    borderWidth: 1,
    borderColor: '#CBD5E1',
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 8,
    fontSize: 12,
    color: '#0F172A',
  },
  applyTrueUpBtn: {
    backgroundColor: '#0D9488',
    paddingHorizontal: 12,
    paddingVertical: 9,
    borderRadius: 8,
  },
  applyTrueUpBtnText: {
    color: '#FFFFFF',
    fontSize: 11,
    fontWeight: '800',
  },
  reconciledBadge: {
    marginTop: 8,
    fontSize: 11,
    fontWeight: '700',
    color: '#0F766E',
  },
  porchStatusRow: {
    flexDirection: 'row',
    gap: 6,
    marginTop: 10,
  },
  porchStatusBtn: {
    flex: 1,
    backgroundColor: '#F1F5F9',
    paddingVertical: 8,
    borderRadius: 8,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#CBD5E1',
  },
  porchStatusBtnActive: {
    backgroundColor: '#0D9488',
    borderColor: '#0D9488',
  },
  porchStatusBtnText: {
    fontSize: 10,
    fontWeight: '800',
    color: '#475569',
  },
  porchStatusBtnTextActive: {
    color: '#FFFFFF',
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
  chipPurple: {
    backgroundColor: '#EDE9FE',
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
  chipTextPurple: {
    color: '#6D28D9',
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
