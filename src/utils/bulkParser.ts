import { CatalogItem, Participant } from '../types/groupBuy';

export interface ParsedReceiptMatch {
  itemId: string;
  itemName: string;
  emoji: string;
  previousPrice: number;
  newReceiptPrice: number;
}

const EMOJI_KEYWORDS: { keywords: string[]; emoji: string; category: string }[] = [
  { keywords: ['avocado', 'strawberr', 'apple', 'lettuce', 'spinach', 'berry', 'produce', 'mango', 'tomato'], emoji: '🥑', category: 'Produce' },
  { keywords: ['milk', 'oat', 'butter', 'cheese', 'yogurt', 'cream', 'egg'], emoji: '🥛', category: 'Dairy & Eggs' },
  { keywords: ['beef', 'wagyu', 'brisket', 'ribeye', 'pork', 'chicken', 'meat', 'steak'], emoji: '🥩', category: 'Meat & Seafood' },
  { keywords: ['scallop', 'shrimp', 'salmon', 'fish', 'seafood', 'crab'], emoji: '🐚', category: 'Meat & Seafood' },
  { keywords: ['rice', 'flour', 'grain', 'oat', 'noodle', 'pasta', 'bread'], emoji: '🌾', category: 'Grains & Staples' },
  { keywords: ['dumpling', 'gyoza', 'frozen', 'bun', 'ice'], emoji: '🥟', category: 'Frozen' },
  { keywords: ['oil', 'honey', 'sauce', 'chili', 'pantry', 'spice'], emoji: '🫒', category: 'Pantry' },
  { keywords: ['water', 'kombucha', 'tea', 'coffee', 'drink', 'juice'], emoji: '🫧', category: 'Beverages' },
];

function inferEmojiAndCategory(name: string): { emoji: string; category: string } {
  const lower = name.toLowerCase();
  for (const entry of EMOJI_KEYWORDS) {
    if (entry.keywords.some((kw) => lower.includes(kw))) {
      return { emoji: entry.emoji, category: entry.category };
    }
  }
  return { emoji: '📦', category: 'Wholesale Bulk' };
}

/**
 * Track #2A: Parses pasted supplier price list lines into structured `CatalogItem` objects.
 * Supports flexible formats such as:
 * - "Organic Fuji Apples (40 lb Case) | $12.50 | $18.99 | 4 | 8 lb share"
 * - "Kirkland Almond Flour 3 lb, 11.00, 16.50, 1, 3 lb bag"
 * - "Oatly Barista 6-Pack Case - $3.25 ($5.49 retail) x6"
 */
export function parseBulkCatalogText(
  rawText: string,
  creator: Participant
): CatalogItem[] {
  const lines = rawText
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.length > 2 && !l.startsWith('#') && !l.startsWith('//'));

  const nowTs = Date.now();
  const parsedItems: CatalogItem[] = [];

  lines.forEach((line, idx) => {
    // Check pipe or comma separated format first: Name | UnitPrice | RetailPrice | CaseSize | UnitLabel
    const parts = line.includes('|')
      ? line.split('|').map((p) => p.trim())
      : line.split(',').map((p) => p.trim());

    if (parts.length >= 2) {
      const rawName = parts[0].replace(/^[-•*]\s*/, '').trim();
      const unitPrice = parseFloat(parts[1].replace(/[^0-9.]/g, '')) || 10.0;
      const retailPrice =
        parts[2] && parseFloat(parts[2].replace(/[^0-9.]/g, ''))
          ? parseFloat(parts[2].replace(/[^0-9.]/g, ''))
          : Number((unitPrice * 1.45).toFixed(2));
      const caseSizeNum =
        parts[3] && parseInt(parts[3].replace(/[^0-9]/g, ''), 10)
          ? parseInt(parts[3].replace(/[^0-9]/g, ''), 10)
          : 1;
      const unitLabel =
        parts[4] ||
        (caseSizeNum > 1 ? `1 share (1/${caseSizeNum} case)` : '1 wholesale unit');

      const { emoji, category } = inferEmojiAndCategory(rawName);
      const isCaseSplit = caseSizeNum > 1;

      parsedItems.push({
        id: `item_import_${nowTs}_${idx}`,
        name: rawName,
        category,
        emoji,
        mode: isCaseSplit ? 'case_split' : 'individual',
        unitLabel,
        unitPrice,
        retailPrice,
        caseSize: isCaseSplit ? caseSizeNum : undefined,
        claims:
          idx === 0
            ? [
                {
                  userId: creator.id,
                  userName: creator.name,
                  avatarColor: creator.avatarColor,
                  quantity: 1,
                },
              ]
            : [],
      });
      return;
    }

    // Fallback free-text parser: e.g. "Organic Strawberries $13.50"
    const priceMatches = line.match(/\$?\d+(?:\.\d{1,2})?/g);
    const unitPrice =
      priceMatches && priceMatches[0]
        ? parseFloat(priceMatches[0].replace('$', ''))
        : 12.0;
    const retailPrice =
      priceMatches && priceMatches[1]
        ? parseFloat(priceMatches[1].replace('$', ''))
        : Number((unitPrice * 1.45).toFixed(2));

    const cleanName = line
      .replace(/\$?\d+(?:\.\d{1,2})?/g, '')
      .replace(/[-|•*]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();

    const { emoji, category } = inferEmojiAndCategory(cleanName || line);

    parsedItems.push({
      id: `item_import_${nowTs}_${idx}`,
      name: cleanName || `Wholesale Item #${idx + 1}`,
      category,
      emoji,
      mode: 'individual',
      unitLabel: '1 wholesale unit',
      unitPrice,
      retailPrice,
      claims: [],
    });
  });

  return parsedItems;
}

/**
 * Track #2B: Matches pasted wholesale register receipt lines against the active pool's
 * catalog items and extracts actual unit prices + extra tax/CRV/weight fees for Receipt True-Up.
 */
export function parseReceiptTrueUpText(
  rawText: string,
  catalogItems: CatalogItem[]
): {
  matches: ParsedReceiptMatch[];
  detectedTaxOrFee: number;
} {
  const lines = rawText
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.length > 0);

  const matches: ParsedReceiptMatch[] = [];
  let detectedTaxOrFee = 0;

  lines.forEach((line) => {
    const lower = line.toLowerCase();
    const priceMatches = line.match(/\$?\d+(?:\.\d{1,2})?/g);
    const lastNumber =
      priceMatches && priceMatches.length > 0
        ? parseFloat(priceMatches[priceMatches.length - 1].replace('$', ''))
        : null;

    if (lastNumber === null || isNaN(lastNumber)) return;

    if (
      lower.includes('tax') ||
      lower.includes('crv') ||
      lower.includes('ice') ||
      lower.includes('bag fee') ||
      lower.includes('surcharge')
    ) {
      detectedTaxOrFee += lastNumber;
      return;
    }

    // Match against catalog item keywords
    for (const item of catalogItems) {
      const words = item.name
        .toLowerCase()
        .replace(/[^a-z0-9 ]/g, '')
        .split(' ')
        .filter((w) => w.length >= 4);

      const isMatch = words.some((w) => lower.includes(w));
      if (isMatch && !matches.some((m) => m.itemId === item.id)) {
        matches.push({
          itemId: item.id,
          itemName: item.name,
          emoji: item.emoji,
          previousPrice: item.unitPrice,
          newReceiptPrice: lastNumber,
        });
        break;
      }
    }
  });

  return {
    matches,
    detectedTaxOrFee: Number(detectedTaxOrFee.toFixed(2)),
  };
}

export const SAMPLE_BULK_CATALOG_TEXT = `Organic Honeycrisp Apples (40 lb Case) | 11.00 | 17.99 | 5 | 8 lb bag (1/5 case)
Wildflower Raw Local Honey (4-Jar Case) | 13.50 | 21.99 | 4 | 32 oz glass jar
Pasture-Raised Greek Yogurt (6-Tub Case) | 4.75 | 7.99 | 6 | 32 oz tub
Artisanal Sourdough Batard ( Bakery Flat ) | 5.50 | 9.50 | 1 | 1 fresh loaf`;

export const SAMPLE_RECEIPT_OCR_TEXT = `VALLEY HARVEST WHOLESALE REGISTER RECEIPT
Organic Hass Avocados (Dock Price Drop) $10.25
Barista Organic Oat Milk (Unit Share) $3.00
Pasture-Raised Heirloom Eggs $11.50
Cold-Pressed California Olive Oil $17.50
Cold Pack Ice & Box CRV Tax $4.50`;
