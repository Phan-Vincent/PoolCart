import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  Linking,
} from 'react-native';
import { newId } from '../utils/poolActions';
import { Participant } from '../types/groupBuy';
import {
  DEMO_PROFILES,
  PoolRepository,
  SupabaseConfig,
  SyncStatusInfo,
} from '../services/repository';
import { getPrivacyPolicyUrl, isHostedBuild } from '../config/appMode';

interface Props {
  activeUser: Participant;
  onSelectUser: (user: Participant) => void;
  syncStatus: SyncStatusInfo;
  onConfigSaved: (config: SupabaseConfig) => Promise<void>;
  onCloudSignIn?: (
    email: string,
    password: string,
    displayName: string,
    neighborhood: string
  ) => Promise<void>;
  onCloudSignUp?: (
    email: string,
    password: string,
    displayName: string,
    neighborhood: string
  ) => Promise<void>;
  onCloudSignOut?: () => Promise<void>;
  onDeleteAccount?: () => Promise<void>;
  onFlushPendingEdits?: () => Promise<void>;
  onSimulateNeighborAction: () => void;
  onResetDemo: () => void;
}

export const SupabaseSetupCard: React.FC<Props> = ({
  activeUser,
  onSelectUser,
  syncStatus,
  onConfigSaved,
  onCloudSignIn,
  onCloudSignUp,
  onCloudSignOut,
  onDeleteAccount,
  onFlushPendingEdits,
  onSimulateNeighborAction,
  onResetDemo,
}) => {
  const existingConfig = PoolRepository.getCurrentConfig();
  const [url, setUrl] = useState(existingConfig.url);
  const [anonKey, setAnonKey] = useState(existingConfig.anonKey);
  const [confirmReset, setConfirmReset] = useState(false);
  const [customName, setCustomName] = useState('');
  const [customNeighborhood, setCustomNeighborhood] = useState('Victoria Gardens');
  const [isConnecting, setIsConnecting] = useState(false);
  const [authEmail, setAuthEmail] = useState('');
  const [authPassword, setAuthPassword] = useState('');
  const [authDisplayName, setAuthDisplayName] = useState('');
  const [authNeighborhood, setAuthNeighborhood] = useState('Victoria Gardens');
  const [authFormError, setAuthFormError] = useState('');
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleteError, setDeleteError] = useState('');
  const [isDeleting, setIsDeleting] = useState(false);
  const hosted = isHostedBuild();
  const privacyUrl = getPrivacyPolicyUrl();

  const handleDeleteAccount = async () => {
    if (!onDeleteAccount) return;
    setDeleteError('');
    setIsDeleting(true);
    try {
      await onDeleteAccount();
      setConfirmDelete(false);
    } catch (err: any) {
      setDeleteError(err?.message || String(err));
    } finally {
      setIsDeleting(false);
    }
  };

  const isCloudEnabled =
    existingConfig.enabled || syncStatus.mode !== 'local';

  useEffect(() => {
    const cfg = PoolRepository.getCurrentConfig();
    setUrl(cfg.url);
    setAnonKey(cfg.anonKey);
  }, [syncStatus.mode]);

  const handleConnectSupabase = async () => {
    if (!url.trim() || !anonKey.trim()) return;
    setIsConnecting(true);
    try {
      await onConfigSaved({
        url: url.trim(),
        anonKey: anonKey.trim(),
        enabled: true,
      });
    } finally {
      setIsConnecting(false);
    }
  };

  const handleDisconnectSupabase = async () => {
    setIsConnecting(true);
    try {
      await onConfigSaved({
        url: url.trim(),
        anonKey: anonKey.trim(),
        enabled: false,
      });
    } finally {
      setIsConnecting(false);
    }
  };

  const handleCreateCustomProfile = () => {
    if (isCloudEnabled) return;
    if (!customName.trim()) return;
    const colors = ['#0D9488', '#E11D48', '#2563EB', '#7C3AED', '#D97706', '#059669'];
    const randomColor = colors[Math.floor(Math.random() * colors.length)];
    const newProfile: Participant = {
      id: newId('u'),
      name: customName.trim(),
      neighborhood: customNeighborhood.trim() || 'Rancho Cucamonga',
      avatarColor: randomColor,
      paidStatus: 'pending',
      verifiedAuth: false,
    };
    onSelectUser(newProfile);
    setCustomName('');
  };

  const handleSignIn = async () => {
    if (!onCloudSignIn) return;
    setAuthFormError('');
    setIsConnecting(true);
    try {
      await onCloudSignIn(
        authEmail,
        authPassword,
        authDisplayName,
        authNeighborhood
      );
      setAuthPassword('');
    } catch (err: any) {
      setAuthFormError(err?.message || String(err));
    } finally {
      setIsConnecting(false);
    }
  };

  const handleSignUp = async () => {
    if (!onCloudSignUp) return;
    setAuthFormError('');
    setIsConnecting(true);
    try {
      await onCloudSignUp(
        authEmail,
        authPassword,
        authDisplayName,
        authNeighborhood
      );
      setAuthPassword('');
    } catch (err: any) {
      setAuthFormError(err?.message || String(err));
    } finally {
      setIsConnecting(false);
    }
  };

  const isErrorMode =
    syncStatus.mode === 'supabase_error' ||
    syncStatus.mode === 'supabase_auth_rejected' ||
    syncStatus.mode === 'supabase_offline';

  const isLiveOrEmptyMode =
    syncStatus.mode === 'supabase_live' ||
    syncStatus.mode === 'supabase_empty';

  return (
    <View style={styles.container}>
      {/* Live Status Banner */}
      <View
        style={[
          styles.statusBanner,
          isLiveOrEmptyMode
            ? styles.bannerLive
            : isErrorMode
            ? styles.bannerError
            : styles.bannerLocal,
        ]}
      >
        <View style={styles.statusRow}>
          <View
            style={[
              styles.statusDot,
              isLiveOrEmptyMode
                ? styles.dotLive
                : isErrorMode
                ? styles.dotError
                : styles.dotLocal,
            ]}
          />
          <Text style={styles.statusTitle}>{syncStatus.label}</Text>
        </View>

        {syncStatus.lastSyncedAt && (
          <Text style={styles.statusMeta}>
            Last checked: {syncStatus.lastSyncedAt}
            {syncStatus.lastRealtimeEvent
              ? ` • Live event: ${syncStatus.lastRealtimeEvent}`
              : ''}
          </Text>
        )}

        {(syncStatus.pendingLocalEditsCount ?? 0) > 0 && (
          <View style={styles.pendingBox}>
            <Text style={styles.pendingText}>
              ⚠️ {syncStatus.pendingLocalEditsCount} unsaved local edit(s) preserved on device. Cloud did not accept or receive them yet.
            </Text>
            {onFlushPendingEdits && (
              <TouchableOpacity
                style={styles.retryPendingBtn}
                onPress={onFlushPendingEdits}
              >
                <Text style={styles.retryPendingText}>Retry Pending Cloud Edits</Text>
              </TouchableOpacity>
            )}
          </View>
        )}

        {syncStatus.errorMessage && (
          <Text style={styles.errorText}>{syncStatus.errorMessage}</Text>
        )}
      </View>

      {/* Multi-Neighbor Identity Switcher (Strict Local Demo Only) */}
      {!hosted && (
      <View style={styles.card}>
        <Text style={styles.cardTitle}>
          👤 Local Demo Neighbor Identity (Local Mode Only)
        </Text>
        <Text style={styles.cardSub}>
          {isCloudEnabled
            ? 'Demo profile switching is disabled while cloud mode is enabled. Cloud identity is derived strictly from your authenticated Supabase session.'
            : 'Switch demo profiles on this device to test claims in local demo mode. Demo profiles are not authenticated users and are never sent to shared cloud pools.'}
        </Text>

        <View style={styles.profileGrid}>
          {DEMO_PROFILES.map((prof) => {
            const isSelected = !isCloudEnabled && prof.id === activeUser.id;
            return (
              <TouchableOpacity
                key={prof.id}
                style={[
                  styles.profilePill,
                  isSelected && styles.profilePillActive,
                  isCloudEnabled && { opacity: 0.45 },
                ]}
                onPress={() => !isCloudEnabled && onSelectUser(prof)}
                disabled={isCloudEnabled}
              >
                <View
                  style={[
                    styles.avatarDot,
                    { backgroundColor: prof.avatarColor },
                  ]}
                />
                <View style={{ flex: 1 }}>
                  <Text
                    style={[
                      styles.profileName,
                      isSelected && styles.profileNameActive,
                    ]}
                    numberOfLines={1}
                  >
                    {prof.name}
                  </Text>
                  <Text style={styles.profileHood} numberOfLines={1}>
                    {prof.neighborhood}
                  </Text>
                </View>
              </TouchableOpacity>
            );
          })}
        </View>

        {!isCloudEnabled && (
          <>
            {/* Custom Profile Creator */}
            <View style={styles.customProfileBox}>
              <Text style={styles.inputLabel}>Or Join as a New Local Demo Profile</Text>
              <View style={styles.customRow}>
                <TextInput
                  style={[styles.input, { flex: 1, marginRight: 8 }]}
                  placeholder="Your Name (e.g. Sarah J.)"
                  value={customName}
                  onChangeText={setCustomName}
                />
                <TextInput
                  style={[styles.input, { flex: 1, marginRight: 8 }]}
                  placeholder="Neighborhood"
                  value={customNeighborhood}
                  onChangeText={setCustomNeighborhood}
                />
                <TouchableOpacity
                  style={styles.createProfileBtn}
                  onPress={handleCreateCustomProfile}
                >
                  <Text style={styles.createProfileBtnText}>Use</Text>
                </TouchableOpacity>
              </View>
            </View>

            {/* Simulate Live Neighbor Activity Button */}
            <TouchableOpacity
              style={styles.simulateBtn}
              onPress={onSimulateNeighborAction}
            >
              <Text style={styles.simulateBtnText}>
                Switch to another demo neighbor
              </Text>
            </TouchableOpacity>
          </>
        )}
      </View>
      )}

      {/* Supabase Cloud Connection & Authenticated Session Setup */}
      <View style={styles.card}>
        <Text style={styles.cardTitle}>
          {hosted ? '👤 Your PoolCart Account' : '☁️ Authenticated Supabase Cloud Sync'}
        </Text>
        {!hosted && (<>
        <Text style={styles.cardSub}>
          1. Run <Text style={styles.codeInline}>supabase/schema.sql</Text> in your Supabase SQL Editor to install member-scoped RLS and transactional RPCs.{'\n'}
          2. Enter your Project URL and Anon Key below, then sign in with an authenticated Supabase user account. Sample demo fixtures are never uploaded automatically.
        </Text>

        <Text style={styles.inputLabel}>Supabase Project URL</Text>
        <TextInput
          style={styles.input}
          placeholder="https://xyzcompany.supabase.co"
          autoCapitalize="none"
          autoCorrect={false}
          value={url}
          onChangeText={setUrl}
        />

        <Text style={styles.inputLabel}>Supabase Anon / Public Key</Text>
        <TextInput
          style={styles.input}
          placeholder="eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
          autoCapitalize="none"
          autoCorrect={false}
          value={anonKey}
          onChangeText={setAnonKey}
        />

        <View style={styles.btnRow}>
          {isCloudEnabled ? (
            <TouchableOpacity
              style={styles.disconnectBtn}
              onPress={handleDisconnectSupabase}
              disabled={isConnecting}
            >
              <Text style={styles.disconnectBtnText}>
                Switch to Local Demo Mode
              </Text>
            </TouchableOpacity>
          ) : null}

          <TouchableOpacity
            style={[
              styles.connectBtn,
              (!url.trim() || !anonKey.trim()) && styles.connectBtnDisabled,
            ]}
            onPress={handleConnectSupabase}
            disabled={isConnecting || !url.trim() || !anonKey.trim()}
          >
            {isConnecting ? (
              <ActivityIndicator color="#FFFFFF" size="small" />
            ) : (
              <Text style={styles.connectBtnText}>
                {isCloudEnabled
                  ? 'Save & Refresh Cloud Sync'
                  : 'Enable Cloud Mode'}
              </Text>
            )}
          </TouchableOpacity>
        </View>
        </>)}

        {/* Cloud Auth Session Controls when Cloud Mode is Enabled */}
        {isCloudEnabled && (
          <View style={hosted ? undefined : styles.authBox}>
            {!hosted && (
              <Text style={styles.cardTitle}>
                🔐 Cloud Account Session (Server-Verified Identity)
              </Text>
            )}
            {syncStatus.authenticatedUser ? (
              <View>
                <Text style={styles.cardSub}>
                  Signed in as{' '}
                  <Text style={{ fontWeight: '800', color: '#0F766E' }}>
                    {syncStatus.authenticatedUser.name}
                  </Text>{' '}
                  ({syncStatus.authenticatedUser.email || syncStatus.authenticatedUser.id})
                </Text>
                {onCloudSignOut && (
                  <TouchableOpacity
                    style={styles.disconnectBtn}
                    onPress={onCloudSignOut}
                  >
                    <Text style={styles.disconnectBtnText}>
                      {hosted ? 'Sign Out' : 'Sign Out of Cloud Session'}
                    </Text>
                  </TouchableOpacity>
                )}
                {onDeleteAccount && (
                  <View style={styles.deleteBox}>
                    {!confirmDelete ? (
                      <TouchableOpacity
                        onPress={() => setConfirmDelete(true)}
                        accessibilityRole="button"
                      >
                        <Text style={styles.deleteLink}>Delete account…</Text>
                      </TouchableOpacity>
                    ) : (
                      <View>
                        <Text style={styles.deleteWarning}>
                          This permanently deletes your account, profile, claims, and chat messages. Pools you host are deleted for every member. In locked pools you joined, your order lines stay for the host's records under “Deleted neighbor”. This cannot be undone.
                        </Text>
                        {!!deleteError && (
                          <Text style={styles.errorText}>{deleteError}</Text>
                        )}
                        <View style={styles.btnRow}>
                          <TouchableOpacity
                            style={styles.deleteConfirmBtn}
                            onPress={handleDeleteAccount}
                            disabled={isDeleting}
                            accessibilityRole="button"
                          >
                            {isDeleting ? (
                              <ActivityIndicator color="#FFFFFF" size="small" />
                            ) : (
                              <Text style={styles.connectBtnText}>Delete permanently</Text>
                            )}
                          </TouchableOpacity>
                          <TouchableOpacity
                            style={styles.disconnectBtn}
                            onPress={() => {
                              setConfirmDelete(false);
                              setDeleteError('');
                            }}
                            disabled={isDeleting}
                          >
                            <Text style={styles.disconnectBtnText}>Cancel</Text>
                          </TouchableOpacity>
                        </View>
                      </View>
                    )}
                  </View>
                )}
                {!!privacyUrl && (
                  <TouchableOpacity
                    onPress={() => Linking.openURL(privacyUrl).catch(() => undefined)}
                    accessibilityRole="link"
                  >
                    <Text style={styles.privacyLink}>Privacy Policy</Text>
                  </TouchableOpacity>
                )}
              </View>
            ) : (
              <View>
                <Text style={styles.cardSub}>
                  Sign in or register an authenticated Supabase account. Your server UID (`auth.uid()`) determines pool membership and host permissions.
                </Text>
                <TextInput
                  style={[styles.input, { marginBottom: 8 }]}
                  placeholder="Email address"
                  autoCapitalize="none"
                  value={authEmail}
                  onChangeText={setAuthEmail}
                />
                <TextInput
                  style={[styles.input, { marginBottom: 8 }]}
                  placeholder="Password"
                  secureTextEntry
                  value={authPassword}
                  onChangeText={setAuthPassword}
                />
                <View style={styles.customRow}>
                  <TextInput
                    style={[styles.input, { flex: 1, marginRight: 8 }]}
                    placeholder="Display Name (for new account)"
                    value={authDisplayName}
                    onChangeText={setAuthDisplayName}
                  />
                  <TextInput
                    style={[styles.input, { flex: 1 }]}
                    placeholder="Neighborhood"
                    value={authNeighborhood}
                    onChangeText={setAuthNeighborhood}
                  />
                </View>
                {!!authFormError && (
                  <Text style={styles.errorText}>{authFormError}</Text>
                )}
                <View style={styles.btnRow}>
                  <TouchableOpacity
                    style={styles.connectBtn}
                    onPress={handleSignIn}
                    disabled={isConnecting || !authEmail.trim() || !authPassword}
                  >
                    <Text style={styles.connectBtnText}>Sign In to Cloud</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={styles.disconnectBtn}
                    onPress={handleSignUp}
                    disabled={
                      isConnecting ||
                      !authEmail.trim() ||
                      !authPassword ||
                      !authDisplayName.trim()
                    }
                  >
                    <Text style={styles.disconnectBtnText}>Create Account</Text>
                  </TouchableOpacity>
                </View>
              </View>
            )}
          </View>
        )}

        {!isCloudEnabled && (
          <>
            <TouchableOpacity
              style={styles.resetButton}
              onPress={() => setConfirmReset(true)}
            >
              <Text style={styles.resetButtonText}>Reset local demo pools…</Text>
            </TouchableOpacity>
            {confirmReset && (
              <View style={{ marginTop: 8 }}>
                <Text style={styles.cardSub}>
                  This replaces all local pool edits with sample data. It does not contact a cloud service.
                </Text>
                <View style={styles.btnRow}>
                  <TouchableOpacity
                    style={styles.connectBtn}
                    onPress={() => {
                      onResetDemo();
                      setConfirmReset(false);
                    }}
                  >
                    <Text style={styles.connectBtnText}>Confirm reset</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={styles.disconnectBtn}
                    onPress={() => setConfirmReset(false)}
                  >
                    <Text style={styles.disconnectBtnText}>Cancel</Text>
                  </TouchableOpacity>
                </View>
              </View>
            )}
          </>
        )}
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  deleteBox: {
    marginTop: 16,
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: '#E2E8F0',
  },
  deleteLink: {
    color: '#B91C1C',
    fontWeight: '700',
    fontSize: 13,
  },
  deleteWarning: {
    color: '#7F1D1D',
    fontSize: 12,
    lineHeight: 17,
    backgroundColor: '#FEF2F2',
    borderRadius: 10,
    padding: 10,
    marginBottom: 8,
  },
  deleteConfirmBtn: {
    flex: 1,
    backgroundColor: '#B91C1C',
    borderRadius: 10,
    paddingVertical: 11,
    alignItems: 'center',
    marginRight: 8,
  },
  privacyLink: {
    color: '#0F766E',
    textDecorationLine: 'underline',
    fontSize: 12,
    marginTop: 14,
  },
  container: {
    paddingBottom: 28,
  },
  statusBanner: {
    borderRadius: 14,
    padding: 14,
    marginBottom: 14,
    borderWidth: 1,
  },
  bannerLive: {
    backgroundColor: '#ECFDF5',
    borderColor: '#6EE7B7',
  },
  bannerLocal: {
    backgroundColor: '#F0FDFA',
    borderColor: '#99F6E4',
  },
  bannerError: {
    backgroundColor: '#FEF2F2',
    borderColor: '#FCA5A5',
  },
  statusRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  statusDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    marginRight: 8,
  },
  dotLive: {
    backgroundColor: '#10B981',
  },
  dotLocal: {
    backgroundColor: '#0D9488',
  },
  dotError: {
    backgroundColor: '#EF4444',
  },
  statusTitle: {
    fontSize: 13,
    fontWeight: '800',
    color: '#0F172A',
    flex: 1,
  },
  statusMeta: {
    fontSize: 11,
    color: '#475569',
    marginTop: 4,
    fontWeight: '600',
  },
  pendingBox: {
    marginTop: 8,
    padding: 10,
    borderRadius: 10,
    backgroundColor: '#FEF3C7',
    borderWidth: 1,
    borderColor: '#FCD34D',
  },
  pendingText: {
    fontSize: 11,
    fontWeight: '700',
    color: '#92400E',
  },
  retryPendingBtn: {
    marginTop: 6,
    alignSelf: 'flex-start',
    backgroundColor: '#92400E',
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 8,
  },
  retryPendingText: {
    color: '#FFFFFF',
    fontSize: 11,
    fontWeight: '800',
  },
  errorText: {
    fontSize: 12,
    color: '#B91C1C',
    marginTop: 6,
    fontWeight: '600',
  },
  card: {
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    padding: 16,
    marginBottom: 14,
    borderWidth: 1,
    borderColor: '#E2E8F0',
  },
  cardTitle: {
    fontSize: 15,
    fontWeight: '800',
    color: '#0F172A',
    marginBottom: 4,
  },
  cardSub: {
    fontSize: 12,
    color: '#64748B',
    lineHeight: 18,
    marginBottom: 12,
  },
  codeInline: {
    fontFamily: 'Courier',
    fontWeight: '700',
    color: '#0F766E',
  },
  profileGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  profilePill: {
    width: '48%',
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#F8FAFC',
    borderWidth: 1,
    borderColor: '#E2E8F0',
    borderRadius: 12,
    padding: 10,
  },
  profilePillActive: {
    backgroundColor: '#F0FDFA',
    borderColor: '#0D9488',
    borderWidth: 1.5,
  },
  avatarDot: {
    width: 12,
    height: 12,
    borderRadius: 6,
    marginRight: 8,
  },
  profileName: {
    fontSize: 13,
    fontWeight: '700',
    color: '#334155',
  },
  profileNameActive: {
    color: '#0F766E',
    fontWeight: '800',
  },
  profileHood: {
    fontSize: 10,
    color: '#64748B',
  },
  customProfileBox: {
    marginTop: 12,
    paddingTop: 10,
    borderTopWidth: 1,
    borderTopColor: '#F1F5F9',
  },
  customRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  createProfileBtn: {
    backgroundColor: '#0F172A',
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 10,
  },
  createProfileBtnText: {
    color: '#FFFFFF',
    fontWeight: '700',
    fontSize: 12,
  },
  simulateBtn: {
    marginTop: 12,
    backgroundColor: '#F3E8FF',
    borderWidth: 1,
    borderColor: '#D8B4FE',
    paddingVertical: 10,
    borderRadius: 10,
    alignItems: 'center',
  },
  simulateBtnText: {
    color: '#7E22CE',
    fontWeight: '800',
    fontSize: 12,
  },
  inputLabel: {
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
    paddingVertical: 9,
    fontSize: 13,
    color: '#0F172A',
  },
  btnRow: {
    flexDirection: 'row',
    gap: 8,
    marginTop: 14,
  },
  connectBtn: {
    flex: 2,
    backgroundColor: '#0D9488',
    paddingVertical: 12,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  connectBtnDisabled: {
    backgroundColor: '#94A3B8',
  },
  connectBtnText: {
    color: '#FFFFFF',
    fontWeight: '800',
    fontSize: 13,
  },
  disconnectBtn: {
    flex: 1,
    backgroundColor: '#F1F5F9',
    paddingVertical: 12,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: '#CBD5E1',
  },
  disconnectBtnText: {
    color: '#334155',
    fontWeight: '700',
    fontSize: 12,
    textAlign: 'center',
  },
  authBox: {
    marginTop: 16,
    paddingTop: 14,
    borderTopWidth: 1,
    borderTopColor: '#E2E8F0',
  },
  resetButton: {
    marginTop: 12,
    backgroundColor: '#F8FAFC',
    paddingVertical: 10,
    borderRadius: 10,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#E2E8F0',
  },
  resetButtonText: {
    fontSize: 12,
    fontWeight: '700',
    color: '#475569',
  },
});
