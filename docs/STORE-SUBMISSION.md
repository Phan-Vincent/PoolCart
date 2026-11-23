# Store submission runbook

Code-side blockers are handled in the repo: icons and splash, a hosted build mode with a sign-in gate, demo features hidden in store builds, in-app account deletion, and a privacy policy page. The steps below need your accounts, so they have to be done by you.

## 1. Production backend (Supabase) — done 2026-11-12

- Project `poolcart-prod`, ref `xvfrmivhkrlpodwsadxc`, region us-west-1, org PoolCart (free plan).
- `EXPO_PUBLIC_SUPABASE_URL` = `https://xvfrmivhkrlpodwsadxc.supabase.co`
- `EXPO_PUBLIC_SUPABASE_ANON_KEY` = the legacy **anon** key from Project Settings → API Keys. It's public by design (row-level security and server-side checks protect the data), but it's left out of this file so it can be rotated.
- `supabase/schema.sql` applied as migrations `poolcart_01`–`06`. `poolcart_06_catalog_item_validation` (2026-11-16) added the shared catalog item validator and the updated `create_pool_with_catalog` and `apply_pool_action_rpc`. The live function sources match the repo file exactly (checked by checksum). `delete_my_account` and a host → join → claim → outsider-blocked flow were exercised live as the `authenticated` role, then cleaned up.
- Advisors: performance clean. The remaining security notes list the RPCs signed-in users are meant to call.

Still to do in the dashboard:
1. **Authentication → Providers → Email**: confirm email confirmation is **on** (it is by default).
2. **Authentication → URL Configuration**: set Site URL to your website once the Vercel domain exists.
3. **Before launch:** upgrade the org to Pro. Free projects pause after about a week without activity.
4. To change the schema later, edit `supabase/schema.sql`, run `npm run test:sql`, then apply only the changed statements as a new migration.

## 2. Privacy policy and website — done 2026-11-12

- Vercel project `poolcart`, production at **https://poolcart.vercel.app**. The root is the store web build (sign-in screen, connected to `poolcart-prod`).
- Privacy policy: **https://poolcart.vercel.app/privacy**. Use this URL in both store listings and for `EXPO_PUBLIC_PRIVACY_POLICY_URL` in EAS.
- Vercel production env vars: `EXPO_PUBLIC_SUPABASE_URL`, `EXPO_PUBLIC_SUPABASE_ANON_KEY` (public config by design), `EXPO_PUBLIC_PRIVACY_POLICY_URL`.
- Redeploy after changes with `vercel deploy --prod`. `.vercelignore` keeps `qa/`, `docs/`, and `tests/` out of the upload.
- Remove the stray `EXPO_PUBLIC_TEST_PROBE` env var: `vercel env rm EXPO_PUBLIC_TEST_PROBE production` (the CLI needs you to confirm interactively).
- In Supabase: **Authentication → URL Configuration → Site URL** = `https://poolcart.vercel.app`. This is what email confirmation links point to.

### Invite links (Universal Links / App Links) — added 2026-11-17

Invites share `https://poolcart.vercel.app/join/CODE`. Neighbors without the app get the web app, which keeps the code through sign-in. With the app installed, the link opens the app instead. The old `poolcart://` scheme still works as a fallback but is no longer shared.

- `public/.well-known/apple-app-site-association` covers `/join/*` for app ID `77FQBK9E92.com.poolcart.grocerygroupbuy`. `vercel.json` serves it as `application/json`.
- `public/.well-known/assetlinks.json` lists the EAS upload keystore's SHA-256 (`BF:E7:11:…:CD:07`, from `eas credentials -p android`).
- `app.json` adds `ios.associatedDomains` and an Android `https` intent filter with `autoVerify` for `/join/`.
- If the domain changes, update all three plus `EXPO_PUBLIC_WEB_URL` (defaults to `https://poolcart.vercel.app`).

Done 2026-11-18:
- Deployed to Vercel. Both `.well-known` files return `application/json`, and `/join/CODE` loads the app's sign-in screen with "Sign in or create an account to join pool CODE". (The catch-all rewrite now targets `/`. With `cleanUrls`, the old `/index.html` target returned 404 for every path except `/` and `/privacy`.)
- iOS build 1.0.0 (7): EAS enabled Associated Domains on the App ID and updated the App Store profile `4TM96FKQ5V`. Build finished. Android build 1.0.0 (4) uses the same upload keystore listed in `assetlinks.json`.
- Supabase Redirect URLs include `https://poolcart.vercel.app/**`.

Still to do:
- Submit iOS build 7 to TestFlight and check that tapping a `/join/` link in Notes or Messages opens the app. Pasting it into Safari's address bar never opens the app.
- **After the app is created in Play Console:** copy the **App signing key** SHA-256 from Play Console → Test and release → App integrity, add it to `assetlinks.json` next to the upload key, and redeploy. Apps installed from Play are signed with Google's key, so links won't verify without it.

## 3. EAS — set up 2026-11-12

- Expo project **@phanvincent/poolcart** (ID `1dbf10f7-fe5b-4255-bd18-89b88358aab6`), owned by the personal `phanvincent` account. It can be transferred to `phanvincents-team` later from the Expo dashboard.
- EAS environment variables, all plaintext: `EXPO_PUBLIC_SUPABASE_URL`, `EXPO_PUBLIC_SUPABASE_ANON_KEY`, and `EXPO_PUBLIC_PRIVACY_POLICY_URL`, on both **production** and **preview**. **development** has none, so dev-client builds stay in local demo mode.
- `eas config --profile production` resolves the variables, bundle ID / package `com.poolcart.grocerygroupbuy`, remote build numbers with `autoIncrement`, and environment `production`.

Builds (iOS asks for your Apple Developer login the first time and creates the certificates and provisioning profile; Android generates an upload keystore that EAS stores):

```bash
eas build --platform ios --profile production
eas submit --platform ios      # uploads to App Store Connect / TestFlight
eas build --platform android --profile production
eas submit --platform android  # first upload must be done manually in Play Console
```

Builds without the two Supabase variables run as the local demo, so check that the TestFlight build opens on the sign-in screen.

### Build and signing status (2026-11-14)

- **iOS:** Apple team Vincent Phan (Individual) `77FQBK9E92`. EAS-managed distribution certificate and App Store provisioning profile, both valid until 2027-11-14. Build 1.0.0 (5) was submitted to App Store Connect app **6834996608** (pinned as `ascAppId` in `eas.json`). The TestFlight group "Team (Expo)" includes phanvincent2@gmail.com. An ASC API key is stored on EAS, so `eas submit --platform ios --latest` no longer needs your password.
- **Android:** EAS-managed upload keystore. Production `.aab` 1.0.0 (2) is built but not yet uploaded; the first upload goes through Play Console → Internal testing by hand. `eas build -p android --profile preview` makes a sideloadable `.apk` against the production backend.
- **Don't delete** the keystore or certificates in the Expo dashboard. Play requires every update to be signed with the same upload key.

## 4. Accounts, reviewer demo pool, and store review notes

- Apple Developer Program ($99/yr) and Google Play Console ($25 once).
- Create the app records with bundle ID / package `com.poolcart.grocerygroupbuy`.
- Screenshots: iPhone 6.9" and 6.5" (iPad not needed; `supportsTablet` is false) and Android phone.

### 4A. Create the reviewer account & seed pool in `poolcart-prod`

1. In Supabase Dashboard → **Authentication → Users → Add user → Create new user**:
   - **Email:** `reviewer@poolcart.app`
   - **Password:** `PoolCartReview2026!`
   - **Auto Confirm User:** **Checked (ON)**
2. In Supabase Dashboard → **SQL Editor**, run this idempotent block to seed the `REVIEW-01` sample pool for `reviewer@poolcart.app` (with a 5/6 case-split item ready to lock on a single `+` tap, plus a direct item and a neighbor wishlist request):

```sql
do $$
declare
  v_reviewer_id text;
begin
  select id::text into v_reviewer_id
  from auth.users
  where lower(email) = 'reviewer@poolcart.app'
  limit 1;

  if v_reviewer_id is null then
    raise exception 'Create confirmed user reviewer@poolcart.app in Authentication -> Users first.';
  end if;

  perform set_config('request.jwt.claim.sub', v_reviewer_id, true);
  perform set_config('request.jwt.claim.email', 'reviewer@poolcart.app', true);

  perform public.upsert_my_profile('App Reviewer (Host)', 'Victoria Gardens', '#0D9488');

  delete from public.pools where id = 'pool_app_review_01' or upper(join_code) = 'REVIEW-01';

  perform public.create_pool_with_catalog(jsonb_build_object(
    'id', 'pool_app_review_01',
    'joinCode', 'REVIEW-01',
    'title', 'Victoria Gardens Wholesale Co-Op',
    'supplierName', 'Restaurant Depot & Local Farms',
    'supplierBadge', 'Wholesale Direct • Case Split',
    'category', 'Produce & Pantry',
    'hostName', 'App Reviewer (Host)',
    'hostVenmoHandle', '@PoolCart-Host',
    'neighborhood', 'Victoria Gardens',
    'distanceMiles', 0.4,
    'pickupAddress', '12505 North Mainstreet, Rancho Cucamonga, CA 91739',
    'pickupWindow', 'Saturday 10:00 AM – 1:00 PM',
    'cutoffTime', 'Friday 6:00 PM',
    'minimumOrderAmount', 120,
    'deliveryFee', 15,
    'freeDeliveryThreshold', 180,
    'items', jsonb_build_array(
      jsonb_build_object(
        'id', 'rev_item_avocados',
        'name', 'Organic Hass Avocados (48-ct Case)',
        'category', 'Produce',
        'emoji', '🥑',
        'mode', 'case_split',
        'unitLabel', '1 bag (8 avocados)',
        'unitPrice', 11.50,
        'retailPrice', 16.99,
        'caseSize', 6,
        'maxCases', 3,
        'claims', jsonb_build_array(
          jsonb_build_object('userId', v_reviewer_id, 'quantity', 5)
        )
      ),
      jsonb_build_object(
        'id', 'rev_item_jasmine_rice',
        'name', 'Three Ladies Jasmine Rice (25 lb Sack)',
        'category', 'Staples',
        'emoji', '🍚',
        'mode', 'individual',
        'unitLabel', '1 sack (25 lb)',
        'unitPrice', 24.00,
        'retailPrice', 34.99,
        'claims', jsonb_build_array(
          jsonb_build_object('userId', v_reviewer_id, 'quantity', 3)
        )
      ),
      jsonb_build_object(
        'id', 'rev_item_olive_oil',
        'name', 'California Extra Virgin Olive Oil (6 x 1L Case)',
        'category', 'Pantry',
        'emoji', '🫒',
        'mode', 'case_split',
        'unitLabel', '1 bottle (1L)',
        'unitPrice', 13.00,
        'retailPrice', 19.50,
        'caseSize', 6,
        'maxCases', 2,
        'claims', '[]'::jsonb
      )
    ),
    'messages', jsonb_build_array(
      jsonb_build_object(
        'id', 'rev_msg_welcome',
        'isAnnouncement', true,
        'text', 'Welcome to the Victoria Gardens weekly wholesale pool! Tap + on Organic Hass Avocados (currently 5/6 shares) to complete Case #1 and meet the $120 wholesale minimum.',
        'createdAt', 'Pinned'
      )
    )
  ));
end $$;
```

### 4B. Copy-pasteable App Store Connect & Google Play Review Notes

- **Sign-In Credentials:**
  - **Email:** `reviewer@poolcart.app`
  - **Password:** `PoolCartReview2026!`
  - **Sample Pool Invite Code:** `REVIEW-01` (already joined on this account; can also be joined from any new account via **🔑 Code → REVIEW-01**)

- **Review Notes Text (paste into App Store Connect → App Review Information → Notes & Google Play Console → App content → App access):**

> PoolCart is a neighborhood grocery group-buying and bulk case-splitting coordination app.
>
> 1. **Sign In:** Use `reviewer@poolcart.app` / `PoolCartReview2026!` on the sign-in screen (or create a new account and tap **🔑 Code** in the top header to join invite code `REVIEW-01`).
> 2. **Test Case-Splitting & Order Pooling:** Open **Victoria Gardens Wholesale Co-Op (`REVIEW-01`)**. On the **🛒 Shop** tab, tap **+** on *Organic Hass Avocados* (pre-set at 5/6 shares) to lock Case #1 (6/6 shares) and cross the $120 wholesale order minimum.
> 3. **Test Split Ledger & Host Sheet:** Open the **💸 Splits** and **📋 Host** tabs to inspect per-neighbor pro-rata cost breakdowns, receipt true-up, and pool lock controls. No in-app payments or card charges are processed in the app; neighbors settle externally in person or via Venmo deep link.
> 4. **In-App Account Deletion (Guideline 5.1.1(v)):** Open the **⚡ Sync** tab at the bottom right, scroll to the **Account** section, and tap **Delete Account** (with confirmation dialog) to permanently delete the signed-in account and its associated data.

## 5. Privacy questionnaires

Data collected (all linked to the user, none used for tracking, none shared for ads):

| Apple category | Google Data safety | Purpose |
| --- | --- | --- |
| Contact Info → Email Address | Personal info → Email address | App functionality, account management |
| Contact Info → Name (display name) | Personal info → Name | App functionality |
| Contact Info → Physical Address (pickup address, entered by hosts) | Personal info → Address | App functionality |
| User Content → Other User Content (chat, wishlist) | Messages → Other in-app messages | App functionality |
| Purchases → Purchase History (claims, amounts due) | Financial info → Purchase history | App functionality |
| Identifiers → User ID | Personal info → User IDs | App functionality |

- Tracking: **No**. No analytics or ad SDKs.
- Data encrypted in transit: **Yes**. Users can request deletion: **Yes**, in-app (Account → Delete account).
- Google Play also requires a **web** deletion path. The privacy policy's email fallback covers it; link the policy's "Retention and deletion" section in the Data safety form.

## Still open after this (not store blockers)

- Password reset ("Forgot password?") flow.
- Push notifications for case completion and pickup reminders.
- Real QR code on the invite flyer (needs `react-native-svg` + a QR library).
- Crash reporting (for example Sentry).
- Replace the generated placeholder icon in `assets/` with final artwork if desired.
