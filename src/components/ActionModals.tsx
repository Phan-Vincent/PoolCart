import React, { useState } from 'react';
import {
  Modal,
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  ScrollView,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { CatalogItem, GroupBuyPool, ItemMode, Participant } from '../types/groupBuy';

interface AddItemModalProps {
  visible: boolean;
  activeUser: Participant;
  onClose: () => void;
  onAddItem: (newItem: CatalogItem) => void;
}

export const AddItemModal: React.FC<AddItemModalProps> = ({
  visible,
  activeUser,
  onClose,
  onAddItem,
}) => {
  const [name, setName] = useState('');
  const [emoji, setEmoji] = useState('📦');
  const [unitLabel, setUnitLabel] = useState('1 unit');
  const [unitPrice, setUnitPrice] = useState('8.50');
  const [retailPrice, setRetailPrice] = useState('12.99');
  const [mode, setMode] = useState<ItemMode>('case_split');
  const [caseSize, setCaseSize] = useState('6');

  const handleSave = () => {
    if (!name.trim()) return;
    const parsedUnit = parseFloat(unitPrice) || 5;
    const parsedRetail = parseFloat(retailPrice) || parsedUnit * 1.35;
    const parsedCase = parseInt(caseSize, 10) || 4;

    const item: CatalogItem = {
      id: `item_${Date.now()}`,
      name: name.trim(),
      category: 'Neighborhood Addition',
      emoji: emoji.trim() || '🛒',
      mode,
      unitLabel: unitLabel.trim() || '1 share',
      unitPrice: parsedUnit,
      retailPrice: parsedRetail,
      caseSize: mode === 'case_split' ? parsedCase : undefined,
      claims: [
        {
          userId: activeUser.id,
          userName: activeUser.name,
          avatarColor: activeUser.avatarColor,
          quantity: 1,
        },
      ],
    };

    onAddItem(item);
    setName('');
    onClose();
  };

  return (
    <Modal visible={visible} animationType="slide" transparent>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={styles.overlay}
      >
        <View style={styles.sheet}>
          <Text style={styles.title}>Add Item or Bulk Case Split</Text>
          <Text style={styles.subtitle}>
            Pitching as {activeUser.name} • First share claimed automatically.
          </Text>

          <ScrollView style={styles.formScroll}>
            <View style={styles.modeSwitchRow}>
              <TouchableOpacity
                style={[
                  styles.modeOption,
                  mode === 'case_split' && styles.modeOptionActive,
                ]}
                onPress={() => setMode('case_split')}
              >
                <Text
                  style={[
                    styles.modeOptionText,
                    mode === 'case_split' && styles.modeOptionTextActive,
                  ]}
                >
                  📦 Split Bulk Case
                </Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[
                  styles.modeOption,
                  mode === 'individual' && styles.modeOptionActive,
                ]}
                onPress={() => setMode('individual')}
              >
                <Text
                  style={[
                    styles.modeOptionText,
                    mode === 'individual' && styles.modeOptionTextActive,
                  ]}
                >
                  🛒 Individual Wholesale
                </Text>
              </TouchableOpacity>
            </View>

            <Text style={styles.label}>Item Name</Text>
            <TextInput
              style={styles.input}
              placeholder="e.g. Organic Kombucha (12-Bottle Case)"
              value={name}
              onChangeText={setName}
            />

            <View style={styles.row}>
              <View style={{ flex: 1, marginRight: 8 }}>
                <Text style={styles.label}>Emoji</Text>
                <TextInput
                  style={styles.input}
                  value={emoji}
                  onChangeText={setEmoji}
                />
              </View>
              <View style={{ flex: 2 }}>
                <Text style={styles.label}>Unit / Share Label</Text>
                <TextInput
                  style={styles.input}
                  placeholder="e.g. 2 bottles (1/6 case)"
                  value={unitLabel}
                  onChangeText={setUnitLabel}
                />
              </View>
            </View>

            <View style={styles.row}>
              <View style={{ flex: 1, marginRight: 8 }}>
                <Text style={styles.label}>Wholesale Price ($)</Text>
                <TextInput
                  style={styles.input}
                  keyboardType="decimal-pad"
                  value={unitPrice}
                  onChangeText={setUnitPrice}
                />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.label}>Store Retail Price ($)</Text>
                <TextInput
                  style={styles.input}
                  keyboardType="decimal-pad"
                  value={retailPrice}
                  onChangeText={setRetailPrice}
                />
              </View>
            </View>

            {mode === 'case_split' && (
              <View>
                <Text style={styles.label}>
                  Shares Needed to Complete 1 Wholesale Case
                </Text>
                <TextInput
                  style={styles.input}
                  keyboardType="number-pad"
                  value={caseSize}
                  onChangeText={setCaseSize}
                />
              </View>
            )}
          </ScrollView>

          <View style={styles.actionsRow}>
            <TouchableOpacity style={styles.cancelBtn} onPress={onClose}>
              <Text style={styles.cancelBtnText}>Cancel</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.saveBtn} onPress={handleSave}>
              <Text style={styles.saveBtnText}>Add & Claim 1st Share</Text>
            </TouchableOpacity>
          </View>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
};

interface CreatePoolModalProps {
  visible: boolean;
  activeUser: Participant;
  onClose: () => void;
  onCreatePool: (pool: GroupBuyPool) => void;
}

export const CreatePoolModal: React.FC<CreatePoolModalProps> = ({
  visible,
  activeUser,
  onClose,
  onCreatePool,
}) => {
  const [title, setTitle] = useState('');
  const [supplierName, setSupplierName] = useState('');
  const [minimumOrder, setMinimumOrder] = useState('250');
  const [freeThreshold, setFreeThreshold] = useState('350');
  const [pickupAddress, setPickupAddress] = useState('Victoria Gardens Drop Point');
  const [pickupWindow, setPickupWindow] = useState('Sat • 10:00 AM – 1:00 PM');

  const handleCreate = () => {
    if (!title.trim()) return;
    const minAmt = parseFloat(minimumOrder) || 200;
    const freeAmt = parseFloat(freeThreshold) || minAmt + 100;

    const newPool: GroupBuyPool = {
      id: `pool_${Date.now()}`,
      title: title.trim(),
      supplierName: supplierName.trim() || 'Local Wholesale Distributor',
      supplierBadge: `Wholesale Direct • $${minAmt} Minimum`,
      category: 'Community Group Buy',
      hostName: activeUser.name,
      neighborhood: activeUser.neighborhood,
      pickupAddress,
      pickupWindow,
      cutoffTime: 'Fri at 8:00 PM',
      minimumOrderAmount: minAmt,
      deliveryFee: 20,
      freeDeliveryThreshold: freeAmt,
      status: 'open',
      participants: [
        {
          ...activeUser,
          isHost: true,
        },
      ],
      items: [
        {
          id: `item_${Date.now()}_1`,
          name: 'Wholesale Organic Produce Box (Standard Share)',
          category: 'Produce',
          emoji: '🥬',
          mode: 'individual',
          unitLabel: '15 lb mixed box',
          unitPrice: 24.0,
          retailPrice: 38.0,
          claims: [
            {
              userId: activeUser.id,
              userName: activeUser.name,
              avatarColor: activeUser.avatarColor,
              quantity: 1,
            },
          ],
        },
      ],
    };

    onCreatePool(newPool);
    setTitle('');
    setSupplierName('');
    onClose();
  };

  return (
    <Modal visible={visible} animationType="slide" transparent>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={styles.overlay}
      >
        <View style={styles.sheet}>
          <Text style={styles.title}>Host a Neighborhood Group Buy</Text>
          <Text style={styles.subtitle}>
            Hosting as {activeUser.name} ({activeUser.neighborhood})
          </Text>

          <ScrollView style={styles.formScroll}>
            <Text style={styles.label}>Pool Title</Text>
            <TextInput
              style={styles.input}
              placeholder="e.g. Costco Business Center Bulk Run"
              value={title}
              onChangeText={setTitle}
            />

            <Text style={styles.label}>Wholesale Supplier / Store</Text>
            <TextInput
              style={styles.input}
              placeholder="e.g. Azure Standard / Restaurant Depot"
              value={supplierName}
              onChangeText={setSupplierName}
            />

            <View style={styles.row}>
              <View style={{ flex: 1, marginRight: 8 }}>
                <Text style={styles.label}>Order Minimum ($)</Text>
                <TextInput
                  style={styles.input}
                  keyboardType="decimal-pad"
                  value={minimumOrder}
                  onChangeText={setMinimumOrder}
                />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.label}>Free Delivery At ($)</Text>
                <TextInput
                  style={styles.input}
                  keyboardType="decimal-pad"
                  value={freeThreshold}
                  onChangeText={setFreeThreshold}
                />
              </View>
            </View>

            <Text style={styles.label}>Pickup Location</Text>
            <TextInput
              style={styles.input}
              value={pickupAddress}
              onChangeText={setPickupAddress}
            />

            <Text style={styles.label}>Pickup Window</Text>
            <TextInput
              style={styles.input}
              value={pickupWindow}
              onChangeText={setPickupWindow}
            />
          </ScrollView>

          <View style={styles.actionsRow}>
            <TouchableOpacity style={styles.cancelBtn} onPress={onClose}>
              <Text style={styles.cancelBtnText}>Cancel</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.saveBtn} onPress={handleCreate}>
              <Text style={styles.saveBtnText}>Launch Pool</Text>
            </TouchableOpacity>
          </View>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
};

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(15, 23, 42, 0.5)',
    justifyContent: 'flex-end',
  },
  sheet: {
    backgroundColor: '#FFFFFF',
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    padding: 20,
    maxHeight: '88%',
  },
  title: {
    fontSize: 18,
    fontWeight: '800',
    color: '#0F172A',
  },
  subtitle: {
    fontSize: 13,
    color: '#64748B',
    marginTop: 4,
    marginBottom: 14,
  },
  formScroll: {
    marginBottom: 14,
  },
  modeSwitchRow: {
    flexDirection: 'row',
    backgroundColor: '#F1F5F9',
    borderRadius: 10,
    padding: 4,
    marginBottom: 12,
  },
  modeOption: {
    flex: 1,
    paddingVertical: 8,
    alignItems: 'center',
    borderRadius: 8,
  },
  modeOptionActive: {
    backgroundColor: '#FFFFFF',
    shadowColor: '#000',
    shadowOpacity: 0.06,
    shadowRadius: 3,
    elevation: 1,
  },
  modeOptionText: {
    fontSize: 12,
    fontWeight: '700',
    color: '#64748B',
  },
  modeOptionTextActive: {
    color: '#0F172A',
  },
  label: {
    fontSize: 12,
    fontWeight: '700',
    color: '#334155',
    marginBottom: 6,
    marginTop: 8,
  },
  input: {
    backgroundColor: '#F8FAFC',
    borderWidth: 1,
    borderColor: '#CBD5E1',
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 14,
    color: '#0F172A',
  },
  row: {
    flexDirection: 'row',
  },
  actionsRow: {
    flexDirection: 'row',
    gap: 10,
  },
  cancelBtn: {
    flex: 1,
    paddingVertical: 12,
    borderRadius: 12,
    backgroundColor: '#F1F5F9',
    alignItems: 'center',
  },
  cancelBtnText: {
    fontSize: 14,
    fontWeight: '700',
    color: '#475569',
  },
  saveBtn: {
    flex: 2,
    paddingVertical: 12,
    borderRadius: 12,
    backgroundColor: '#0D9488',
    alignItems: 'center',
  },
  saveBtnText: {
    fontSize: 14,
    fontWeight: '800',
    color: '#FFFFFF',
  },
});
