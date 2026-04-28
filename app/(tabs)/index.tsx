import React, { useState, useEffect, useCallback } from 'react';
import { StyleSheet, ScrollView, TouchableOpacity, Dimensions, StatusBar } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Text, View } from '@/components/Themed';
import { AlertCircle, ArrowUpRight, BookOpen, CheckCircle2, Clock, GraduationCap } from 'lucide-react-native';
import { colors, typography } from '../../src/theme';
import { supabase } from '../../src/utils/supabase';
import { useRouter, useFocusEffect } from 'expo-router';
import { NavigationMenu, HamburgerHeader } from '@/components/NavigationMenu';
import {
  academiaApi,
} from '../../src/services/academiaService';
import {
  getActiveAcademiaAccount,
  subscribeAcademiaSession,
  type AcademiaSessionMode,
} from '../../src/services/academiaSessionService';

const { width } = Dimensions.get('window');

type HackathonStatus = 'Registered' | 'Planning' | 'Building' | 'Submitted' | null;

interface HackathonRow {
  id: string;
  name: string;
  platform: string | null;
  deadline: string;
  theme: string | null;
  status: HackathonStatus;
}

interface AcademiaSummary {
  email: string | null;
  mode: AcademiaSessionMode | null;
  studentName: string | null;
  semester: string | null;
  todayDayOrder: string | null;
  classCount: number;
  nextClassTitle: string | null;
  nextClassTime: string | null;
  attendanceAverage: number | null;
  lowAttendanceCount: number;
  error: string | null;
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

/** Parse "8:00 AM - 8:50 AM" → today's Date at 8:00 */
function parseClassStartTime(timingStr: string | null): Date | null {
  if (!timingStr) return null;
  const startStr = timingStr.split('-')[0].trim();
  const match = startStr.match(/^(\d{1,2}):(\d{2})\s*(AM|PM)$/i);
  if (!match) return null;
  let hours = parseInt(match[1], 10);
  const minutes = parseInt(match[2], 10);
  const ampm = match[3].toUpperCase();
  if (ampm === 'PM' && hours < 12) hours += 12;
  if (ampm === 'AM' && hours === 12) hours = 0;
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), now.getDate(), hours, minutes, 0);
}

function formatCountdown(ms: number): string {
  if (ms <= 0) return 'now';
  const totalSecs = Math.floor(ms / 1000);
  const hours = Math.floor(totalSecs / 3600);
  const mins = Math.floor((totalSecs % 3600) / 60);
  if (hours > 0) return `in ${hours}h ${mins}m`;
  if (mins > 0) return `in ${mins}m`;
  return 'starting soon';
}

export default function DashboardScreen() {
  const router = useRouter();
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const [upcomingHackathon, setUpcomingHackathon] = useState<HackathonRow | null>(null);
  const [totalHackathons, setTotalHackathons] = useState(0);
  const [pendingTasks, setPendingTasks] = useState<any[]>([]);
  const [academiaSummary, setAcademiaSummary] = useState<AcademiaSummary | null>(null);
  const [isAcademiaLoading, setIsAcademiaLoading] = useState(false);
  const [classCountdown, setClassCountdown] = useState<string | null>(null);

  // Tick every 30 s to update the countdown to the next class
  useEffect(() => {
    function tick() {
      const timing = academiaSummary?.nextClassTime ?? null;
      const classStart = parseClassStartTime(timing);
      if (!classStart) { setClassCountdown(null); return; }
      const diff = classStart.getTime() - Date.now();
      if (diff < -50 * 60 * 1000) {
        setClassCountdown(null); // ended more than 50 min ago
      } else if (diff < 0) {
        setClassCountdown('in progress');
      } else {
        setClassCountdown(formatCountdown(diff));
      }
    }
    tick();
    const id = setInterval(tick, 30_000);
    return () => clearInterval(id);
  }, [academiaSummary?.nextClassTime]);

  const fetchDashboardData = async () => {
    const { data: { user } } = await supabase.auth.getUser();

    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);

    // Fetch closest upcoming hackathon
    let upNextQuery = supabase
      .from('hackathons')
      .select('*')
      .gte('deadline', todayStart.toISOString())
      .order('deadline', { ascending: true })
      .limit(1);
      
    if (user) {
      upNextQuery = upNextQuery.eq('user_id', user.id);
    } else {
      upNextQuery = upNextQuery.is('source', null);
    }

    const { data: upNext } = await upNextQuery.single();
    if (upNext) {
      setUpcomingHackathon(upNext as HackathonRow);
    } else {
      setUpcomingHackathon(null);
    }

    // Fetch count
    let countQuery = supabase
      .from('hackathons')
      .select('*', { count: 'exact', head: true });
      
    if (user) {
      countQuery = countQuery.eq('user_id', user.id);
    } else {
      countQuery = countQuery.is('source', null);
    }

    const { count } = await countQuery;
    if (count !== null) setTotalHackathons(count);

    // Fetch pending tasks
    let tasksQuery = supabase
      .from('tasks')
      .select('*, hackathons(name)')
      .eq('status', 'todo')
      .limit(4);
      
    if (user) {
      tasksQuery = tasksQuery.eq('user_id', user.id);
    }

    const { data: tasks } = await tasksQuery;
    if (tasks) setPendingTasks(tasks);
  };

  const fetchAcademiaSummary = async () => {
    setIsAcademiaLoading(true);

    try {
      const { data: { user } } = await supabase.auth.getUser();
      const academiaAccount = await getActiveAcademiaAccount(user?.id);
      if (!academiaAccount) {
        setAcademiaSummary(null);
        return;
      }

      const summaryRes = await academiaApi.summary(academiaAccount.email);
      if (!summaryRes.success) throw new Error(summaryRes.error || 'Could not load Academia.');

      const student = summaryRes.studentInfo || null;
      const nextClassTitle = summaryRes.nextClass?.courseTitle || summaryRes.nextClass?.courseCode || null;

      setAcademiaSummary({
        email: academiaAccount.email,
        mode: academiaAccount.mode,
        studentName: student?.Name || null,
        semester: summaryRes.semester || student?.Semester || null,
        todayDayOrder: summaryRes.todayDayOrder || null,
        classCount: summaryRes.classCount ?? 0,
        nextClassTitle,
        nextClassTime: summaryRes.nextClass?.timing || null,
        attendanceAverage: summaryRes.attendanceAverage ?? null,
        lowAttendanceCount: summaryRes.lowAttendanceCount ?? 0,
        error: null,
      });
    } catch (error) {
      setAcademiaSummary((prev) => ({
        email: prev?.email || null,
        mode: prev?.mode || null,
        studentName: prev?.studentName || null,
        semester: prev?.semester || null,
        todayDayOrder: prev?.todayDayOrder || null,
        classCount: prev?.classCount || 0,
        nextClassTitle: prev?.nextClassTitle || null,
        nextClassTime: prev?.nextClassTime || null,
        attendanceAverage: prev?.attendanceAverage || null,
        lowAttendanceCount: prev?.lowAttendanceCount || 0,
        error: error instanceof Error ? error.message : 'Could not load Academia.',
      }));
    } finally {
      setIsAcademiaLoading(false);
    }
  };

  useFocusEffect(
    useCallback(() => {
      fetchDashboardData();
      fetchAcademiaSummary();
    }, [])
  );

  useEffect(() => {
    // The subscription to hackathons
    const channel = supabase
      .channel(`public:dashboard_${Date.now()}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'hackathons' }, () => {
        fetchDashboardData(); // Refetch on any change to keep dashboard fresh
      })
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, []);

  useEffect(() => subscribeAcademiaSession(() => {
    fetchAcademiaSummary();
  }), []);

  const accentColor = upcomingHackathon?.status 
    ? STATUS_COLORS[upcomingHackathon.status] || colors.accentBlue 
    : colors.accentBlue;

  return (
    <SafeAreaView style={styles.safeArea}>
      <ScrollView style={styles.container} contentContainerStyle={styles.contentContainer} showsVerticalScrollIndicator={false}>
        
        {/* Header / Nav */}
        <HamburgerHeader onMenuPress={() => setIsMenuOpen(true)} />

        {/* Title */}
        <View style={styles.titleContainer}>
          <Text style={styles.titleBold}>Command Center</Text>
        </View>

        {/* Up Next Hero */}
        {upcomingHackathon && (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>UP NEXT</Text>
            <TouchableOpacity 
              style={styles.heroCard}
              onPress={() => router.push(`/hackathon/${upcomingHackathon.id}`)}
              activeOpacity={0.8}
            >
              <View style={styles.heroContent}>
                <View style={styles.heroHeaderRow}>
                  <Text style={[styles.heroPlatform, { color: accentColor }]}>
                    {upcomingHackathon.platform || 'HACKATHON'}
                  </Text>
                  {upcomingHackathon.status && (
                    <View style={[styles.statusBadge, { borderColor: accentColor }]}>
                      <Text style={[styles.statusText, { color: accentColor }]}>
                        {upcomingHackathon.status}
                      </Text>
                    </View>
                  )}
                </View>
                
                <Text style={styles.heroTitleHuge} numberOfLines={2} adjustsFontSizeToFit>
                  {upcomingHackathon.name}
                </Text>
                
                <View style={styles.heroFooter}>
                  <View style={styles.deadlineWrap}>
                    <Clock color={colors.textMuted} size={14} />
                    <Text style={styles.heroTime}>{formatDeadline(upcomingHackathon.deadline)}</Text>
                  </View>
                  <ArrowUpRight color={colors.text} size={28} strokeWidth={1.5} />
                </View>
              </View>
            </TouchableOpacity>
          </View>
        )}

        {/* Stats Grid */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>OVERVIEW</Text>
          <View style={styles.bentoGrid}>
            <View style={styles.bentoBox}>
              <Text style={styles.bentoNumber}>{totalHackathons}</Text>
              <Text style={styles.bentoLabel}>Total events</Text>
            </View>
            <View style={styles.bentoBox}>
              <Text style={styles.bentoNumber}>{pendingTasks.length}</Text>
              <Text style={styles.bentoLabel}>Pending tasks</Text>
            </View>
          </View>
        </View>

        {/* Academia Snapshot */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>ACADEMIA</Text>
          <TouchableOpacity
            style={styles.academiaCard}
            onPress={() => router.push('/academia')}
            activeOpacity={0.85}
          >
            {!academiaSummary && !isAcademiaLoading ? (
              <View style={styles.academiaConnect}>
                <GraduationCap color={colors.accentBlue} size={26} strokeWidth={1.5} />
                <View style={styles.taskContent}>
                  <Text style={styles.academiaTitle}>Connect Academia</Text>
                  <Text style={styles.academiaMuted}>Sign in once to show classes and attendance here.</Text>
                </View>
                <ArrowUpRight color={colors.text} size={24} strokeWidth={1.5} />
              </View>
            ) : (
              <>
                <View style={styles.academiaHeader}>
                  <View>
                    <Text style={styles.academiaOverline}>
                      {academiaSummary?.mode === 'temporary'
                        ? 'TEMP ACADEMIA'
                        : academiaSummary?.semester ? `SEMESTER ${academiaSummary.semester}` : 'SRM ACADEMIA'}
                    </Text>
                    <Text style={styles.academiaTitle} numberOfLines={1}>
                      {academiaSummary?.studentName || 'Academia'}
                    </Text>
                  </View>
                  <ArrowUpRight color={colors.text} size={24} strokeWidth={1.5} />
                </View>

                {academiaSummary?.error ? (
                  <View style={styles.academiaError}>
                    <AlertCircle color="#F87171" size={16} strokeWidth={1.5} />
                    <Text style={styles.academiaErrorText} numberOfLines={2}>
                      {academiaSummary.error}
                    </Text>
                  </View>
                ) : null}

                <View style={styles.academiaStatsRow}>
                  <View style={styles.academiaStat}>
                    <BookOpen color={colors.accentYellow} size={18} strokeWidth={1.5} />
                    <Text style={styles.academiaNumber}>
                      {isAcademiaLoading && !academiaSummary ? '-' : academiaSummary?.classCount ?? 0}
                    </Text>
                    <Text style={styles.academiaLabel}>
                      {academiaSummary?.todayDayOrder ? `Day ${academiaSummary.todayDayOrder}` : 'Classes'}
                    </Text>
                  </View>
                  <View style={styles.academiaStat}>
                    <CheckCircle2
                      color={(academiaSummary?.lowAttendanceCount || 0) > 0 ? '#F87171' : colors.accentBlue}
                      size={18}
                      strokeWidth={1.5}
                    />
                    <Text style={styles.academiaNumber}>
                      {academiaSummary?.attendanceAverage === null || academiaSummary?.attendanceAverage === undefined
                        ? '-'
                        : `${academiaSummary.attendanceAverage}%`}
                    </Text>
                    <Text style={styles.academiaLabel}>Attendance</Text>
                  </View>
                </View>

                {academiaSummary?.nextClassTitle ? (
                  <View style={styles.nextClassRow}>
                    <Clock color={colors.textMuted} size={15} strokeWidth={1.5} />
                    <Text style={styles.nextClassText} numberOfLines={1}>
                      {academiaSummary.nextClassTime} / {academiaSummary.nextClassTitle}
                    </Text>
                    {classCountdown ? (
                      <Text style={styles.countdownBadge}>{classCountdown}</Text>
                    ) : null}
                  </View>
                ) : (
                  <Text style={styles.academiaMuted}>
                    {isAcademiaLoading ? 'Loading academic snapshot...' : 'No class found for today.'}
                  </Text>
                )}
              </>
            )}
          </TouchableOpacity>
        </View>

        {/* Needs Attention */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>NEEDS ATTENTION</Text>
          <View style={styles.tasksCard}>
            {pendingTasks.length > 0 ? (
              pendingTasks.map((task, idx) => (
                <View key={task.id} style={[styles.taskRow, idx > 0 && styles.taskRowBorder]}>
                  <CheckCircle2 color={colors.accentYellow} size={20} strokeWidth={1.5} />
                  <View style={styles.taskContent}>
                    <Text style={styles.taskTitle} numberOfLines={1}>{task.title}</Text>
                    <Text style={styles.taskSubtitle} numberOfLines={1}>
                      {task.hackathons?.name || 'Hackathon task'}
                    </Text>
                  </View>
                </View>
              ))
            ) : (
              <Text style={styles.emptyText}>You're all caught up! No pending tasks.</Text>
            )}
          </View>
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
    marginBottom: 40,
    backgroundColor: 'transparent',
  },
  titleBold: {
    ...typography.h1,
    fontSize: 48,
    color: colors.text,
  },
  section: {
    marginBottom: 40,
    paddingHorizontal: 24,
    backgroundColor: 'transparent',
  },
  sectionTitle: {
    ...typography.caption,
    color: colors.textMuted,
    marginBottom: 16,
    letterSpacing: 1,
  },
  heroCard: {
    backgroundColor: colors.surface,
    borderRadius: 24,
    borderWidth: 1,
    borderColor: colors.border,
    overflow: 'hidden',
  },
  heroContent: {
    padding: 24,
    backgroundColor: 'transparent',
  },
  heroHeaderRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
    backgroundColor: 'transparent',
  },
  heroPlatform: {
    ...typography.caption,
    letterSpacing: 1,
    textTransform: 'uppercase',
  },
  statusBadge: {
    borderWidth: 1,
    borderRadius: 100,
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  statusText: {
    ...typography.caption,
    fontSize: 10,
    letterSpacing: 0.5,
  },
  heroTitleHuge: {
    ...typography.display,
    fontSize: 52,
    lineHeight: 56,
    color: colors.text,
    marginBottom: 32,
  },
  heroFooter: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-end',
    backgroundColor: 'transparent',
  },
  deadlineWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: 'transparent',
  },
  heroTime: {
    ...typography.body,
    fontSize: 16,
    color: colors.textMuted,
  },
  bentoGrid: {
    flexDirection: 'row',
    gap: 16,
    backgroundColor: 'transparent',
  },
  bentoBox: {
    flex: 1,
    backgroundColor: colors.surface,
    borderRadius: 24,
    padding: 20,
    borderWidth: 1,
    borderColor: colors.border,
  },
  bentoNumber: {
    ...typography.display,
    fontSize: 48,
    lineHeight: 52,
    color: colors.text,
  },
  bentoLabel: {
    ...typography.body,
    color: colors.textMuted,
    fontSize: 14,
    marginTop: 4,
  },
  tasksCard: {
    backgroundColor: colors.surface,
    borderRadius: 24,
    padding: 20,
    borderWidth: 1,
    borderColor: colors.border,
  },
  academiaCard: {
    backgroundColor: colors.surface,
    borderRadius: 24,
    padding: 20,
    borderWidth: 1,
    borderColor: colors.border,
  },
  academiaConnect: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 16,
    backgroundColor: 'transparent',
  },
  academiaHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    gap: 16,
    marginBottom: 18,
    backgroundColor: 'transparent',
  },
  academiaOverline: {
    ...typography.caption,
    color: colors.accentBlue,
    letterSpacing: 1.2,
    marginBottom: 4,
  },
  academiaTitle: {
    ...typography.h3,
    color: colors.text,
    fontSize: 22,
    lineHeight: 26,
  },
  academiaMuted: {
    ...typography.body,
    color: colors.textMuted,
    fontSize: 14,
    lineHeight: 20,
  },
  academiaStatsRow: {
    flexDirection: 'row',
    gap: 14,
    marginBottom: 18,
    backgroundColor: 'transparent',
  },
  academiaStat: {
    flex: 1,
    borderTopWidth: 1,
    borderColor: '#1A1A1A',
    paddingTop: 14,
    backgroundColor: 'transparent',
    gap: 6,
  },
  academiaNumber: {
    fontFamily: 'Inter-Light',
    fontSize: 34,
    lineHeight: 38,
    color: colors.text,
  },
  academiaLabel: {
    ...typography.caption,
    color: colors.textMuted,
    letterSpacing: 0.8,
  },
  nextClassRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: 'transparent',
    borderTopWidth: 1,
    borderColor: '#1A1A1A',
    paddingTop: 14,
  },
  nextClassText: {
    ...typography.body,
    color: colors.textMuted,
    fontSize: 14,
    flex: 1,
  },
  countdownBadge: {
    ...typography.caption,
    color: colors.accentYellow,
    borderWidth: 1,
    borderColor: 'rgba(205, 215, 70, 0.3)',
    borderRadius: 100,
    paddingHorizontal: 8,
    paddingVertical: 3,
    letterSpacing: 0.3,
  },
  academiaError: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
    backgroundColor: 'rgba(248, 113, 113, 0.08)',
    borderColor: 'rgba(248, 113, 113, 0.24)',
    borderWidth: 1,
    borderRadius: 14,
    padding: 12,
    marginBottom: 16,
  },
  academiaErrorText: {
    ...typography.body,
    color: '#FCA5A5',
    fontSize: 13,
    lineHeight: 18,
    flex: 1,
  },
  taskRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'transparent',
    paddingVertical: 12,
    gap: 16,
  },
  taskRowBorder: {
    borderTopWidth: 1,
    borderColor: '#1A1A1A',
  },
  taskContent: {
    flex: 1,
    backgroundColor: 'transparent',
  },
  taskTitle: {
    ...typography.body,
    color: colors.text,
    fontSize: 16,
    marginBottom: 2,
  },
  taskSubtitle: {
    ...typography.caption,
    color: colors.textMuted,
    textTransform: 'none',
    letterSpacing: 0,
  },
  emptyText: {
    ...typography.body,
    color: colors.textMuted,
    textAlign: 'center',
    paddingVertical: 20,
  },
});
