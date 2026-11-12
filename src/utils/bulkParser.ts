import { CatalogItem, Participant } from '../types/groupBuy';
import { requireNumber } from './poolActions';

export interface ParsedReceiptMatch {
  itemId: string; itemName: string; emoji: string; previousPrice: number; newReceiptPrice: number;
}
export interface ParseIssue { line: number; message: string; }
const categoryRules: [RegExp, string, string][] = [
  [/\b(avocados?|apples?|lettuce|spinach|berries|strawberries|mango|tomato)\b/i, '🥑', 'Produce'],
  [/\b(milk|butter|cheese|yogurt|cream|eggs?)\b/i, '🥛', 'Dairy & Eggs'],
  [/\b(beef|pork|chicken|meat|steak|scallops?|shrimp|salmon|fish)\b/i, '🥩', 'Meat & Seafood'],
  [/\b(rice|flour|grains?|oats?|noodles?|pasta|bread)\b/i, '🌾', 'Grains & Staples'],
  [/\b(dumplings?|gyoza|frozen)\b/i, '🥟', 'Frozen'],
  [/\b(oil|honey|sauce|chili|pantry|spice)\b/i, '🫒', 'Pantry'],
];
function decimal(raw: string, label: string, min = 0.01): number {
  const clean = raw.trim().replace(/^\$/, '');
  if (!/^\d+(?:\.\d{1,2})?$/.test(clean)) throw new Error(`${label}: use an unsigned amount with at most two decimal places (no thousands separators).`);
  return requireNumber(Number(clean), label, min);
}
function lines(raw: string) {
  if (raw.length > 100_000) throw new Error('Paste at most 100,000 characters.');
  const rows = raw.split(/\r?\n/).map((text, i) => ({ text: text.trim(), line: i + 1 })).filter((r) => r.text && !/^(#|\/\/)/.test(r.text));
  if (rows.length > 200) throw new Error('Paste at most 200 non-comment lines.');
  return rows;
}
export function parseBulkCatalog(raw: string): { items: CatalogItem[]; errors: ParseIssue[] } {
  const items: CatalogItem[] = []; const errors: ParseIssue[] = [];
  let rows: ReturnType<typeof lines>;
  try { rows = lines(raw); } catch (error) { return { items, errors: [{ line: 0, message: String(error) }] }; }
  for (const row of rows) {
    try {
      if (/^name\s*[|,]\s*(?:unit|wholesale)/i.test(row.text)) continue;
      let name: string, unitPrice: number, retailPrice: number, caseSize = 1, unitLabel = '1 wholesale unit';
      if (row.text.includes('|') || row.text.includes(',')) {
        const parts = row.text.split(row.text.includes('|') ? '|' : ',').map((part) => part.trim());
        if (parts.length < 2 || parts.length > 5 || parts.some((p) => p.includes('"'))) throw new Error('Use 2–5 plain columns: Name | Unit $ | Retail $ | Shares/case | Unit label.');
        name = parts[0]; unitPrice = decimal(parts[1], 'Unit price');
        retailPrice = parts[2] ? decimal(parts[2], 'Retail price') : unitPrice;
        if (parts[3]) {
          if (!/^\d+$/.test(parts[3])) throw new Error('Shares per case must be a whole number.');
          caseSize = requireNumber(Number(parts[3]), 'Shares per case', 1, true, 1000);
        }
        unitLabel = parts[4] || (caseSize > 1 ? `1 share (1/${caseSize} case)` : unitLabel);
      } else {
        const match = row.text.match(/^(.+?)\s+\$(\d+(?:\.\d{1,2})?)$/);
        if (!match || /\$/.test(match[1])) throw new Error('Use explicit columns, or Item Name $unit-price. Prices are never guessed from package sizes.');
        name = match[1].trim(); unitPrice = decimal(match[2], 'Unit price'); retailPrice = unitPrice;
      }
      if (!name || name.length > 200) throw new Error('Item name must contain 1–200 characters.');
      const category = categoryRules.find(([pattern]) => pattern.test(name));
      items.push({ id: `preview_${row.line}`, name, emoji: category?.[1] ?? '📦', category: category?.[2] ?? 'Wholesale Bulk', mode: caseSize > 1 ? 'case_split' : 'individual', unitLabel, unitPrice, retailPrice, caseSize: caseSize > 1 ? caseSize : undefined, claims: [] });
    } catch (error) { errors.push({ line: row.line, message: error instanceof Error ? error.message : String(error) }); }
  }
  if (items.length > 200) errors.push({ line: 0, message: 'Import at most 200 items at a time.' });
  return { items, errors };
}
// Retained compatibility API; callers requiring diagnostics use parseBulkCatalog.
export function parseBulkCatalogText(raw: string, _creator?: Participant): CatalogItem[] {
  const result = parseBulkCatalog(raw);
  if (result.errors.length) throw new Error(result.errors.map((e) => `Line ${e.line}: ${e.message}`).join('\n'));
  return result.items;
}
const genericWords = new Set(['organic', 'wholesale', 'bulk', 'case', 'split', 'share', 'pack', 'unit', 'bag', 'box', 'local', 'fresh', 'price', 'drop']);
function tokens(text: string): string[] {
  return text.toLowerCase().replace(/\([^)]*\)/g, ' ').match(/[a-z]+/g)?.filter((word) => word.length >= 3 && !genericWords.has(word)) ?? [];
}
export function parseReceiptTrueUpText(raw: string, catalog: CatalogItem[]): {
  matches: ParsedReceiptMatch[]; detectedTaxOrFee: number; errors: ParseIssue[];
} {
  const matches: ParsedReceiptMatch[] = []; const errors: ParseIssue[] = []; let feeCents = 0;
  let rows: ReturnType<typeof lines>;
  try { rows = lines(raw); } catch (error) { return { matches, detectedTaxOrFee: 0, errors: [{ line: 0, message: String(error) }] }; }
  for (const row of rows) {
    try {
      if (/^(?:subtotal|grand total|total|date|receipt|valley harvest wholesale register receipt)\b/i.test(row.text)) continue;
      const fee = row.text.match(/^(?:sales tax|tax|crv|ice fee|bag fee|surcharge|cold pack ice & box crv tax)\s*[:=]?\s+\$?(\d+(?:\.\d{1,2})?)$/i);
      if (fee) { feeCents += Math.round(decimal(fee[1], 'Receipt fee', 0) * 100); continue; }
      const match = row.text.match(/^(.+?)\s+@\s*\$?(\d+(?:\.\d{1,2})?)(?:\s*\/unit)?$/i);
      if (!match) throw new Error('Use Item Name @ $unit-price /unit; line totals and quantities cannot be safely inferred. Use Tax $amount for fees.');
      const words = new Set(tokens(match[1]));
      if (!words.size) throw new Error('Item name is too generic to match.');
      const candidates = catalog.filter((item) => {
        const itemWords = new Set(tokens(item.name));
        return [...words].every((word) => itemWords.has(word));
      });
      if (candidates.length !== 1) throw new Error(candidates.length ? 'Ambiguous item name: use its full catalog name.' : 'No catalog item matched this line.');
      const item = candidates[0];
      if (matches.some((m) => m.itemId === item.id)) throw new Error('Duplicate receipt entry for this item.');
      matches.push({ itemId: item.id, itemName: item.name, emoji: item.emoji, previousPrice: item.actualUnitPrice ?? item.unitPrice, newReceiptPrice: decimal(match[2], 'Actual unit price') });
    } catch (error) { errors.push({ line: row.line, message: error instanceof Error ? error.message : String(error) }); }
  }
  if (feeCents > 100_000_000) errors.push({ line: 0, message: 'Receipt fees exceed the supported amount.' });
  return { matches, detectedTaxOrFee: feeCents / 100, errors };
}
export const SAMPLE_BULK_CATALOG_TEXT = `Organic Honeycrisp Apples (40 lb Case) | 11.00 | 17.99 | 5 | 8 lb bag (1/5 case)
Wildflower Raw Local Honey (4-Jar Case) | 13.50 | 21.99 | 4 | 32 oz glass jar
Pasture-Raised Greek Yogurt (6-Tub Case) | 4.75 | 7.99 | 6 | 32 oz tub
Artisanal Sourdough Batard | 5.50 | 9.50 | 1 | 1 fresh loaf`;
export const SAMPLE_RECEIPT_OCR_TEXT = `# Enter actual per-share prices, not case totals.
Organic Hass Avocados @ $10.25 /unit
Barista Organic Oat Milk @ $3.00 /unit
Pasture-Raised Heirloom Eggs @ $11.50 /unit
Cold-Pressed California Olive Oil @ $17.50 /unit
Tax $4.50`;
