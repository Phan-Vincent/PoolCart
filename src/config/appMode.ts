/**
 * Release-mode switches.
 *
 * A build that has EXPO_PUBLIC_SUPABASE_URL and EXPO_PUBLIC_SUPABASE_ANON_KEY
 * baked in is a "hosted" build: everyone uses the one PoolCart backend, the
 * app requires sign-in, and local demo features (sample pools, demo profile
 * switching, simulated card holds, the editable Supabase URL/key form) are
 * hidden. Builds without those variables keep the local demo experience for
 * development.
 *
 * Expo inlines `process.env.EXPO_PUBLIC_*` at bundle time, so these must be
 * read with literal property access.
 */
declare const process: { env: Record<string, string | undefined> };

export interface HostedCloudConfig {
  url: string;
  anonKey: string;
}

export function getHostedCloudConfig(): HostedCloudConfig | null {
  const url = (process.env.EXPO_PUBLIC_SUPABASE_URL || '').trim();
  const anonKey = (process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY || '').trim();
  if (!url || !anonKey) return null;
  return { url, anonKey };
}

/** True when this build talks to the bundled production backend only. */
export function isHostedBuild(): boolean {
  return getHostedCloudConfig() !== null;
}

/** Public URL of the privacy policy shown on the sign-in and account screens. */
export function getPrivacyPolicyUrl(): string {
  return (process.env.EXPO_PUBLIC_PRIVACY_POLICY_URL || '').trim();
}
