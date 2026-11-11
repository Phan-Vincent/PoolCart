# PoolCart — Grocery Group Buy Mobile App (Expo + React Native)

PoolCart is a cross-platform mobile application (iOS, Android, and Web via Expo) built for **pooling neighborhood grocery orders to hit wholesale/delivery minimums** AND **splitting bulk cases** (like a 6-pack of barista oat milk or a 50 lb sack of jasmine rice) across neighbors.

## Why Start With This Architecture?

1. **Order Pooling + Case Splitting Hybrid**:
   - **Direct Wholesale Items (`individual` mode)**: Neighbors order full units (e.g., a 12-count bag of avocados or a 30-egg flat) that combine toward the supplier's **$250 minimum order** and **$300 free delivery tier**.
   - **Bulk Case Splits (`case_split` mode)**: Neighbors claim individual shares of a bulk wholesale case (e.g., 1 carton out of a 6-pack case). Visual slot bars track how many shares are claimed (`4/6 claimed`) and automatically roll completed cases into the pool total.
2. **Pragmatic Backend Path (Local-First $\rightarrow$ Supabase)**:
   - **Right now (Zero Setup)**: Uses `AsyncStorage` (`src/services/repository.ts`) so you can run the app immediately, test adding items, claim shares, and mark neighbors as paid without configuring cloud keys.
   - **When inviting real neighbors**: Run `supabase/schema.sql` in a free [Supabase](https://supabase.com/) project and add `EXPO_PUBLIC_SUPABASE_URL` and `EXPO_PUBLIC_SUPABASE_ANON_KEY` to a `.env` file. Supabase gives you Postgres relational integrity (preventing two people from claiming the last share of a case at the same time) plus **Supabase Realtime** so the wholesale progress bar updates live on everyone's phone.

## Project Structure

- `App.tsx` — Main mobile screen with pool switcher, live wholesale minimum progress, item filters, and sticky personal cart bar.
- `src/types/groupBuy.ts` — TypeScript domain models for pools, wholesale items, case splits, and settlement ledgers.
- `src/utils/calculations.ts` — Core math engine for wholesale minimum progress, free delivery fee waivers, case-split matching, and per-neighbor cost breakdowns.
- `src/components/PoolProgressCard.tsx` — Visual tracker for the supplier order minimum, free delivery threshold, per-person delivery split, and total group savings.
- `src/components/CatalogItemCard.tsx` — Item card supporting both direct wholesale units and visual slot bars for bulk case splits.
- `src/components/SplitLedgerView.tsx` — Host pickup logistics and itemized per-neighbor cost split & payment status tracker.
- `src/components/ActionModals.tsx` — Modals for pitching new items/case splits to a pool and hosting a new neighborhood group buy.
- `src/services/repository.ts` — Storage adapter supporting local `AsyncStorage` out-of-the-box and optional Supabase cloud sync.
- `supabase/schema.sql` — Ready-to-run PostgreSQL schema with Realtime publications enabled.

## Running the App

```bash
cd "/Users/vincentphan/grocery groupbuy"
npm install
npx expo start
```

- Press **`i`** to open in the iOS Simulator, **`a`** for Android Emulator, **`w`** for Web, or scan the QR code with the **Expo Go** app on your phone.
