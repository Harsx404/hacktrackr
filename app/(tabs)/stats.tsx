import React, { useState, useEffect } from 'react';
import {
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  StatusBar,
  Dimensions,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Text, View } from '@/components/Themed';
import { colors, typography } from '../../src/theme';
import { supabase } from '../../src/utils/supabase';
import { NavigationMenu, HamburgerHeader } from '@/components/NavigationMenu';
import { Trophy, Zap, Clock, CheckCircle } from 'lucide-react-native';

const { width } = Dimensions.get('window');

interface StatsSummary {
  totalHackathons: number;
  submitted: number;
  building: number;
  planning: number;
  registered: number;
  totalTasks: number;
  completedTasks: number;
  totalChecklist: number;
  completedChecklist: number;
  upcomingDeadlines: { name: string; deadline: string; daysLeft: number }[];
  topPlatforms: { name: string; count: number }[];
}

function getDaysUntil(dateStr: string): number {
  return Math.ceil((new Date(dateStr).getTime() - Date.now()) / (1000 * 60 * 60 * 24));
}

function BarRow({ label, value, max, color }: { label: string; value: number; max: number; color: string }) {
  const pct = max > 0 ? value / max : 0;
  return (
    <View style={bar.row}>
      <Text style={bar.label}>{label}</Text>
      <View style={bar.track}>
        <View style={[bar.fill, { width: `${pct * 100}%`, backgroundColor: color }]} />
      </View>
      <Text style={bar.value}>{value}</Text>
    </View>
  );
}

const bar = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 20,
    backgroundColor: 'transparent',
    gap: 12,
  },
  label: {
    ...typography.body,
    color: colors.textMuted,
    fontSize: 13,
    width: 84,
  },
  track: {
    flex: 1,
    height: 2,
    backgroundColor: '#1E1E1E',
    borderRadius: 1,
  },
  fill: {
    height: 2,
    borderRadius: 1,
  },
  value: {
    ...typography.body,
    color: colors.text,
    fontFamily: 'Inter-Light',
    fontSize: 18,
    width: 28,
    textAlign: 'right',
  },
});

export default function StatsScreen() {
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const [stats, setStats] = useState<StatsSummary | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchStats = async () => {
      const [hackRes, taskRes, checkRes] = await Promise.all([
        supabase.from('hackathons').select('id, name, status, platform, deadline'),
        supabase.from('tasks').select('id, status'),
        supabase.from('checklist_items').select('id, is_completed'),
      ]);

      const hackathons = hackRes.data ?? [];
      const tasks = taskRes.data ?? [];
      const checklist = checkRes.data ?? [];

      // Upcoming deadlines
      const upcoming = hackathons
        .map(h => ({ name: h.name, deadline: h.deadline, daysLeft: getDaysUntil(h.deadline) }))
        .filter(h => h.daysLeft >= 0)
        .sort((a, b) => a.daysLeft - b.daysLeft)
        .slice(0, 5);

      // Top platforms
      const platformCount: Record<string, number> = {};
      hackathons.forEach(h => {
        const p = h.platform ?? 'Unknown';
        platformCount[p] = (platformCount[p] ?? 0) + 1;
      });
      const topPlatforms = Object.entries(platformCount)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 5)
        .map(([name, count]) => ({ name, count }));

      setStats({
        totalHackathons: hackathons.length,
        submitted: hackathons.filter(h => h.status === 'Submitted').length,
        building: hackathons.filter(h => h.status === 'Building').length,
        planning: hackathons.filter(h => h.status === 'Planning').length,
        registered: hackathons.filter(h => h.status === 'Registered').length,
        totalTasks: tasks.length,
        completedTasks: tasks.filter(t => t.status === 'done').length,
        totalChecklist: checklist.length,
        completedChecklist: checklist.filter(c => c.is_completed).length,
        upcomingDeadlines: upcoming,
        topPlatforms,
      });
      setLoading(false);
    };

    fetchStats();
  }, []);

  const submissionRate =
    stats && stats.totalHackathons > 0
      ? Math.round((stats.submitted / stats.totalHackathons) * 100)
      : 0;

  const taskCompletionRate =
    stats && stats.totalTasks > 0
      ? Math.round((stats.completedTasks / stats.totalTasks) * 100)
      : 0;

  return (
    <SafeAreaView style={styles.safeArea}>
      <ScrollView
        style={styles.container}
        contentContainerStyle={styles.contentContainer}
        showsVerticalScrollIndicator={false}
      >
        <HamburgerHeader onMenuPress={() => setIsMenuOpen(true)} />

        {/* Title */}
        <View style={styles.titleBlock}>
          <Text style={styles.title}>Stats</Text>
        </View>

        {!loading && stats && (
          <>
            {/* Hero Metrics Row */}
            <View style={styles.heroRow}>
              <View style={styles.heroMetric}>
                <Text style={styles.heroNumber}>{stats.totalHackathons}</Text>
                <Text style={styles.heroLabel}>Entered</Text>
              </View>
              <View style={[styles.heroMetric, styles.heroDivider]}>
                <Text style={[styles.heroNumber, { color: '#4ADE80' }]}>{stats.submitted}</Text>
                <Text style={styles.heroLabel}>Submitted</Text>
              </View>
              <View style={styles.heroMetric}>
                <Text style={[styles.heroNumber, { color: colors.accentYellow }]}>{submissionRate}%</Text>
                <Text style={styles.heroLabel}>Rate</Text>
              </View>
            </View>

            {/* Status Breakdown */}
            <View style={styles.section}>
              <Text style={styles.sectionLabel}>STATUS BREAKDOWN</Text>
              <BarRow label="Submitted" value={stats.submitted} max={stats.totalHackathons} color="#4ADE80" />
              <BarRow label="Building" value={stats.building} max={stats.totalHackathons} color={colors.accentYellow} />
              <BarRow label="Planning" value={stats.planning} max={stats.totalHackathons} color="#A78BFA" />
              <BarRow label="Registered" value={stats.registered} max={stats.totalHackathons} color={colors.accentBlue} />
            </View>

            {/* Task Completion */}
            <View style={styles.section}>
              <Text style={styles.sectionLabel}>PRODUCTIVITY</Text>
              <View style={styles.productivityRow}>
                <View style={styles.productivityCard}>
                  <CheckCircle color={colors.accentYellow} size={20} strokeWidth={1.5} />
                  <Text style={styles.productivityNumber}>{stats.completedTasks}</Text>
                  <Text style={styles.productivityLabel}>Tasks done</Text>
                  <Text style={styles.productivitySub}>of {stats.totalTasks}</Text>
                </View>
                <View style={styles.productivityCard}>
                  <Zap color={colors.accentBlue} size={20} strokeWidth={1.5} />
                  <Text style={styles.productivityNumber}>{stats.completedChecklist}</Text>
                  <Text style={styles.productivityLabel}>Deliverables</Text>
                  <Text style={styles.productivitySub}>of {stats.totalChecklist}</Text>
                </View>
                <View style={styles.productivityCard}>
                  <Trophy color="#4ADE80" size={20} strokeWidth={1.5} />
                  <Text style={styles.productivityNumber}>{taskCompletionRate}%</Text>
                  <Text style={styles.productivityLabel}>Task rate</Text>
                  <Text style={styles.productivitySub}>&nbsp;</Text>
                </View>
              </View>
            </View>

            {/* Top Platforms */}
            {stats.topPlatforms.length > 0 && (
              <View style={styles.section}>
                <Text style={styles.sectionLabel}>TOP PLATFORMS</Text>
                {stats.topPlatforms.map((p, i) => (
                  <BarRow
                    key={p.name}
                    label={p.name}
                    value={p.count}
                    max={stats.topPlatforms[0].count}
                    color={i === 0 ? colors.text : colors.textMuted}
                  />
                ))}
              </View>
            )}

            {/* Upcoming Deadlines */}
            {stats.upcomingDeadlines.length > 0 && (
              <View style={styles.section}>
                <Text style={styles.sectionLabel}>UPCOMING DEADLINES</Text>
                {stats.upcomingDeadlines.map(d => (
                  <View key={d.name} style={styles.deadlineRow}>
                    <View style={styles.deadlineLeft}>
                      <Clock
                        color={d.daysLeft <= 3 ? '#F87171' : d.daysLeft <= 7 ? colors.accentYellow : colors.textMuted}
                        size={14}
                        strokeWidth={1.5}
                      />
                      <Text style={styles.deadlineName} numberOfLines={1}>{d.name}</Text>
                    </View>
                    <Text
                      style={[
                        styles.deadlineDays,
                        { color: d.daysLeft <= 3 ? '#F87171' : d.daysLeft <= 7 ? colors.accentYellow : colors.textMuted },
                      ]}
                    >
                      {d.daysLeft === 0 ? 'Today!' : `${d.daysLeft}d`}
                    </Text>
                  </View>
                ))}
              </View>
            )}

            {/* Empty state */}
            {stats.totalHackathons === 0 && (
              <View style={styles.emptyState}>
                <Text style={styles.emptyTitle}>No data yet</Text>
                <Text style={styles.emptyBody}>
                  Add your first hackathon to start tracking your performance.
                </Text>
              </View>
            )}
          </>
        )}
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
  titleBlock: {
    paddingHorizontal: 24,
    marginBottom: 48,
    backgroundColor: 'transparent',
  },
  title: {
    ...typography.h1,
    fontSize: 48,
    color: colors.text,
  },

  // Hero row
  heroRow: {
    flexDirection: 'row',
    marginHorizontal: 24,
    marginBottom: 56,
    borderTopWidth: 1,
    borderColor: '#1A1A1A',
    backgroundColor: 'transparent',
  },
  heroMetric: {
    flex: 1,
    paddingTop: 24,
    alignItems: 'flex-start',
    backgroundColor: 'transparent',
  },
  heroDivider: {
    borderLeftWidth: 1,
    borderRightWidth: 1,
    borderColor: '#1A1A1A',
    paddingHorizontal: 20,
  },
  heroNumber: {
    fontFamily: 'Inter-ExtraLight',
    fontSize: 52,
    lineHeight: 56,
    letterSpacing: -2,
    color: colors.text,
  },
  heroLabel: {
    ...typography.caption,
    color: colors.textMuted,
    marginTop: 6,
  },

  // Section
  section: {
    paddingHorizontal: 24,
    marginBottom: 48,
    backgroundColor: 'transparent',
  },
  sectionLabel: {
    ...typography.caption,
    color: colors.textMuted,
    letterSpacing: 1.5,
    marginBottom: 24,
  },

  // Productivity cards
  productivityRow: {
    flexDirection: 'row',
    gap: 12,
    backgroundColor: 'transparent',
  },
  productivityCard: {
    flex: 1,
    paddingTop: 20,
    borderTopWidth: 1,
    borderColor: '#1A1A1A',
    backgroundColor: 'transparent',
    gap: 6,
  },
  productivityNumber: {
    fontFamily: 'Inter-Light',
    fontSize: 36,
    lineHeight: 40,
    letterSpacing: -1,
    color: colors.text,
    marginTop: 8,
  },
  productivityLabel: {
    ...typography.body,
    color: colors.text,
    fontSize: 13,
    fontFamily: 'Inter-Medium',
  },
  productivitySub: {
    ...typography.caption,
    color: colors.textMuted,
    letterSpacing: 0,
  },

  // Upcoming deadlines
  deadlineRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 16,
    borderBottomWidth: 1,
    borderColor: '#1A1A1A',
    backgroundColor: 'transparent',
  },
  deadlineLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    flex: 1,
    backgroundColor: 'transparent',
  },
  deadlineName: {
    ...typography.body,
    color: colors.text,
    fontSize: 15,
    fontFamily: 'Inter-Regular',
    flex: 1,
  },
  deadlineDays: {
    fontFamily: 'Inter-Medium',
    fontSize: 15,
    letterSpacing: 0,
  },

  // Empty state
  emptyState: {
    paddingHorizontal: 24,
    paddingTop: 40,
    backgroundColor: 'transparent',
  },
  emptyTitle: {
    ...typography.h2,
    color: colors.text,
    marginBottom: 12,
  },
  emptyBody: {
    ...typography.body,
    color: colors.textMuted,
  },
});
