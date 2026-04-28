import React, { useState, useCallback } from 'react';
import { StyleSheet, ScrollView, TouchableOpacity, StatusBar } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Text, View } from '@/components/Themed';
import { ArrowUpRight, Clock } from 'lucide-react-native';
import { colors, typography } from '../../src/theme';
import { supabase } from '../../src/utils/supabase';
import { useRouter, useFocusEffect } from 'expo-router';
import { NavigationMenu, HamburgerHeader } from '@/components/NavigationMenu';

type HackathonStatus = 'Registered' | 'Planning' | 'Building' | 'Submitted' | null;

interface HackathonRow {
  id: string;
  name: string;
  platform: string | null;
  deadline: string;
  status: HackathonStatus;
  theme: string | null;
  prize: string | null;
  location: string | null;
  mode: string | null;
}

const STATUS_COLORS: Record<string, string> = {
  Registered: colors.accentBlue,
  Planning:   '#A78BFA',
  Building:   colors.accentYellow,
  Submitted:  '#4ADE80',
};

function formatDeadline(dateStr: string): string {
  try {
    return new Date(dateStr).toLocaleDateString('en-US', {
      month: 'short', day: 'numeric', year: 'numeric',
    });
  } catch {
    return dateStr;
  }
}

export default function HackathonsScreen() {
  const router = useRouter();
  const [hackathons, setHackathons] = useState<HackathonRow[]>([]);
  const [filter, setFilter] = useState<'All' | 'Upcoming' | 'Past'>('All');
  const [isMenuOpen, setIsMenuOpen] = useState(false);

  useFocusEffect(
    useCallback(() => {
      const fetchHackathons = async () => {
        const { data: { user } } = await supabase.auth.getUser();
        
        let query = supabase
          .from('hackathons')
          .select('id, name, platform, deadline, status, theme, prize, location, mode')
          .order('deadline', { ascending: true });

        if (user) {
          query = query.eq('user_id', user.id);
        } else {
          // If not logged in, just don't show the globally scraped ones
          query = query.is('source', null);
        }

        const { data } = await query;
        if (data) setHackathons(data as HackathonRow[]);
      };
      fetchHackathons();
    }, [])
  );

  const filteredHackathons = hackathons.filter(h => {
    if (filter === 'All') return true;
    const isPast = new Date(h.deadline) < new Date();
    return filter === 'Upcoming' ? !isPast : isPast;
  });

  return (
    <SafeAreaView style={styles.safeArea}>
      <ScrollView
        style={styles.container}
        contentContainerStyle={styles.contentContainer}
        showsVerticalScrollIndicator={false}
      >
        <HamburgerHeader onMenuPress={() => setIsMenuOpen(true)} />

        {/* Title */}
        <View style={styles.titleContainer}>
          <Text style={styles.title}>My Hackathons</Text>
          <Text style={styles.count}>{hackathons.length} total</Text>
        </View>

        {/* Filter tabs */}
        <View style={styles.filterTabsContainer}>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.filterTabs}>
            {(['All', 'Upcoming', 'Past'] as const).map(tab => (
              <TouchableOpacity
                key={tab}
                style={[styles.filterTab, filter === tab && styles.filterTabActive]}
                onPress={() => setFilter(tab)}
                activeOpacity={0.7}
              >
                <Text style={[styles.filterTabText, filter === tab && styles.filterTabTextActive]}>
                  {tab}
                </Text>
              </TouchableOpacity>
            ))}
          </ScrollView>
        </View>

        {/* Colored Cards List */}
        <View style={styles.listContainer}>
          {filteredHackathons.length === 0 && (
            <Text style={styles.emptyText}>No hackathons here yet.</Text>
          )}

          {filteredHackathons.map((hackathon) => {
            // Determine background color safely based on status
            const bgColor = hackathon.status ? (STATUS_COLORS[hackathon.status] || colors.surface) : colors.surface;
            
            // If background is a bright color (not surface/background), use black text. Otherwise white.
            const isDarkBg = bgColor === colors.surface || bgColor === colors.background;
            const textColor = isDarkBg ? colors.text : '#000000';
            const textMutedColor = isDarkBg ? colors.textMuted : 'rgba(0,0,0,0.6)';

            return (
              <TouchableOpacity 
                key={hackathon.id} 
                style={[
                  styles.card, 
                  { backgroundColor: bgColor },
                  isDarkBg && { borderWidth: 1, borderColor: colors.border }
                ]}
                activeOpacity={0.9}
                onPress={() => router.push(`/hackathon/${hackathon.id}`)}
              >
                <View style={styles.cardInner}>
                  <View style={{ backgroundColor: 'transparent' }}>
                    <View style={styles.cardHeader}>
                      <Text style={[styles.cardPlatform, { color: textMutedColor }]}>
                        {hackathon.platform || 'HACKATHON'}
                      </Text>
                      {hackathon.status && (
                        <View style={[styles.statusBadge, { borderColor: textMutedColor }]}>
                          <Text style={[styles.statusText, { color: textMutedColor }]}>
                            {hackathon.status}
                          </Text>
                        </View>
                      )}
                    </View>
                    <Text style={[styles.cardTitle, { color: textColor }]} numberOfLines={2} adjustsFontSizeToFit>
                      {hackathon.name}
                    </Text>

                    {/* Extra Details (API Extracted) */}
                    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 12, backgroundColor: 'transparent' }}>
                      {hackathon.mode && (
                        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: 'rgba(0,0,0,0.05)', paddingHorizontal: 8, paddingVertical: 4, borderRadius: 100 }}>
                          <Text style={{ fontSize: 11, fontFamily: 'Inter-Medium', color: textColor }}>{hackathon.mode === 'online' ? '🌍 Online' : '🏢 ' + hackathon.mode}</Text>
                        </View>
                      )}
                      {hackathon.prize && (
                        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: 'rgba(0,0,0,0.05)', paddingHorizontal: 8, paddingVertical: 4, borderRadius: 100 }}>
                          <Text style={{ fontSize: 11, fontFamily: 'Inter-Medium', color: textColor }} numberOfLines={1}>🏆 {hackathon.prize}</Text>
                        </View>
                      )}
                      {hackathon.location && hackathon.mode !== 'online' && (
                        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: 'rgba(0,0,0,0.05)', paddingHorizontal: 8, paddingVertical: 4, borderRadius: 100, maxWidth: 150 }}>
                          <Text style={{ fontSize: 11, fontFamily: 'Inter-Medium', color: textColor }} numberOfLines={1}>📍 {hackathon.location}</Text>
                        </View>
                      )}
                    </View>
                  </View>
                  
                  <View style={styles.cardFooter}>
                    <View style={styles.deadlineWrap}>
                      <Clock color={textMutedColor} size={16} />
                      <Text style={[styles.cardTime, { color: textColor }]}>
                        {formatDeadline(hackathon.deadline)}
                      </Text>
                    </View>
                    <ArrowUpRight color={textColor} size={28} />
                  </View>
                </View>
              </TouchableOpacity>
            );
          })}
        </View>
      </ScrollView>

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
    backgroundColor: 'transparent',
  },
  contentContainer: {
    paddingBottom: 80,
  },
  titleContainer: {
    paddingHorizontal: 24,
    marginBottom: 32,
    flexDirection: 'column',
    alignItems: 'flex-start',
    justifyContent: 'center',
    backgroundColor: 'transparent',
  },
  title: {
    ...typography.h1,
    fontSize: 48,
    color: colors.text,
  },
  count: {
    ...typography.caption,
    color: colors.textMuted,
    paddingBottom: 8,
  },
  filterTabsContainer: {
    marginBottom: 24,
    backgroundColor: 'transparent',
  },
  filterTabs: {
    paddingHorizontal: 24,
    gap: 10,
  },
  filterTab: {
    paddingHorizontal: 18,
    paddingVertical: 9,
    borderRadius: 100,
    borderWidth: 1,
    borderColor: '#2A2A2A',
    backgroundColor: 'transparent',
  },
  filterTabActive: {
    backgroundColor: colors.text,
    borderColor: colors.text,
  },
  filterTabText: {
    ...typography.body,
    color: colors.textMuted,
    fontSize: 14,
    fontFamily: 'Inter-Medium',
  },
  filterTabTextActive: {
    color: '#000',
  },
  emptyText: {
    ...typography.body,
    color: colors.textMuted,
    textAlign: 'center',
    paddingTop: 40,
  },
  listContainer: {
    paddingHorizontal: 24,
    gap: 16,
    backgroundColor: 'transparent',
  },
  card: {
    width: '100%',
    borderRadius: 32,
    padding: 24,
    minHeight: 180,
  },
  cardInner: {
    flex: 1,
    justifyContent: 'space-between',
    backgroundColor: 'transparent',
  },
  cardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
    backgroundColor: 'transparent',
  },
  cardPlatform: {
    ...typography.caption,
    letterSpacing: 1,
    textTransform: 'uppercase',
  },
  statusBadge: {
    borderWidth: 1,
    borderRadius: 100,
    paddingHorizontal: 10,
    paddingVertical: 4,
    backgroundColor: 'transparent',
  },
  statusText: {
    ...typography.caption,
    fontSize: 10,
    letterSpacing: 0.5,
  },
  cardTitle: {
    ...typography.h2,
    fontSize: 32,
    lineHeight: 36,
  },
  cardFooter: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-end',
    marginTop: 32,
    backgroundColor: 'transparent',
  },
  deadlineWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: 'transparent',
  },
  cardTime: {
    ...typography.body,
    fontFamily: 'Inter-Medium',
  },
});
