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
import {
  CatalogItem,
  GroupBuyPool,
  ItemMode,
  Participant,
  SupplierCatalogTemplate,
} from '../types/groupBuy';
import { SUPPLIER_TEMPLATES } from '../data/mockPools';

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
  const [maxCases, setMaxCases] = useState('');

  const handleSave = () => {
    if (!name.trim()) return;
    const parsedUnit = parseFloat(unitPrice) || 5;
    const parsedRetail = parseFloat(retailPrice) || parsedUnit * 1.35;
    const parsedCase = parseInt(caseSize, 10) || 4;
    const parsedMaxCases = parseInt(maxCases, 10);

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
      maxCases:
        mode === 'case_split' && !isNaN(parsedMaxCases) && parsedMaxCases > 0
          ? parsedMaxCases
          : undefined,
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
    setMaxCases('');
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
              <View style={styles.row}>
                <View style={{ flex: 1, marginRight: 8 }}>
                  <Text style={styles.label}>Shares per Case</Text>
                  <TextInput
                    style={styles.input}
                    keyboardType="number-pad"
                    value={caseSize}
                    onChangeText={setCaseSize}
                  />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.label}>Max Cases Cap (Optional)</Text>
                  <TextInput
                    style={styles.input}
                    keyboardType="number-pad"
                    placeholder="Unlimited"
                    value={maxCases}
                    onChangeText={setMaxCases}
                  />
                </View>
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
  const [selectedTemplateId, setSelectedTemplateId] = useState<string>(
    SUPPLIER_TEMPLATES[0].id
  );
  const [title, setTitle] = useState(SUPPLIER_TEMPLATES[0].name);
  const [supplierName, setSupplierName] = useState(
    SUPPLIER_TEMPLATES[0].supplierName
  );
  const [minimumOrder, setMinimumOrder] = useState(
    String(SUPPLIER_TEMPLATES[0].defaultMinimumOrder)
  );
  const [freeThreshold, setFreeThreshold] = useState(
    String(SUPPLIER_TEMPLATES[0].defaultFreeThreshold)
  );
  const [venmoHandle, setVenmoHandle] = useState('Vincent-Phan-Coop');
  const [pickupAddress, setPickupAddress] = useState(
    'Victoria Gardens Drop Point'
  );
  const [pickupWindow, setPickupWindow] = useState(
    'Sat • 10:00 AM – 1:00 PM'
  );

  const handleSelectTemplate = (tpl: SupplierCatalogTemplate) => {
    setSelectedTemplateId(tpl.id);
    setTitle(tpl.name);
    setSupplierName(tpl.supplierName);
    setMinimumOrder(String(tpl.defaultMinimumOrder));
    setFreeThreshold(String(tpl.defaultFreeThreshold));
  };

  const generateJoinCode = (poolTitle: string) => {
    const prefix = poolTitle
      .replace(/[^a-zA-Z]/g, '')
      .slice(0, 4)
      .toUpperCase();
    const num = Math.floor(10 + Math.random() * 89);
    return `${prefix || 'POOL'}-${num}`;
  };

  const handleCreate = () => {
    if (!title.trim()) return;
    const minAmt = parseFloat(minimumOrder) || 200;
    const freeAmt = parseFloat(freeThreshold) || minAmt + 100;
    const tpl =
      SUPPLIER_TEMPLATES.find((t) => t.id === selectedTemplateId) ||
      SUPPLIER_TEMPLATES[0];

    const nowTs = Date.now();
    const joinCode = generateJoinCode(title);

    const templateItems: CatalogItem[] = tpl.items.map((raw, idx) => ({
      ...raw,
      id: `item_${nowTs}_${idx}`,
      claims:
        idx === 0
          ? [
              {
                userId: activeUser.id,
                userName: activeUser.name,
                avatarColor: activeUser.avatarColor,
                quantity: 1,
              },
            ]
          : [],
    }));

    const newPool: GroupBuyPool = {
      id: `pool_${nowTs}`,
      joinCode,
      title: title.trim(),
      supplierName: supplierName.trim() || tpl.supplierName,
      supplierBadge: tpl.supplierBadge,
      category: tpl.category,
      hostName: activeUser.name,
      hostVenmoHandle: venmoHandle.trim() || 'PoolCart-Host',
      neighborhood: activeUser.neighborhood,
      pickupAddress,
      pickupWindow,
      cutoffTime: 'Fri at 8:00 PM',
      minimumOrderAmount: minAmt,
      deliveryFee: tpl.defaultDeliveryFee,
      freeDeliveryThreshold: freeAmt,
      status: 'open',
      participants: [
        {
          ...activeUser,
          isHost: true,
          paidStatus: 'paid',
        },
      ],
      items: templateItems,
      messages: [
        {
          id: `msg_${nowTs}`,
          poolId: `pool_${nowTs}`,
          userId: activeUser.id,
          userName: activeUser.name,
          avatarColor: activeUser.avatarColor,
          isHost: true,
          isAnnouncement: true,
          text: `Welcome to ${title.trim()}! Share code ${joinCode} with neighbors so we can hit the $${minAmt} wholesale minimum together.`,
          createdAt: 'Just now',
        },
      ],
    };

    onCreatePool(newPool);
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
            Pick a pre-loaded wholesale supplier catalog template or customize your own.
          </Text>

          <ScrollView style={styles.formScroll}>
            <Text style={styles.label}>
              ⚡ 1-Tap Wholesale Supplier Catalog Template
            </Text>
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              style={styles.tplScroll}
            >
              {SUPPLIER_TEMPLATES.map((tpl) => {
                const isSelected = tpl.id === selectedTemplateId;
                return (
                  <TouchableOpacity
                    key={tpl.id}
                    style={[
                      styles.tplCard,
                      isSelected && styles.tplCardSelected,
                    ]}
                    onPress={() => handleSelectTemplate(tpl)}
                  >
                    <Text style={styles.tplEmoji}>{tpl.emoji}</Text>
                    <Text
                      style={[
                        styles.tplName,
                        isSelected && styles.tplNameSelected,
                      ]}
                      numberOfLines={1}
                    >
                      {tpl.name}
                    </Text>
                    <Text style={styles.tplMeta}>
                      {tpl.items.length} bulk items • ${tpl.defaultMinimumOrder}{' '}
                      min
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </ScrollView>

            <Text style={styles.label}>Pool Title</Text>
            <TextInput
              style={styles.input}
              value={title}
              onChangeText={setTitle}
            />

            <View style={styles.row}>
              <View style={{ flex: 1, marginRight: 8 }}>
                <Text style={styles.label}>Supplier / Distributor</Text>
                <TextInput
                  style={styles.input}
                  value={supplierName}
                  onChangeText={setSupplierName}
                />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.label}>Host Venmo (@handle)</Text>
                <TextInput
                  style={styles.input}
                  value={venmoHandle}
                  onChangeText={setVenmoHandle}
                />
              </View>
            </View>

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
              <Text style={styles.saveBtnText}>
                Launch Pool ({
                  (
                    SUPPLIER_TEMPLATES.find((t) => t.id === selectedTemplateId) ||
                    SUPPLIER_TEMPLATES[0]
                  ).items.length
                }{' '}
                Items)
              </Text>
            </TouchableOpacity>
          </View>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
};

interface JoinByCodeModalProps {
  visible: boolean;
  pools: GroupBuyPool[];
  onClose: () => void;
  onSelectPoolId: (poolId: string) => void;
}

export const JoinByCodeModal: React.FC<JoinByCodeModalProps> = ({
  visible,
  pools,
  onClose,
  onSelectPoolId,
}) => {
  const [codeInput, setCodeInput] = useState('');
  const [errorText, setErrorText] = useState('');

  const handleJoin = () => {
    const cleaned = codeInput.trim().toUpperCase();
    if (!cleaned) return;

    const matched = pools.find(
      (p) => p.joinCode.toUpperCase() === cleaned || p.id.toUpperCase() === cleaned
    );

    if (!matched) {
      setErrorText(
        `No neighborhood pool found with code "${cleaned}". Try one of the active codes below!`
      );
      return;
    }

    setErrorText('');
    setCodeInput('');
    onSelectPoolId(matched.id);
    onClose();
  };

  return (
    <Modal visible={visible} animationType="fade" transparent>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={styles.overlay}
      >
        <View style={styles.sheet}>
          <Text style={styles.title}>🔑 Join a Pool by Invite Code</Text>
          <Text style={styles.subtitle}>
            Enter the 6-character code shared by your neighborhood host (or tap an active pool code below).
          </Text>

          <TextInput
            style={[styles.input, styles.codeInputBig]}
            placeholder="e.g. VG-FARM or WEEE-88"
            autoCapitalize="characters"
            autoCorrect={false}
            value={codeInput}
            onChangeText={(val) => {
              setCodeInput(val);
              setErrorText('');
            }}
          />

          {errorText ? <Text style={styles.errorMsg}>{errorText}</Text> : null}

          <Text style={styles.label}>Active Neighborhood Codes Near You</Text>
          <View style={styles.activeCodesWrap}>
            {pools.map((p) => (
              <TouchableOpacity
                key={p.id}
                style={styles.activeCodeChip}
                onPress={() => {
                  onSelectPoolId(p.id);
                  onClose();
                }}
              >
                <Text style={styles.activeCodeBadge}>{p.joinCode}</Text>
                <Text style={styles.activeCodeTitle} numberOfLines={1}>
                  {p.title}
                </Text>
              </TouchableOpacity>
            ))}
          </View>

          <View style={[styles.actionsRow, { marginTop: 16 }]}>
            <TouchableOpacity style={styles.cancelBtn} onPress={onClose}>
              <Text style={styles.cancelBtnText}>Close</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.saveBtn} onPress={handleJoin}>
              <Text style={styles.saveBtnText}>Join Pool</Text>
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
    maxHeight: '90%',
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
  tplScroll: {
    marginBottom: 8,
  },
  tplCard: {
    width: 195,
    backgroundColor: '#F8FAFC',
    borderWidth: 1,
    borderColor: '#E2E8F0',
    borderRadius: 12,
    padding: 10,
    marginRight: 10,
  },
  tplCardSelected: {
    backgroundColor: '#F0FDFA',
    borderColor: '#0D9488',
    borderWidth: 1.5,
  },
  tplEmoji: {
    fontSize: 22,
    marginBottom: 4,
  },
  tplName: {
    fontSize: 13,
    fontWeight: '700',
    color: '#1E293B',
  },
  tplNameSelected: {
    color: '#0F766E',
    fontWeight: '800',
  },
  tplMeta: {
    fontSize: 11,
    color: '#64748B',
    marginTop: 2,
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
  codeInputBig: {
    fontSize: 18,
    fontWeight: '800',
    letterSpacing: 1.2,
    textAlign: 'center',
  },
  errorMsg: {
    fontSize: 12,
    color: '#DC2626',
    fontWeight: '600',
    marginTop: 6,
  },
  activeCodesWrap: {
    gap: 8,
    marginTop: 4,
  },
  activeCodeChip: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#F8FAFC',
    borderWidth: 1,
    borderColor: '#E2E8F0',
    borderRadius: 10,
    padding: 10,
    gap: 10,
  },
  activeCodeBadge: {
    backgroundColor: '#0F172A',
    color: '#5EEAD4',
    fontWeight: '800',
    fontSize: 12,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 6,
    overflow: 'hidden',
  },
  activeCodeTitle: {
    fontSize: 13,
    fontWeight: '700',
    color: '#1E293B',
    flex: 1,
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
