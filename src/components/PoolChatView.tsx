import React, { useState } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
} from 'react-native';
import { GroupBuyPool, Participant, PoolMessage } from '../types/groupBuy';
import { getCaseSplitStatus } from '../utils/calculations';

interface Props {
  pool: GroupBuyPool;
  activeUser: Participant;
  onSendMessage: (text: string, isAnnouncement: boolean) => void;
}

export const PoolChatView: React.FC<Props> = ({
  pool,
  activeUser,
  onSendMessage,
}) => {
  const [draft, setDraft] = useState('');
  const [postAsAnnouncement, setPostAsAnnouncement] = useState(false);

  const messages: PoolMessage[] = pool.messages || [];
  const pinnedAnnouncements = messages.filter((m) => m.isAnnouncement);

  // Quick helper prompts so neighbors or hosts can post 1-tap case-split calls
  const openCaseSplits = pool.items
    .map((item) => ({ item, status: getCaseSplitStatus(item) }))
    .filter(
      (x) => x.item.mode === 'case_split' && x.status.neededForNextCase > 0
    );

  const handleSend = () => {
    if (!draft.trim()) return;
    onSendMessage(draft.trim(), postAsAnnouncement);
    setDraft('');
    setPostAsAnnouncement(false);
  };

  const handleQuickPrompt = (promptText: string, asAnnouncement = false) => {
    onSendMessage(promptText, asAnnouncement);
  };

  return (
    <View style={styles.container}>
      {/* Pool Invite Code & Pickup Info Banner */}
      <View style={styles.codeCard}>
        <View>
          <Text style={styles.codeLabel}>NEIGHBORHOOD INVITE CODE</Text>
          <Text style={styles.codeValue}>🔑 {pool.joinCode}</Text>
        </View>
        <View style={{ alignItems: 'flex-end' }}>
          <Text style={styles.codeHost}>Host: {pool.hostName}</Text>
          <Text style={styles.codePickup}>{pool.pickupWindow}</Text>
        </View>
      </View>

      {/* Pinned Host Announcements */}
      {pinnedAnnouncements.length > 0 && (
        <View style={styles.pinnedBox}>
          <Text style={styles.pinnedHeader}>
            📢 PINNED HOST ANNOUNCEMENT
          </Text>
          {pinnedAnnouncements.slice(-2).map((ann) => (
            <View key={ann.id} style={styles.pinnedItem}>
              <Text style={styles.pinnedText}>{ann.text}</Text>
              <Text style={styles.pinnedMeta}>
                — {ann.userName} • {ann.createdAt}
              </Text>
            </View>
          ))}
        </View>
      )}

      {/* 1-Tap Quick Prompts for Case Splits & Porch Drop Updates */}
      <View style={styles.quickPromptsWrap}>
        <Text style={styles.quickPromptsLabel}>
          ⚡ 1-TAP NEIGHBOR & HOST UPDATES
        </Text>
        <View style={styles.quickChipsRow}>
          {openCaseSplits.slice(0, 2).map(({ item, status }) => (
            <TouchableOpacity
              key={item.id}
              style={styles.quickChip}
              onPress={() =>
                handleQuickPrompt(
                  `Who wants to split ${item.emoji} ${item.name}? Only ${status.neededForNextCase} more share(s) needed ($${item.unitPrice.toFixed(2)} each) to lock the case!`
                )
              }
            >
              <Text style={styles.quickChipText}>
                📣 Rally {item.emoji} ({status.neededForNextCase} left)
              </Text>
            </TouchableOpacity>
          ))}

          <TouchableOpacity
            style={[styles.quickChip, styles.quickChipHost]}
            onPress={() =>
              handleQuickPrompt(
                `📦 Wholesale delivery has arrived at ${pool.pickupAddress}! Cooler is out on the porch for pickup (${pool.pickupWindow}).`,
                true
              )
            }
          >
            <Text style={styles.quickChipHostText}>
              📢 Post "Order Arrived!"
            </Text>
          </TouchableOpacity>
        </View>
      </View>

      {/* Message Feed */}
      <Text style={styles.feedHeader}>
        POOL DISCUSSION & Q&A ({messages.length})
      </Text>

      {messages.length === 0 ? (
        <View style={styles.emptyBox}>
          <Text style={styles.emptyText}>
            No messages yet. Ask a question about an item or rally neighbors to
            split a bulk case!
          </Text>
        </View>
      ) : (
        messages.map((msg) => {
          const isMe = msg.userId === activeUser.id;
          return (
            <View
              key={msg.id}
              style={[
                styles.msgCard,
                isMe && styles.msgCardMe,
                msg.isAnnouncement && styles.msgCardAnnouncement,
              ]}
            >
              <View style={styles.msgTopRow}>
                <View style={styles.authorRow}>
                  <View
                    style={[
                      styles.avatar,
                      { backgroundColor: msg.avatarColor },
                    ]}
                  >
                    <Text style={styles.avatarText}>
                      {msg.userName.charAt(0).toUpperCase()}
                    </Text>
                  </View>
                  <Text style={styles.authorName}>{msg.userName}</Text>
                  {msg.isAnnouncement && (
                    <View style={styles.annBadge}>
                      <Text style={styles.annBadgeText}>ANNOUNCEMENT</Text>
                    </View>
                  )}
                </View>
                <Text style={styles.msgTime}>{msg.createdAt}</Text>
              </View>
              <Text style={styles.msgBody}>{msg.text}</Text>
            </View>
          );
        })
      )}

      {/* Composer */}
      <View style={styles.composerCard}>
        <View style={styles.composerTopRow}>
          <Text style={styles.composerIdentity}>
            Posting as <Text style={{ fontWeight: '800' }}>{activeUser.name}</Text>
          </Text>
          <TouchableOpacity
            style={[
              styles.annToggle,
              postAsAnnouncement && styles.annToggleActive,
            ]}
            onPress={() => setPostAsAnnouncement(!postAsAnnouncement)}
          >
            <Text
              style={[
                styles.annToggleText,
                postAsAnnouncement && styles.annToggleTextActive,
              ]}
            >
              {postAsAnnouncement ? '📢 Pin as Announcement' : 'Pin Announcement'}
            </Text>
          </TouchableOpacity>
        </View>

        <View style={styles.inputRow}>
          <TextInput
            style={styles.input}
            placeholder="Ask the host or rally neighbors for a case split..."
            value={draft}
            onChangeText={setDraft}
            multiline
          />
          <TouchableOpacity
            style={[
              styles.sendBtn,
              !draft.trim() && styles.sendBtnDisabled,
            ]}
            onPress={handleSend}
            disabled={!draft.trim()}
          >
            <Text style={styles.sendBtnText}>Send</Text>
          </TouchableOpacity>
        </View>
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    paddingBottom: 28,
  },
  codeCard: {
    backgroundColor: '#0F172A',
    borderRadius: 14,
    padding: 14,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
  },
  codeLabel: {
    fontSize: 10,
    fontWeight: '800',
    color: '#94A3B8',
    letterSpacing: 0.6,
  },
  codeValue: {
    fontSize: 20,
    fontWeight: '900',
    color: '#5EEAD4',
    marginTop: 2,
    letterSpacing: 1,
  },
  codeHost: {
    fontSize: 12,
    fontWeight: '700',
    color: '#FFFFFF',
  },
  codePickup: {
    fontSize: 11,
    color: '#CBD5E1',
    marginTop: 2,
  },
  pinnedBox: {
    backgroundColor: '#FFFBEB',
    borderWidth: 1,
    borderColor: '#FDE68A',
    borderRadius: 14,
    padding: 12,
    marginBottom: 12,
  },
  pinnedHeader: {
    fontSize: 10,
    fontWeight: '800',
    color: '#B45309',
    letterSpacing: 0.6,
    marginBottom: 6,
  },
  pinnedItem: {
    marginTop: 4,
  },
  pinnedText: {
    fontSize: 13,
    fontWeight: '700',
    color: '#78350F',
    lineHeight: 18,
  },
  pinnedMeta: {
    fontSize: 11,
    color: '#92400E',
    marginTop: 3,
    fontWeight: '600',
  },
  quickPromptsWrap: {
    marginBottom: 14,
  },
  quickPromptsLabel: {
    fontSize: 10,
    fontWeight: '800',
    color: '#64748B',
    letterSpacing: 0.5,
    marginBottom: 6,
  },
  quickChipsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
  },
  quickChip: {
    backgroundColor: '#F3E8FF',
    borderWidth: 1,
    borderColor: '#D8B4FE',
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 999,
  },
  quickChipText: {
    fontSize: 11,
    fontWeight: '700',
    color: '#6B21A8',
  },
  quickChipHost: {
    backgroundColor: '#FEF3C7',
    borderColor: '#FCD34D',
  },
  quickChipHostText: {
    fontSize: 11,
    fontWeight: '700',
    color: '#92400E',
  },
  feedHeader: {
    fontSize: 11,
    fontWeight: '800',
    color: '#64748B',
    letterSpacing: 0.6,
    marginBottom: 8,
  },
  emptyBox: {
    backgroundColor: '#FFFFFF',
    borderRadius: 12,
    padding: 16,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    marginBottom: 12,
  },
  emptyText: {
    fontSize: 12,
    color: '#64748B',
    fontStyle: 'italic',
  },
  msgCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 14,
    padding: 12,
    marginBottom: 10,
    borderWidth: 1,
    borderColor: '#E2E8F0',
  },
  msgCardMe: {
    borderColor: '#0D9488',
    backgroundColor: '#F0FDFA',
  },
  msgCardAnnouncement: {
    borderColor: '#F59E0B',
    backgroundColor: '#FFFBEB',
  },
  msgTopRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 6,
  },
  authorRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  avatar: {
    width: 24,
    height: 24,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarText: {
    color: '#FFFFFF',
    fontSize: 11,
    fontWeight: '800',
  },
  authorName: {
    fontSize: 13,
    fontWeight: '700',
    color: '#0F172A',
  },
  annBadge: {
    backgroundColor: '#FDE68A',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
  },
  annBadgeText: {
    fontSize: 9,
    fontWeight: '800',
    color: '#92400E',
  },
  msgTime: {
    fontSize: 11,
    color: '#64748B',
  },
  msgBody: {
    fontSize: 13,
    color: '#1E293B',
    lineHeight: 19,
  },
  composerCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 14,
    padding: 12,
    marginTop: 6,
    borderWidth: 1,
    borderColor: '#CBD5E1',
  },
  composerTopRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  composerIdentity: {
    fontSize: 11,
    color: '#475569',
  },
  annToggle: {
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 6,
    backgroundColor: '#F1F5F9',
  },
  annToggleActive: {
    backgroundColor: '#FEF3C7',
  },
  annToggleText: {
    fontSize: 10,
    fontWeight: '700',
    color: '#475569',
  },
  annToggleTextActive: {
    color: '#B45309',
  },
  inputRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  input: {
    flex: 1,
    backgroundColor: '#F8FAFC',
    borderWidth: 1,
    borderColor: '#E2E8F0',
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 9,
    fontSize: 13,
    color: '#0F172A',
    maxHeight: 80,
  },
  sendBtn: {
    backgroundColor: '#0D9488',
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 10,
  },
  sendBtnDisabled: {
    backgroundColor: '#94A3B8',
  },
  sendBtnText: {
    color: '#FFFFFF',
    fontWeight: '800',
    fontSize: 13,
  },
});
