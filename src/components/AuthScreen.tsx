import React, { useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Linking,
  Platform,
  SafeAreaView,
  ScrollView,
  StatusBar,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';

type Mode = 'sign_in' | 'sign_up';

interface Props {
  onSignIn: (email: string, password: string) => Promise<void>;
  onSignUp: (
    email: string,
    password: string,
    displayName: string,
    neighborhood: string
  ) => Promise<void>;
  privacyPolicyUrl?: string;
  notice?: string;
}

/**
 * Sign-in gate for hosted (store) builds. Shared pools contain neighbors'
 * pickup addresses and porch codes, so nothing is shown until the server
 * has verified who is signed in.
 */
export const AuthScreen: React.FC<Props> = ({
  onSignIn,
  onSignUp,
  privacyPolicyUrl,
  notice,
}) => {
  const [mode, setMode] = useState<Mode>('sign_in');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [neighborhood, setNeighborhood] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const isSignUp = mode === 'sign_up';
  const canSubmit =
    !busy &&
    email.trim().length > 0 &&
    password.length >= (isSignUp ? 8 : 1) &&
    (!isSignUp || displayName.trim().length > 0);

  const submit = async () => {
    if (!canSubmit) return;
    setBusy(true);
    setError('');
    try {
      if (isSignUp) {
        await onSignUp(email, password, displayName, neighborhood);
      } else {
        await onSignIn(email, password);
      }
      setPassword('');
    } catch (err: any) {
      setError(err?.message || String(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <SafeAreaView style={styles.safe}>
      <StatusBar barStyle="light-content" />
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <ScrollView
          contentContainerStyle={styles.scroll}
          keyboardShouldPersistTaps="handled"
        >
          <Text style={styles.brand}>🥬 PoolCart</Text>
          <Text style={styles.tagline}>
            Split wholesale cases with neighbors and pick up nearby.
          </Text>

          <View style={styles.card}>
            <View style={styles.modeRow}>
              {(['sign_in', 'sign_up'] as Mode[]).map((m) => (
                <TouchableOpacity
                  key={m}
                  style={[styles.modePill, mode === m && styles.modePillActive]}
                  onPress={() => {
                    setMode(m);
                    setError('');
                  }}
                  accessibilityRole="button"
                  accessibilityState={{ selected: mode === m }}
                >
                  <Text
                    style={[
                      styles.modeText,
                      mode === m && styles.modeTextActive,
                    ]}
                  >
                    {m === 'sign_in' ? 'Sign in' : 'Create account'}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>

            {!!notice && <Text style={styles.notice}>{notice}</Text>}

            {isSignUp && (
              <>
                <Text style={styles.label}>Display name</Text>
                <TextInput
                  style={styles.input}
                  placeholder="How neighbors see you"
                  value={displayName}
                  onChangeText={setDisplayName}
                  autoComplete="name"
                  textContentType="name"
                />
                <Text style={styles.label}>Neighborhood (optional)</Text>
                <TextInput
                  style={styles.input}
                  placeholder="e.g. Terra Vista"
                  value={neighborhood}
                  onChangeText={setNeighborhood}
                />
              </>
            )}

            <Text style={styles.label}>Email</Text>
            <TextInput
              style={styles.input}
              placeholder="you@example.com"
              autoCapitalize="none"
              autoCorrect={false}
              keyboardType="email-address"
              autoComplete="email"
              textContentType="emailAddress"
              value={email}
              onChangeText={setEmail}
            />
            <Text style={styles.label}>Password</Text>
            <TextInput
              style={styles.input}
              placeholder={isSignUp ? 'At least 8 characters' : 'Password'}
              secureTextEntry
              autoComplete={isSignUp ? 'new-password' : 'current-password'}
              textContentType={isSignUp ? 'newPassword' : 'password'}
              value={password}
              onChangeText={setPassword}
              onSubmitEditing={submit}
            />

            {!!error && <Text style={styles.error}>{error}</Text>}

            <TouchableOpacity
              style={[styles.submit, !canSubmit && styles.submitDisabled]}
              onPress={submit}
              disabled={!canSubmit}
              accessibilityRole="button"
            >
              {busy ? (
                <ActivityIndicator color="#FFFFFF" />
              ) : (
                <Text style={styles.submitText}>
                  {isSignUp ? 'Create account' : 'Sign in'}
                </Text>
              )}
            </TouchableOpacity>
          </View>

          {!!privacyPolicyUrl && (
            <TouchableOpacity
              onPress={() => Linking.openURL(privacyPolicyUrl).catch(() => undefined)}
              accessibilityRole="link"
            >
              <Text style={styles.privacy}>Privacy Policy</Text>
            </TouchableOpacity>
          )}
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#0D9488' },
  scroll: { flexGrow: 1, justifyContent: 'center', padding: 20 },
  brand: {
    fontSize: 34,
    fontWeight: '900',
    color: '#FFFFFF',
    textAlign: 'center',
  },
  tagline: {
    fontSize: 15,
    color: '#CCFBF1',
    textAlign: 'center',
    marginTop: 6,
    marginBottom: 24,
  },
  card: {
    backgroundColor: '#FFFFFF',
    borderRadius: 18,
    padding: 18,
  },
  modeRow: {
    flexDirection: 'row',
    backgroundColor: '#F1F5F9',
    borderRadius: 12,
    padding: 4,
    marginBottom: 14,
  },
  modePill: { flex: 1, paddingVertical: 9, borderRadius: 9, alignItems: 'center' },
  modePillActive: { backgroundColor: '#FFFFFF' },
  modeText: { fontSize: 14, fontWeight: '700', color: '#64748B' },
  modeTextActive: { color: '#0F766E' },
  notice: {
    fontSize: 13,
    color: '#0F766E',
    backgroundColor: '#F0FDFA',
    borderRadius: 10,
    padding: 10,
    marginBottom: 10,
  },
  label: {
    fontSize: 12,
    fontWeight: '700',
    color: '#334155',
    marginTop: 10,
    marginBottom: 4,
  },
  input: {
    borderWidth: 1,
    borderColor: '#CBD5E1',
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 11,
    fontSize: 15,
    color: '#0F172A',
    backgroundColor: '#FFFFFF',
  },
  error: { color: '#B91C1C', fontSize: 13, marginTop: 10 },
  submit: {
    backgroundColor: '#0D9488',
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: 'center',
    marginTop: 16,
  },
  submitDisabled: { opacity: 0.5 },
  submitText: { color: '#FFFFFF', fontSize: 16, fontWeight: '800' },
  privacy: {
    color: '#FFFFFF',
    textAlign: 'center',
    textDecorationLine: 'underline',
    marginTop: 18,
    fontSize: 13,
  },
});
