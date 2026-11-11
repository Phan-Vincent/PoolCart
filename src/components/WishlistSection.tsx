import React, { useState } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
} from 'react-native';
import { GroupBuyPool, Participant, WishlistRequest } from '../types/groupBuy';

interface Props {
  pool: GroupBuyPool;
  activeUser: Participant;
  isCurrentUserHost: boolean;
  onPledgeWishlist: (wishId: string) => void;
  onPromoteWishlistToCatalog: (wish: WishlistRequest) => void;
  onAddWishlistRequest: (req: Omit<WishlistRequest, 'id' | 'poolId'>) => void;
}

export const WishlistSection: React.FC<Props> = ({
  pool,
  activeUser,
  isCurrentUserHost,
  onPledgeWishlist,
  onPromoteWishlistToCatalog,
  onAddWishlistRequest,
}) => {
  const [showPitchForm, setShowPitchForm] = useState(false);
  const [title, setTitle] = useState('');
  const [emoji, setEmoji] = useState('🥐');
  const [unitLabel, setUnitLabel] = useState('1 share (1/5 case)');
  const [estPrice, setEstPrice] = useState('9.00');
  const [targetCaseSize, setTargetCaseSize] = useState('5');

  const wishlist = (pool.wishlist || []).filter((w) => !w.promotedToCatalog);

  const handleCreateWish = () => {
    if (!title.trim()) return;
    const price = parseFloat(estPrice) || 8;
    const cases = parseInt(targetCaseSize, 10) || 5;

    onAddWishlistRequest({
      title: title.trim(),
      emoji: emoji.trim() || '📦',
      category: 'Neighbor Request',
      suggestedUnitLabel: unitLabel.trim() || '1 share',
      estimatedUnitPrice: price,
      estimatedRetailPrice: Number((price * 1.45).toFixed(2)),
      targetCaseSize: cases,
      requestedByUserId: activeUser.id,
      requestedByUserName: activeUser.name,
      pledgedUserIds: [activeUser.id],
    });

    setTitle('');
    setShowPitchForm(false);
  };

  return (
    <View style={styles.container}>
      <View style={styles.headerRow}>
        <View style={{ flex: 1, paddingRight: 8 }}>
          <Text style={styles.sectionBadge}>
            💡 NEIGHBOR BULK SPLIT WISHLIST ({wishlist.length})
          </Text>
          <Text style={styles.sectionSub}>
            Want to split a bulk sack or case not in the catalog yet? Request it
            and collect neighbor pledges so the host can add it!
          </Text>
        </View>
        <TouchableOpacity
          style={styles.requestBtn}
          onPress={() => setShowPitchForm(!showPitchForm)}
        >
          <Text style={styles.requestBtnText}>
            {showPitchForm ? 'Close' : '+ Request Split'}
          </Text>
        </TouchableOpacity>
      </View>

      {showPitchForm && (
        <View style={styles.pitchFormCard}>
          <Text style={styles.formTitle}>
            Pitch a Bulk Item for Neighbors to Split
          </Text>
          <TextInput
            style={styles.input}
            placeholder="e.g. King Arthur Organic Bread Flour (50 lb Sack)"
            value={title}
            onChangeText={setTitle}
          />
          <View style={styles.formRow}>
            <TextInput
              style={[styles.input, { flex: 1, marginRight: 6 }]}
              placeholder="Emoji"
              value={emoji}
              onChangeText={setEmoji}
            />
            <TextInput
              style={[styles.input, { flex: 2, marginRight: 6 }]}
              placeholder="Share label (e.g. 10 lb bag)"
              value={unitLabel}
              onChangeText={setUnitLabel}
            />
          </View>
          <View style={styles.formRow}>
            <TextInput
              style={[styles.input, { flex: 1, marginRight: 6 }]}
              placeholder="Est. $/share"
              keyboardType="decimal-pad"
              value={estPrice}
              onChangeText={setEstPrice}
            />
            <TextInput
              style={[styles.input, { flex: 1, marginRight: 6 }]}
              placeholder="Shares/case"
              keyboardType="number-pad"
              value={targetCaseSize}
              onChangeText={setTargetCaseSize}
            />
            <TouchableOpacity
              style={styles.submitWishBtn}
              onPress={handleCreateWish}
            >
              <Text style={styles.submitWishBtnText}>Post Request</Text>
            </TouchableOpacity>
          </View>
        </View>
      )}

      {wishlist.map((w) => {
        const hasPledged = w.pledgedUserIds.includes(activeUser.id);
        const pledgeCount = w.pledgedUserIds.length;
        const readyToPromote = pledgeCount >= Math.ceil(w.targetCaseSize * 0.5);

        return (
          <View key={w.id} style={styles.wishCard}>
            <View style={styles.wishTopRow}>
              <Text style={styles.wishEmoji}>{w.emoji}</Text>
              <View style={{ flex: 1, paddingRight: 8 }}>
                <Text style={styles.wishTitle}>{w.title}</Text>
                <Text style={styles.wishMeta}>
                  Est. ${w.estimatedUnitPrice.toFixed(2)} / {w.suggestedUnitLabel} •
                  Requested by {w.requestedByUserName.split(' ')[0]}
                </Text>
              </View>

              <TouchableOpacity
                style={[
                  styles.pledgeButton,
                  hasPledged && styles.pledgeButtonActive,
                ]}
                onPress={() => onPledgeWishlist(w.id)}
              >
                <Text
                  style={[
                    styles.pledgeButtonText,
                    hasPledged && styles.pledgeButtonTextActive,
                  ]}
                >
                  {hasPledged ? '✓ I’m In' : '🙋‍♂️ I’d Split'} ({pledgeCount}/
                  {w.targetCaseSize})
                </Text>
              </TouchableOpacity>
            </View>

            {/* Host Promote to Official Catalog Action */}
            <View style={styles.wishFooterRow}>
              <Text style={styles.pledgeProgressNote}>
                {readyToPromote
                  ? `🔥 ${pledgeCount} neighbors pledged! Ready to add to pool catalog.`
                  : `${w.targetCaseSize - pledgeCount} more neighbor pledges needed for a full case`}
              </Text>

              {isCurrentUserHost && (
                <TouchableOpacity
                  style={styles.promoteBtn}
                  onPress={() => onPromoteWishlistToCatalog(w)}
                >
                  <Text style={styles.promoteBtnText}>
                    + Approve & Add to Catalog
                  </Text>
                </TouchableOpacity>
              )}
            </View>
          </View>
        );
      })}
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    marginTop: 8,
    marginBottom: 16,
    backgroundColor: '#FFFBEB',
    borderRadius: 16,
    padding: 14,
    borderWidth: 1,
    borderColor: '#FDE68A',
  },
  headerRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 10,
  },
  sectionBadge: {
    fontSize: 11,
    fontWeight: '800',
    color: '#B45309',
    letterSpacing: 0.5,
  },
  sectionSub: {
    fontSize: 11,
    color: '#92400E',
    marginTop: 2,
    lineHeight: 15,
  },
  requestBtn: {
    backgroundColor: '#D97706',
    paddingHorizontal: 10,
    paddingVertical: 7,
    borderRadius: 9,
  },
  requestBtnText: {
    color: '#FFFFFF',
    fontSize: 11,
    fontWeight: '800',
  },
  pitchFormCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 12,
    padding: 12,
    marginBottom: 10,
    borderWidth: 1,
    borderColor: '#FCD34D',
  },
  formTitle: {
    fontSize: 12,
    fontWeight: '800',
    color: '#0F172A',
    marginBottom: 8,
  },
  formRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 6,
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
  submitWishBtn: {
    backgroundColor: '#0D9488',
    paddingHorizontal: 12,
    paddingVertical: 9,
    borderRadius: 8,
  },
  submitWishBtnText: {
    color: '#FFFFFF',
    fontWeight: '800',
    fontSize: 11,
  },
  wishCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 12,
    padding: 12,
    marginTop: 8,
    borderWidth: 1,
    borderColor: '#FDE68A',
  },
  wishTopRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  wishEmoji: {
    fontSize: 24,
    marginRight: 10,
  },
  wishTitle: {
    fontSize: 13,
    fontWeight: '700',
    color: '#0F172A',
  },
  wishMeta: {
    fontSize: 11,
    color: '#64748B',
    marginTop: 2,
  },
  pledgeButton: {
    backgroundColor: '#FEF3C7',
    borderWidth: 1,
    borderColor: '#F59E0B',
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 999,
  },
  pledgeButtonActive: {
    backgroundColor: '#DCFCE7',
    borderColor: '#10B981',
  },
  pledgeButtonText: {
    fontSize: 11,
    fontWeight: '800',
    color: '#B45309',
  },
  pledgeButtonTextActive: {
    color: '#15803D',
  },
  wishFooterRow: {
    marginTop: 8,
    paddingTop: 8,
    borderTopWidth: 1,
    borderTopColor: '#F1F5F9',
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: 6,
  },
  pledgeProgressNote: {
    fontSize: 11,
    color: '#78350F',
    fontWeight: '600',
    flex: 1,
  },
  promoteBtn: {
    backgroundColor: '#0F172A',
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 7,
  },
  promoteBtnText: {
    color: '#5EEAD4',
    fontSize: 10,
    fontWeight: '800',
  },
});
