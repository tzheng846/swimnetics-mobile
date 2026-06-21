import React, { useState } from 'react';
import {
  Modal, View, ScrollView, TextInput, Pressable, ActivityIndicator,
  KeyboardAvoidingView, Platform,
} from 'react-native';
import AppText from '../ui/AppText';
import { apiFetch } from '../../lib/apiFetch';
import { colors, spacing, radii } from '../../theme';

// Compact AI coaching chat. Calls POST /coach/chat { session_id, messages } anchored to a
// session (team tools let it answer team-level questions). Non-invasive bottom sheet, not
// full-screen. `seed` optionally pre-fills the first user message + auto-sends on open.
export default function CoachChatSheet({ visible, onClose, anchorSessionId, token }) {
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);

  const send = async () => {
    const text = input.trim();
    if (!text || loading || !anchorSessionId) return;
    const next = [...messages, { role: 'user', content: text }];
    setMessages(next);
    setInput('');
    setLoading(true);
    try {
      const res = await apiFetch('/coach/chat', {
        token,
        method: 'POST',
        body: { session_id: anchorSessionId, messages: next },
      });
      setMessages([...next, { role: 'assistant', content: res?.reply || '…' }]);
    } catch (e) {
      setMessages([...next, { role: 'assistant', content: e.message || 'Coaching is unavailable right now.' }]);
    } finally {
      setLoading(false);
    }
  };

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View style={{ flex: 1, backgroundColor: colors.scrim, justifyContent: 'flex-end' }}>
        <Pressable style={{ flex: 1 }} onPress={onClose} accessibilityLabel="Close" />
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
          <View style={{ backgroundColor: colors.surface, borderTopLeftRadius: radii.lg, borderTopRightRadius: radii.lg, paddingHorizontal: spacing.lg, paddingTop: spacing.md, paddingBottom: spacing.xl, maxHeight: 460 }}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: spacing.sm }}>
              <AppText variant="heading" color="primary">Coach AI</AppText>
              <Pressable onPress={onClose} hitSlop={10}><AppText variant="heading" color="textMuted">✕</AppText></Pressable>
            </View>

            <ScrollView style={{ maxHeight: 280 }} contentContainerStyle={{ paddingVertical: spacing.sm }}>
              {messages.length === 0 ? (
                <AppText variant="body" color="textSecondary">
                  {anchorSessionId
                    ? 'Ask about your team or a swimmer — e.g. "who needs the most work?"'
                    : 'Record a session to unlock AI coaching.'}
                </AppText>
              ) : (
                messages.map((m, i) => (
                  <View
                    key={i}
                    style={{
                      alignSelf: m.role === 'user' ? 'flex-end' : 'flex-start',
                      backgroundColor: m.role === 'user' ? colors.primary : colors.surfaceAlt,
                      borderRadius: radii.md,
                      paddingVertical: 8,
                      paddingHorizontal: 12,
                      marginBottom: 8,
                      maxWidth: '85%',
                    }}
                  >
                    <AppText variant="body" color={m.role === 'user' ? colors.white : 'text'}>{m.content}</AppText>
                  </View>
                ))
              )}
              {loading ? <ActivityIndicator color={colors.primary} style={{ marginTop: spacing.sm }} /> : null}
            </ScrollView>

            <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginTop: spacing.sm }}>
              <TextInput
                value={input}
                onChangeText={setInput}
                onSubmitEditing={send}
                editable={!!anchorSessionId}
                placeholder={anchorSessionId ? 'Ask the coach…' : 'No sessions yet'}
                placeholderTextColor={colors.textMuted}
                style={{ flex: 1, backgroundColor: colors.surfaceAlt, borderRadius: radii.md, paddingHorizontal: 14, paddingVertical: 10, color: colors.text, fontSize: 15 }}
              />
              <Pressable onPress={send} disabled={!input.trim() || loading || !anchorSessionId} style={{ opacity: !input.trim() || loading || !anchorSessionId ? 0.4 : 1 }}>
                <AppText variant="body" color="primary" weight="600">Send</AppText>
              </Pressable>
            </View>
          </View>
        </KeyboardAvoidingView>
      </View>
    </Modal>
  );
}
