import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { CatalogItem } from '../types/groupBuy';
import { getCaseSplitStatus } from '../utils/calculations';

interface Props {
  item: CatalogItem;
  currentUserId: string;
  isPoolLocked?: boolean;
  onUpdateQuantity: (itemId: string, delta: number) => void;
}

export const CatalogItemCard: React.FC<Props> = ({
  item,
  currentUserId,
  isPoolLocked = false,
  onUpdateQuantity,
}) => {
  const userClaim = item.claims.find((c) => c.userId === currentUserId);
  const myQty = userClaim ? userClaim.quantity : 0;
  const caseStatus = getCaseSplitStatus(item);
  const savingsPct = Math.round(
    ((item.retailPrice - item.unitPrice) / item.retailPrice) * 100
  );

  // Build slot indicators for case_split mode
  const renderCaseSlots = () => {
    if (item.mode !== 'case_split' || !item.caseSize) return null;

    // Show current active case slots (or completed case if exact multiple)
    const slotsInCurrentView =
      caseStatus.remainderUnits === 0 && caseStatus.totalClaimedUnits > 0
        ? item.caseSize
        : caseStatus.remainderUnits;

    const slots = Array.from({ length: item.caseSize }, (_, idx) => {
      const filled = idx < slotsInCurrentView;
      return (
        <View
          key={idx}
          style={[
            styles.caseSlot,
            filled ? styles.caseSlotFilled : styles.caseSlotEmpty,
          ]}
        />
      );
    });

    return (
      <View style={styles.caseSplitContainer}>
        <View style={styles.caseHeaderRow}>
          <Text style={styles.caseTitle}>
            📦 Bulk Case Split ({item.caseSize} units/case)
          </Text>
          <Text
            style={[
              styles.caseStatusBadge,
              caseStatus.neededForNextCase === 0 && caseStatus.totalClaimedUnits > 0
                ? styles.caseMatchedText
                : styles.casePendingText,
            ]}
          >
            {caseStatus.totalClaimedUnits === 0
              ? `0/${item.caseSize} claimed`
              : caseStatus.neededForNextCase === 0
              ? `✓ ${caseStatus.fullCasesCount} full case(s) locked!`
              : `${caseStatus.neededForNextCase} more needed to fill case`}
          </Text>
        </View>
        <View style={styles.slotsRow}>{slots}</View>
      </View>
    );
  };

  return (
    <View style={styles.card}>
      <View style={styles.mainRow}>
        <View style={styles.emojiContainer}>
          <Text style={styles.emoji}>{item.emoji}</Text>
        </View>

        <View style={styles.infoCol}>
          <View style={styles.tagRow}>
            <View
              style={[
                styles.modeBadge,
                item.mode === 'case_split' ? styles.badgeCase : styles.badgeIndiv,
              ]}
            >
              <Text
                style={[
                  styles.modeBadgeText,
                  item.mode === 'case_split'
                    ? styles.badgeCaseText
                    : styles.badgeIndivText,
                ]}
              >
                {item.mode === 'case_split' ? 'SPLIT CASE' : 'DIRECT WHOLESALE'}
              </Text>
            </View>
            {savingsPct > 0 && (
              <View style={styles.saveBadge}>
                <Text style={styles.saveBadgeText}>Save {savingsPct}%</Text>
              </View>
            )}
          </View>

          <Text style={styles.itemName}>{item.name}</Text>
          <Text style={styles.unitLabel}>{item.unitLabel}</Text>

          <View style={styles.priceRow}>
            <Text style={styles.unitPrice}>${item.unitPrice.toFixed(2)}</Text>
            <Text style={styles.retailPrice}>${item.retailPrice.toFixed(2)} retail</Text>
          </View>
        </View>

        {/* Stepper Control */}
        <View style={styles.stepperCol}>
          {isPoolLocked ? (
            <View style={styles.lockedBadge}>
              <Text style={styles.lockedBadgeText}>
                🔒 {myQty > 0 ? `Locked (${myQty})` : 'Pool Locked'}
              </Text>
            </View>
          ) : myQty === 0 ? (
            <TouchableOpacity
              style={styles.joinButton}
              onPress={() => onUpdateQuantity(item.id, 1)}
              activeOpacity={0.8}
            >
              <Text style={styles.joinButtonText}>
                {item.mode === 'case_split' ? '+ Claim Share' : '+ Add'}
              </Text>
            </TouchableOpacity>
          ) : (
            <View style={styles.stepperBox}>
              <TouchableOpacity
                style={styles.stepBtn}
                onPress={() => onUpdateQuantity(item.id, -1)}
              >
                <Text style={styles.stepBtnText}>−</Text>
              </TouchableOpacity>
              <Text style={styles.qtyText}>{myQty}</Text>
              <TouchableOpacity
                style={styles.stepBtn}
                onPress={() => onUpdateQuantity(item.id, 1)}
              >
                <Text style={styles.stepBtnText}>+</Text>
              </TouchableOpacity>
            </View>
          )}
          {myQty > 0 && (
            <Text style={styles.mySubtotalText}>
              You: ${(myQty * item.unitPrice).toFixed(2)}
            </Text>
          )}
        </View>
      </View>

      {/* Case Split Bar if applicable */}
      {renderCaseSlots()}

      {/* Neighbors claiming this item */}
      {item.claims.length > 0 && (
        <View style={styles.claimsRow}>
          <Text style={styles.claimsLabel}>Pool claims: </Text>
          <View style={styles.pillsWrap}>
            {item.claims.map((c) => (
              <View
                key={c.userId}
                style={[
                  styles.claimPill,
                  c.userId === currentUserId && styles.myClaimPill,
                ]}
              >
                <View
                  style={[styles.dot, { backgroundColor: c.avatarColor }]}
                />
                <Text style={styles.claimPillText}>
                  {c.userName.split(' ')[0]} ×{c.quantity}
                </Text>
              </View>
            ))}
          </View>
        </View>
      )}
    </View>
  );
};

const styles = StyleSheet.create({
  card: {
    backgroundColor: '#FFFFFF',
    borderRadius: 14,
    padding: 14,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: '#E2E8F0',
  },
  mainRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  emojiContainer: {
    width: 52,
    height: 52,
    borderRadius: 12,
    backgroundColor: '#F8FAFC',
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 12,
    borderWidth: 1,
    borderColor: '#F1F5F9',
  },
  emoji: {
    fontSize: 26,
  },
  infoCol: {
    flex: 1,
    paddingRight: 8,
  },
  tagRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 4,
    gap: 6,
  },
  modeBadge: {
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 5,
  },
  badgeIndiv: {
    backgroundColor: '#E0F2FE',
  },
  badgeCase: {
    backgroundColor: '#F3E8FF',
  },
  modeBadgeText: {
    fontSize: 9,
    fontWeight: '800',
    letterSpacing: 0.4,
  },
  badgeIndivText: {
    color: '#0369A1',
  },
  badgeCaseText: {
    color: '#7E22CE',
  },
  saveBadge: {
    backgroundColor: '#DCFCE7',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 5,
  },
  saveBadgeText: {
    fontSize: 10,
    fontWeight: '700',
    color: '#15803D',
  },
  itemName: {
    fontSize: 15,
    fontWeight: '700',
    color: '#0F172A',
  },
  unitLabel: {
    fontSize: 12,
    color: '#64748B',
    marginTop: 1,
  },
  priceRow: {
    flexDirection: 'row',
    alignItems: 'baseline',
    marginTop: 4,
    gap: 6,
  },
  unitPrice: {
    fontSize: 16,
    fontWeight: '800',
    color: '#0F172A',
  },
  retailPrice: {
    fontSize: 12,
    color: '#94A3B8',
    textDecorationLine: 'line-through',
  },
  stepperCol: {
    alignItems: 'flex-end',
    justifyContent: 'center',
  },
  joinButton: {
    backgroundColor: '#0D9488',
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 10,
  },
  joinButtonText: {
    color: '#FFFFFF',
    fontWeight: '700',
    fontSize: 12,
  },
  lockedBadge: {
    backgroundColor: '#F1F5F9',
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#CBD5E1',
  },
  lockedBadgeText: {
    fontSize: 11,
    fontWeight: '700',
    color: '#475569',
  },
  stepperBox: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#F1F5F9',
    borderRadius: 10,
    padding: 3,
  },
  stepBtn: {
    width: 28,
    height: 28,
    borderRadius: 8,
    backgroundColor: '#FFFFFF',
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOpacity: 0.05,
    shadowRadius: 2,
    elevation: 1,
  },
  stepBtnText: {
    fontSize: 16,
    fontWeight: '800',
    color: '#0F172A',
  },
  qtyText: {
    fontSize: 14,
    fontWeight: '800',
    color: '#0F172A',
    paddingHorizontal: 10,
  },
  mySubtotalText: {
    fontSize: 11,
    fontWeight: '700',
    color: '#0D9488',
    marginTop: 4,
  },
  caseSplitContainer: {
    marginTop: 12,
    backgroundColor: '#FAF5FF',
    borderRadius: 10,
    padding: 10,
    borderWidth: 1,
    borderColor: '#E9D5FF',
  },
  caseHeaderRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 6,
  },
  caseTitle: {
    fontSize: 11,
    fontWeight: '700',
    color: '#6B21A8',
  },
  caseStatusBadge: {
    fontSize: 11,
    fontWeight: '700',
  },
  caseMatchedText: {
    color: '#15803D',
  },
  casePendingText: {
    color: '#9333EA',
  },
  slotsRow: {
    flexDirection: 'row',
    gap: 5,
  },
  caseSlot: {
    flex: 1,
    height: 7,
    borderRadius: 4,
  },
  caseSlotFilled: {
    backgroundColor: '#9333EA',
  },
  caseSlotEmpty: {
    backgroundColor: '#E9D5FF',
  },
  claimsRow: {
    marginTop: 10,
    paddingTop: 8,
    borderTopWidth: 1,
    borderTopColor: '#F1F5F9',
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
  },
  claimsLabel: {
    fontSize: 11,
    color: '#64748B',
    fontWeight: '600',
    marginRight: 4,
  },
  pillsWrap: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 5,
  },
  claimPill: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#F8FAFC',
    paddingHorizontal: 7,
    paddingVertical: 3,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: '#E2E8F0',
  },
  myClaimPill: {
    backgroundColor: '#CCFBF1',
    borderColor: '#5EEAD4',
  },
  dot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    marginRight: 4,
  },
  claimPillText: {
    fontSize: 11,
    fontWeight: '600',
    color: '#334155',
  },
});
