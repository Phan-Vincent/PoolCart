# Store submission runbook

Code-side blockers are handled in the repo: icons and splash, a hosted build mode with a sign-in gate, demo features hidden in store builds, in-app account deletion, and a privacy policy page. The steps below need your accounts, so they have to be done by you.

## 1. Production backend (Supabase)

1. Create a production Supabase project (separate from any test project).
2. In **SQL Editor**, run `supabase/schema.sql`. It can be re-run safely; `npm run test:sql` applies it twice to a local Postgres to confirm that.
3. **Authentication → Providers → Email**: keep email confirmation **on**.
4. **Authentication → URL Configuration**: set Site URL to your website (for example the Vercel domain).
5. Copy the **Project URL** and **anon/public key** from Project Settings → API.

## 2. Privacy policy

1. Fill in the highlighted `[DATE]`, `[OPERATOR NAME]`, and `[CONTACT EMAIL]` placeholders in `public/privacy.html`.
2. Deploy the web export to Vercel (`vercel.json` is already set up). The page is served at `/privacy`.
3. Use that URL for `EXPO_PUBLIC_PRIVACY_POLICY_URL` and in both store listings.

## 3. EAS

```bash
npm install -g eas-cli
eas login
eas init                      # writes owner + extra.eas.projectId into app.json
eas env:create --environment production --name EXPO_PUBLIC_SUPABASE_URL --value https://<project>.supabase.co --visibility plaintext
eas env:create --environment production --name EXPO_PUBLIC_SUPABASE_ANON_KEY --value <anon key> --visibility plaintext
eas env:create --environment production --name EXPO_PUBLIC_PRIVACY_POLICY_URL --value https://<domain>/privacy --visibility plaintext
```

Repeat the `env:create` lines with `--environment preview` for internal test builds.

```bash
eas build --platform ios --profile production
eas submit --platform ios      # uploads to App Store Connect / TestFlight
eas build --platform android --profile production
eas submit --platform android  # first upload must be done manually in Play Console
```

Builds without the two Supabase variables run as the local demo, so check that the TestFlight build opens on the sign-in screen.

## 4. Accounts and listings

- Apple Developer Program ($99/yr) and Google Play Console ($25 once).
- Create the app records with bundle ID / package `com.poolcart.grocerygroupbuy`.
- Screenshots: iPhone 6.9" and 6.5" (iPad not needed; `supportsTablet` is false) and Android phone.
- **Reviewer account**: create a confirmed account in the production project, host one sample pool with a couple of items, and put the credentials and the pool's invite code in App Review notes and Play's App access section.

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
