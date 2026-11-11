import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
} from 'react-native';
import { Participant } from '../types/groupBuy';
import {
  DEMO_PROFILES,
  PoolRepository,
  SupabaseConfig,
} from '../services/repository';

interface Props {
  activeUser: Participant;
  onSelectUser: (user: Participant) => void;
  syncStatus: {
    mode: 'local' | 'supabase_live' | 'supabase_error';
    lastSyncedAt: string | null;
    errorMessage?: string;
    lastRealtimeEvent?: string | null;
  };
  onConfigSaved: (config: SupabaseConfig) => Promise<void>;
  onSimulateNeighborAction: () => void;
  onResetDemo: () => void;
}

export const SupabaseSetupCard: React.FC<Props> = ({
  activeUser,
  onSelectUser,
  syncStatus,
  onConfigSaved,
  onSimulateNeighborAction,
  onResetDemo,
}) => {
  const existingConfig = PoolRepository.getCurrentConfig();
  const [url, setUrl] = useState(existingConfig.url);
  const [anonKey, setAnonKey] = useState(existingConfig.anonKey);
  const [customName, setCustomName] = useState('');
  const [customNeighborhood, setCustomNeighborhood] = useState('Victoria Gardens');
  const [isConnecting, setIsConnecting] = useState(false);

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
    if (!customName.trim()) return;
    const colors = ['#0D9488', '#E11D48', '#2563EB', '#7C3AED', '#D97706', '#059669'];
    const randomColor = colors[Math.floor(Math.random() * colors.length)];
    const newProfile: Participant = {
      id: `u_${customName.trim().toLowerCase().replace(/[^a-z0-9]/g, '_')}_${Date.now().toString().slice(-3)}`,
      name: customName.trim(),
      neighborhood: customNeighborhood.trim() || 'Rancho Cucamonga',
      avatarColor: randomColor,
      paidStatus: 'pending',
    };
    onSelectUser(newProfile);
    setCustomName('');
  };

  return (
    <View style={styles.container}>
      {/* Live Status Banner */}
      <View
        style={[
          styles.statusBanner,
          syncStatus.mode === 'supabase_live'
            ? styles.bannerLive
            : syncStatus.mode === 'supabase_error'
            ? styles.bannerError
            : styles.bannerLocal,
        ]}
      >
        <View style={styles.statusRow}>
          <View
            style={[
              styles.statusDot,
              syncStatus.mode === 'supabase_live'
                ? styles.dotLive
                : syncStatus.mode === 'supabase_error'
                ? styles.dotError
                : styles.dotLocal,
            ]}
          />
          <Text style={styles.statusTitle}>
            {syncStatus.mode === 'supabase_live'
              ? 'Supabase Realtime Connected (Live Multi-Neighbor Sync)'
              : syncStatus.mode === 'supabase_error'
              ? 'Supabase Connection Error (Using Local Fallback)'
              : 'Local Device Mode (Ready for Supabase Cloud Sync)'}
          </Text>
        </View>

        {syncStatus.lastSyncedAt && (
          <Text style={styles.statusMeta}>
            Last synced: {syncStatus.lastSyncedAt}
            {syncStatus.lastRealtimeEvent
              ? ` • Live event: ${syncStatus.lastRealtimeEvent}`
              : ''}
          </Text>
        )}

        {syncStatus.errorMessage && (
          <Text style={styles.errorText}>{syncStatus.errorMessage}</Text>
        )}
      </View>

      {/* Multi-Neighbor Identity Switcher */}
      <View style={styles.card}>
        <Text style={styles.cardTitle}>
          👤 Active Neighbor Identity (Test Multi-User Claims)
        </Text>
        <Text style={styles.cardSub}>
          Switch between neighbor profiles on this device—or open the app on two
          phones—to test how claims combine toward wholesale minimums and case splits.
        </Text>

        <View style={styles.profileGrid}>
          {DEMO_PROFILES.map((prof) => {
            const isSelected = prof.id === activeUser.id;
            return (
              <TouchableOpacity
                key={prof.id}
                style={[
                  styles.profilePill,
                  isSelected && styles.profilePillActive,
                ]}
                onPress={() => onSelectUser(prof)}
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

        {/* Custom Profile Creator */}
        <View style={styles.customProfileBox}>
          <Text style={styles.inputLabel}>Or Join as a New Neighbor Profile</Text>
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
            ⚡ Simulate Neighbor Claiming a Share Live
          </Text>
        </TouchableOpacity>
      </View>

      {/* Supabase Cloud Connection Setup */}
      <View style={styles.card}>
        <Text style={styles.cardTitle}>
          ☁️ Connect Your Supabase Project (Real-Time Postgres)
        </Text>
        <Text style={styles.cardSub}>
          1. Create a free project at supabase.com and run{' '}
          <Text style={styles.codeInline}>supabase/schema.sql</Text> in the SQL
          Editor.{'\n'}
          2. Paste your Project URL and Anon Key below (or set{' '}
          <Text style={styles.codeInline}>EXPO_PUBLIC_SUPABASE_URL</Text> and{' '}
          <Text style={styles.codeInline}>EXPO_PUBLIC_SUPABASE_ANON_KEY</Text>{' '}
          in <Text style={styles.codeInline}>.env</Text>).
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
          {syncStatus.mode === 'supabase_live' ? (
            <TouchableOpacity
              style={styles.disconnectBtn}
              onPress={handleDisconnectSupabase}
              disabled={isConnecting}
            >
              <Text style={styles.disconnectBtnText}>
                Switch Back to Local Mode
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
                {syncStatus.mode === 'supabase_live'
                  ? 'Reconnect & Reseed Cloud DB'
                  : 'Connect & Sync Pools to Supabase'}
              </Text>
            )}
          </TouchableOpacity>
        </View>

        <TouchableOpacity style={styles.resetButton} onPress={onResetDemo}>
          <Text style={styles.resetButtonText}>
            ↺ Reset All Demo Pools to Default
          </Text>
        </TouchableOpacity>
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
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
