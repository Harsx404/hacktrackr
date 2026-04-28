import AsyncStorage from '@react-native-async-storage/async-storage';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Image,
  KeyboardAvoidingView,
  Linking,
  Modal,
  Platform,
  RefreshControl,
  ScrollView,
  Share,
  StatusBar,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import {
  AlertCircle,
  ArrowUpRight,
  BarChart3,
  BookOpen,
  Calendar,
  CheckCircle2,
  Clock,
  FileDown,
  GraduationCap,
  Lock,
  LogOut,
  RefreshCw,
  User,
  Users,
  X,
} from 'lucide-react-native';

import { HamburgerHeader, NavigationMenu } from '@/components/NavigationMenu';
import { academiaApi, academiaApiUrl, type AcademiaSem, type AttendanceRecord, type CalendarData, type FacultyProfile, type MarksRecord, type MarksTest, type StudentInfo, type TimetableCourse, type TimetableData } from '@/src/services/academiaService';
import {
  clearTemporaryAcademiaEmail,
  getActiveAcademiaAccount,
  getBoundAcademiaEmail,
  removeBoundAcademiaEmail,
  setBoundAcademiaEmail,
  setTemporaryAcademiaEmail,
  type AcademiaSessionMode,
} from '@/src/services/academiaSessionService';
import { colors, typography } from '@/src/theme';
import { supabase } from '@/src/utils/supabase';

type AcademiaTab = 'Schedule' | 'Attendance' | 'Marks' | 'Courses' | 'Calendar';

interface ScheduleClass {
  courseCode: string;
  courseTitle: string;
  category: string;
  facultyName: string;
  facultyPhotoUrl: string;
  roomNo: string;
  timing: string;
  hourIndex: number;
  slotToken: string;
}

interface ScheduleData {
  date: string;
  monthName: string;
  dayOfWeek: string;
  dayOrder: string | null;
  todayDayOrder: string | null;
  event: string;
  isHoliday: boolean;
  isWeekend: boolean;
  isOverride: boolean;
  semester: string;
  semType: AcademiaSem;
  classes: ScheduleClass[];
}

const STORAGE_OPTIONAL_KEY = 'academia_optional_classes';
const DAY_ORDERS = ['1', '2', '3', '4', '5'] as const;

const ACADEMIA_TABS: { id: AcademiaTab; label: string }[] = [
  { id: 'Schedule', label: 'Schedule' },
  { id: 'Attendance', label: 'Attendance' },
  { id: 'Marks', label: 'Marks' },
  { id: 'Courses', label: 'Courses' },
  { id: 'Calendar', label: 'Calendar' },
];

function numberValue(value: unknown): number {
  const parsed = typeof value === 'number' ? value : parseFloat(String(value ?? '0'));
  return Number.isFinite(parsed) ? parsed : 0;
}

function stringValue(value: unknown, fallback = ''): string {
  if (value === null || value === undefined) return fallback;
  return String(value);
}

function calculateMargin(totalConducted: number, absent: number) {
  if (totalConducted <= 0) return 0;

  let margin = 0;
  let present = totalConducted - absent;
  let current = (present / totalConducted) * 100;
  let conducted = totalConducted;
  let guard = 0;

  if (current > 75) {
    while (current >= 75 && guard < 1000) {
      conducted += 1;
      margin += 1;
      current = (present / conducted) * 100;
      guard += 1;
    }
    return Math.max(0, margin - 1);
  }

  while (current < 75 && guard < 1000) {
    conducted += 1;
    present += 1;
    margin -= 1;
    current = (present / conducted) * 100;
    guard += 1;
  }

  return margin;
}

function isSessionError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error ?? '');
  return message.toLowerCase().includes('session');
}

function normalizeQuotes(value: string) {
  return value.replace(/[\u2018\u2019\u201A\u201B\u2032\u2035`']/g, "'").toLowerCase().trim();
}

function getCurrentCalendarParts() {
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const now = new Date();

  return {
    date: String(now.getDate()),
    dayOfWeek: days[now.getDay()],
    monthName: `${months[now.getMonth()]} '${String(now.getFullYear()).slice(2)}`,
    isWeekend: now.getDay() === 0 || now.getDay() === 6,
  };
}

function findTodayCalendarEntry(calendar: CalendarData | null) {
  const parts = getCurrentCalendarParts();
  const month = calendar?.months?.find((item) => normalizeQuotes(item.name || '') === normalizeQuotes(parts.monthName));
  const day = month?.days?.find((item) => String(item.date ?? '').trim() === parts.date);

  return {
    ...parts,
    todayDayOrder: day?.dayOrder && day.dayOrder !== '-' ? String(day.dayOrder) : null,
    event: String(day?.event || ''),
  };
}

function buildScheduleData({
  student,
  timetable,
  calendarEven,
  calendarOdd,
  selectedDay,
}: {
  student: StudentInfo | null;
  timetable: TimetableData | null;
  calendarEven: CalendarData | null;
  calendarOdd: CalendarData | null;
  selectedDay: string | null;
}): ScheduleData | null {
  if (!student || !timetable) return null;

  const semester = stringValue(student.Semester, '1');
  const semType: AcademiaSem = parseInt(semester, 10) % 2 === 0 ? 'even' : 'odd';
  const calendar = semType === 'even' ? calendarEven : calendarOdd;
  const today = findTodayCalendarEntry(calendar);
  const dayOrder = selectedDay || today.todayDayOrder;
  const classes: ScheduleClass[] = [];

  if (dayOrder) {
    for (const course of timetable.courses || []) {
      for (const slot of course.schedule || []) {
        if (slot.day === `Day ${dayOrder}`) {
          classes.push({
            courseCode: stringValue(course.courseCode),
            courseTitle: stringValue(course.courseTitle, 'Untitled course'),
            category: stringValue(course.category || course.courseType),
            facultyName: stringValue(course.facultyName),
            facultyPhotoUrl: stringValue(course.facultyPhotoUrl),
            roomNo: stringValue(course.roomNo),
            timing: stringValue(slot.timing),
            hourIndex: numberValue(slot.hourIndex),
            slotToken: stringValue(slot.slotToken),
          });
        }
      }
    }
  }

  classes.sort((a, b) => a.hourIndex - b.hourIndex);

  return {
    date: today.date,
    monthName: today.monthName,
    dayOfWeek: today.dayOfWeek,
    dayOrder,
    todayDayOrder: today.todayDayOrder,
    event: selectedDay ? '' : today.event,
    isHoliday: !selectedDay && !today.isWeekend && !today.todayDayOrder && !!today.event,
    isWeekend: !selectedDay && today.isWeekend,
    isOverride: !!selectedDay,
    semester,
    semType,
    classes,
  };
}

function proxiedFacultyPhoto(url?: string) {
  if (!url) return null;
  if (url.startsWith('data:')) return url;
  return academiaApiUrl(`/faculty-photo?url=${encodeURIComponent(url)}`);
}

function studentPhotoUrl(student: StudentInfo | null, email: string | null) {
  if (student?.PhotoUrl?.startsWith('data:')) return student.PhotoUrl;
  if (email) return academiaApiUrl(`/student-photo?email=${encodeURIComponent(email)}`);
  return null;
}

function cleanFacultyName(name: string) {
  return name.replace(/\s*\(.*?\)\s*/g, '').trim();
}

// ── Upcoming events helper ────────────────────────────────────────────────────
interface UpcomingEvent {
  fullDate: Date;
  dateStr: string;
  monthName: string;
  event: string;
  dayOrder: string;
  isHoliday: boolean;
}

const EVENT_MONTH_NAMES = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];

function getUpcomingEvents(calendar: CalendarData | null, limit = 8): UpcomingEvent[] {
  if (!calendar?.months) return [];
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const events: UpcomingEvent[] = [];

  for (const month of calendar.months) {
    const mn = normalizeQuotes(month.name || '').trim();
    const match = mn.match(/^(\w+)\s*'(\d{2})$/i);
    if (!match) continue;
    const mIdx = EVENT_MONTH_NAMES.findIndex((m) => match[1].toLowerCase().startsWith(m));
    if (mIdx < 0) continue;
    const year = 2000 + parseInt(match[2], 10);

    for (const day of (month.days || [])) {
      const dayNum = parseInt(String(day.date), 10);
      if (!dayNum) continue;
      const event = String(day.event || '').trim();
      if (!event || event === '-') continue;
      const fullDate = new Date(year, mIdx, dayNum);
      if (fullDate < today) continue;
      events.push({
        fullDate,
        dateStr: String(day.date),
        monthName: month.name || '',
        event,
        dayOrder: String(day.dayOrder || '-'),
        isHoliday: (!day.dayOrder || day.dayOrder === '-') && !!event,
      });
    }
  }

  return events.sort((a, b) => a.fullDate.getTime() - b.fullDate.getTime()).slice(0, limit);
}

function daysUntil(date: Date): number {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return Math.round((date.getTime() - today.getTime()) / 86_400_000);
}

// ── Timetable HTML builder (for PDF export via expo-print) ────────────────────
function buildTimetableHtml(timetable: TimetableData): string {
  const rows = (timetable.courses || []).map((c) => {
    const sched = (c.schedule || []).map((s) => `${s.day} · ${s.timing}`).join('<br/>');
    return `<tr>
      <td>${c.courseCode || '—'}</td>
      <td>${c.courseTitle || '—'}</td>
      <td>${c.category || '—'}</td>
      <td>${c.credit || '—'}</td>
      <td>${c.slot || '—'}</td>
      <td>${c.roomNo || '—'}</td>
      <td>${cleanFacultyName(c.facultyName || '—')}</td>
      <td>${sched || '—'}</td>
    </tr>`;
  }).join('');
  return `<!DOCTYPE html><html><head><meta charset="utf-8"/>
<style>
body{font-family:Arial,sans-serif;padding:24px;color:#111;}
h1{font-size:22px;margin:0 0 4px;}p.sub{color:#666;font-size:12px;margin:0 0 20px;}
table{width:100%;border-collapse:collapse;font-size:11px;}
th{background:#111;color:#fff;padding:10px 8px;text-align:left;}
td{padding:8px;border-bottom:1px solid #e5e5e5;vertical-align:top;}
tr:nth-child(even)td{background:#f9f9f9;}
</style></head><body>
<h1>Timetable</h1>
<p class="sub">HackTrackr · ${new Date().toLocaleDateString()}</p>
<table><thead><tr>
<th>Code</th><th>Course</th><th>Type</th><th>Cr</th>
<th>Slot</th><th>Room</th><th>Faculty</th><th>Schedule</th>
</tr></thead><tbody>${rows}</tbody></table>
</body></html>`;
}

function SectionLabel({ children }: { children: string }) {
  return <Text style={styles.sectionLabel}>{children}</Text>;
}

function EmptyState({ title, body }: { title: string; body?: string }) {
  return (
    <View style={styles.emptyState}>
      <AlertCircle color={colors.textMuted} size={24} strokeWidth={1.5} />
      <Text style={styles.emptyTitle}>{title}</Text>
      {body ? <Text style={styles.emptyBody}>{body}</Text> : null}
    </View>
  );
}

function LoadingBlock({ text }: { text: string }) {
  return (
    <View style={styles.loadingBlock}>
      <ActivityIndicator color={colors.accentYellow} />
      <Text style={styles.loadingText}>{text}</Text>
    </View>
  );
}

function ErrorBlock({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <View style={styles.errorBlock}>
      <AlertCircle color="#F87171" size={26} strokeWidth={1.5} />
      <Text style={styles.errorTitle}>Failed to load data</Text>
      <Text style={styles.errorBody}>{message}</Text>
      <TouchableOpacity style={styles.errorButton} onPress={onRetry} activeOpacity={0.8}>
        <Text style={styles.errorButtonText}>Try Again</Text>
      </TouchableOpacity>
    </View>
  );
}

function TabSelector({ activeTab, onChange }: { activeTab: AcademiaTab; onChange: (tab: AcademiaTab) => void }) {
  return (
    <View style={styles.filterTabsContainer}>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.filterTabs}>
        {ACADEMIA_TABS.map((tab) => {
          const isActive = tab.id === activeTab;
          return (
            <TouchableOpacity
              key={tab.id}
              style={[styles.filterTab, isActive && styles.filterTabActive]}
              onPress={() => onChange(tab.id)}
              activeOpacity={0.7}
            >
              <Text style={[styles.filterTabText, isActive && styles.filterTabTextActive]}>{tab.label}</Text>
            </TouchableOpacity>
          );
        })}
      </ScrollView>
    </View>
  );
}

function LoginPanel({
  email,
  password,
  mode,
  error,
  loading,
  onEmailChange,
  onPasswordChange,
  onModeChange,
  onSubmit,
}: {
  email: string;
  password: string;
  mode: AcademiaSessionMode;
  error: string | null;
  loading: boolean;
  onEmailChange: (value: string) => void;
  onPasswordChange: (value: string) => void;
  onModeChange: (value: AcademiaSessionMode) => void;
  onSubmit: () => void;
}) {
  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView style={styles.container} contentContainerStyle={styles.contentContainer} keyboardShouldPersistTaps="handled">
        <View style={styles.titleContainer}>
          <Text style={styles.titleLight}>SRM</Text>
          <Text style={styles.titleBold}>Academia</Text>
          <Text style={styles.subtitle}>Sign in with your student account.</Text>
        </View>

        <View style={styles.loginCard}>
          {error ? (
            <View style={styles.inlineError}>
              <AlertCircle color="#F87171" size={18} />
              <Text style={styles.inlineErrorText}>{error}</Text>
            </View>
          ) : null}

          <View style={styles.modeSwitch}>
            {(['bound', 'temporary'] as AcademiaSessionMode[]).map((item) => {
              const isActive = item === mode;
              return (
                <TouchableOpacity
                  key={item}
                  style={[styles.modeButton, isActive && styles.modeButtonActive]}
                  onPress={() => onModeChange(item)}
                  disabled={loading}
                  activeOpacity={0.85}
                >
                  <Text style={[styles.modeButtonText, isActive && styles.modeButtonTextActive]}>
                    {item === 'bound' ? 'Bind main' : 'Temporary'}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </View>
          <Text style={styles.modeHint}>
            {mode === 'bound'
              ? 'Saved for this HackTrackr account.'
              : 'Kept only until the app restarts.'}
          </Text>

          <View style={styles.inputGroup}>
            <Text style={styles.inputLabel}>EMAIL ADDRESS</Text>
            <View style={styles.inputShell}>
              <User color={colors.textMuted} size={18} strokeWidth={1.5} />
              <TextInput
                style={styles.textInput}
                value={email}
                onChangeText={onEmailChange}
                placeholder="name@srmist.edu.in"
                placeholderTextColor={colors.textMuted}
                autoCapitalize="none"
                autoCorrect={false}
                keyboardType="email-address"
              />
            </View>
          </View>

          <View style={styles.inputGroup}>
            <Text style={styles.inputLabel}>PASSWORD</Text>
            <View style={styles.inputShell}>
              <Lock color={colors.textMuted} size={18} strokeWidth={1.5} />
              <TextInput
                style={styles.textInput}
                value={password}
                onChangeText={onPasswordChange}
                placeholder="Academia password"
                placeholderTextColor={colors.textMuted}
                secureTextEntry
              />
            </View>
          </View>

          <TouchableOpacity
            style={[styles.primaryButton, (!email.trim() || !password.trim() || loading) && styles.buttonDisabled]}
            onPress={onSubmit}
            disabled={!email.trim() || !password.trim() || loading}
            activeOpacity={0.85}
          >
            {loading ? (
              <ActivityIndicator color="#000" />
            ) : (
              <>
                <Text style={styles.primaryButtonText}>
                  {mode === 'bound' ? 'Bind & Sign In' : 'Use Temporarily'}
                </Text>
                <ArrowUpRight color="#000" size={18} strokeWidth={2} />
              </>
            )}
          </TouchableOpacity>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

function StudentHero({
  student,
  email,
  mode,
  onLogout,
  onTemporary,
}: {
  student: StudentInfo | null;
  email: string;
  mode: AcademiaSessionMode;
  onLogout: () => void;
  onTemporary: () => void;
}) {
  const photo = studentPhotoUrl(student, email);
  const name = student?.Name || 'Student';
  const regNo = student?.['Registration Number'];

  return (
    <View style={styles.studentHero}>
      <View style={styles.studentTopRow}>
        <View style={styles.avatar}>
          {photo ? (
            <Image source={{ uri: photo }} style={styles.avatarImage} />
          ) : (
            <Text style={styles.avatarFallback}>{name.charAt(0)}</Text>
          )}
        </View>
        <View style={styles.studentActions}>
          {mode === 'bound' ? (
            <TouchableOpacity style={styles.logoutButton} onPress={onTemporary} activeOpacity={0.8}>
              <Users color={colors.textMuted} size={18} strokeWidth={1.5} />
              <Text style={styles.logoutText}>Temporary</Text>
            </TouchableOpacity>
          ) : (
            <View style={styles.modeBadge}>
              <Text style={styles.modeBadgeText}>TEMP</Text>
            </View>
          )}
          <TouchableOpacity style={styles.logoutButton} onPress={onLogout} activeOpacity={0.8}>
            <LogOut color={colors.textMuted} size={18} strokeWidth={1.5} />
            <Text style={styles.logoutText}>{mode === 'temporary' ? 'End temp' : 'Disconnect'}</Text>
          </TouchableOpacity>
        </View>
      </View>

      <Text style={styles.studentName} numberOfLines={2} adjustsFontSizeToFit>
        {name}
      </Text>
      <Text style={styles.studentMeta} numberOfLines={2}>
        {[student?.Program, student?.Department].filter(Boolean).join(' / ') || email}
      </Text>

      <View style={styles.studentStats}>
        <View style={styles.studentStat}>
          <Text style={styles.studentStatValue}>{student?.Semester || '-'}</Text>
          <Text style={styles.studentStatLabel}>Semester</Text>
        </View>
        <View style={styles.studentStat}>
          <Text style={styles.studentStatValue}>{student?.Section || '-'}</Text>
          <Text style={styles.studentStatLabel}>Section</Text>
        </View>
        <View style={styles.studentStat}>
          <Text style={styles.studentStatValue} numberOfLines={1} adjustsFontSizeToFit>
            {regNo || '-'}
          </Text>
          <Text style={styles.studentStatLabel}>Reg No</Text>
        </View>
      </View>
    </View>
  );
}

function ScheduleView({
  data,
  selectedDay,
  optionalClasses,
  onSelectDay,
  onToggleOptional,
  onFacultyPress,
}: {
  data: ScheduleData;
  selectedDay: string | null;
  optionalClasses: Record<string, boolean>;
  onSelectDay: (day: string | null) => void;
  onToggleOptional: (key: string) => void;
  onFacultyPress: (name: string) => void;
}) {
  const isViewingToday = selectedDay === null;
  const headerTitle = isViewingToday ? "Today's Schedule" : `Day ${data.dayOrder} Schedule`;

  return (
    <View style={styles.tabContent}>
      <View style={styles.scheduleHero}>
        <View>
          <Text style={styles.scheduleTitle}>{headerTitle}</Text>
          <Text style={styles.scheduleDate}>
            {data.dayOfWeek}, {data.date} {data.monthName}
          </Text>
        </View>
        <View style={styles.semesterPill}>
          <Text style={styles.semesterPillText}>
            Sem {data.semester} / {data.semType}
          </Text>
        </View>
      </View>

      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.dayPills}>
        <TouchableOpacity
          style={[styles.dayPill, isViewingToday && styles.dayPillActive]}
          onPress={() => onSelectDay(null)}
          activeOpacity={0.7}
        >
          <Text style={[styles.dayPillText, isViewingToday && styles.dayPillTextActive]}>
            Today{data.todayDayOrder ? ` / Day ${data.todayDayOrder}` : ''}
          </Text>
        </TouchableOpacity>

        {DAY_ORDERS.map((day) => {
          const isActive = selectedDay === day;
          return (
            <TouchableOpacity
              key={day}
              style={[styles.dayPill, isActive && styles.dayPillActive]}
              onPress={() => onSelectDay(day)}
              activeOpacity={0.7}
            >
              <Text style={[styles.dayPillText, isActive && styles.dayPillTextActive]}>Day {day}</Text>
            </TouchableOpacity>
          );
        })}
      </ScrollView>

      {data.event && isViewingToday ? (
        <View style={[styles.noticeCard, data.isHoliday && styles.noticeCardWarn]}>
          <Text style={[styles.noticeText, data.isHoliday && styles.noticeTextWarn]}>{data.event}</Text>
        </View>
      ) : null}

      {isViewingToday && data.isWeekend ? (
        <EmptyState title="Weekend" body="No classes are scheduled for today." />
      ) : isViewingToday && data.isHoliday ? (
        <EmptyState title="Holiday" body="No classes are assigned for today." />
      ) : isViewingToday && !data.dayOrder ? (
        <EmptyState title="No day order" body="The academic calendar has no day order for today." />
      ) : data.classes.length === 0 ? (
        <EmptyState title="Free day" body={`No classes found for ${data.dayOrder ? `Day ${data.dayOrder}` : 'this day'}.`} />
      ) : (
        <View style={styles.classList}>
          <View style={styles.sectionHeader}>
            <SectionLabel>CLASSES SCHEDULED</SectionLabel>
            <Text style={styles.sectionCount}>{data.classes.length}</Text>
          </View>

          {data.classes.map((item, index) => {
            const optionalKey = `${data.dayOrder}-${item.courseCode}-${item.hourIndex}`;
            const isOptional = !!optionalClasses[optionalKey];
            const photo = proxiedFacultyPhoto(item.facultyPhotoUrl);

            return (
              <View key={`${item.courseCode}-${item.timing}-${index}`} style={[styles.classCard, isOptional && styles.classCardOptional]}>
                <View style={styles.classTopRow}>
                  <View style={styles.smallAvatar}>
                    {photo ? (
                      <Image source={{ uri: photo }} style={styles.smallAvatarImage} />
                    ) : (
                      <Text style={styles.smallAvatarFallback}>{item.courseTitle.charAt(0)}</Text>
                    )}
                  </View>
                  <View style={styles.classTitleBlock}>
                    <Text style={[styles.classTitle, isOptional && styles.optionalText]}>{item.courseTitle}</Text>
                    <Text style={styles.classCode}>{item.courseCode}</Text>
                  </View>
                </View>

                <View style={styles.classMetaRow}>
                  <View style={styles.classMetaItem}>
                    <Clock color={colors.textMuted} size={15} strokeWidth={1.5} />
                    <Text style={styles.classMetaText}>{item.timing || 'Timing TBA'}</Text>
                  </View>
                  <View style={styles.classMetaItem}>
                    <BookOpen color={colors.textMuted} size={15} strokeWidth={1.5} />
                    <Text style={styles.classMetaText}>{item.roomNo || item.category || 'Room TBA'}</Text>
                  </View>
                </View>

                <View style={styles.classActions}>
                  {item.facultyName ? (
                    <TouchableOpacity onPress={() => onFacultyPress(item.facultyName)} activeOpacity={0.7}>
                      <Text style={styles.facultyLink}>{cleanFacultyName(item.facultyName)}</Text>
                    </TouchableOpacity>
                  ) : (
                    <Text style={styles.classMetaText}>Faculty TBA</Text>
                  )}
                  <TouchableOpacity
                    style={[styles.optionalButton, isOptional && styles.optionalButtonActive]}
                    onPress={() => onToggleOptional(optionalKey)}
                    activeOpacity={0.75}
                  >
                    <Text style={[styles.optionalButtonText, isOptional && styles.optionalButtonTextActive]}>
                      {isOptional ? 'Optional' : 'Required'}
                    </Text>
                  </TouchableOpacity>
                </View>
              </View>
            );
          })}
        </View>
      )}
    </View>
  );
}

// ── Margin predictor (per attendance card) ────────────────────────────────────
function MarginPredictor({ conducted, absent }: { conducted: number; absent: number }) {
  const [mode, setMode] = useState<'skip' | 'attend'>('skip');
  const [delta, setDelta] = useState(1);

  const projected = useMemo(() => {
    const extra = Math.max(1, delta);
    const newConducted = conducted + extra;
    const newAbsent = mode === 'skip' ? absent + extra : absent;
    const newPresent = newConducted - newAbsent;
    const pct = newConducted > 0 ? (newPresent / newConducted) * 100 : 0;
    const margin = calculateMargin(newConducted, newAbsent);
    return { pct, margin };
  }, [conducted, absent, delta, mode]);

  const base = conducted > 0 ? ((conducted - absent) / conducted) * 100 : 0;
  const diff = projected.pct - base;
  const isSafe = projected.pct >= 75;

  return (
    <View style={styles.predictorBox}>
      {/* Mode toggle */}
      <View style={styles.predictorToggle}>
        {(['skip', 'attend'] as const).map((m) => (
          <TouchableOpacity
            key={m}
            style={[styles.predictorMode, mode === m && (m === 'skip' ? styles.predictorModeSkip : styles.predictorModeAttend)]}
            onPress={() => setMode(m)}
            activeOpacity={0.75}
          >
            <Text style={[styles.predictorModeText, mode === m && styles.predictorModeTextActive]}>
              {m === 'skip' ? 'If I skip' : 'If I attend'}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      {/* Stepper */}
      <View style={styles.predictorStepper}>
        <TouchableOpacity
          style={styles.stepBtn}
          onPress={() => setDelta((d) => Math.max(1, d - 1))}
          activeOpacity={0.7}
        >
          <Text style={styles.stepBtnText}>−</Text>
        </TouchableOpacity>
        <Text style={styles.stepValue}>{delta}</Text>
        <TouchableOpacity
          style={styles.stepBtn}
          onPress={() => setDelta((d) => Math.min(50, d + 1))}
          activeOpacity={0.7}
        >
          <Text style={styles.stepBtnText}>+</Text>
        </TouchableOpacity>
        <Text style={styles.stepLabel}>{delta === 1 ? 'class' : 'classes'}</Text>
      </View>

      {/* Result */}
      <View style={styles.predictorResult}>
        <Text style={[styles.predictorPct, { color: isSafe ? colors.accentYellow : '#F87171' }]}>
          {projected.pct.toFixed(1)}%
        </Text>
        <View style={styles.predictorResultRight}>
          <Text style={[styles.predictorDiff, { color: diff >= 0 ? '#4ADE80' : '#F87171' }]}>
            {diff >= 0 ? '+' : ''}{diff.toFixed(1)}%
          </Text>
          <Text style={styles.predictorMarginText}>
            {projected.margin < 0
              ? `Need ${Math.abs(projected.margin)} more`
              : projected.margin === 0
              ? 'On the edge'
              : `Can still bunk ${projected.margin}`}
          </Text>
        </View>
      </View>
    </View>
  );
}

// ── Attendance planner summary ────────────────────────────────────────────────
function AttendancePlanner({ attendance }: { attendance: AttendanceRecord[] }) {
  const items = useMemo(() => attendance.map((item) => {
    const conducted = numberValue(item.hoursConducted);
    const absent = numberValue(item.hoursAbsent);
    const margin = calculateMargin(conducted, absent);
    return { code: item.courseCode || '', title: item.courseTitle || item.courseCode || 'Subject', conducted, absent, margin };
  }), [attendance]);

  const atRisk = items.filter((i) => i.margin < 0);
  const safe = items.filter((i) => i.margin >= 0);
  const totalNeeded = atRisk.reduce((s, i) => s + Math.abs(i.margin), 0);

  if (items.length === 0) return null;

  return (
    <View style={styles.plannerCard}>
      <View style={styles.plannerHeader}>
        <Text style={styles.plannerTitle}>Attendance Planner</Text>
        <View style={styles.plannerBadges}>
          <View style={styles.plannerBadgeSafe}>
            <Text style={styles.plannerBadgeSafeText}>{safe.length} safe</Text>
          </View>
          {atRisk.length > 0 && (
            <View style={styles.plannerBadgeRisk}>
              <Text style={styles.plannerBadgeRiskText}>{atRisk.length} at risk</Text>
            </View>
          )}
        </View>
      </View>

      {atRisk.length === 0 ? (
        <View style={styles.plannerAllGood}>
          <CheckCircle2 color="#4ADE80" size={20} strokeWidth={1.5} />
          <Text style={styles.plannerAllGoodText}>All subjects above 75% — you're safe!</Text>
        </View>
      ) : (
        <>
          <View style={styles.plannerSummaryRow}>
            <Text style={styles.plannerSummaryNum}>{totalNeeded}</Text>
            <Text style={styles.plannerSummaryLabel}>
              total class{totalNeeded !== 1 ? 'es' : ''} needed to recover all at-risk subjects
            </Text>
          </View>
          <View style={styles.plannerList}>
            {atRisk.map((item) => (
              <View key={item.code} style={styles.plannerRow}>
                <View style={styles.plannerRowLeft}>
                  <Text style={styles.plannerRowCode}>{item.code}</Text>
                  <Text style={styles.plannerRowTitle} numberOfLines={1}>{item.title}</Text>
                </View>
                <View style={styles.plannerRowRight}>
                  <Text style={styles.plannerRowNeed}>attend {Math.abs(item.margin)} more</Text>
                </View>
              </View>
            ))}
          </View>
        </>
      )}
    </View>
  );
}

function AttendanceView({ attendance }: { attendance: AttendanceRecord[] }) {
  const [expandedCard, setExpandedCard] = useState<string | null>(null);

  const avg = attendance.length
    ? Math.round(attendance.reduce((sum, item) => sum + numberValue(item.attendancePct), 0) / attendance.length)
    : 0;
  const low = attendance.filter((item) => numberValue(item.attendancePct) < 75).length;

  return (
    <View style={styles.tabContent}>
      <View style={styles.metricRow}>
        <View style={styles.metricBox}>
          <Text style={styles.metricNumber}>{avg}%</Text>
          <Text style={styles.metricLabel}>Average</Text>
        </View>
        <View style={styles.metricBox}>
          <Text style={[styles.metricNumber, { color: low ? '#F87171' : colors.accentYellow }]}>{low}</Text>
          <Text style={styles.metricLabel}>Below 75%</Text>
        </View>
      </View>

      <View style={styles.listSection}>
        <AttendancePlanner attendance={attendance} />

        <SectionLabel>SUBJECTS</SectionLabel>
        {attendance.length === 0 ? (
          <EmptyState title="No attendance records" />
        ) : (
          attendance.map((item, index) => {
            const conducted = numberValue(item.hoursConducted);
            const absent = numberValue(item.hoursAbsent);
            const present = Math.max(0, conducted - absent);
            const pct = numberValue(item.attendancePct);
            const margin = calculateMargin(conducted, absent);
            const isLow = pct < 75;
            const cardKey = `${item.courseCode}-${index}`;
            const isExpanded = expandedCard === cardKey;

            return (
              <View key={cardKey} style={[styles.attendanceCard, isLow && styles.attendanceCardLow]}>
                <View style={styles.cardHeaderRow}>
                  <View style={styles.flexOne}>
                    <Text style={styles.cardTitle}>{item.courseTitle || item.courseCode || 'Subject'}</Text>
                    <Text style={styles.cardSubtitle}>{item.courseCode || 'Course code'}</Text>
                  </View>
                  <Text style={[styles.attendancePct, isLow && { color: '#F87171' }]}>{pct.toFixed(1)}%</Text>
                </View>

                <View style={styles.progressTrack}>
                  <View style={[styles.progressFill, { width: `${Math.min(100, Math.max(0, pct))}%`, backgroundColor: isLow ? '#F87171' : colors.accentYellow }]} />
                </View>

                <View style={styles.bunkRow}>
                  <View style={styles.bunkStat}>
                    <Text style={styles.bunkStatNum}>{present}/{conducted}</Text>
                    <Text style={styles.bunkStatLabel}>present</Text>
                  </View>
                  <View style={[
                    styles.bunkPill,
                    margin < 0 ? styles.bunkPillDanger : margin === 0 ? styles.bunkPillEdge : styles.bunkPillSafe,
                  ]}>
                    <Text style={[
                      styles.bunkPillNum,
                      { color: margin < 0 ? '#F87171' : margin === 0 ? colors.accentBlue : colors.accentYellow },
                    ]}>
                      {Math.abs(margin)}
                    </Text>
                    <Text style={styles.bunkPillLbl}>
                      {margin < 0 ? 'must attend' : margin === 0 ? 'on the edge' : 'can bunk'}
                    </Text>
                  </View>
                </View>

                {/* Predictor toggle */}
                <TouchableOpacity
                  style={styles.predictorToggleBtn}
                  onPress={() => setExpandedCard(isExpanded ? null : cardKey)}
                  activeOpacity={0.75}
                >
                  <Text style={styles.predictorToggleBtnText}>
                    {isExpanded ? 'Hide predictor' : 'Predict margin'}
                  </Text>
                  <Text style={styles.predictorToggleChevron}>{isExpanded ? '▲' : '▼'}</Text>
                </TouchableOpacity>

                {isExpanded && <MarginPredictor conducted={conducted} absent={absent} />}
              </View>
            );
          })
        )}
      </View>
    </View>
  );
}

function groupMarks(marks: MarksRecord[], attendance: AttendanceRecord[]) {
  const grouped: Record<string, { courseCode: string; courseTitle?: string; components: { type: string; tests: MarksTest[] }[] }> = {};

  marks.forEach((item) => {
    const code = item.courseCode || 'Unknown';
    const attendanceMatch = attendance.find((record) => record.courseCode === code);
    if (!grouped[code]) {
      grouped[code] = {
        courseCode: code,
        courseTitle: attendanceMatch?.courseTitle,
        components: [],
      };
    }

    grouped[code].components.push({
      type: item.courseType || 'Component',
      tests: Array.isArray(item.tests) ? item.tests : [],
    });
  });

  return Object.values(grouped);
}

function MarksView({ marks, attendance }: { marks: MarksRecord[]; attendance: AttendanceRecord[] }) {
  const courses = useMemo(() => groupMarks(marks, attendance), [marks, attendance]);

  return (
    <View style={styles.tabContent}>
      {courses.length === 0 ? (
        <EmptyState title="No marks recorded" />
      ) : (
        <View style={styles.listSection}>
          <SectionLabel>INTERNAL MARKS</SectionLabel>
          {courses.map((course) => {
            let totalScore = 0;
            let totalMax = 0;

            course.components.forEach((component) => {
              component.tests.forEach((test) => {
                const score = numberValue(test.score);
                const maxScore = numberValue(test.maxScore);
                if (maxScore > 0) {
                  totalScore += score;
                  totalMax += maxScore;
                }
              });
            });

            const pct = totalMax > 0 ? Math.round((totalScore / totalMax) * 100) : null;

            return (
              <View key={course.courseCode} style={styles.marksCard}>
                <View style={styles.cardHeaderRow}>
                  <View style={styles.flexOne}>
                    <Text style={styles.cardTitle}>{course.courseCode}</Text>
                    <Text style={styles.cardSubtitle}>{course.courseTitle || 'Subject title unavailable'}</Text>
                  </View>
                  <View style={styles.scoreBadge}>
                    <Text style={styles.scoreBadgeText}>{pct === null ? '-' : `${pct}%`}</Text>
                  </View>
                </View>

                <Text style={styles.marksTotal}>
                  {totalMax > 0 ? `${totalScore.toFixed(1)} / ${totalMax.toFixed(1)} marks` : 'No scored tests yet'}
                </Text>

                {course.components.map((component, index) => (
                  <View key={`${component.type}-${index}`} style={styles.componentBlock}>
                    <Text style={styles.componentTitle}>{component.type}</Text>
                    {component.tests.length === 0 ? (
                      <Text style={styles.componentEmpty}>No tests recorded.</Text>
                    ) : (
                      component.tests.map((test, testIndex) => (
                        <View key={`${test.testName}-${testIndex}`} style={styles.testRow}>
                          <Text style={styles.testName}>{test.testName || 'Assessment'}</Text>
                          <Text style={styles.testScore}>
                            {stringValue(test.score, '-')} / {stringValue(test.maxScore, '-')}
                          </Text>
                        </View>
                      ))
                    )}
                  </View>
                ))}
              </View>
            );
          })}
        </View>
      )}
    </View>
  );
}

function CoursesView({ timetable, onFacultyPress }: { timetable: TimetableData; onFacultyPress: (name: string) => void }) {
  const courses = timetable.courses || [];
  const [exporting, setExporting] = useState(false);

  const handleExport = async () => {
    if (courses.length === 0) return;
    setExporting(true);
    try {
      const header = 'Code | Course | Type | Cr | Slot | Room | Faculty | Schedule';
      const lines = courses.map((c) => {
        const sched = (c.schedule || []).map((s) => `${s.day} ${s.timing}`).join(', ');
        return `${c.courseCode || '-'} | ${c.courseTitle || '-'} | ${c.category || '-'} | ${c.credit || '-'} | ${c.slot || '-'} | ${c.roomNo || '-'} | ${cleanFacultyName(c.facultyName || '-')} | ${sched}`;
      });
      await Share.share({
        message: `Timetable — ${new Date().toLocaleDateString()}\n\n${header}\n${lines.join('\n')}`,
        title: 'Timetable',
      });
    } catch (err) {
      Alert.alert('Export failed', err instanceof Error ? err.message : 'Could not export timetable.');
    } finally {
      setExporting(false);
    }
  };

  return (
    <View style={styles.tabContent}>
      {courses.length === 0 ? (
        <EmptyState title="No courses found" />
      ) : (
        <View style={styles.listSection}>
          <View style={styles.sectionHeader}>
            <SectionLabel>COURSE INFO</SectionLabel>
            <TouchableOpacity
              style={[styles.exportButton, exporting && { opacity: 0.55 }]}
              onPress={handleExport}
              disabled={exporting}
              activeOpacity={0.75}
            >
              {exporting
                ? <ActivityIndicator color={colors.accentYellow} size={14} />
                : <FileDown color={colors.accentYellow} size={15} strokeWidth={1.5} />}
              <Text style={styles.exportButtonText}>{exporting ? 'Exporting…' : 'Export PDF'}</Text>
            </TouchableOpacity>
          </View>
          {courses.map((course: TimetableCourse, index) => {
            const photo = proxiedFacultyPhoto(course.facultyPhotoUrl);
            return (
              <View key={`${course.courseCode}-${index}`} style={styles.courseCard}>
                <View style={styles.classTopRow}>
                  <View style={styles.smallAvatar}>
                    {photo ? (
                      <Image source={{ uri: photo }} style={styles.smallAvatarImage} />
                    ) : (
                      <Text style={styles.smallAvatarFallback}>{stringValue(course.courseTitle, '?').charAt(0)}</Text>
                    )}
                  </View>
                  <View style={styles.classTitleBlock}>
                    <Text style={styles.cardTitle}>{course.courseTitle || 'Untitled course'}</Text>
                    <Text style={styles.cardSubtitle}>{course.courseCode || 'Course code'}</Text>
                  </View>
                </View>

                <View style={styles.courseMetaGrid}>
                  <Text style={styles.courseMeta}>{course.category || course.courseType || 'Category TBA'}</Text>
                  <Text style={styles.courseMeta}>{course.credit ? `${course.credit} credits` : 'Credits TBA'}</Text>
                  <Text style={styles.courseMeta}>{course.roomNo || 'Room TBA'}</Text>
                  <Text style={styles.courseMeta}>{course.slot || 'Slot TBA'}</Text>
                </View>

                {course.facultyName ? (
                  <TouchableOpacity onPress={() => onFacultyPress(course.facultyName || '')} activeOpacity={0.7}>
                    <Text style={styles.facultyLink}>{cleanFacultyName(course.facultyName)}</Text>
                  </TouchableOpacity>
                ) : null}

                {course.schedule?.length ? (
                  <View style={styles.scheduleChips}>
                    {course.schedule.map((slot, slotIndex) => (
                      <View key={`${slot.day}-${slot.timing}-${slotIndex}`} style={styles.scheduleChip}>
                        <Text style={styles.scheduleChipText}>{slot.day || 'Day'} / {slot.timing || 'Timing'}</Text>
                      </View>
                    ))}
                  </View>
                ) : null}
              </View>
            );
          })}
        </View>
      )}
    </View>
  );
}

function CalendarView({
  activeSem,
  calendar,
  onSemChange,
}: {
  activeSem: AcademiaSem;
  calendar: CalendarData | null;
  onSemChange: (sem: AcademiaSem) => void;
}) {
  const upcomingEvents = useMemo(() => getUpcomingEvents(calendar), [calendar]);

  return (
    <View style={styles.tabContent}>
      <View style={styles.semToggle}>
        {(['even', 'odd'] as AcademiaSem[]).map((sem) => {
          const isActive = activeSem === sem;
          return (
            <TouchableOpacity
              key={sem}
              style={[styles.semToggleButton, isActive && styles.semToggleButtonActive]}
              onPress={() => onSemChange(sem)}
              activeOpacity={0.75}
            >
              <Text style={[styles.semToggleText, isActive && styles.semToggleTextActive]}>
                {sem === 'even' ? 'Even Semester' : 'Odd Semester'}
              </Text>
            </TouchableOpacity>
          );
        })}
      </View>

      {upcomingEvents.length > 0 && (
        <View style={styles.holidaySection}>
          <SectionLabel>UPCOMING EVENTS</SectionLabel>
          {upcomingEvents.map((ev, idx) => {
            const until = daysUntil(ev.fullDate);
            const isToday = until === 0;
            const isTomorrow = until === 1;
            const untilLabel = isToday ? 'Today' : isTomorrow ? 'Tomorrow' : `In ${until}d`;
            return (
              <View
                key={`${ev.monthName}-${ev.dateStr}-${idx}`}
                style={[styles.holidayRow, ev.isHoliday && styles.holidayRowHoliday]}
              >
                <View style={styles.holidayDateBox}>
                  <Text style={styles.holidayDate}>{ev.dateStr}</Text>
                  <Text style={styles.holidayMonth}>{ev.monthName.split(' ')[0]}</Text>
                </View>
                <View style={styles.holidayInfo}>
                  <Text style={styles.holidayEvent} numberOfLines={2}>{ev.event}</Text>
                  <View style={styles.holidayMeta}>
                    {ev.dayOrder !== '-' && (
                      <Text style={styles.holidayDayOrder}>Day {ev.dayOrder}</Text>
                    )}
                    {ev.isHoliday && (
                      <Text style={styles.holidayBadge}>Holiday</Text>
                    )}
                  </View>
                </View>
                <Text style={[styles.holidayUntil, isToday && { color: colors.accentYellow }]}>{untilLabel}</Text>
              </View>
            );
          })}
        </View>
      )}

      {!calendar?.months?.length ? (
        <EmptyState title="No calendar data" />
      ) : (
        <View style={styles.listSection}>
          {calendar.months.map((month) => (
            <View key={month.name} style={styles.monthCard}>
              <Text style={styles.monthTitle}>{month.name || 'Month'}</Text>
              <View style={styles.calendarGrid}>
                {(month.days || []).map((day, index) => {
                  const dayOrder = stringValue(day.dayOrder);
                  const hasDayOrder = /^[1-5]$/.test(dayOrder);
                  return (
                    <View key={`${month.name}-${day.date}-${index}`} style={[styles.dayCell, hasDayOrder && styles.dayCellActive]}>
                      <Text style={[styles.dayCellDate, hasDayOrder && styles.dayCellDateActive]}>{day.date || '-'}</Text>
                      <Text style={[styles.dayCellOrder, hasDayOrder && styles.dayCellOrderActive]}>
                        {hasDayOrder ? `D${dayOrder}` : day.event ? 'Event' : '-'}
                      </Text>
                    </View>
                  );
                })}
              </View>
            </View>
          ))}
        </View>
      )}
    </View>
  );
}

function FacultyModal({
  visible,
  loading,
  profile,
  error,
  onClose,
}: {
  visible: boolean;
  loading: boolean;
  profile: FacultyProfile | null;
  error: string | null;
  onClose: () => void;
}) {
  const photo = proxiedFacultyPhoto(profile?.photo_url);
  const infoRows = [
    ['Designation', profile?.designation],
    ['Department', profile?.department],
    ['Campus', profile?.campus],
    ['Email', profile?.email],
    ['Experience', profile?.experience],
  ].filter(([, value]) => !!value);

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <SafeAreaView style={styles.modalContainer}>
        <View style={styles.modalHeader}>
          <TouchableOpacity onPress={onClose} style={styles.modalCloseButton}>
            <X color={colors.text} size={26} strokeWidth={1.5} />
          </TouchableOpacity>
          <Text style={styles.logo}>.hack</Text>
        </View>

        {loading ? (
          <LoadingBlock text="Loading faculty profile..." />
        ) : error ? (
          <ErrorBlock message={error} onRetry={onClose} />
        ) : profile ? (
          <ScrollView contentContainerStyle={styles.modalContent} showsVerticalScrollIndicator={false}>
            <View style={styles.facultyHero}>
              <View style={styles.facultyAvatar}>
                {photo ? (
                  <Image source={{ uri: photo }} style={styles.facultyAvatarImage} />
                ) : (
                  <Text style={styles.facultyAvatarFallback}>{(profile.name || '?').charAt(0)}</Text>
                )}
              </View>
              <Text style={styles.facultyName}>{profile.name || 'Faculty'}</Text>
              {profile.research_interest ? (
                <Text style={styles.facultyResearch} numberOfLines={3}>{profile.research_interest}</Text>
              ) : null}
            </View>

            <View style={styles.modalSection}>
              {infoRows.map(([label, value]) => (
                <View key={label} style={styles.infoRow}>
                  <Text style={styles.infoLabel}>{label}</Text>
                  <Text style={styles.infoValue}>{String(value)}</Text>
                </View>
              ))}
            </View>

            {Array.isArray(profile.courses) && profile.courses.length > 0 ? (
              <View style={styles.modalSection}>
                <SectionLabel>COURSES</SectionLabel>
                {profile.courses.map((course, index) => (
                  <Text key={`${course}-${index}`} style={styles.modalListItem}>{course}</Text>
                ))}
              </View>
            ) : null}

            {profile.profile_url ? (
              <TouchableOpacity style={styles.primaryButton} onPress={() => Linking.openURL(profile.profile_url || '')}>
                <Text style={styles.primaryButtonText}>Open Profile</Text>
                <ArrowUpRight color="#000" size={18} strokeWidth={2} />
              </TouchableOpacity>
            ) : null}
          </ScrollView>
        ) : null}
      </SafeAreaView>
    </Modal>
  );
}

export default function AcademiaScreen() {
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const [sessionEmail, setSessionEmail] = useState<string | null>(null);
  const [sessionMode, setSessionMode] = useState<AcademiaSessionMode | null>(null);
  const [loginMode, setLoginMode] = useState<AcademiaSessionMode>('bound');
  const [appUserId, setAppUserId] = useState<string | null>(null);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loginError, setLoginError] = useState<string | null>(null);
  const [booting, setBooting] = useState(true);
  const [loggingIn, setLoggingIn] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  const [activeTab, setActiveTab] = useState<AcademiaTab>('Schedule');
  const [activeSem, setActiveSem] = useState<AcademiaSem>('even');
  const [selectedDay, setSelectedDay] = useState<string | null>(null);

  const [student, setStudent] = useState<StudentInfo | null>(null);
  const [attendance, setAttendance] = useState<AttendanceRecord[] | null>(null);
  const [marks, setMarks] = useState<MarksRecord[] | null>(null);
  const [timetable, setTimetable] = useState<TimetableData | null>(null);
  const [calendarEven, setCalendarEven] = useState<CalendarData | null>(null);
  const [calendarOdd, setCalendarOdd] = useState<CalendarData | null>(null);
  const [optionalClasses, setOptionalClasses] = useState<Record<string, boolean>>({});

  const [loading, setLoading] = useState<Record<string, boolean>>({});
  const [errors, setErrors] = useState<Record<string, string | null>>({});
  const inFlight = useRef<Record<string, boolean>>({});

  const [facultyName, setFacultyName] = useState<string | null>(null);
  const [facultyProfile, setFacultyProfile] = useState<FacultyProfile | null>(null);
  const [facultyLoading, setFacultyLoading] = useState(false);
  const [facultyError, setFacultyError] = useState<string | null>(null);

  const resetAcademiaData = useCallback(() => {
    setStudent(null);
    setAttendance(null);
    setMarks(null);
    setTimetable(null);
    setCalendarEven(null);
    setCalendarOdd(null);
    setSelectedDay(null);
  }, []);

  const handleBackendSessionLost = useCallback(async (modeToClear: AcademiaSessionMode | null) => {
    if (modeToClear === 'temporary') {
      clearTemporaryAcademiaEmail();
    }

    setSessionEmail(null);
    setSessionMode(null);
    setPassword('');
    resetAcademiaData();
  }, [resetAcademiaData]);

  const runGuarded = useCallback(async (key: string, task: (email: string) => Promise<void>) => {
    if (!sessionEmail || inFlight.current[key]) return;

    inFlight.current[key] = true;
    setLoading((prev) => ({ ...prev, [key]: true }));
    setErrors((prev) => ({ ...prev, [key]: null }));

    try {
      await task(sessionEmail);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Academia request failed.';
      setErrors((prev) => ({ ...prev, [key]: message }));
      if (isSessionError(error)) {
        await handleBackendSessionLost(sessionMode);
      }
    } finally {
      inFlight.current[key] = false;
      setLoading((prev) => ({ ...prev, [key]: false }));
    }
  }, [handleBackendSessionLost, sessionEmail, sessionMode]);

  const loadInitial = useCallback(async (emailToLoad: string, modeToLoad: AcademiaSessionMode = 'bound') => {
    setLoading((prev) => ({ ...prev, init: true }));
    setErrors((prev) => ({ ...prev, init: null }));

    try {
      const res = await academiaApi.init(emailToLoad, 'even');
      if (!res.success) throw new Error(res.error || 'Could not load Academia data.');

      setStudent(res.studentInfo || null);
      setTimetable(res.timetable || null);
      setCalendarEven(res.calendar || null);

      if (!res.studentInfo?.PhotoUrl) {
        setTimeout(() => {
          academiaApi.student(emailToLoad)
            .then((next) => {
              if (next.success && next.studentInfo?.PhotoUrl) {
                setStudent((prev) => prev ? { ...prev, PhotoUrl: next.studentInfo?.PhotoUrl } : next.studentInfo || null);
              }
            })
            .catch(() => undefined);
        }, 8000);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Could not load Academia data.';
      setErrors((prev) => ({ ...prev, init: message }));
      if (isSessionError(error)) {
        await handleBackendSessionLost(modeToLoad);
      }
    } finally {
      setLoading((prev) => ({ ...prev, init: false }));
      setBooting(false);
    }
  }, [handleBackendSessionLost]);

  useEffect(() => {
    let cancelled = false;

    async function restore() {
      try {
        const [{ data: { user } }, storedOptional] = await Promise.all([
          supabase.auth.getUser(),
          AsyncStorage.getItem(STORAGE_OPTIONAL_KEY),
        ]);

        if (cancelled) return;

        if (storedOptional) {
          setOptionalClasses(JSON.parse(storedOptional) as Record<string, boolean>);
        }

        const userId = user?.id || null;
        setAppUserId(userId);

        const activeAccount = await getActiveAcademiaAccount(userId);
        if (cancelled) return;

        if (activeAccount) {
          setEmail(activeAccount.email);
          setLoginMode(activeAccount.mode);
          setSessionMode(activeAccount.mode);
          setSessionEmail(activeAccount.email);
          await loadInitial(activeAccount.email, activeAccount.mode);
        } else {
          setBooting(false);
        }
      } catch {
        if (!cancelled) setBooting(false);
      }
    }

    restore();

    return () => {
      cancelled = true;
    };
  }, [loadInitial]);

  const loadAttendance = useCallback(() => runGuarded('attendance', async (currentEmail) => {
    const res = await academiaApi.attendance(currentEmail);
    if (!res.success) throw new Error(res.error || 'Could not load attendance.');
    setAttendance(res.attendance || []);
  }), [runGuarded]);

  const loadMarks = useCallback(() => runGuarded('marks', async (currentEmail) => {
    const res = await academiaApi.marks(currentEmail);
    if (!res.success) throw new Error(res.error || 'Could not load marks.');
    setMarks(res.marks || []);
  }), [runGuarded]);

  const loadTimetable = useCallback(() => runGuarded('timetable', async (currentEmail) => {
    const res = await academiaApi.timetable(currentEmail);
    if (!res.success) throw new Error(res.error || 'Could not load course info.');
    setTimetable(res.timetable || null);
  }), [runGuarded]);

  const loadCalendar = useCallback((sem: AcademiaSem) => runGuarded(`calendar-${sem}`, async (currentEmail) => {
    const res = await academiaApi.calendar(currentEmail, sem);
    if (!res.success) throw new Error(res.error || `Could not load ${sem} calendar.`);
    if (sem === 'even') setCalendarEven(res.calendar || null);
    else setCalendarOdd(res.calendar || null);
  }), [runGuarded]);

  useEffect(() => {
    if (!sessionEmail) return;

    if (activeTab === 'Attendance' && !attendance) {
      loadAttendance();
      if (!timetable) loadTimetable();
    }

    if (activeTab === 'Marks' && !marks) {
      loadMarks();
      if (!attendance) loadAttendance();
    }

    if (activeTab === 'Courses' && !timetable) {
      loadTimetable();
    }

    if (activeTab === 'Calendar') {
      if (activeSem === 'even' && !calendarEven) loadCalendar('even');
      if (activeSem === 'odd' && !calendarOdd) loadCalendar('odd');
    }

    if (activeTab === 'Schedule' && student && !timetable) {
      loadTimetable();
    }

    if (activeTab === 'Schedule' && student) {
      const semType: AcademiaSem = parseInt(student.Semester || '1', 10) % 2 === 0 ? 'even' : 'odd';
      if (semType === 'odd' && !calendarOdd) loadCalendar('odd');
    }
  }, [
    activeSem,
    activeTab,
    attendance,
    calendarEven,
    calendarOdd,
    loadAttendance,
    loadCalendar,
    loadMarks,
    loadTimetable,
    marks,
    sessionEmail,
    student,
    timetable,
  ]);

  const handleLogin = useCallback(async () => {
    const trimmedEmail = email.trim();
    if (!trimmedEmail || !password.trim()) return;
    if (loginMode === 'bound' && !appUserId) {
      setLoginError('Sign in to HackTrackr before binding Academia.');
      return;
    }

    setLoggingIn(true);
    setLoginError(null);

    try {
      const res = await academiaApi.login(trimmedEmail, password);
      if (!res.success) throw new Error(res.error || 'Login failed.');

      if (loginMode === 'bound' && appUserId) {
        await setBoundAcademiaEmail(appUserId, trimmedEmail);
      } else {
        setTemporaryAcademiaEmail(trimmedEmail);
      }

      setSessionEmail(trimmedEmail);
      setSessionMode(loginMode);
      setPassword('');
      resetAcademiaData();
      await loadInitial(trimmedEmail, loginMode);
    } catch (error) {
      setLoginError(error instanceof Error ? error.message : 'Could not connect to Academia backend.');
    } finally {
      setLoggingIn(false);
    }
  }, [appUserId, email, loadInitial, loginMode, password, resetAcademiaData]);

  const handleLogout = useCallback(async () => {
    const currentMode = sessionMode;
    const currentEmail = sessionEmail;

    if (sessionEmail) {
      academiaApi.logout(sessionEmail).catch(() => undefined);
    }

    if (currentMode === 'temporary') {
      clearTemporaryAcademiaEmail();
      resetAcademiaData();

      const boundEmail = appUserId ? await getBoundAcademiaEmail(appUserId) : null;
      if (boundEmail) {
        setEmail(boundEmail);
        setLoginMode('bound');
        if (boundEmail !== currentEmail) {
          setSessionMode('bound');
          setSessionEmail(boundEmail);
          await loadInitial(boundEmail, 'bound');
          return;
        }
      }
    } else if (currentMode === 'bound' && appUserId) {
      await removeBoundAcademiaEmail(appUserId);
    }

    setSessionEmail(null);
    setSessionMode(null);
    setPassword('');
    resetAcademiaData();
  }, [appUserId, loadInitial, resetAcademiaData, sessionEmail, sessionMode]);

  const handleSwitchToTemporary = useCallback(() => {
    setLoginMode('temporary');
    setSessionEmail(null);
    setSessionMode(null);
    setEmail('');
    setPassword('');
    setLoginError(null);
    resetAcademiaData();
  }, [resetAcademiaData]);

  const handleToggleOptional = useCallback((key: string) => {
    setOptionalClasses((prev) => {
      const next = { ...prev };
      if (next[key]) delete next[key];
      else next[key] = true;
      AsyncStorage.setItem(STORAGE_OPTIONAL_KEY, JSON.stringify(next)).catch(() => undefined);
      return next;
    });
  }, []);

  const handleFacultyPress = useCallback(async (name: string) => {
    if (!name) return;

    setFacultyName(name);
    setFacultyProfile(null);
    setFacultyError(null);
    setFacultyLoading(true);

    try {
      const res = await academiaApi.faculty(name, sessionEmail || undefined);
      if (!res.success) throw new Error(res.error || 'Faculty not found.');
      setFacultyProfile(res.faculty || null);
    } catch (error) {
      setFacultyError(error instanceof Error ? error.message : 'Could not load faculty profile.');
    } finally {
      setFacultyLoading(false);
    }
  }, [sessionEmail]);

  const refreshActive = useCallback(async () => {
    if (!sessionEmail) return;
    setRefreshing(true);
    try {
      if (activeTab === 'Schedule') {
        await loadInitial(sessionEmail, sessionMode || 'bound');
      } else if (activeTab === 'Attendance') {
        setAttendance(null);
        await loadAttendance();
      } else if (activeTab === 'Marks') {
        setMarks(null);
        await loadMarks();
      } else if (activeTab === 'Courses') {
        setTimetable(null);
        await loadTimetable();
      } else if (activeTab === 'Calendar') {
        if (activeSem === 'even') setCalendarEven(null);
        else setCalendarOdd(null);
        await loadCalendar(activeSem);
      }
    } finally {
      setRefreshing(false);
    }
  }, [activeSem, activeTab, loadAttendance, loadCalendar, loadInitial, loadMarks, loadTimetable, sessionEmail, sessionMode]);

  const scheduleData = useMemo(() => buildScheduleData({
    student,
    timetable,
    calendarEven,
    calendarOdd,
    selectedDay,
  }), [calendarEven, calendarOdd, selectedDay, student, timetable]);

  const activeCalendar = activeSem === 'even' ? calendarEven : calendarOdd;

  function renderActiveContent() {
    if (activeTab === 'Schedule') {
      if (loading.init || loading.timetable || loading['calendar-odd']) {
        return <LoadingBlock text="Fetching schedule..." />;
      }
      const scheduleError = errors.init || errors.timetable || errors['calendar-odd'];
      if (scheduleError) {
        return <ErrorBlock message={scheduleError} onRetry={refreshActive} />;
      }
      if (!scheduleData) {
        return <LoadingBlock text="Preparing schedule..." />;
      }
      return (
        <ScheduleView
          data={scheduleData}
          selectedDay={selectedDay}
          optionalClasses={optionalClasses}
          onSelectDay={setSelectedDay}
          onToggleOptional={handleToggleOptional}
          onFacultyPress={handleFacultyPress}
        />
      );
    }

    if (activeTab === 'Attendance') {
      if (loading.attendance) return <LoadingBlock text="Fetching attendance..." />;
      if (errors.attendance) return <ErrorBlock message={errors.attendance} onRetry={loadAttendance} />;
      return <AttendanceView attendance={attendance || []} />;
    }

    if (activeTab === 'Marks') {
      if (loading.marks) return <LoadingBlock text="Fetching marks..." />;
      if (errors.marks) return <ErrorBlock message={errors.marks} onRetry={loadMarks} />;
      return <MarksView marks={marks || []} attendance={attendance || []} />;
    }

    if (activeTab === 'Courses') {
      if (loading.timetable) return <LoadingBlock text="Fetching course info..." />;
      if (errors.timetable) return <ErrorBlock message={errors.timetable} onRetry={loadTimetable} />;
      return <CoursesView timetable={timetable || { courses: [] }} onFacultyPress={handleFacultyPress} />;
    }

    if (loading[`calendar-${activeSem}`]) return <LoadingBlock text={`Fetching ${activeSem} calendar...`} />;
    if (errors[`calendar-${activeSem}`]) {
      return <ErrorBlock message={errors[`calendar-${activeSem}`] || 'Could not load calendar.'} onRetry={() => loadCalendar(activeSem)} />;
    }
    return <CalendarView activeSem={activeSem} calendar={activeCalendar} onSemChange={setActiveSem} />;
  }

  if (booting) {
    return (
      <SafeAreaView style={styles.safeArea}>
        <LoadingBlock text="Starting Academia..." />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safeArea}>
      <HamburgerHeader onMenuPress={() => setIsMenuOpen(true)} />

      {!sessionEmail ? (
        <LoginPanel
          email={email}
          password={password}
          mode={loginMode}
          error={loginError}
          loading={loggingIn}
          onEmailChange={setEmail}
          onPasswordChange={setPassword}
          onModeChange={setLoginMode}
          onSubmit={handleLogin}
        />
      ) : (
        <ScrollView
          style={styles.container}
          contentContainerStyle={styles.contentContainer}
          showsVerticalScrollIndicator={false}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refreshActive} tintColor={colors.accentYellow} />}
        >
          <View style={styles.titleContainer}>
            <Text style={styles.titleLight}>Academia</Text>
            <Text style={styles.titleBold}>Mine</Text>
          </View>

          <StudentHero
            student={student}
            email={sessionEmail}
            mode={sessionMode || 'bound'}
            onLogout={handleLogout}
            onTemporary={handleSwitchToTemporary}
          />
          <TabSelector activeTab={activeTab} onChange={setActiveTab} />
          {renderActiveContent()}
        </ScrollView>
      )}

      <FacultyModal
        visible={!!facultyName}
        loading={facultyLoading}
        profile={facultyProfile}
        error={facultyError}
        onClose={() => setFacultyName(null)}
      />

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
  logo: {
    ...typography.body,
    color: colors.text,
    fontWeight: '500',
  },
  titleContainer: {
    paddingHorizontal: 24,
    marginBottom: 32,
    backgroundColor: 'transparent',
  },
  titleLight: {
    ...typography.h1,
    color: colors.text,
    fontWeight: '300',
  },
  titleBold: {
    ...typography.h1,
    color: colors.text,
    fontWeight: '400',
    marginTop: -6,
  },
  subtitle: {
    ...typography.body,
    color: colors.textMuted,
    marginTop: 12,
  },
  loginCard: {
    marginHorizontal: 24,
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: 24,
    padding: 22,
    gap: 20,
  },
  inlineError: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
    borderWidth: 1,
    borderColor: 'rgba(248, 113, 113, 0.3)',
    backgroundColor: 'rgba(248, 113, 113, 0.08)',
    borderRadius: 16,
    padding: 14,
  },
  inlineErrorText: {
    ...typography.body,
    flex: 1,
    color: '#F87171',
    fontSize: 14,
  },
  modeSwitch: {
    flexDirection: 'row',
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 18,
    padding: 4,
    backgroundColor: colors.background,
  },
  modeButton: {
    flex: 1,
    borderRadius: 14,
    paddingVertical: 10,
    alignItems: 'center',
  },
  modeButtonActive: {
    backgroundColor: colors.text,
  },
  modeButtonText: {
    ...typography.body,
    color: colors.textMuted,
    fontSize: 14,
    fontFamily: 'Inter-Medium',
  },
  modeButtonTextActive: {
    color: '#000',
  },
  modeHint: {
    ...typography.body,
    color: colors.textMuted,
    fontSize: 13,
    lineHeight: 18,
    marginTop: -8,
  },
  inputGroup: {
    gap: 8,
  },
  inputLabel: {
    ...typography.caption,
    color: colors.textMuted,
    letterSpacing: 1.5,
  },
  inputShell: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    backgroundColor: colors.background,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: 18,
    paddingHorizontal: 16,
  },
  textInput: {
    flex: 1,
    ...typography.body,
    color: colors.text,
    paddingVertical: 16,
  },
  primaryButton: {
    backgroundColor: colors.accentYellow,
    borderRadius: 100,
    paddingVertical: 18,
    paddingHorizontal: 18,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  primaryButtonText: {
    ...typography.h3,
    color: '#000',
    fontSize: 17,
    fontWeight: '500',
  },
  buttonDisabled: {
    opacity: 0.5,
  },
  studentHero: {
    marginHorizontal: 24,
    marginBottom: 32,
    borderRadius: 28,
    borderColor: colors.border,
    borderWidth: 1,
    backgroundColor: colors.surface,
    padding: 22,
  },
  studentTopRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: 22,
  },
  studentActions: {
    alignItems: 'flex-end',
    gap: 8,
    backgroundColor: 'transparent',
  },
  avatar: {
    width: 72,
    height: 72,
    borderRadius: 36,
    overflow: 'hidden',
    backgroundColor: colors.accentYellow,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarImage: {
    width: '100%',
    height: '100%',
  },
  avatarFallback: {
    ...typography.h2,
    color: '#000',
  },
  logoutButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 100,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  logoutText: {
    ...typography.body,
    color: colors.textMuted,
    fontSize: 13,
  },
  modeBadge: {
    borderRadius: 100,
    borderWidth: 1,
    borderColor: 'rgba(96, 165, 250, 0.45)',
    backgroundColor: 'rgba(96, 165, 250, 0.12)',
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  modeBadgeText: {
    ...typography.caption,
    color: colors.accentBlue,
    letterSpacing: 1,
  },
  studentName: {
    ...typography.h1,
    color: colors.text,
    fontSize: 42,
    lineHeight: 46,
    marginBottom: 8,
  },
  studentMeta: {
    ...typography.body,
    color: colors.textMuted,
    marginBottom: 24,
  },
  studentStats: {
    flexDirection: 'row',
    borderTopWidth: 1,
    borderColor: '#1A1A1A',
  },
  studentStat: {
    flex: 1,
    paddingTop: 16,
    paddingRight: 10,
  },
  studentStatValue: {
    fontFamily: 'Inter-Light',
    fontSize: 24,
    lineHeight: 28,
    color: colors.text,
  },
  studentStatLabel: {
    ...typography.caption,
    color: colors.textMuted,
    letterSpacing: 1,
    marginTop: 4,
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
    borderColor: colors.border,
    backgroundColor: colors.surface,
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
  tabContent: {
    backgroundColor: 'transparent',
  },
  scheduleHero: {
    marginHorizontal: 24,
    marginBottom: 18,
    borderRadius: 24,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    padding: 20,
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: 12,
  },
  scheduleTitle: {
    ...typography.h2,
    color: colors.text,
    fontSize: 30,
    lineHeight: 34,
  },
  scheduleDate: {
    ...typography.body,
    color: colors.accentYellow,
    marginTop: 6,
  },
  semesterPill: {
    alignSelf: 'flex-start',
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 100,
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  semesterPillText: {
    ...typography.caption,
    color: colors.textMuted,
    letterSpacing: 0.5,
    textTransform: 'capitalize',
  },
  dayPills: {
    paddingHorizontal: 24,
    paddingBottom: 24,
    gap: 10,
  },
  dayPill: {
    paddingHorizontal: 16,
    paddingVertical: 9,
    borderRadius: 100,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: 'transparent',
  },
  dayPillActive: {
    backgroundColor: colors.accentYellow,
    borderColor: colors.accentYellow,
  },
  dayPillText: {
    ...typography.body,
    color: colors.textMuted,
    fontSize: 13,
    fontFamily: 'Inter-Medium',
  },
  dayPillTextActive: {
    color: '#000',
  },
  noticeCard: {
    marginHorizontal: 24,
    marginBottom: 20,
    borderRadius: 18,
    backgroundColor: 'rgba(125, 164, 199, 0.12)',
    borderWidth: 1,
    borderColor: 'rgba(125, 164, 199, 0.25)',
    padding: 16,
  },
  noticeCardWarn: {
    backgroundColor: 'rgba(248, 113, 113, 0.08)',
    borderColor: 'rgba(248, 113, 113, 0.25)',
  },
  noticeText: {
    ...typography.body,
    color: colors.accentBlue,
  },
  noticeTextWarn: {
    color: '#F87171',
  },
  classList: {
    paddingHorizontal: 24,
    gap: 14,
    backgroundColor: 'transparent',
  },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: 'transparent',
  },
  sectionLabel: {
    ...typography.caption,
    color: colors.textMuted,
    letterSpacing: 1.5,
    marginBottom: 14,
  },
  sectionCount: {
    ...typography.caption,
    color: colors.text,
    marginBottom: 14,
  },
  classCard: {
    borderRadius: 22,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    padding: 18,
    gap: 16,
  },
  classCardOptional: {
    opacity: 0.62,
  },
  classTopRow: {
    flexDirection: 'row',
    gap: 14,
    alignItems: 'center',
  },
  smallAvatar: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: '#1D1D1D',
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
  },
  smallAvatarImage: {
    width: '100%',
    height: '100%',
  },
  smallAvatarFallback: {
    ...typography.h3,
    color: colors.text,
  },
  classTitleBlock: {
    flex: 1,
  },
  classTitle: {
    ...typography.h3,
    color: colors.text,
    fontSize: 18,
    lineHeight: 22,
  },
  optionalText: {
    textDecorationLine: 'line-through',
    color: colors.textMuted,
  },
  classCode: {
    ...typography.caption,
    color: colors.textMuted,
    marginTop: 3,
    letterSpacing: 1,
  },
  classMetaRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
  },
  classMetaItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    borderWidth: 1,
    borderColor: '#1F1F1F',
    borderRadius: 100,
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  classMetaText: {
    ...typography.body,
    color: colors.textMuted,
    fontSize: 13,
  },
  classActions: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: 12,
  },
  facultyLink: {
    ...typography.body,
    color: colors.accentBlue,
    fontFamily: 'Inter-Medium',
    fontSize: 14,
  },
  optionalButton: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 100,
    paddingHorizontal: 12,
    paddingVertical: 7,
  },
  optionalButtonActive: {
    backgroundColor: colors.accentYellow,
    borderColor: colors.accentYellow,
  },
  optionalButtonText: {
    ...typography.caption,
    color: colors.textMuted,
    letterSpacing: 0.8,
  },
  optionalButtonTextActive: {
    color: '#000',
  },
  metricRow: {
    flexDirection: 'row',
    gap: 14,
    paddingHorizontal: 24,
    marginBottom: 28,
  },
  metricBox: {
    flex: 1,
    borderTopWidth: 1,
    borderColor: '#1A1A1A',
    paddingTop: 18,
  },
  metricNumber: {
    fontFamily: 'Inter-ExtraLight',
    fontSize: 52,
    lineHeight: 56,
    color: colors.text,
  },
  metricLabel: {
    ...typography.caption,
    color: colors.textMuted,
  },
  listSection: {
    paddingHorizontal: 24,
    gap: 14,
  },
  attendanceCard: {
    borderRadius: 22,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    padding: 18,
    gap: 14,
  },
  attendanceCardLow: {
    borderColor: 'rgba(248, 113, 113, 0.35)',
  },
  cardHeaderRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: 14,
  },
  flexOne: {
    flex: 1,
  },
  cardTitle: {
    ...typography.h3,
    color: colors.text,
    fontSize: 18,
    lineHeight: 23,
  },
  cardSubtitle: {
    ...typography.body,
    color: colors.textMuted,
    fontSize: 13,
    marginTop: 4,
  },
  attendancePct: {
    fontFamily: 'Inter-Light',
    fontSize: 34,
    lineHeight: 38,
    color: colors.accentYellow,
  },
  progressTrack: {
    height: 5,
    borderRadius: 100,
    backgroundColor: '#242424',
    overflow: 'hidden',
  },
  progressFill: {
    height: '100%',
    borderRadius: 100,
  },
  attendanceStats: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: 12,
  },
  attendanceStat: {
    ...typography.caption,
    color: colors.textMuted,
    letterSpacing: 0.5,
  },
  marksCard: {
    borderRadius: 24,
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderWidth: 1,
    padding: 20,
    gap: 18,
  },
  scoreBadge: {
    borderRadius: 18,
    backgroundColor: colors.accentBlue,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  scoreBadgeText: {
    ...typography.h3,
    color: '#000',
    fontSize: 16,
  },
  marksTotal: {
    ...typography.body,
    color: colors.textMuted,
  },
  componentBlock: {
    borderTopWidth: 1,
    borderColor: '#1A1A1A',
    paddingTop: 14,
    gap: 10,
  },
  componentTitle: {
    ...typography.caption,
    color: colors.accentYellow,
    letterSpacing: 1.3,
  },
  componentEmpty: {
    ...typography.body,
    color: colors.textMuted,
    fontSize: 14,
  },
  testRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 14,
  },
  testName: {
    ...typography.body,
    color: colors.text,
    flex: 1,
    fontSize: 14,
  },
  testScore: {
    ...typography.body,
    color: colors.textMuted,
    fontFamily: 'Inter-Medium',
    fontSize: 14,
  },
  courseCard: {
    borderRadius: 22,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    padding: 18,
    gap: 16,
  },
  courseMetaGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  courseMeta: {
    ...typography.caption,
    color: colors.textMuted,
    borderWidth: 1,
    borderColor: '#1F1F1F',
    borderRadius: 100,
    paddingHorizontal: 10,
    paddingVertical: 6,
    letterSpacing: 0.7,
  },
  scheduleChips: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  scheduleChip: {
    backgroundColor: '#181818',
    borderRadius: 100,
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  scheduleChipText: {
    ...typography.body,
    color: colors.textMuted,
    fontSize: 12,
  },
  // ── Can-I-Bunk? row ─────────────────────────────────────────────────────────
  bunkRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
  },
  bunkStat: {
    gap: 2,
  },
  bunkStatNum: {
    fontFamily: 'Inter-Medium',
    fontSize: 15,
    color: colors.text,
  },
  bunkStatLabel: {
    ...typography.caption,
    color: colors.textMuted,
    letterSpacing: 0.5,
  },
  bunkPill: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: 100,
    paddingHorizontal: 14,
    paddingVertical: 8,
    gap: 6,
    borderWidth: 1,
  },
  bunkPillSafe: {
    backgroundColor: 'rgba(205, 215, 70, 0.1)',
    borderColor: 'rgba(205, 215, 70, 0.3)',
  },
  bunkPillDanger: {
    backgroundColor: 'rgba(248, 113, 113, 0.1)',
    borderColor: 'rgba(248, 113, 113, 0.3)',
  },
  bunkPillEdge: {
    backgroundColor: 'rgba(125, 164, 199, 0.1)',
    borderColor: 'rgba(125, 164, 199, 0.3)',
  },
  bunkPillNum: {
    fontFamily: 'Inter-SemiBold',
    fontSize: 22,
    lineHeight: 26,
  },
  bunkPillLbl: {
    ...typography.caption,
    color: colors.textMuted,
    letterSpacing: 0.5,
  },
  // ── Holiday planner ──────────────────────────────────────────────────────────
  holidaySection: {
    paddingHorizontal: 24,
    marginBottom: 28,
    gap: 10,
  },
  holidayRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    padding: 14,
  },
  holidayRowHoliday: {
    borderColor: 'rgba(248, 113, 113, 0.3)',
    backgroundColor: 'rgba(248, 113, 113, 0.05)',
  },
  holidayDateBox: {
    width: 44,
    alignItems: 'center',
  },
  holidayDate: {
    fontFamily: 'Inter-SemiBold',
    fontSize: 22,
    color: colors.text,
    lineHeight: 26,
  },
  holidayMonth: {
    ...typography.caption,
    color: colors.textMuted,
    letterSpacing: 0.5,
  },
  holidayInfo: {
    flex: 1,
    gap: 4,
  },
  holidayEvent: {
    ...typography.body,
    color: colors.text,
    fontSize: 14,
    lineHeight: 18,
  },
  holidayMeta: {
    flexDirection: 'row',
    gap: 6,
    flexWrap: 'wrap',
  },
  holidayDayOrder: {
    ...typography.caption,
    color: colors.accentBlue,
    letterSpacing: 0.5,
  },
  holidayBadge: {
    ...typography.caption,
    color: '#F87171',
    letterSpacing: 0.5,
  },
  holidayUntil: {
    ...typography.caption,
    color: colors.textMuted,
    letterSpacing: 0.5,
    textAlign: 'right',
  },
  // ── PDF export button ────────────────────────────────────────────────────────
  exportButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    borderWidth: 1,
    borderColor: 'rgba(205, 215, 70, 0.3)',
    borderRadius: 100,
    paddingHorizontal: 12,
    paddingVertical: 7,
    marginBottom: 14,
  },
  exportButtonText: {
    ...typography.caption,
    color: colors.accentYellow,
    letterSpacing: 0.5,
  },
  // ── Attendance planner ───────────────────────────────────────────────────────
  plannerCard: {
    borderRadius: 24,
    borderWidth: 1,
    borderColor: 'rgba(125, 164, 199, 0.3)',
    backgroundColor: 'rgba(125, 164, 199, 0.06)',
    padding: 20,
    gap: 16,
    marginBottom: 6,
  },
  plannerHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
  },
  plannerTitle: {
    ...typography.h3,
    color: colors.text,
    fontSize: 17,
  },
  plannerBadges: {
    flexDirection: 'row',
    gap: 6,
  },
  plannerBadgeSafe: {
    borderRadius: 100,
    backgroundColor: 'rgba(74, 222, 128, 0.12)',
    borderWidth: 1,
    borderColor: 'rgba(74, 222, 128, 0.3)',
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  plannerBadgeSafeText: {
    ...typography.caption,
    color: '#4ADE80',
    letterSpacing: 0.5,
  },
  plannerBadgeRisk: {
    borderRadius: 100,
    backgroundColor: 'rgba(248, 113, 113, 0.12)',
    borderWidth: 1,
    borderColor: 'rgba(248, 113, 113, 0.3)',
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  plannerBadgeRiskText: {
    ...typography.caption,
    color: '#F87171',
    letterSpacing: 0.5,
  },
  plannerAllGood: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  plannerAllGoodText: {
    ...typography.body,
    color: '#4ADE80',
    fontSize: 14,
  },
  plannerSummaryRow: {
    flexDirection: 'row',
    alignItems: 'baseline',
    gap: 8,
  },
  plannerSummaryNum: {
    fontFamily: 'Inter-Light',
    fontSize: 42,
    lineHeight: 46,
    color: '#F87171',
  },
  plannerSummaryLabel: {
    ...typography.body,
    color: colors.textMuted,
    flex: 1,
    fontSize: 13,
    lineHeight: 18,
  },
  plannerList: {
    gap: 8,
    borderTopWidth: 1,
    borderColor: '#1A1A1A',
    paddingTop: 12,
  },
  plannerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
  },
  plannerRowLeft: {
    flex: 1,
  },
  plannerRowCode: {
    ...typography.caption,
    color: colors.textMuted,
    letterSpacing: 0.8,
  },
  plannerRowTitle: {
    ...typography.body,
    color: colors.text,
    fontSize: 14,
  },
  plannerRowRight: {},
  plannerRowNeed: {
    ...typography.caption,
    color: '#F87171',
    letterSpacing: 0.3,
  },
  // ── Margin predictor ─────────────────────────────────────────────────────────
  predictorToggleBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    borderTopWidth: 1,
    borderColor: '#1A1A1A',
    paddingTop: 12,
  },
  predictorToggleBtnText: {
    ...typography.caption,
    color: colors.textMuted,
    letterSpacing: 0.8,
  },
  predictorToggleChevron: {
    ...typography.caption,
    color: colors.textMuted,
    fontSize: 8,
  },
  predictorBox: {
    gap: 14,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#1D1D1D',
    backgroundColor: colors.background,
    padding: 14,
  },
  predictorToggle: {
    flexDirection: 'row',
    gap: 8,
  },
  predictorMode: {
    paddingHorizontal: 14,
    paddingVertical: 7,
    borderRadius: 100,
    borderWidth: 1,
    borderColor: '#1F1F1F',
  },
  predictorModeSkip: {
    backgroundColor: 'rgba(248, 113, 113, 0.12)',
    borderColor: 'rgba(248, 113, 113, 0.35)',
  },
  predictorModeAttend: {
    backgroundColor: 'rgba(74, 222, 128, 0.12)',
    borderColor: 'rgba(74, 222, 128, 0.35)',
  },
  predictorModeText: {
    ...typography.caption,
    color: colors.textMuted,
    letterSpacing: 0.5,
  },
  predictorModeTextActive: {
    color: colors.text,
  },
  predictorStepper: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
  },
  stepBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: '#1A1A1A',
    alignItems: 'center',
    justifyContent: 'center',
  },
  stepBtnText: {
    color: colors.text,
    fontSize: 20,
    lineHeight: 24,
    fontFamily: 'Inter-Light',
  },
  stepValue: {
    fontFamily: 'Inter-SemiBold',
    fontSize: 28,
    lineHeight: 32,
    color: colors.text,
    minWidth: 32,
    textAlign: 'center',
  },
  stepLabel: {
    ...typography.body,
    color: colors.textMuted,
    fontSize: 14,
  },
  predictorResult: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderTopWidth: 1,
    borderColor: '#1A1A1A',
    paddingTop: 12,
    gap: 12,
  },
  predictorPct: {
    fontFamily: 'Inter-Light',
    fontSize: 38,
    lineHeight: 42,
  },
  predictorResultRight: {
    alignItems: 'flex-end',
    gap: 4,
  },
  predictorDiff: {
    fontFamily: 'Inter-Medium',
    fontSize: 16,
  },
  predictorMarginText: {
    ...typography.caption,
    color: colors.textMuted,
    letterSpacing: 0.3,
  },
  semToggle: {
    flexDirection: 'row',
    gap: 10,
    paddingHorizontal: 24,
    marginBottom: 24,
  },
  semToggleButton: {
    flex: 1,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 100,
    paddingVertical: 11,
    alignItems: 'center',
  },
  semToggleButtonActive: {
    backgroundColor: colors.accentYellow,
    borderColor: colors.accentYellow,
  },
  semToggleText: {
    ...typography.body,
    color: colors.textMuted,
    fontSize: 13,
    fontFamily: 'Inter-Medium',
  },
  semToggleTextActive: {
    color: '#000',
  },
  monthCard: {
    borderRadius: 22,
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderWidth: 1,
    padding: 16,
    gap: 14,
  },
  monthTitle: {
    ...typography.h3,
    color: colors.text,
  },
  calendarGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  dayCell: {
    width: 48,
    minHeight: 48,
    borderRadius: 14,
    backgroundColor: colors.background,
    borderWidth: 1,
    borderColor: '#1F1F1F',
    alignItems: 'center',
    justifyContent: 'center',
  },
  dayCellActive: {
    borderColor: 'rgba(205, 215, 70, 0.4)',
    backgroundColor: 'rgba(205, 215, 70, 0.08)',
  },
  dayCellDate: {
    fontFamily: 'Inter-Medium',
    fontSize: 14,
    color: colors.text,
  },
  dayCellDateActive: {
    color: colors.accentYellow,
  },
  dayCellOrder: {
    ...typography.caption,
    color: colors.textMuted,
    fontSize: 9,
    letterSpacing: 0.5,
  },
  dayCellOrderActive: {
    color: colors.accentYellow,
  },
  emptyState: {
    marginHorizontal: 24,
    borderRadius: 24,
    borderColor: colors.border,
    borderWidth: 1,
    backgroundColor: colors.surface,
    padding: 28,
    alignItems: 'center',
    gap: 10,
  },
  emptyTitle: {
    ...typography.h3,
    color: colors.text,
    textAlign: 'center',
  },
  emptyBody: {
    ...typography.body,
    color: colors.textMuted,
    textAlign: 'center',
  },
  loadingBlock: {
    flex: 1,
    minHeight: 220,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
    backgroundColor: 'transparent',
    paddingHorizontal: 24,
  },
  loadingText: {
    ...typography.body,
    color: colors.textMuted,
    textAlign: 'center',
  },
  errorBlock: {
    marginHorizontal: 24,
    borderRadius: 24,
    borderColor: 'rgba(248, 113, 113, 0.25)',
    borderWidth: 1,
    backgroundColor: 'rgba(248, 113, 113, 0.07)',
    padding: 24,
    alignItems: 'center',
    gap: 12,
  },
  errorTitle: {
    ...typography.h3,
    color: colors.text,
  },
  errorBody: {
    ...typography.body,
    color: '#FCA5A5',
    textAlign: 'center',
  },
  errorButton: {
    marginTop: 6,
    borderRadius: 100,
    backgroundColor: colors.accentWhite,
    paddingHorizontal: 20,
    paddingVertical: 10,
  },
  errorButtonText: {
    ...typography.body,
    color: '#000',
    fontFamily: 'Inter-Medium',
  },
  modalContainer: {
    flex: 1,
    backgroundColor: colors.background,
  },
  modalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 24,
    paddingVertical: 16,
  },
  modalCloseButton: {
    width: 42,
    height: 42,
    borderRadius: 21,
    alignItems: 'center',
    justifyContent: 'center',
  },
  modalContent: {
    paddingHorizontal: 24,
    paddingBottom: 40,
    gap: 24,
  },
  facultyHero: {
    alignItems: 'flex-start',
    gap: 12,
  },
  facultyAvatar: {
    width: 108,
    height: 108,
    borderRadius: 54,
    overflow: 'hidden',
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  facultyAvatarImage: {
    width: '100%',
    height: '100%',
  },
  facultyAvatarFallback: {
    ...typography.h1,
    color: colors.text,
  },
  facultyName: {
    ...typography.h1,
    color: colors.text,
    fontSize: 42,
    lineHeight: 46,
  },
  facultyResearch: {
    ...typography.body,
    color: colors.textMuted,
  },
  modalSection: {
    gap: 12,
    backgroundColor: 'transparent',
  },
  infoRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: 16,
    borderBottomWidth: 1,
    borderColor: '#1A1A1A',
    paddingBottom: 12,
  },
  infoLabel: {
    ...typography.body,
    color: colors.textMuted,
    fontSize: 14,
  },
  infoValue: {
    ...typography.body,
    color: colors.text,
    flex: 1,
    textAlign: 'right',
    fontSize: 14,
  },
  modalListItem: {
    ...typography.body,
    color: colors.text,
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderColor: '#1A1A1A',
  },
});
