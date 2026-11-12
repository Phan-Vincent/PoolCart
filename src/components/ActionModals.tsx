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
import { newId, requireNumber, validatePool } from '../utils/poolActions';
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
  const [formError, setFormError] = useState('');
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
    let parsedUnit: number, parsedRetail: number, parsedCase: number, parsedMaxCases: number;
    try {
      parsedUnit = requireNumber(Number(unitPrice), 'Wholesale unit price', 0.01);
      parsedRetail = requireNumber(Number(retailPrice), 'Retail unit price', 0.01);
      parsedCase = mode === 'case_split' ? requireNumber(Number(caseSize), 'Shares per case', 2, true, 1000) : 1;
      parsedMaxCases = maxCases.trim() ? requireNumber(Number(maxCases), 'Maximum cases', 1, true, 1000) : NaN;
    } catch (error) { setFormError(String(error)); return; }

    const item: CatalogItem = {
      id: newId('item'),
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

          {!!formError && <Text style={{ color: '#B91C1C', paddingVertical: 6 }}>{formError}</Text>}
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
  sourcePool?: GroupBuyPool;
  visible: boolean;
  activeUser: Participant;
  onClose: () => void;
  onCreatePool: (pool: GroupBuyPool) => void;
}

export function buildCreatedPoolFromForm(params: {
  sourcePool?: GroupBuyPool;
  selectedTemplate: SupplierCatalogTemplate;
  activeUser: Participant;
  title: string;
  supplierName: string;
  minimumOrder: string;
  freeThreshold: string;
  venmoHandle: string;
  pickupAddress: string;
  pickupWindow: string;
  cutoffTime: string;
}): GroupBuyPool {
  const {
    sourcePool,
    selectedTemplate: tpl,
    activeUser,
    title,
    supplierName,
    minimumOrder,
    freeThreshold,
    venmoHandle,
    pickupAddress,
    pickupWindow,
    cutoffTime,
  } = params;

  if (!title.trim()) {
    throw new Error('Pool title is required.');
  }
  const minAmt = requireNumber(Number(minimumOrder), 'Minimum order', 0.01);
  const freeAmt = requireNumber(
    Number(freeThreshold),
    'Free-delivery threshold',
    minAmt
  );
  if (!pickupAddress.trim() || !pickupWindow.trim() || !cutoffTime.trim()) {
    throw new Error(
      'Enter a pickup address, a new pickup date/window, and an order cutoff including timezone.'
    );
  }

  const prefix = title
    .replace(/[^a-zA-Z]/g, '')
    .slice(0, 4)
    .toUpperCase();
  const num = newId('invite').split('_').slice(1).join('').toUpperCase();
  const joinCode = `${prefix || 'POOL'}-${num}`;
  const poolId = newId('pool');

  // A new run or rerun must start with NO claims unless a user explicitly claims shares afterward.
  // Preserve catalog configuration (name, category, emoji, mode, unitLabel, unitPrice, retailPrice, caseSize, maxCases),
  // while clearing actualUnitPrice and all prior claims.
  const templateItems: CatalogItem[] = (sourcePool?.items || tpl.items).map(
    (raw) => ({
      name: raw.name,
      category: raw.category,
      emoji: raw.emoji,
      mode: raw.mode,
      unitLabel: raw.unitLabel,
      unitPrice: raw.unitPrice,
      retailPrice: raw.retailPrice,
      caseSize: raw.mode === 'case_split' ? raw.caseSize : undefined,
      maxCases: raw.mode === 'case_split' ? raw.maxCases : undefined,
      id: newId('item'),
      actualUnitPrice: undefined,
      claims: [],
    })
  );

  const newPool: GroupBuyPool = {
    id: poolId,
    joinCode,
    title: title.trim(),
    supplierName: supplierName.trim() || tpl.supplierName,
    supplierBadge: sourcePool?.supplierBadge || tpl.supplierBadge,
    category: sourcePool?.category || tpl.category,
    hostUserId: activeUser.id,
    hostName: activeUser.name,
    hostVenmoHandle: venmoHandle.trim().replace(/^@/, '') || undefined,
    neighborhood: activeUser.neighborhood,
    distanceMiles: sourcePool?.distanceMiles,
    pickupAddress: pickupAddress.trim(),
    pickupWindow: pickupWindow.trim(),
    cutoffTime: cutoffTime.trim(),
    minimumOrderAmount: minAmt,
    deliveryFee: sourcePool?.deliveryFee ?? tpl.defaultDeliveryFee,
    freeDeliveryThreshold: freeAmt,
    status: 'open',
    trueUp: undefined,
    porchCheckIn: undefined,
    wishlist: [],
    participants: [
      {
        id: activeUser.id,
        name: activeUser.name,
        email: activeUser.email,
        neighborhood: activeUser.neighborhood,
        avatarColor: activeUser.avatarColor,
        isHost: true,
        verifiedAuth: Boolean(activeUser.verifiedAuth),
        paidStatus: 'pending',
        demoHoldId: undefined,
        demoAuthorizedAmount: undefined,
        settledAmount: undefined,
        pickedUp: false,
      },
    ],
    items: templateItems,
    messages: [
      {
        id: newId('msg'),
        poolId,
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

  validatePool(newPool);
  return newPool;
}

export const CreatePoolModal: React.FC<CreatePoolModalProps> = ({
  sourcePool,
  visible,
  activeUser,
  onClose,
  onCreatePool,
}) => {
  const [formError, setFormError] = useState('');
  const [selectedTemplateId, setSelectedTemplateId] = useState<string>(
    SUPPLIER_TEMPLATES[0].id
  );
  const [title, setTitle] = useState(
    sourcePool
      ? `${sourcePool.title.replace(/ \(Next Run\)$/, '')} (Next Run)`
      : SUPPLIER_TEMPLATES[0].name
  );
  const [supplierName, setSupplierName] = useState(
    sourcePool?.supplierName || SUPPLIER_TEMPLATES[0].supplierName
  );
  const [minimumOrder, setMinimumOrder] = useState(
    String(
      sourcePool?.minimumOrderAmount ??
        SUPPLIER_TEMPLATES[0].defaultMinimumOrder
    )
  );
  const [freeThreshold, setFreeThreshold] = useState(
    String(
      sourcePool?.freeDeliveryThreshold ??
        SUPPLIER_TEMPLATES[0].defaultFreeThreshold
    )
  );
  const [venmoHandle, setVenmoHandle] = useState(
    sourcePool?.hostVenmoHandle || ''
  );
  const [pickupAddress, setPickupAddress] = useState(
    sourcePool?.pickupAddress || ''
  );
  const [pickupWindow, setPickupWindow] = useState('');
  const [cutoffTime, setCutoffTime] = useState('');

  const handleSelectTemplate = (tpl: SupplierCatalogTemplate) => {
    setSelectedTemplateId(tpl.id);
    setTitle(tpl.name);
    setSupplierName(tpl.supplierName);
    setMinimumOrder(String(tpl.defaultMinimumOrder));
    setFreeThreshold(String(tpl.defaultFreeThreshold));
  };

  const handleCreate = () => {
    const tpl =
      SUPPLIER_TEMPLATES.find((t) => t.id === selectedTemplateId) ||
      SUPPLIER_TEMPLATES[0];
    try {
      const newPool = buildCreatedPoolFromForm({
        sourcePool,
        selectedTemplate: tpl,
        activeUser,
        title,
        supplierName,
        minimumOrder,
        freeThreshold,
        venmoHandle,
        pickupAddress,
        pickupWindow,
        cutoffTime,
      });
      setFormError('');
      onCreatePool(newPool);
      onClose();
    } catch (error) {
      setFormError(error instanceof Error ? error.message : String(error));
    }
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
            {sourcePool
              ? 'Rerun this catalog with a fresh schedule. Prior claims, receipts, payments, wishlist pledges and porch details will not carry over.'
              : 'Pick a sample supplier catalog and customize your pickup schedule.'}
          </Text>

          <ScrollView style={styles.formScroll}>
            <Text style={styles.label}>
              ⚡ 1-Tap Wholesale Supplier Catalog Template
            </Text>
            <ScrollView
              style={sourcePool ? { display: 'none' } : styles.tplScroll}
              horizontal
              showsHorizontalScrollIndicator={false}
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

            <Text style={styles.label}>Order Cutoff (date, time, timezone)</Text>
            <TextInput
              style={styles.input}
              value={cutoffTime}
              onChangeText={setCutoffTime}
              placeholder="e.g. Nov 20, 2026 at 8 PM Pacific"
            />
            <Text style={styles.label}>Pickup Window (new date and timezone)</Text>
            <TextInput
              style={styles.input}
              value={pickupWindow}
              onChangeText={setPickupWindow}
              placeholder="e.g. Sat, Nov 21 • 9:00 AM – 12:00 PM Pacific"
            />
          </ScrollView>

          {!!formError && (
            <Text style={{ color: '#B91C1C', paddingVertical: 6 }}>
              {formError}
            </Text>
          )}
          <View style={styles.actionsRow}>
            <TouchableOpacity style={styles.cancelBtn} onPress={onClose}>
              <Text style={styles.cancelBtnText}>Cancel</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.saveBtn} onPress={handleCreate}>
              <Text style={styles.saveBtnText}>
                Launch Pool (
                {sourcePool?.items.length ??
                  (
                    SUPPLIER_TEMPLATES.find(
                      (t) => t.id === selectedTemplateId
                    ) || SUPPLIER_TEMPLATES[0]
                  ).items.length}{' '}
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
  isCloudMode?: boolean;
  onClose: () => void;
  onSelectPoolId: (poolId: string) => void;
  onJoinByInviteCode?: (code: string) => Promise<{ poolId?: string; error?: string }>;
}

export const JoinByCodeModal: React.FC<JoinByCodeModalProps> = ({
  visible,
  pools,
  isCloudMode = false,
  onClose,
  onSelectPoolId,
  onJoinByInviteCode,
}) => {
  const [codeInput, setCodeInput] = useState('');
  const [errorText, setErrorText] = useState('');
  const [isJoining, setIsJoining] = useState(false);

  const handleJoin = async () => {
    const cleaned = codeInput.trim().toUpperCase();
    if (!cleaned) return;

    if (isCloudMode && onJoinByInviteCode) {
      setIsJoining(true);
      try {
        const res = await onJoinByInviteCode(cleaned);
        if (res.error) {
          setErrorText(res.error);
          return;
        }
        if (res.poolId) {
          setErrorText('');
          setCodeInput('');
          onSelectPoolId(res.poolId);
          onClose();
          return;
        }
      } finally {
        setIsJoining(false);
      }
    }

    const matched = pools.find(
      (p) =>
        p.joinCode.toUpperCase() === cleaned || p.id.toUpperCase() === cleaned
    );

    if (!matched) {
      setErrorText(
        `No neighborhood pool found with code "${cleaned}". ${
          isCloudMode
            ? 'Check the code with your host or verify your cloud connection.'
            : 'Try one of the active codes below!'
        }`
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
            {isCloudMode
              ? 'Enter your neighborhood invite code to join as an authenticated cloud member.'
              : 'Enter the invite code shared by your neighborhood host (or tap an active pool code below).'}
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

          {pools.length > 0 && (
            <>
              <Text style={styles.label}>
                {isCloudMode
                  ? 'Your Joined Cloud Pools'
                  : 'Active Neighborhood Codes Near You'}
              </Text>
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
            </>
          )}

          <View style={[styles.actionsRow, { marginTop: 16 }]}>
            <TouchableOpacity style={styles.cancelBtn} onPress={onClose}>
              <Text style={styles.cancelBtnText}>Close</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.saveBtn}
              onPress={handleJoin}
              disabled={isJoining}
            >
              <Text style={styles.saveBtnText}>
                {isJoining ? 'Joining…' : 'Join Pool'}
              </Text>
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
