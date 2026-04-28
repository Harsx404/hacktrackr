import React, { useState, useCallback } from 'react';
import {
  StyleSheet, ScrollView, TouchableOpacity, StatusBar,
  ActivityIndicator, FlatList, Alert, Linking, Modal,
  Image, Platform, RefreshControl,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Text, View } from '@/components/Themed';
import { ArrowUpRight, Globe, Bookmark, X, Users, Clock, MapPin, Trophy, Calendar, Tag, BookmarkCheck } from 'lucide-react-native';
import { colors, typography } from '../../src/theme';
import { supabase } from '../../src/utils/supabase';
import { useFocusEffect } from 'expo-router';
import { NavigationMenu, HamburgerHeader } from '@/components/NavigationMenu';

const BACKEND_URL = process.env.EXPO_PUBLIC_BACKEND_URL || 'http://localhost:3001';

interface GlobalHackathon {
  registration_url: string;
  name: string;
  platform: string | null;
  source: string;
  organizer: string | null;
  description: string | null;
  deadline: string | null;
  submission_deadline: string | null;
  end_date: string | null;
  start_date: string | null;
  mode: string | null;
  location: string | null;
  prize: string | null;
  tags: string[] | null;
  image_url: string | null;
  team_size_min: number | null;
  team_size_max: number | null;
  reg_status: string | null;
  remain_days: number | null;
  register_count: number | null;
  eligibility: string | null;
}

const SOURCES = ['All', 'unstop', 'mlh', 'devfolio', 'hack2skill'];
const PAGE_SIZE = 15;

function getDeadline(h: GlobalHackathon): string | null {
  return h.deadline || h.submission_deadline || h.end_date;
}

function formatDate(dateStr: string | null): string {
  if (!dateStr) return 'TBA';
  try {
    return new Date(dateStr).toLocaleDateString('en-US', {
      month: 'short', day: 'numeric', year: 'numeric',
    });
  } catch {
    return dateStr;
  }
}

// ─── Detail Modal ────────────────────────────────────────────
function HackathonDetailModal({
  hackathon,
  visible,
  onClose,
  onSave,
}: {
  hackathon: GlobalHackathon | null;
  visible: boolean;
  onClose: () => void;
  onSave: (h: GlobalHackathon) => void;
}) {
  if (!hackathon) return null;
  const deadline = getDeadline(hackathon);

  // Strip HTML tags from description, preserving basic line breaks
  const cleanDescription = hackathon.description
    ? hackathon.description
        .replace(/<br\s*\/?>/gi, '\n')
        .replace(/<\/p>/gi, '\n\n')
        .replace(/<li>/gi, '\n• ')
        .replace(/<[^>]*>/g, '')
        .replace(/&[a-z]+;/gi, ' ')
        .replace(/\n{3,}/g, '\n\n')
        .trim()
    : null;

  const teamLabel = hackathon.team_size_min && hackathon.team_size_max
    ? `${hackathon.team_size_min}–${hackathon.team_size_max} members`
    : hackathon.team_size_max
    ? `Up to ${hackathon.team_size_max} members`
    : null;

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <SafeAreaView style={modal.container}>
        {/* Header bar */}
        <View style={modal.headerBar}>
          <TouchableOpacity onPress={onClose} style={modal.closeBtn} activeOpacity={0.7}>
            <X color={colors.text} size={28} strokeWidth={1} />
          </TouchableOpacity>
          <View style={modal.headerSpacer} />
          <TouchableOpacity
            style={modal.saveBtn}
            onPress={() => onSave(hackathon)}
            activeOpacity={0.8}
          >
            <Bookmark color="#000" size={16} />
            <Text style={modal.saveBtnText}>Save</Text>
          </TouchableOpacity>
        </View>

        <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={modal.scrollContent}>
          {/* Image */}
          {hackathon.image_url ? (
            <Image source={{ uri: hackathon.image_url }} style={modal.image} resizeMode="cover" />
          ) : null}

          {/* Platform + Mode badges */}
          <View style={modal.badgeRow}>
            <View style={modal.badge}>
              <Text style={modal.badgeText}>{hackathon.platform || hackathon.source.toUpperCase()}</Text>
            </View>
            {hackathon.mode ? (
              <View style={[modal.badge, modal.badgeOutline]}>
                <Globe color={colors.textMuted} size={10} />
                <Text style={[modal.badgeText, { color: colors.textMuted }]}>{hackathon.mode}</Text>
              </View>
            ) : null}
            {hackathon.reg_status === 'STARTED' ? (
              <View style={[modal.badge, modal.badgeGreen]}>
                <Text style={[modal.badgeText, { color: colors.accentYellow }]}>Open</Text>
              </View>
            ) : null}
          </View>

          {/* Title */}
          <Text style={modal.title} adjustsFontSizeToFit numberOfLines={3}>{hackathon.name}</Text>
          <Text style={modal.organizer}>by {hackathon.organizer}</Text>

          {/* Stats Row */}
          <View style={modal.statsRow}>
            <View style={modal.statItem}>
              <Clock color={colors.textMuted} size={16} />
              <View>
                <Text style={modal.statLabel}>Deadline</Text>
                <Text style={modal.statValue}>{formatDate(deadline)}</Text>
              </View>
            </View>
            {hackathon.remain_days != null ? (
              <View style={modal.statItem}>
                <Calendar color={colors.textMuted} size={16} />
                <View>
                  <Text style={modal.statLabel}>Time Left</Text>
                  <Text style={modal.statValue}>{hackathon.remain_days} days</Text>
                </View>
              </View>
            ) : null}
            {hackathon.register_count ? (
              <View style={modal.statItem}>
                <Users color={colors.textMuted} size={16} />
                <View>
                  <Text style={modal.statLabel}>Registered</Text>
                  <Text style={modal.statValue}>{hackathon.register_count.toLocaleString()}</Text>
                </View>
              </View>
            ) : null}
          </View>

          {/* Details section */}
          <View style={modal.section}>
            {hackathon.prize ? (
              <View style={modal.detailRow}>
                <Trophy color={colors.textMuted} size={20} />
                <View style={modal.detailContent}>
                  <Text style={modal.detailLabel}>Prize</Text>
                  <Text style={modal.detailValue}>{hackathon.prize}</Text>
                </View>
              </View>
            ) : null}
            {hackathon.location ? (
              <View style={modal.detailRow}>
                <MapPin color={colors.textMuted} size={20} />
                <View style={modal.detailContent}>
                  <Text style={modal.detailLabel}>Location</Text>
                  <Text style={modal.detailValue}>{hackathon.location}</Text>
                </View>
              </View>
            ) : null}
            {teamLabel ? (
              <View style={modal.detailRow}>
                <Users color={colors.textMuted} size={20} />
                <View style={modal.detailContent}>
                  <Text style={modal.detailLabel}>Team Size</Text>
                  <Text style={modal.detailValue}>{teamLabel}</Text>
                </View>
              </View>
            ) : null}
            {hackathon.start_date ? (
              <View style={modal.detailRow}>
                <Calendar color={colors.textMuted} size={20} />
                <View style={modal.detailContent}>
                  <Text style={modal.detailLabel}>Starts</Text>
                  <Text style={modal.detailValue}>{formatDate(hackathon.start_date)}</Text>
                </View>
              </View>
            ) : null}
          </View>

          {/* Tags */}
          {hackathon.tags && hackathon.tags.length > 0 ? (
            <View style={modal.tagsSection}>
              <View style={modal.tagsSectionHeader}>
                <Tag color={colors.text} size={14} />
                <Text style={modal.tagsSectionTitle}>Topics</Text>
              </View>
              <View style={modal.tagsWrap}>
                {hackathon.tags.map((tag, i) => (
                  <View key={i} style={modal.tag}>
                    <Text style={modal.tagText}>{tag}</Text>
                  </View>
                ))}
              </View>
            </View>
          ) : null}

          {/* Description */}
          {cleanDescription ? (
            <View style={modal.descSection}>
              <Text style={modal.descTitle}>About</Text>
              <Text style={modal.descText}>{cleanDescription}</Text>
            </View>
          ) : null}

          {/* CTA */}
          <TouchableOpacity
            style={modal.visitBtn}
            onPress={() => hackathon.registration_url && Linking.openURL(hackathon.registration_url)}
            activeOpacity={0.85}
          >
            <Text style={modal.visitBtnText}>Visit Hackathon Page</Text>
            <ArrowUpRight color="#000" size={18} />
          </TouchableOpacity>
        </ScrollView>
      </SafeAreaView>
    </Modal>
  );
}

// ─── Main Screen ──────────────────────────────────────────────
export default function DiscoverScreen() {
  const [hackathons, setHackathons] = useState<GlobalHackathon[]>([]);
  const [filterSource, setFilterSource] = useState<string>('All');
  const [filterMode, setFilterMode] = useState<string>('all'); // 'all' | 'online' | 'offline'
  const [filterPrize, setFilterPrize] = useState<boolean>(false);
  const [isLoading, setIsLoading] = useState(true);
  const [isFetchingMore, setIsFetchingMore] = useState(false);
  const [hasMore, setHasMore] = useState(true);
  const [page, setPage] = useState(0);
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const [selectedHackathon, setSelectedHackathon] = useState<GlobalHackathon | null>(null);
  const [isRefreshing, setIsRefreshing] = useState(false);

  const fetchHackathons = async (pageIndex = 0, append = false, isRefreshAction = false) => {
    if (isRefreshAction) setIsRefreshing(true);
    else if (pageIndex === 0) setIsLoading(true);
    else setIsFetchingMore(true);

    try {
      const source = filterSource === 'All' ? 'all' : filterSource.toLowerCase();
      const url = `${BACKEND_URL}/api/discover?source=${source}&page=${pageIndex + 1}&per_page=${PAGE_SIZE}&mode=${filterMode}&has_prize=${filterPrize}`;
      const res = await fetch(url);
      const json = await res.json();

      const data: GlobalHackathon[] = json.data || [];
      if (append) {
        setHackathons(prev => [...prev, ...data]);
      } else {
        setHackathons(data);
      }
      setHasMore(data.length === PAGE_SIZE);
      setPage(pageIndex);
    } catch (err: any) {
      Alert.alert('Error', 'Could not load hackathons: ' + err.message);
    } finally {
      setIsLoading(false);
      setIsFetchingMore(false);
      setIsRefreshing(false);
    }
  };

  useFocusEffect(
    useCallback(() => {
      fetchHackathons(0, false);
    }, [filterSource, filterMode, filterPrize])
  );

  const handleSaveHackathon = async (hackathon: GlobalHackathon) => {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      Alert.alert('Login Required', 'Please sign in to save hackathons.');
      return;
    }

    const deadline = getDeadline(hackathon);

    const { data, error } = await supabase.from('hackathons').insert({
      user_id:             user.id,
      name:                hackathon.name,
      platform:            hackathon.platform || hackathon.organizer,
      deadline:            deadline,
      submission_deadline: deadline,
      mode:                hackathon.mode,
      location:            hackathon.location,
      prize:               hackathon.prize,
      tags:                hackathon.tags,
      website_url:         hackathon.registration_url,
      image_url:           hackathon.image_url,
      status:              'Registered',
      source:              hackathon.source,
    }).select().single();

    if (error) {
      if (error.code === '23505') {
        Alert.alert('Already Saved', `${hackathon.name} is already in your dashboard.`);
      } else {
        Alert.alert('Error', 'Could not save hackathon: ' + error.message);
      }
    } else {
      // Fire the full AI plan in the background — it generates tasks, deliverables, milestones, and ideas
      fetch(`${BACKEND_URL}/api/ai-plan`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          hackathon_id: data.id,
          user_id: user.id,
          data: hackathon,
        }),
      }).catch(err => console.error('AI plan trigger failed:', err));

      Alert.alert(
        'Saved! 🎉',
        `${hackathon.name} added to your dashboard.\n\n✨ AI is building your personalised tasks, deliverables, milestones & ideas in the background.`,
      );
      setSelectedHackathon(null);
    }
  };

  const handleLoadMore = () => {
    if (!isLoading && !isFetchingMore && !isRefreshing && hasMore) {
      fetchHackathons(page + 1, true);
    }
  };

  const onRefresh = useCallback(() => {
    fetchHackathons(1, false, true);
  }, [filterSource, filterMode, filterPrize]);

  const renderHeader = () => (
    <>
      <HamburgerHeader onMenuPress={() => setIsMenuOpen(true)} />

      <View style={styles.titleContainer}>
        <Text style={styles.titleLight}>Global</Text>
        <Text style={styles.titleBold}>Discover</Text>
      </View>

      <View style={styles.filterTabsContainer}>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.filterTabs}>
          {SOURCES.map(tab => (
            <TouchableOpacity
              key={tab}
              style={[styles.filterTab, filterSource === tab && styles.filterTabActive]}
              onPress={() => setFilterSource(tab)}
              activeOpacity={0.7}
            >
              <Text style={[styles.filterTabText, filterSource === tab && styles.filterTabTextActive]}>
                {tab === 'All' ? 'All Platforms' : tab.charAt(0).toUpperCase() + tab.slice(1)}
              </Text>
            </TouchableOpacity>
          ))}
        </ScrollView>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.secondaryFilters}>
          {/* Mode Filters */}
          <TouchableOpacity 
            style={[styles.secondaryFilterPill, filterMode === 'all' && styles.secondaryFilterPillActive]}
            onPress={() => setFilterMode('all')}
          >
            <Text style={[styles.secondaryFilterText, filterMode === 'all' && styles.secondaryFilterTextActive]}>Any Mode</Text>
          </TouchableOpacity>
          <TouchableOpacity 
            style={[styles.secondaryFilterPill, filterMode === 'online' && styles.secondaryFilterPillActive]}
            onPress={() => setFilterMode('online')}
          >
            <Text style={[styles.secondaryFilterText, filterMode === 'online' && styles.secondaryFilterTextActive]}>🌍 Online</Text>
          </TouchableOpacity>
          <TouchableOpacity 
            style={[styles.secondaryFilterPill, filterMode === 'offline' && styles.secondaryFilterPillActive]}
            onPress={() => setFilterMode('offline')}
          >
            <Text style={[styles.secondaryFilterText, filterMode === 'offline' && styles.secondaryFilterTextActive]}>🏢 Offline</Text>
          </TouchableOpacity>

          {/* Prize Filter */}
          <TouchableOpacity 
            style={[styles.secondaryFilterPill, filterPrize && styles.secondaryFilterPillActive]}
            onPress={() => setFilterPrize(!filterPrize)}
          >
            <Text style={[styles.secondaryFilterText, filterPrize && styles.secondaryFilterTextActive]}>🏆 Has Prize</Text>
          </TouchableOpacity>
        </ScrollView>
      </View>
    </>
  );

  const cardColors = [colors.accentYellow, colors.accentBlue, colors.accentWhite];

  const renderItem = ({ item: hackathon, index }: { item: GlobalHackathon; index: number }) => {
    const deadline = getDeadline(hackathon);
    const bgColor = cardColors[index % cardColors.length];

    return (
      <View style={{ paddingHorizontal: 24, paddingBottom: 16 }}>
        <TouchableOpacity
          style={[styles.card, { backgroundColor: bgColor }]}
          activeOpacity={0.9}
          onPress={() => setSelectedHackathon(hackathon)}
        >
          <View style={styles.cardInner}>
            <View style={{ backgroundColor: 'transparent' }}>
              <View style={styles.cardHeader}>
                <Text style={styles.cardPlatform} numberOfLines={1}>
                  {hackathon.platform || hackathon.source.toUpperCase()}
                </Text>
                {hackathon.mode ? (
                  <View style={styles.modeBadge}>
                    <Globe color={colors.background} size={12} />
                    <Text style={styles.modeText}>{hackathon.mode}</Text>
                  </View>
                ) : null}
              </View>
              <Text style={styles.cardTitle} numberOfLines={2}>
                {hackathon.name}
              </Text>
              {hackathon.prize ? (
                <Text style={styles.cardTheme} numberOfLines={1}>
                  {`🏆 ${hackathon.prize}`}
                </Text>
              ) : hackathon.location ? (
                <Text style={styles.cardTheme} numberOfLines={1}>
                  {`📍 ${hackathon.location}`}
                </Text>
              ) : null}
            </View>

            <View style={styles.cardFooter}>
              <View style={styles.deadlineWrap}>
                <Text style={styles.cardTimeLabel}>Deadline</Text>
                <Text style={styles.cardTime}>{formatDate(deadline)}</Text>
              </View>
              <View style={styles.iconGroup}>
                <TouchableOpacity
                  onPress={(e) => { e.stopPropagation(); handleSaveHackathon(hackathon); }}
                  activeOpacity={0.7}
                >
                  <Bookmark color={colors.background} size={22} style={{ marginRight: 12 }} />
                </TouchableOpacity>
                <ArrowUpRight color={colors.background} size={24} strokeWidth={1.5} />
              </View>
            </View>
          </View>
        </TouchableOpacity>
      </View>
    );
  };

  return (
    <SafeAreaView style={styles.safeArea}>
      {isLoading && page === 0 ? (
        <View style={{ flex: 1, backgroundColor: 'transparent' }}>
          {renderHeader()}
          <ActivityIndicator color="#000" style={{ marginTop: 40 }} />
        </View>
      ) : (
        <FlatList
          style={styles.container}
          contentContainerStyle={styles.contentContainer}
          showsVerticalScrollIndicator={false}
          ListHeaderComponent={renderHeader}
          data={hackathons}
          keyExtractor={(item) => item.registration_url || item.name}
          renderItem={renderItem}
          ListEmptyComponent={<Text style={styles.emptyText}>No hackathons found.</Text>}
          onEndReached={handleLoadMore}
          onEndReachedThreshold={0.5}
          ListFooterComponent={isFetchingMore ? <ActivityIndicator color="#000" style={{ marginVertical: 20 }} /> : null}
          refreshControl={
            <RefreshControl refreshing={isRefreshing} onRefresh={onRefresh} tintColor={colors.accentYellow} />
          }
        />
      )}

      <HackathonDetailModal
        hackathon={selectedHackathon}
        visible={!!selectedHackathon}
        onClose={() => setSelectedHackathon(null)}
        onSave={handleSaveHackathon}
      />

      <NavigationMenu isOpen={isMenuOpen} setIsOpen={setIsMenuOpen} />
    </SafeAreaView>
  );
}

// ─── Card Styles ──────────────────────────────────────────────
const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: colors.background,
    paddingTop: StatusBar.currentHeight ? StatusBar.currentHeight + 10 : 40,
  },
  container: { flex: 1, backgroundColor: 'transparent' },
  contentContainer: { paddingBottom: 80 },
  titleContainer: { paddingHorizontal: 24, marginBottom: 24, backgroundColor: 'transparent' },
  titleLight: { ...typography.h1, fontWeight: '300', color: colors.text },
  titleBold: { ...typography.h1, fontWeight: '400', color: colors.text, marginTop: -8 },
  filterTabsContainer: { marginBottom: 24, backgroundColor: 'transparent' },
  filterTabs: { paddingHorizontal: 24, gap: 10 },
  filterTab: {
    paddingHorizontal: 18, paddingVertical: 9, borderRadius: 100,
    borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface,
  },
  filterTabActive: { backgroundColor: colors.accentYellow, borderColor: colors.accentYellow },
  filterTabText: { ...typography.body, color: colors.textMuted, fontSize: 14, fontFamily: 'Inter-Medium' },
  filterTabTextActive: { color: '#000' },
  secondaryFilters: {
    paddingHorizontal: 24, gap: 10, paddingBottom: 8,
  },
  secondaryFilterPill: {
    paddingHorizontal: 16, paddingVertical: 8, borderRadius: 100,
    backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.surface,
  },
  secondaryFilterPillActive: {
    backgroundColor: 'transparent', borderColor: colors.text,
  },
  secondaryFilterText: {
    fontFamily: 'Inter-Medium', fontSize: 13, color: colors.textMuted,
  },
  secondaryFilterTextActive: {
    color: colors.text,
  },
  emptyText: { ...typography.body, color: colors.textMuted, textAlign: 'center', paddingTop: 40 },
  card: {
    width: '100%', borderRadius: 24, padding: 20, minHeight: 160,
  },
  cardInner: { flex: 1, justifyContent: 'space-between', backgroundColor: 'transparent' },
  cardHeader: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    marginBottom: 8, backgroundColor: 'transparent', width: '100%',
  },
  cardPlatform: {
    flexShrink: 1, marginRight: 8, ...typography.caption, fontFamily: 'Inter-Medium',
    color: 'rgba(0,0,0,0.6)', letterSpacing: 1, textTransform: 'uppercase',
  },
  modeBadge: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    backgroundColor: 'rgba(0,0,0,0.06)', paddingHorizontal: 10, paddingVertical: 4, borderRadius: 100,
  },
  modeText: { ...typography.caption, fontSize: 10, color: colors.background, textTransform: 'capitalize' },
  cardTitle: { ...typography.h1, fontSize: 32, lineHeight: 36, letterSpacing: -1, color: colors.background, marginBottom: 4 },
  cardTheme: { ...typography.body, fontSize: 14, color: 'rgba(0,0,0,0.7)' },
  cardFooter: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-end',
    marginTop: 24, backgroundColor: 'transparent',
  },
  deadlineWrap: { backgroundColor: 'transparent' },
  cardTimeLabel: { ...typography.caption, color: 'rgba(0,0,0,0.6)', marginBottom: 2 },
  cardTime: { ...typography.body, color: colors.background, fontFamily: 'Inter-Medium' },
  iconGroup: { flexDirection: 'row', alignItems: 'center', backgroundColor: 'transparent' },
});

// ─── Modal Styles ─────────────────────────────────────────────
const modal = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  headerBar: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 20, paddingVertical: 14,
    backgroundColor: 'transparent',
  },
  headerSpacer: { flex: 1, backgroundColor: 'transparent' },
  closeBtn: {
    width: 44, height: 44, borderRadius: 22, backgroundColor: 'transparent',
    alignItems: 'center', justifyContent: 'center',
  },
  saveBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    backgroundColor: colors.accentYellow, paddingHorizontal: 16, paddingVertical: 10,
    borderRadius: 100,
  },
  saveBtnText: { fontFamily: 'Inter-SemiBold', fontSize: 14, color: '#000' },
  scrollContent: { paddingHorizontal: 24, paddingBottom: 40, paddingTop: 10 },
  image: { width: '100%', height: 260, borderRadius: 24, marginBottom: 32, backgroundColor: colors.surface },
  badgeRow: { flexDirection: 'row', gap: 8, flexWrap: 'wrap', marginBottom: 20 },
  badge: {
    backgroundColor: colors.surface, paddingHorizontal: 14, paddingVertical: 6, borderRadius: 100,
  },
  badgeOutline: {
    backgroundColor: 'transparent', borderWidth: 1, borderColor: colors.border,
    flexDirection: 'row', alignItems: 'center', gap: 6,
  },
  badgeGreen: { backgroundColor: 'transparent', borderWidth: 1, borderColor: colors.accentYellow },
  badgeText: { fontFamily: 'Inter-Medium', fontSize: 12, color: colors.text, textTransform: 'uppercase', letterSpacing: 1 },
  title: { ...typography.h1, fontSize: 44, color: colors.text, lineHeight: 48, marginBottom: 12 },
  organizer: { fontFamily: 'Inter-Regular', fontSize: 16, color: colors.textMuted, marginBottom: 32 },
  statsRow: {
    flexDirection: 'row', gap: 24, marginBottom: 40,
    backgroundColor: 'transparent',
  },
  statItem: { flex: 1, flexDirection: 'row', alignItems: 'flex-start', gap: 12 },
  statLabel: { fontFamily: 'Inter-Regular', fontSize: 12, color: colors.textMuted, marginBottom: 4 },
  statValue: { fontFamily: 'Inter-Medium', fontSize: 15, color: colors.text },
  section: { gap: 0, marginBottom: 40 },
  detailRow: {
    flexDirection: 'row', alignItems: 'center', gap: 16,
    backgroundColor: 'transparent', paddingVertical: 16,
    borderBottomWidth: 1, borderBottomColor: colors.border,
  },
  detailContent: { flex: 1, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  detailLabel: { fontFamily: 'Inter-Regular', fontSize: 15, color: colors.textMuted },
  detailValue: { fontFamily: 'Inter-Medium', fontSize: 15, color: colors.text, textAlign: 'right', flexShrink: 1, marginLeft: 16 },
  tagsSection: { marginBottom: 40 },
  tagsSectionHeader: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 16 },
  tagsSectionTitle: { fontFamily: 'Inter-Regular', fontSize: 12, color: colors.textMuted, letterSpacing: 1, textTransform: 'uppercase' },
  tagsWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  tag: {
    backgroundColor: 'transparent', borderWidth: 1, borderColor: colors.border, paddingHorizontal: 14, paddingVertical: 8, borderRadius: 100,
  },
  tagText: { fontFamily: 'Inter-Regular', fontSize: 14, color: colors.text },
  descSection: { marginBottom: 40 },
  descTitle: { fontFamily: 'Inter-Regular', fontSize: 12, color: colors.textMuted, letterSpacing: 1, textTransform: 'uppercase', marginBottom: 16 },
  descText: { fontFamily: 'Inter-Regular', fontSize: 16, color: 'rgba(255, 255, 255, 0.85)', lineHeight: 28 },
  visitBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    gap: 8, backgroundColor: colors.accentWhite, borderRadius: 100, paddingVertical: 20,
    marginBottom: 16,
  },
  visitBtnText: { fontFamily: 'Inter-Medium', fontSize: 18, color: '#000' },
});
