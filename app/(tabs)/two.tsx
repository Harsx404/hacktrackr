import React, { useState } from 'react';
import { StyleSheet, ScrollView, TextInput, TouchableOpacity, Dimensions, StatusBar, ActivityIndicator, KeyboardAvoidingView, Platform } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Text, View } from '@/components/Themed';
import { Sparkles, Link2, FileText } from 'lucide-react-native';
import { colors, typography } from '../../src/theme';
import { parseHackathonDetails, ParsedHackathonData } from '../../src/services/aiService';
import { useRouter } from 'expo-router';
import { supabase } from '../../src/utils/supabase';
import { NavigationMenu, HamburgerHeader } from '@/components/NavigationMenu';
import { scheduleDeadlineReminder } from '../../src/services/notificationService';

const { width } = Dimensions.get('window');

const BACKEND_URL = process.env.EXPO_PUBLIC_BACKEND_URL || 'http://192.168.1.21:3001';

type InputMode = 'text' | 'url';

export default function AddHackathonScreen() {
  const router = useRouter();
  const [inputMode, setInputMode] = useState<InputMode>('text');
  const [text, setText] = useState('');
  const [url, setUrl] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [parsedData, setParsedData] = useState<ParsedHackathonData | null>(null);
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const [isScraped, setIsScraped] = useState(false); // true if data came from a platform scraper

  const handleParseText = async () => {
    if (!text.trim()) return;
    setIsLoading(true);
    try {
      const data = await parseHackathonDetails(text);
      setParsedData(data);
    } catch (error: any) {
      console.error(error);
      alert(error.message || 'Failed to extract hackathon details.');
    } finally {
      setIsLoading(false);
    }
  };

  const handleParseUrl = async () => {
    if (!url.trim() || !url.startsWith('http')) {
      alert('Please enter a valid URL starting with http:// or https://');
      return;
    }
    setIsLoading(true);
    try {
      const res = await fetch(`${BACKEND_URL}/api/extract`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: url.trim() }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Backend extraction failed');
      setIsScraped(json.scraped === true);
      setParsedData(json.data as ParsedHackathonData);
    } catch (error: any) {
      console.error(error);
      alert(
        error.message.includes('fetch')
          ? `Cannot reach backend at ${BACKEND_URL}.\n\nSet EXPO_PUBLIC_BACKEND_URL in .env to your Railway URL.`
          : error.message
      );
    } finally {
      setIsLoading(false);
    }
  };

  const handleSave = async () => {
    if (!parsedData) return;

    setIsLoading(true);
    try {
      const { data: { user }, error: userError } = await supabase.auth.getUser();
      if (userError || !user) {
        alert("Authentication Required:\n\nYou must be logged in to save. Please set up Authentication or create a user.");
        return;
      }

      // 1. Insert Hackathon (all extracted fields)
      const { data: hackathon, error: hackError } = await supabase
        .from('hackathons')
        .insert({
          user_id: user.id,
          name: parsedData.name,
          deadline: parsedData.deadline,
          team_size: parsedData.team_size || 1,
          platform: parsedData.platform || null,
          theme: parsedData.theme || null,
          website_url: parsedData.website_url || null,
          submission_link: parsedData.submission_link || null,
          status: 'Registered',
        })
        .select()
        .single();

      if (hackError) throw hackError;

      // 2. Insert Tasks (if any)
      if (parsedData.tasks && parsedData.tasks.length > 0) {
        const { error: tasksError } = await supabase
          .from('tasks')
          .insert(
            parsedData.tasks.map((t: string) => ({
              hackathon_id: hackathon.id,
              user_id: user.id,
              title: t,
            }))
          );
        if (tasksError) console.error("Tasks insert failed:", tasksError);
      }

      // 3. Insert Checklist (if any)
      if (parsedData.checklist_items && parsedData.checklist_items.length > 0) {
        const { error: checklistError } = await supabase
          .from('checklist_items')
          .insert(
            parsedData.checklist_items.map((item: string) => ({
              hackathon_id: hackathon.id,
              user_id: user.id,
              title: item,
            }))
          );
        if (checklistError) console.error("Checklist insert failed:", checklistError);
      }

      // 4. Insert Milestones (if any)
      if (parsedData.milestones && parsedData.milestones.length > 0) {
        const { error: mileError } = await supabase
          .from('milestones')
          .insert(
            parsedData.milestones.map((m: string) => ({
              hackathon_id: hackathon.id,
              user_id: user.id,
              title: m,
            }))
          );
        if (mileError) console.error("Milestones insert failed:", mileError);
      }

      // Schedule a 24h deadline reminder notification
      await scheduleDeadlineReminder({ id: hackathon.id, name: hackathon.name, deadline: hackathon.deadline });

      // Trigger AI plan generation in background (tasks, deliverables, milestones, ideas)
      fetch(`${BACKEND_URL}/api/ai-plan`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          hackathon_id: hackathon.id,
          user_id: user.id,
          data: { ...parsedData, website_url: parsedData.website_url || url },
        }),
      }).catch(err => console.error('[two.tsx] AI plan trigger failed:', err));

      alert(`Hackathon saved! ✨ AI is building your tasks, deliverables & ideas in the background.`);
      setParsedData(null);
      setIsScraped(false);
      setText('');
      setUrl('');
      router.push('/');

    } catch (error: any) {
      console.error("Save Error:", error);
      alert('Failed to save to Tracker. ' + error.message);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <SafeAreaView style={styles.safeArea}>
      <KeyboardAvoidingView 
        style={{ flex: 1 }} 
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        keyboardVerticalOffset={Platform.OS === 'ios' ? 0 : 20}
      >
        <ScrollView style={styles.container} contentContainerStyle={styles.contentContainer} keyboardShouldPersistTaps="handled">
        
        {/* Header */}
        <HamburgerHeader onMenuPress={() => setIsMenuOpen(true)} />

        {/* Title */}
        <View style={styles.titleContainer}>
          <Text style={styles.titleLight}>New</Text>
          <Text style={styles.titleBold}>Hackathon</Text>
        </View>

        {!parsedData ? (
          <View style={styles.formContainer}>
            {/* Mode Tabs */}
            <View style={styles.modeTabs}>
              <TouchableOpacity
                style={[styles.modeTab, inputMode === 'text' && styles.modeTabActive]}
                onPress={() => setInputMode('text')}
                activeOpacity={0.7}
              >
                <FileText size={16} color={inputMode === 'text' ? '#000' : colors.textMuted} />
                <Text style={[styles.modeTabText, inputMode === 'text' && styles.modeTabTextActive]}>
                  Paste Text
                </Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.modeTab, inputMode === 'url' && styles.modeTabActive]}
                onPress={() => setInputMode('url')}
                activeOpacity={0.7}
              >
                <Link2 size={16} color={inputMode === 'url' ? '#000' : colors.textMuted} />
                <Text style={[styles.modeTabText, inputMode === 'url' && styles.modeTabTextActive]}>
                  Paste URL
                </Text>
              </TouchableOpacity>
            </View>

            {inputMode === 'text' ? (
              <>
                <Text style={styles.instructionText}>
                  Paste hackathon details from Devfolio, MLH, or Unstop. AI will extract deadlines, team sizes, and requirements automatically.
                </Text>
                <TextInput
                  style={styles.textInput}
                  multiline
                  placeholder="e.g. HackMIT runs Oct 12-13. Teams of up to 4. Requires a demo video and a GitHub repo link."
                  placeholderTextColor={colors.textMuted}
                  value={text}
                  onChangeText={setText}
                  textAlignVertical="top"
                />
                <TouchableOpacity
                  style={[styles.button, !text.trim() && styles.buttonDisabled]}
                  onPress={handleParseText}
                  disabled={!text.trim() || isLoading}
                >
                  {isLoading ? (
                    <ActivityIndicator color="#000" />
                  ) : (
                    <>
                      <Sparkles color="#000" size={20} strokeWidth={2} />
                      <Text style={styles.buttonText}>Extract Details</Text>
                    </>
                  )}
                </TouchableOpacity>
              </>
            ) : (
              <>
                <Text style={styles.instructionText}>
                  Paste a direct link to any hackathon page on Devfolio, MLH, Unstop, or Devpost. The backend will scrape and extract all details automatically.
                </Text>
                <TextInput
                  style={styles.textInput}
                  placeholder="https://devfolio.co/hackathons/example"
                  placeholderTextColor={colors.textMuted}
                  value={url}
                  onChangeText={setUrl}
                  autoCapitalize="none"
                  keyboardType="url"
                  autoCorrect={false}
                />
                <TouchableOpacity
                  style={[styles.button, (!url.trim() || !url.startsWith('http')) && styles.buttonDisabled]}
                  onPress={handleParseUrl}
                  disabled={!url.trim() || !url.startsWith('http') || isLoading}
                >
                  {isLoading ? (
                    <ActivityIndicator color="#000" />
                  ) : (
                    <>
                      <Link2 color="#000" size={20} strokeWidth={2} />
                      <Text style={styles.buttonText}>Scrape & Extract</Text>
                    </>
                  )}
                </TouchableOpacity>
              </>
            )}
          </View>

        ) : (
          <View style={styles.resultContainer}>
            <View style={styles.previewCard}>
              <Text style={styles.instructionText}>Review and edit the extracted details before saving:</Text>

              {isScraped && parsedData.platform && (
                <View style={styles.scrapedBadge}>
                  <Text style={styles.scrapedBadgeText}>✅ Scraped from {parsedData.platform}</Text>
                </View>
              )}

              <Text style={[styles.previewLabel, { color: colors.accentBlue }]}>ORGANIZER / PLATFORM</Text>
              <TextInput
                style={styles.editInput}
                value={parsedData.platform || ''}
                onChangeText={(t) => setParsedData({ ...parsedData, platform: t })}
                placeholder="e.g. Devfolio"
                placeholderTextColor={colors.textMuted}
              />

              <Text style={styles.previewLabel}>HACKATHON NAME</Text>
              <TextInput
                style={[styles.editInput, styles.editInputTitle]}
                value={parsedData.name || ''}
                onChangeText={(t) => setParsedData({ ...parsedData, name: t })}
                placeholder="Name"
                placeholderTextColor={colors.textMuted}
              />

              <Text style={styles.previewLabel}>THEME</Text>
              <TextInput
                style={styles.editInput}
                value={parsedData.theme || ''}
                onChangeText={(t) => setParsedData({ ...parsedData, theme: t })}
                placeholder="e.g. AI, Web3"
                placeholderTextColor={colors.textMuted}
              />

              <Text style={styles.previewLabel}>DEADLINE (ISO FORMAT YYYY-MM-DD)</Text>
              <TextInput
                style={styles.editInput}
                value={parsedData.deadline || ''}
                onChangeText={(t) => setParsedData({ ...parsedData, deadline: t })}
                placeholder="2026-10-27T23:59:00Z"
                placeholderTextColor={colors.textMuted}
              />

              <Text style={styles.previewLabel}>TEAM SIZE</Text>
              <TextInput
                style={styles.editInput}
                value={String(parsedData.team_size || '')}
                onChangeText={(t) => setParsedData({ ...parsedData, team_size: parseInt(t) || 1 })}
                keyboardType="numeric"
                placeholder="e.g. 4"
                placeholderTextColor={colors.textMuted}
              />

              {parsedData.milestones && parsedData.milestones.length > 0 && (
                <>
                  <Text style={styles.previewLabel}>MILESTONES (Extracted)</Text>
                  {parsedData.milestones.map((m: string, index: number) => (
                    <Text key={index} style={styles.previewListItem}>◆ {m}</Text>
                  ))}
                </>
              )}

              {parsedData.checklist_items && parsedData.checklist_items.length > 0 && (
                <>
                  <Text style={styles.previewLabel}>DELIVERABLES (Extracted)</Text>
                  {parsedData.checklist_items.map((item: string, index: number) => (
                    <Text key={index} style={styles.previewListItem}>• {item}</Text>
                  ))}
                </>
              )}

              {parsedData.tasks && parsedData.tasks.length > 0 && (
                <>
                  <Text style={styles.previewLabel}>SUGGESTED TASKS (Extracted)</Text>
                  {parsedData.tasks.map((task: string, index: number) => (
                    <Text key={index} style={styles.previewListItem}>• {task}</Text>
                  ))}
                </>
              )}
            </View>

            <TouchableOpacity 
              style={styles.buttonSecondary}
              onPress={handleSave}
              disabled={isLoading}
            >
              {isLoading ? (
                <ActivityIndicator color="#000" />
              ) : (
                <Text style={styles.buttonSecondaryText}>Confirm & Add to Tracker</Text>
              )}
            </TouchableOpacity>
            
            <TouchableOpacity 
              style={{ marginTop: 24, alignItems: 'center' }}
              onPress={() => setParsedData(null)}
            >
              <Text style={{ color: colors.textMuted }}>Try again</Text>
            </TouchableOpacity>
          </View>
        )}

        </ScrollView>
      </KeyboardAvoidingView>

      <NavigationMenu isOpen={isMenuOpen} setIsOpen={setIsMenuOpen} />

    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: colors.background,
    paddingTop: StatusBar.currentHeight ? StatusBar.currentHeight + 10 : 40,
  },
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  contentContainer: {
    paddingBottom: 60,
  },
  titleContainer: {
    paddingHorizontal: 24,
    marginBottom: 32,
    backgroundColor: 'transparent',
  },
  titleLight: {
    ...typography.h1,
    fontWeight: '300',
    color: colors.text,
  },
  titleBold: {
    ...typography.h1,
    fontWeight: '400',
    color: colors.text,
  },
  formContainer: {
    paddingHorizontal: 24,
    backgroundColor: 'transparent',
  },
  modeTabs: {
    flexDirection: 'row',
    gap: 10,
    marginBottom: 28,
    backgroundColor: 'transparent',
  },
  modeTab: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingVertical: 12,
    borderRadius: 100,
    borderWidth: 1,
    borderColor: '#2A2A2A',
    backgroundColor: 'transparent',
  },
  modeTabActive: {
    backgroundColor: colors.accentYellow,
    borderColor: colors.accentYellow,
  },
  modeTabText: {
    ...typography.body,
    color: colors.textMuted,
    fontSize: 14,
  },
  modeTabTextActive: {
    color: '#000',
    fontFamily: 'Inter-Medium',
  },
  instructionText: {
    ...typography.body,
    color: colors.textMuted,
    marginBottom: 24,
  },
  textInput: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: 20,
    padding: 20,
    color: colors.text,
    ...typography.body,
    height: 200,
    marginBottom: 24,
  },
  button: {
    backgroundColor: colors.accentYellow,
    borderRadius: 30,
    paddingVertical: 18,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  buttonDisabled: {
    opacity: 0.5,
  },
  buttonText: {
    ...typography.h3,
    fontSize: 18,
    color: '#000',
    fontWeight: '500',
  },
  resultContainer: {
    paddingHorizontal: 24,
    backgroundColor: 'transparent',
  },
  previewCard: {
    backgroundColor: colors.surface,
    borderRadius: 24,
    padding: 24,
    borderWidth: 1,
    borderColor: colors.border,
    marginBottom: 24,
  },
  editInput: {
    ...typography.body,
    color: colors.text,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    paddingVertical: 8,
    marginBottom: 16,
  },
  editInputTitle: {
    ...typography.h2,
    fontSize: 24,
    color: colors.text,
    marginTop: 4,
  },
  previewTitle: {
    ...typography.h2,
    color: colors.text,
    marginBottom: 8,
    marginTop: 4,
  },
  previewLabel: {
    ...typography.caption,
    color: colors.textMuted,
    marginTop: 20,
    marginBottom: 6,
  },
  previewValue: {
    ...typography.body,
    color: colors.text,
  },
  previewListItem: {
    ...typography.body,
    color: colors.accentWhite,
    marginBottom: 6,
    fontSize: 15,
  },
  buttonSecondary: {
    backgroundColor: colors.accentBlue,
    borderRadius: 30,
    paddingVertical: 18,
    alignItems: 'center',
    justifyContent: 'center',
  },
  buttonSecondaryText: {
    ...typography.h3,
    fontSize: 18,
    color: '#000',
    fontWeight: '500',
  },
  scrapedBadge: {
    backgroundColor: 'rgba(100, 230, 150, 0.12)',
    borderWidth: 1,
    borderColor: 'rgba(100, 230, 150, 0.4)',
    borderRadius: 100,
    paddingHorizontal: 14,
    paddingVertical: 8,
    alignSelf: 'flex-start',
    marginBottom: 20,
  },
  scrapedBadgeText: {
    ...typography.caption,
    color: '#64e696',
    fontFamily: 'Inter-Medium',
    fontSize: 13,
  },
});
