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
import { CatalogItem, GroupBuyPool, Participant } from '../types/groupBuy';
import {
  parseBulkCatalogText,
  parseReceiptTrueUpText,
  SAMPLE_BULK_CATALOG_TEXT,
  SAMPLE_RECEIPT_OCR_TEXT,
} from '../utils/bulkParser';

interface Props {
  visible: boolean;
  pool: GroupBuyPool;
  activeUser: Participant;
  initialMode?: 'catalog_import' | 'receipt_ocr';
  onClose: () => void;
  onImportCatalogItems: (items: CatalogItem[]) => void;
  onApplyParsedReceipt: (
    priceUpdates: { itemId: string; newPrice: number }[],
    detectedTaxOrFee: number,
    note: string
  ) => void;
}

export const BulkImportModal: React.FC<Props> = ({
  visible,
  pool,
  activeUser,
  initialMode = 'catalog_import',
  onClose,
  onImportCatalogItems,
  onApplyParsedReceipt,
}) => {
  const [tab, setTab] = useState<'catalog_import' | 'receipt_ocr'>(initialMode);
  const [catalogRawText, setCatalogRawText] = useState(
    SAMPLE_BULK_CATALOG_TEXT
  );
  const [receiptRawText, setReceiptRawText] = useState(SAMPLE_RECEIPT_OCR_TEXT);

  const previewItems = parseBulkCatalogText(catalogRawText, activeUser);
  const receiptPreview = parseReceiptTrueUpText(receiptRawText, pool.items);

  const handleConfirmCatalogImport = () => {
    if (previewItems.length === 0) return;
    onImportCatalogItems(previewItems);
    onClose();
  };

  const handleConfirmReceiptOcr = () => {
    const updates = receiptPreview.matches.map((m) => ({
      itemId: m.itemId,
      newPrice: m.newReceiptPrice,
    }));
    onApplyParsedReceipt(
      updates,
      receiptPreview.detectedTaxOrFee,
      `Auto-reconciled ${updates.length} items from scanned wholesale receipt`
    );
    onClose();
  };

  return (
    <Modal visible={visible} animationType="slide" transparent>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={styles.overlay}
      >
        <View style={styles.sheet}>
          <View style={styles.switchRow}>
            <TouchableOpacity
              style={[
                styles.switchBtn,
                tab === 'catalog_import' && styles.switchBtnActive,
              ]}
              onPress={() => setTab('catalog_import')}
            >
              <Text
                style={[
                  styles.switchText,
                  tab === 'catalog_import' && styles.switchTextActive,
                ]}
              >
                📋 Bulk Catalog Paste
              </Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={[
                styles.switchBtn,
                tab === 'receipt_ocr' && styles.switchBtnActive,
              ]}
              onPress={() => setTab('receipt_ocr')}
            >
              <Text
                style={[
                  styles.switchText,
                  tab === 'receipt_ocr' && styles.switchTextActive,
                ]}
              >
                📸 Receipt OCR Scanner
              </Text>
            </TouchableOpacity>
          </View>

          <ScrollView style={styles.scrollArea}>
            {tab === 'catalog_import' ? (
              <View>
                <Text style={styles.title}>
                  Bulk Import Supplier Price List
                </Text>
                <Text style={styles.subtitle}>
                  Paste lines from a Costco Business Center, Weee!, or farm
                  co-op spreadsheet (`Name | Wholesale $ | Retail $ | Shares/Case | Unit Label`):
                </Text>

                <TextInput
                  style={styles.textArea}
                  multiline
                  value={catalogRawText}
                  onChangeText={setCatalogRawText}
                  placeholder="Item Name | 11.00 | 17.99 | 5 | 8 lb bag"
                />

                <Text style={styles.previewHeader}>
                  ⚡ LIVE PARSED PREVIEW ({previewItems.length} ITEMS READY)
                </Text>

                {previewItems.map((it) => (
                  <View key={it.id} style={styles.previewRow}>
                    <Text style={styles.previewEmoji}>{it.emoji}</Text>
                    <View style={{ flex: 1, paddingRight: 8 }}>
                      <Text style={styles.previewName}>{it.name}</Text>
                      <Text style={styles.previewMeta}>
                        {it.category} • {it.unitLabel} •{' '}
                        {it.mode === 'case_split'
                          ? `${it.caseSize} shares/case`
                          : 'Direct Wholesale'}
                      </Text>
                    </View>
                    <View style={{ alignItems: 'flex-end' }}>
                      <Text style={styles.previewPrice}>
                        ${it.unitPrice.toFixed(2)}
                      </Text>
                      <Text style={styles.previewRetail}>
                        ${it.retailPrice.toFixed(2)} retail
                      </Text>
                    </View>
                  </View>
                ))}
              </View>
            ) : (
              <View>
                <Text style={styles.title}>
                  Smart Wholesale Receipt Scanner & True-Up
                </Text>
                <Text style={styles.subtitle}>
                  Paste OCR text from your supplier register receipt (or tap
                  "Simulate Camera Scan") to auto-match catalog items and
                  update every neighbor’s split pro-rata:
                </Text>

                <TextInput
                  style={styles.textArea}
                  multiline
                  value={receiptRawText}
                  onChangeText={setReceiptRawText}
                />

                <Text style={styles.previewHeader}>
                  🧾 DETECTED RECEIPT PRICE UPDATES ({receiptPreview.matches.length}{' '}
                  MATCHED)
                </Text>

                {receiptPreview.matches.map((m) => {
                  const diff = m.newReceiptPrice - m.previousPrice;
                  return (
                    <View key={m.itemId} style={styles.previewRow}>
                      <Text style={styles.previewEmoji}>{m.emoji}</Text>
                      <View style={{ flex: 1, paddingRight: 8 }}>
                        <Text style={styles.previewName}>{m.itemName}</Text>
                        <Text style={styles.previewMeta}>
                          Quoted: ${m.previousPrice.toFixed(2)} → Receipt: $
                          {m.newReceiptPrice.toFixed(2)}
                        </Text>
                      </View>
                      <Text
                        style={[
                          styles.deltaBadge,
                          diff <= 0 ? styles.deltaDown : styles.deltaUp,
                        ]}
                      >
                        {diff <= 0
                          ? `↓ $${Math.abs(diff).toFixed(2)}`
                          : `↑ +$${diff.toFixed(2)}`}
                      </Text>
                    </View>
                  );
                })}

                <View style={styles.taxSummaryRow}>
                  <Text style={styles.taxLabel}>
                    Detected Receipt Tax / Ice / CRV Surcharge:
                  </Text>
                  <Text style={styles.taxVal}>
                    ${receiptPreview.detectedTaxOrFee.toFixed(2)}
                  </Text>
                </View>
              </View>
            )}
          </ScrollView>

          <View style={styles.actionsRow}>
            <TouchableOpacity style={styles.cancelBtn} onPress={onClose}>
              <Text style={styles.cancelBtnText}>Cancel</Text>
            </TouchableOpacity>
            {tab === 'catalog_import' ? (
              <TouchableOpacity
                style={styles.saveBtn}
                onPress={handleConfirmCatalogImport}
              >
                <Text style={styles.saveBtnText}>
                  + Import {previewItems.length} Items to Pool
                </Text>
              </TouchableOpacity>
            ) : (
              <TouchableOpacity
                style={styles.saveBtn}
                onPress={handleConfirmReceiptOcr}
              >
                <Text style={styles.saveBtnText}>
                  ✓ Apply Receipt True-Up ({receiptPreview.matches.length})
                </Text>
              </TouchableOpacity>
            )}
          </View>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
};

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(15, 23, 42, 0.55)',
    justifyContent: 'flex-end',
  },
  sheet: {
    backgroundColor: '#FFFFFF',
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    padding: 20,
    maxHeight: '90%',
  },
  switchRow: {
    flexDirection: 'row',
    backgroundColor: '#F1F5F9',
    borderRadius: 12,
    padding: 4,
    marginBottom: 14,
  },
  switchBtn: {
    flex: 1,
    paddingVertical: 8,
    alignItems: 'center',
    borderRadius: 9,
  },
  switchBtnActive: {
    backgroundColor: '#FFFFFF',
    shadowColor: '#000',
    shadowOpacity: 0.06,
    shadowRadius: 3,
    elevation: 1,
  },
  switchText: {
    fontSize: 12,
    fontWeight: '700',
    color: '#64748B',
  },
  switchTextActive: {
    color: '#0F172A',
    fontWeight: '800',
  },
  scrollArea: {
    marginBottom: 14,
  },
  title: {
    fontSize: 17,
    fontWeight: '800',
    color: '#0F172A',
  },
  subtitle: {
    fontSize: 12,
    color: '#64748B',
    marginTop: 4,
    marginBottom: 10,
    lineHeight: 17,
  },
  textArea: {
    backgroundColor: '#F8FAFC',
    borderWidth: 1,
    borderColor: '#CBD5E1',
    borderRadius: 12,
    padding: 12,
    fontSize: 12,
    color: '#0F172A',
    minHeight: 105,
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
    marginBottom: 12,
  },
  previewHeader: {
    fontSize: 10,
    fontWeight: '800',
    color: '#0D9488',
    letterSpacing: 0.6,
    marginBottom: 8,
  },
  previewRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#F8FAFC',
    borderRadius: 10,
    padding: 10,
    marginBottom: 6,
    borderWidth: 1,
    borderColor: '#E2E8F0',
  },
  previewEmoji: {
    fontSize: 20,
    marginRight: 10,
  },
  previewName: {
    fontSize: 13,
    fontWeight: '700',
    color: '#0F172A',
  },
  previewMeta: {
    fontSize: 11,
    color: '#64748B',
    marginTop: 1,
  },
  previewPrice: {
    fontSize: 14,
    fontWeight: '800',
    color: '#0F172A',
  },
  previewRetail: {
    fontSize: 10,
    color: '#94A3B8',
    textDecorationLine: 'line-through',
  },
  deltaBadge: {
    fontSize: 12,
    fontWeight: '800',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 6,
  },
  deltaDown: {
    backgroundColor: '#DCFCE7',
    color: '#15803D',
  },
  deltaUp: {
    backgroundColor: '#FEF3C7',
    color: '#B45309',
  },
  taxSummaryRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    backgroundColor: '#F0FDFA',
    padding: 12,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#99F6E4',
    marginTop: 6,
  },
  taxLabel: {
    fontSize: 12,
    fontWeight: '700',
    color: '#0F766E',
  },
  taxVal: {
    fontSize: 13,
    fontWeight: '900',
    color: '#0F766E',
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
    fontSize: 13,
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
    fontSize: 13,
    fontWeight: '800',
    color: '#FFFFFF',
  },
});
