import Constants from 'expo-constants';

export type AcademiaSem = 'even' | 'odd';

export interface AcademiaBaseResponse {
  success: boolean;
  error?: string;
}

export interface StudentInfo {
  Name?: string;
  Semester?: string;
  Program?: string;
  Department?: string;
  Section?: string;
  PhotoUrl?: string;
  [key: string]: string | undefined;
}

export interface AttendanceRecord {
  courseCode?: string;
  courseTitle?: string;
  attendancePct?: string | number;
  hoursConducted?: string | number;
  hoursAbsent?: string | number;
  [key: string]: unknown;
}

export interface MarksTest {
  testName?: string;
  score?: string | number;
  maxScore?: string | number;
}

export interface MarksRecord {
  courseCode?: string;
  courseType?: string;
  tests?: MarksTest[];
  [key: string]: unknown;
}

export interface TimetableSlot {
  day?: string;
  timing?: string;
  hourIndex?: number;
  slotToken?: string;
}

export interface TimetableCourse {
  courseCode?: string;
  courseTitle?: string;
  credit?: string | number;
  category?: string;
  courseType?: string;
  facultyName?: string;
  facultyPhotoUrl?: string;
  slot?: string;
  roomNo?: string;
  schedule?: TimetableSlot[];
  [key: string]: unknown;
}

export interface TimetableData {
  courses?: TimetableCourse[];
  advisors?: unknown[];
  [key: string]: unknown;
}

export interface CalendarDay {
  date?: string | number;
  dayOrder?: string;
  event?: string;
  day?: string;
  [key: string]: unknown;
}

export interface CalendarMonth {
  name?: string;
  days?: CalendarDay[];
}

export interface CalendarData {
  months?: CalendarMonth[];
}

export interface FacultyProfile {
  name?: string;
  photo_url?: string;
  designation?: string;
  department?: string;
  email?: string;
  campus?: string;
  experience?: string;
  research_interest?: string;
  courses?: string[];
  education?: string[];
  publications?: string[];
  awards?: string[];
  workshops?: string[];
  work_experience?: string[];
  memberships?: string[];
  responsibilities?: string[];
  profile_url?: string;
  [key: string]: unknown;
}

export interface InitResponse extends AcademiaBaseResponse {
  studentInfo?: StudentInfo;
  timetable?: TimetableData;
  calendar?: CalendarData;
}

export interface AttendanceResponse extends AcademiaBaseResponse {
  attendance?: AttendanceRecord[];
}

export interface MarksResponse extends AcademiaBaseResponse {
  marks?: MarksRecord[];
}

export interface TimetableResponse extends AcademiaBaseResponse {
  timetable?: TimetableData;
}

export interface CalendarResponse extends AcademiaBaseResponse {
  calendar?: CalendarData;
}

export interface AcademiaSummaryResponse extends AcademiaBaseResponse {
  email?: string;
  studentInfo?: StudentInfo;
  semester?: string | null;
  semType?: AcademiaSem;
  todayDayOrder?: string | null;
  classCount?: number;
  nextClass?: {
    courseCode?: string;
    courseTitle?: string;
    timing?: string;
    hourIndex?: number | null;
    facultyName?: string;
    roomNo?: string;
  } | null;
  attendanceAverage?: number | null;
  lowAttendanceCount?: number;
  attendanceCount?: number;
}

export interface FacultyResponse extends AcademiaBaseResponse {
  faculty?: FacultyProfile;
}

export const ACADEMIA_EMAIL_STORAGE_KEY = 'academia_email';

function getExpoHost() {
  const expoConstants = Constants as unknown as {
    expoConfig?: { hostUri?: string };
    manifest?: { debuggerHost?: string; hostUri?: string };
    manifest2?: { extra?: { expoClient?: { hostUri?: string } } };
  };

  const hostUri =
    expoConstants.expoConfig?.hostUri ||
    expoConstants.manifest2?.extra?.expoClient?.hostUri ||
    expoConstants.manifest?.debuggerHost ||
    expoConstants.manifest?.hostUri ||
    '';

  const hostPort = hostUri.replace(/^[a-z]+:\/\//i, '').split('/')[0];
  return hostPort.split(':')[0];
}

function defaultAcademiaApiUrl() {
  // In dev (Expo Go), use the host machine's LAN IP auto-detected from Expo
  const host = getExpoHost();
  if (host && !['localhost', '127.0.0.1', '::1'].includes(host)) {
    return `http://${host}:3000`;
  }
  // Production fallback — Render deployment
  return 'https://academia-backend-8q9r.onrender.com';
}

const BASE_URL = (process.env.EXPO_PUBLIC_BACKEND_URL || defaultAcademiaApiUrl()).replace(/\/+$/, '');

export function academiaApiUrl(path: string) {
  return `${BASE_URL}${path.startsWith('/') ? path : `/${path}`}`;
}

async function request<T extends AcademiaBaseResponse>(method: string, path: string, body?: unknown): Promise<T> {
  let response: Response;

  try {
    response = await fetch(academiaApiUrl(path), {
      method,
      headers: { 'Content-Type': 'application/json' },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
  } catch {
    throw new Error(
      `Cannot reach Academia backend at ${BASE_URL}. Check your internet connection and try again.`,
    );
  }

  const payload = await response.json().catch(() => null);

  if (!response.ok) {
    const message =
      payload && typeof payload === 'object' && 'error' in payload
        ? String((payload as AcademiaBaseResponse).error)
        : `Academia request failed with HTTP ${response.status}`;
    throw new Error(message);
  }

  if (!payload || typeof payload !== 'object') {
    throw new Error('Academia backend returned an invalid response.');
  }

  return payload as T;
}

function numberValue(value: unknown): number {
  const parsed = typeof value === 'number' ? value : parseFloat(String(value ?? '0'));
  return Number.isFinite(parsed) ? parsed : 0;
}

function normalizeQuotes(value: string) {
  return value.replace(/[\u2018\u2019\u201A\u201B\u2032\u2035`']/g, "'").toLowerCase().trim();
}

function currentAcademicDate() {
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const now = new Date();
  return {
    date: String(now.getDate()),
    monthName: `${months[now.getMonth()]} '${String(now.getFullYear()).slice(2)}`,
  };
}

function getTodayDayOrder(calendar: CalendarData | null) {
  const today = currentAcademicDate();
  const month = calendar?.months?.find((item) => normalizeQuotes(item.name || '') === normalizeQuotes(today.monthName));
  const day = month?.days?.find((item) => String(item.date ?? '').trim() === today.date);
  return day?.dayOrder && day.dayOrder !== '-' ? String(day.dayOrder) : null;
}

function getClassesForDay(timetable: TimetableData | null, dayOrder: string | null) {
  if (!timetable?.courses || !dayOrder) return [];

  const classes: Array<{
    courseCode?: string;
    courseTitle?: string;
    timing?: string;
    hourIndex: number;
    facultyName?: string;
    roomNo?: string;
  }> = [];

  for (const course of timetable.courses) {
    for (const slot of course.schedule || []) {
      if (slot.day === `Day ${dayOrder}`) {
        classes.push({
          courseCode: course.courseCode,
          courseTitle: course.courseTitle,
          timing: slot.timing || 'Timing TBA',
          hourIndex: numberValue(slot.hourIndex),
          facultyName: course.facultyName,
          roomNo: course.roomNo,
        });
      }
    }
  }

  return classes.sort((a, b) => a.hourIndex - b.hourIndex);
}

async function legacySummary(email: string): Promise<AcademiaSummaryResponse> {
  const initRes = await request<InitResponse>('GET', `/init?email=${encodeURIComponent(email)}&sem=even`);
  if (!initRes.success) throw new Error(initRes.error || 'Could not load Academia.');

  const student = initRes.studentInfo || null;
  const semester = student?.Semester || null;
  const semType: AcademiaSem = parseInt(semester || '1', 10) % 2 === 0 ? 'even' : 'odd';
  const calendar =
    semType === 'odd'
      ? ((await request<CalendarResponse>('GET', `/calendar?email=${encodeURIComponent(email)}&sem=odd`)).calendar || null)
      : initRes.calendar || null;

  const todayDayOrder = getTodayDayOrder(calendar);
  const classes = getClassesForDay(initRes.timetable || null, todayDayOrder);
  const attendanceRes = await request<AttendanceResponse>('GET', `/attendance?email=${encodeURIComponent(email)}`);
  const attendance = attendanceRes.success ? attendanceRes.attendance || [] : [];
  const attendanceAverage = attendance.length
    ? Math.round(attendance.reduce((sum, item) => sum + numberValue(item.attendancePct), 0) / attendance.length)
    : null;

  return {
    success: true,
    email,
    studentInfo: student || undefined,
    semester,
    semType,
    todayDayOrder,
    classCount: classes.length,
    nextClass: classes[0] ? {
      courseCode: classes[0].courseCode,
      courseTitle: classes[0].courseTitle,
      timing: classes[0].timing,
      hourIndex: classes[0].hourIndex,
      facultyName: classes[0].facultyName,
      roomNo: classes[0].roomNo,
    } : null,
    attendanceAverage,
    lowAttendanceCount: attendance.filter((item) => numberValue(item.attendancePct) < 75).length,
    attendanceCount: attendance.length,
  };
}

export const academiaApi = {
  login: (email: string, password: string) =>
    request<AcademiaBaseResponse>('POST', '/login', { email, password }),
  logout: (email: string) =>
    request<AcademiaBaseResponse>('POST', '/logout', { email }),
  init: (email: string, sem: AcademiaSem = 'even') =>
    request<InitResponse>('GET', `/init?email=${encodeURIComponent(email)}&sem=${sem}`),
  summary: async (email: string) => {
    try {
      return await request<AcademiaSummaryResponse>('GET', `/summary?email=${encodeURIComponent(email)}`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error ?? '');
      if (!message.includes('HTTP 404')) throw error;
      return legacySummary(email);
    }
  },
  student: (email: string) =>
    request<InitResponse>('GET', `/student?email=${encodeURIComponent(email)}`),
  attendance: (email: string) =>
    request<AttendanceResponse>('GET', `/attendance?email=${encodeURIComponent(email)}`),
  marks: (email: string) =>
    request<MarksResponse>('GET', `/marks?email=${encodeURIComponent(email)}`),
  timetable: (email: string) =>
    request<TimetableResponse>('GET', `/timetable?email=${encodeURIComponent(email)}`),
  calendar: (email: string, sem: AcademiaSem) =>
    request<CalendarResponse>('GET', `/calendar?email=${encodeURIComponent(email)}&sem=${sem}`),
  faculty: (name: string, email?: string) =>
    request<FacultyResponse>(
      'GET',
      `/faculty?name=${encodeURIComponent(name)}${email ? `&email=${encodeURIComponent(email)}` : ''}`,
    ),
};
