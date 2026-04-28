/**
 * server.js — SRM Academia API Server (Go-only backend)
 *
 * Architecture:
 *   - Uses the Go scraper binary exclusively for all SRM portal interactions
 *   - Sessions stored in-memory: sessions[email] = { cookies, cache, meta, … }
 *   - Sessions expire after 30 minutes of inactivity (auto-destroyed)
 *   - ALL scraped data is cached server-side → repeat requests are instant
 *   - NO password storage, NO auto re-login
 *
 * Endpoints:
 *   POST /login                  → login via Go scraper, create session
 *   GET  /init?email=            → fetch student + timetable + calendar in parallel
 *   GET  /attendance?email=      → fetch attendance
 *   GET  /marks?email=           → fetch marks
 *   GET  /timetable?email=       → fetch timetable (+ advisors)
 *   GET  /student?email=         → fetch student info
 *   GET  /calendar?email=&sem=   → fetch academic calendar
 *   GET  /summary?email=         → dashboard-ready Academia snapshot
 *   GET  /schedule?email=        → schedule (computed from timetable + calendar cache)
 *   GET  /all?email=             → fetch everything at once
 *   GET  /student-photo?email=   → proxy student profile photo (Zoho previewengine)
 *   GET  /faculty-photo?url=     → proxy SRM faculty photo (hotlink bypass)
 *   GET  /faculty?name=          → faculty info via Go faculty scraper
 *   POST /logout                 → destroy session
 *   GET  /status                 → server health + active sessions
 */

import express from "express";
import cors from "cors";
import helmet from "helmet";
import rateLimit from "express-rate-limit";
import { runAcademiaScraper, getAcademiaScraperRuntime } from "../integrations/go/go_scraper_client.js";
import { buildScheduleFromData } from "../utils/schedule_utils.js";

// ─── Config ───────────────────────────────────────────────────────────────────

const PORT = process.env.PORT || 3000;
const SESSION_TTL_MS = 30 * 60 * 1000;      // 30 minutes inactivity timeout
const CLEANUP_INTERVAL_MS = 5 * 60 * 1000;  // check every 5 minutes
const MAX_USERS = 8;
const GO_CLASS_AUTHENTICATED = "authenticated_session_established";

function parseOriginEnv(value) {
  return (value || "")
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean);
}

// Allowed CORS origins — set ALLOWED_ORIGINS in production (comma-separated).
const ALLOWED_ORIGINS = Array.from(new Set([
  "http://localhost:5173",
  "http://localhost:4173",
  "https://srm-academia-dashboard.vercel.app",
  "https://srm-academia-dashboard-s9ky.vercel.app",
  ...parseOriginEnv(process.env.ALLOWED_ORIGIN),
  ...parseOriginEnv(process.env.ALLOWED_ORIGINS),
]));

// ─── State ────────────────────────────────────────────────────────────────────

/**
 * In-memory session store.
 * sessions[email] = { cookies, lastActive, cache, meta }
 * Passwords are NEVER stored.
 */
const sessions = {};

// ─── Helpers ──────────────────────────────────────────────────────────────────

function log(tag, msg) {
  console.log(`[${new Date().toISOString()}] [${tag}] ${msg}`);
}

function hasOwn(obj, key) {
  return Object.prototype.hasOwnProperty.call(obj, key);
}

function normalizeMarksRecords(records) {
  if (!Array.isArray(records)) return [];
  return records.map((record) => ({
    ...record,
    tests: Array.isArray(record?.tests) ? record.tests : [],
  }));
}

function isStudentPhotoProxyUrl(photoUrl) {
  const lowerUrl = String(photoUrl || "").toLowerCase();
  return (
    lowerUrl.includes("previewengine") ||
    lowerUrl.includes("creatorexport.zoho.com") ||
    (lowerUrl.includes("zoho.com") && lowerUrl.includes("/image/")) ||
    (lowerUrl.includes("academia.srmist.edu.in") && lowerUrl.includes("download-file?filepath="))
  );
}

function normalizeGoSections(sections = []) {
  const valid = new Set(["studentInfo", "attendance", "marks", "timetable"]);
  return [...new Set(
    sections
      .map((section) => String(section || "").trim())
      .filter((section) => valid.has(section))
  )];
}

function normalizeCalendarSems(sems = []) {
  return [...new Set(
    sems
      .map((sem) => String(sem || "").trim().toLowerCase())
      .filter((sem) => sem === "odd" || sem === "even")
  )];
}

function hasCachedSection(session, section) {
  if (!session?.cache) return false;
  switch (section) {
    case "studentInfo": return hasOwn(session.cache, "studentInfo");
    case "attendance": return hasOwn(session.cache, "attendance");
    case "marks": return hasOwn(session.cache, "marks");
    case "timetable": return hasOwn(session.cache, "timetable");
    default: return false;
  }
}

function hasCachedCalendar(session, sem) {
  return !!session?.cache && hasOwn(session.cache, `calendar_${sem}`);
}

function mergeGoDataIntoCache(session, data = {}) {
  if (!session?.cache || !data) return;

  if (data.studentInfo && Object.keys(data.studentInfo).length) {
    session.cache.studentInfo = {
      ...(session.cache.studentInfo || {}),
      ...data.studentInfo,
    };
    if (session.cache.studentInfo.PhotoUrl) {
      session.cache.photo = session.cache.studentInfo.PhotoUrl;
    }
  }

  if (Array.isArray(data.attendance) && data.attendance.length) {
    session.cache.attendance = data.attendance;
  }

  if (Array.isArray(data.marks) && data.marks.length) {
    session.cache.marks = normalizeMarksRecords(data.marks);
  }

  if (data.timetable && Array.isArray(data.timetable.courses)) {
    session.cache.timetable = data.timetable;
  }

  if (data.calendars && typeof data.calendars === "object") {
    for (const [sem, calendar] of Object.entries(data.calendars)) {
      if (calendar && Array.isArray(calendar.months)) {
        session.cache[`calendar_${sem}`] = calendar;
      }
    }
  }

  if (data.errors && typeof data.errors === "object" && Object.keys(data.errors).length) {
    session.meta = {
      ...(session.meta || {}),
      lastErrors: data.errors,
    };
  }
}

function needsGoStudentPhotoRefresh(session) {
  return (
    session?.backend === "go" &&
    !!session.cache?.studentInfo &&
    !session.cache.studentInfo.PhotoUrl &&
    !session.cache.photo
  );
}

async function refreshGoStudentInfo(email) {
  const session = sessions[email];
  if (!session) throw Object.assign(new Error("No session"), { expired: true });
  if (session.backend !== "go") return session.cache?.studentInfo || null;

  const existingStudentInfo = session.cache?.studentInfo
    ? { ...session.cache.studentInfo }
    : null;

  delete session.cache.studentInfo;
  try {
    await hydrateGoSession(email, { sections: ["studentInfo"] });
  } catch (error) {
    if (existingStudentInfo) {
      session.cache.studentInfo = existingStudentInfo;
    }
    throw error;
  }

  return session.cache?.studentInfo || existingStudentInfo;
}

function needsStudentPhotoFallback(session) {
  const photoUrl = session?.cache?.studentInfo?.PhotoUrl || session?.cache?.photo || "";
  const lowerUrl = String(photoUrl || "").toLowerCase();
  return (
    session?.backend === "go" &&
    (!photoUrl || lowerUrl.includes("creatorexport.zoho.com"))
  );
}

function cookieHeader(session) {
  const cookies = session?.cookies || [];
  return cookies.map((c) => `${c.name}=${c.value}`).join("; ");
}


/**
 * Fetches the student photo via plain HTTP using the stored session cookies.
 * Mirrors what the Go scraper does, but in Node.js so it can run anytime:
 *   1. GET the Student_Profile_Report page with session cookies
 *   2. Parse the Your_Photo <img src> from the embedded JSON blob
 *   3. Download the image bytes → cache as a data: URI
 */
async function ensureUsableStudentPhoto(email) {
  const session = sessions[email];
  if (!session) throw Object.assign(new Error("No session"), { expired: true });

  if (!needsStudentPhotoFallback(session)) {
    return session.cache?.studentInfo?.PhotoUrl || session.cache?.photo || null;
  }

  if (session.photoRecoveryPromise) {
    return session.photoRecoveryPromise;
  }

  session.photoRecoveryPromise = (async () => {
    try {
      const cookies = cookieHeader(session);
      const headers = {
        "Cookie": cookies,
        "Referer": "https://academia.srmist.edu.in/#Report:Student_Profile_Report",
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36",
        "X-Requested-With": "XMLHttpRequest",
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      };

      // ── Step 1: fetch the profile report page ────────────────────────────
      const profileURL = "https://academia.srmist.edu.in/srm_university/academia-academic-services/report/Student_Profile_Report";
      log("PHOTO", `HTTP fetch profile report for ${email}`);
      const pageRes = await fetch(profileURL, { headers });
      if (!pageRes.ok) {
        log("PHOTO", `Profile report returned ${pageRes.status} for ${email}`);
        return null;
      }
      const html = await pageRes.text();

      // ── Step 2: extract photo URL from the embedded JSON blob ──────────────
      // The page embeds: {"HTML":... "MODEL":{"DATAJSONARRAY":[{"Your_Photo":"<a ...><img downqual=\"/...\" src=\"/...\" />"}]}}
      // Zoho Creator uses lazy-loading: the real URL is in downqual/medqual/lowqual attrs, not src.
      let photoSrc = "";

      function extractPhotoUrl(rawHtml) {
        // Decode HTML entities so &amp; becomes & before URL matching
        const decoded = rawHtml.replace(/&amp;/g, "&").replace(/&#x26;/g, "&");

        // Priority 1: lowqual/medqual/downqual/src with Your_Photo + filepath
        for (const attr of ["lowqual", "medqual", "downqual", "src"]) {
          const m = decoded.match(new RegExp(attr + '=["\']([^"\']+Your_Photo[^"\']+filepath[^"\']+)', "i"));
          if (m && m[1]) return m[1];
        }
        // Priority 2: download-file?filepath= path
        const df = decoded.match(/\/[^\s"']*\/Your_Photo\/download-file\?[^\s"'<>]+/);
        if (df) return df[0];
        // Priority 3: Zoho /image/ path
        const img = decoded.match(/\/[^\s"']*\/Your_Photo\/image\/[^\s"'<>]+/);
        if (img) return img[0];
        return "";
      }

      // Try structured JSON parse first
      const jsonStart = html.indexOf('{"HTML":');
      if (jsonStart >= 0) {
        try {
          const obj = JSON.parse(html.slice(jsonStart));
          const photoHtml = obj?.MODEL?.DATAJSONARRAY?.[0]?.["Your_Photo"] || "";
          if (photoHtml) {
            log("PHOTO", `Your_Photo HTML (first 500): ${photoHtml.slice(0, 500)}`);
            photoSrc = extractPhotoUrl(photoHtml);
          }
        } catch (e) {
          log("PHOTO", `JSON parse failed: ${e.message}`);
        }
      }

      // Fallback: substring search in raw HTML
      if (!photoSrc) {
        const marker = '"Your_Photo":"';
        const idx = html.indexOf(marker);
        if (idx >= 0) {
          const end = html.indexOf('"}', idx + marker.length);
          if (end >= 0) {
            const raw = html.slice(idx + marker.length, end).replace(/\\"/g, '"').replace(/\\\//g, '/');
            log("PHOTO", `Your_Photo fallback HTML (first 500): ${raw.slice(0, 500)}`);
            photoSrc = extractPhotoUrl(raw);
          }
        }
      }

      if (!photoSrc) {
        log("PHOTO", `Could not extract photo URL from profile report for ${email}`);
        return null;
      }

      // Resolve relative URLs
      if (photoSrc.startsWith("/")) {
        photoSrc = "https://academia.srmist.edu.in" + photoSrc;
      }

      log("PHOTO", `HTTP photo candidate for ${email}: ${photoSrc.slice(0, 120)}`);

      // ── Step 3: download the image bytes ─────────────────────────────────
      const imgRes = await fetch(photoSrc, {
        headers: {
          "Cookie": cookies,
          "Referer": "https://academia.srmist.edu.in/#Report:Student_Profile_Report",
          "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36",
          "Accept": "image/avif,image/webp,image/apng,image/*,*/*;q=0.8",
        },
      });

      if (!imgRes.ok) {
        log("PHOTO", `Photo download returned ${imgRes.status} for ${email} (${photoSrc.slice(0, 80)})`);
        return null;
      }

      let contentType = imgRes.headers.get("content-type") || "";
      if (!contentType.startsWith("image/") || contentType.includes("octet-stream")) {
        // Guess from extension
        const lower = photoSrc.toLowerCase();
        contentType = lower.includes(".png") ? "image/png"
          : lower.includes(".webp") ? "image/webp"
            : "image/jpeg";
      }

      const buf = await imgRes.arrayBuffer();
      if (!buf.byteLength) {
        log("PHOTO", `Photo download returned empty body for ${email}`);
        return null;
      }

      const dataUri = `data:${contentType};base64,${Buffer.from(buf).toString("base64")}`;
      log("PHOTO", `HTTP photo OK for ${email} (${buf.byteLength} bytes, ${contentType})`);

      session.cache.photo = dataUri;
      if (session.cache.studentInfo) {
        session.cache.studentInfo.PhotoUrl = dataUri;
      }
      return dataUri;
    } catch (err) {
      log("PHOTO", `HTTP photo fetch error for ${email}: ${err.message}`);
      return null;
    } finally {
      delete session.photoRecoveryPromise;
    }
  })();

  return session.photoRecoveryPromise;
}

function goResultLooksExpired(result) {
  if (!result || result.classification === GO_CLASS_AUTHENTICATED) return false;
  const urls = [
    result.finalUrl,
    ...(result.redirectSummary || []).flatMap((step) => [step.url, step.location]),
  ]
    .filter(Boolean)
    .map((value) => String(value).toLowerCase());

  return urls.some((value) => value.includes("/accounts/") || value.includes("signin"));
}

function requestedGoDataMissing(session, sections = [], calendarSems = []) {
  const missing = [];
  for (const section of normalizeGoSections(sections)) {
    if (!hasCachedSection(session, section)) missing.push(section);
  }
  for (const sem of normalizeCalendarSems(calendarSems)) {
    if (!hasCachedCalendar(session, sem)) missing.push(`calendar_${sem}`);
  }
  return missing;
}

function numericValue(value) {
  const parsed = typeof value === "number" ? value : parseFloat(String(value ?? "0"));
  return Number.isFinite(parsed) ? parsed : 0;
}

function getSemType(studentInfo = {}) {
  const semNum = parseInt(studentInfo?.Semester || "1", 10);
  return semNum % 2 === 0 ? "even" : "odd";
}

function buildAttendanceSnapshot(attendance = []) {
  if (!Array.isArray(attendance) || attendance.length === 0) {
    return {
      attendanceAverage: null,
      lowAttendanceCount: 0,
      attendanceCount: 0,
    };
  }

  const percentages = attendance.map((record) => numericValue(record?.attendancePct));
  const average = Math.round(percentages.reduce((sum, value) => sum + value, 0) / percentages.length);
  return {
    attendanceAverage: average,
    lowAttendanceCount: percentages.filter((value) => value < 75).length,
    attendanceCount: attendance.length,
  };
}

function buildAcademiaSummary(email, session) {
  const studentInfo = session.cache?.studentInfo || {};
  const semester = studentInfo.Semester || null;
  const semType = getSemType(studentInfo);
  const calendar = session.cache?.[`calendar_${semType}`] || null;
  const timetable = session.cache?.timetable || null;
  const attendance = session.cache?.attendance || [];

  let schedule = null;
  try {
    if (timetable && calendar && Object.keys(studentInfo).length) {
      schedule = buildScheduleFromData({ timetable, calendar, studentInfo });
    }
  } catch (err) {
    session.meta = {
      ...(session.meta || {}),
      lastSummaryScheduleError: err.message,
    };
  }

  const classes = Array.isArray(schedule?.classes) ? schedule.classes : [];
  const nextClass = classes[0] || null;

  return {
    email,
    studentInfo,
    semester,
    semType,
    calendar,
    timetable,
    schedule,
    todayDayOrder: schedule?.todayDayOrder || schedule?.dayOrder || null,
    classCount: classes.length,
    nextClass: nextClass ? {
      courseCode: nextClass.courseCode || "",
      courseTitle: nextClass.courseTitle || "",
      timing: nextClass.timing || "",
      hourIndex: nextClass.hourIndex ?? null,
      facultyName: nextClass.facultyName || "",
      roomNo: nextClass.roomNo || "",
    } : null,
    ...buildAttendanceSnapshot(attendance),
  };
}

async function runGoPayload(email, payload, tag) {
  const startedAt = Date.now();
  const { parsed, stderr, runtime, exitCode } = await runAcademiaScraper(payload);
  const elapsedMs = Date.now() - startedAt;

  if (stderr?.trim()) {
    log("GO", `${tag} stderr for ${email} (${runtime}): ${stderr.trim()}`);
  }

  if (!parsed) {
    throw new Error("academia scraper returned no JSON payload");
  }

  log(
    "GO",
    `${tag} ${email} runtime=${runtime} exit=${exitCode} success=${parsed.success} classification=${parsed.classification || "unknown"} duration=${elapsedMs}ms`
  );

  return { parsed, runtime, exitCode };
}

async function hydrateGoSession(email, { sections = [], calendarSems = [] } = {}) {
  const requestedSections = normalizeGoSections(sections);
  const requestedCalendarSems = normalizeCalendarSems(calendarSems);

  while (true) {
    const session = sessions[email];
    if (!session) throw Object.assign(new Error("No session"), { expired: true });

    touch(email);

    const missingSections = requestedSections.filter((s) => !hasCachedSection(session, s));
    const missingCalendarSems = requestedCalendarSems.filter((sem) => !hasCachedCalendar(session, sem));

    if (!missingSections.length && !missingCalendarSems.length) {
      return session.cache;
    }

    if (session.goFetchPromise) {
      try {
        await session.goFetchPromise;
      } catch (err) {
        const afterWaitSession = sessions[email];
        if (!afterWaitSession) throw Object.assign(new Error("Session expired. Please login again."), { expired: true });
        const stillMissing = requestedGoDataMissing(afterWaitSession, requestedSections, requestedCalendarSems);
        if (!stillMissing.length) return afterWaitSession.cache;
        throw err;
      }
      continue;
    }

    const fetchSections = missingSections;
    const fetchCalendarSems = missingCalendarSems;
    const fetchPromise = (async () => {
      const activeSession = sessions[email];
      if (!activeSession) throw Object.assign(new Error("No session"), { expired: true });

      const { parsed } = await runGoPayload(email, {
        mode: "fetch",
        email,
        cookies: activeSession.cookies || [],
        sections: fetchSections,
        calendarSems: fetchCalendarSems,
      }, `fetch sections=${fetchSections.join(",") || "-"} sems=${fetchCalendarSems.join(",") || "-"}`);

      const currentSession = sessions[email];
      if (!currentSession) throw Object.assign(new Error("No session"), { expired: true });

      if (Array.isArray(parsed.cookies) && parsed.cookies.length) {
        currentSession.cookies = parsed.cookies;
      }
      mergeGoDataIntoCache(currentSession, parsed.data);
      currentSession.meta = {
        ...(currentSession.meta || {}),
        classification: parsed.classification,
        lastFetchAt: Date.now(),
      };

      if (goResultLooksExpired(parsed)) {
        await destroySession(email, "expired (go session invalid)");
        throw Object.assign(new Error("Session expired. Please login again."), { expired: true });
      }

      const missingAfter = requestedGoDataMissing(currentSession, fetchSections, fetchCalendarSems);
      if (missingAfter.length) {
        throw new Error(parsed.error || `Missing data after Go fetch: ${missingAfter.join(", ")}`);
      }

      return currentSession.cache;
    })();

    session.goFetchPromise = fetchPromise;
    try {
      await fetchPromise;
    } finally {
      if (sessions[email]?.goFetchPromise === fetchPromise) {
        delete sessions[email].goFetchPromise;
      }
    }
  }
}

function warmAcademiaSession(email) {
  setTimeout(async () => {
    try {
      await hydrateGoSession(email, {
        sections: ["studentInfo", "attendance", "marks", "timetable"],
        calendarSems: ["odd", "even"],
      });
      warmTimetableFacultyPhotoUrls(email, "WARM");
      if (sessions[email]?.cache?.timetable) {
        warmFacultyCache(sessions[email].cache.timetable);
      }
      log("WARM", `Session cache warmed for ${email}`);
    } catch (err) {
      log("WARM", `Session warm-up failed for ${email}: ${err.message}`);
    }
  }, 1200);
}

/** Touch session (update lastActive) for a given email. */
function touch(email) {
  if (sessions[email]) sessions[email].lastActive = Date.now();
}

/** Destroy a session and remove it from memory. */
async function destroySession(email, reason = "destroyed") {
  const s = sessions[email];
  if (!s) return;
  log("SESSION", `Session for ${email} ${reason}`);
  delete sessions[email];
}

// ─── Session cleanup (inactivity) ─────────────────────────────────────────────

setInterval(async () => {
  const now = Date.now();
  for (const email of Object.keys(sessions)) {
    if (now - sessions[email].lastActive > SESSION_TTL_MS) {
      await destroySession(email, `expired (inactive > ${SESSION_TTL_MS / 60000}m)`);
    }
  }
}, CLEANUP_INTERVAL_MS);

// ─── Express App ──────────────────────────────────────────────────────────────

const app = express();

// Security headers
app.use(helmet());

// CORS — only allow configured origins
app.use(cors({
  origin: (origin, cb) => {
    if (!origin || ALLOWED_ORIGINS.includes(origin) || /^https?:\/\/(192\.168\.|10\.|172\.(1[6-9]|2[0-9]|3[01])\.|127\.|localhost)/.test(origin)) return cb(null, true);
    return cb(new Error(`CORS: origin not allowed — ${origin}`));
  },
  methods: ["GET", "POST"],
  allowedHeaders: ["Content-Type"],
}));

// Rate limiter — general API (120 req/min per IP)
const apiLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 120,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, error: "Too many requests. Please slow down." },
});
app.use(apiLimiter);

// Login rate limiter — max 5 attempts per 15 min per IP
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, error: "Too many login attempts. Try again in 15 minutes." },
  skipSuccessfulRequests: true,
});

app.use(express.json({ limit: "10kb" }));

// ── Middleware: JSON error wrapper ─────────────────────────────────────────────
app.use((req, res, next) => {
  res.fail = (status, message, extra = {}) =>
    res.status(status).json({ success: false, error: message, ...extra });
  res.ok = (data) =>
    res.json({ success: true, ...data });
  next();
});

// ─── Routes ───────────────────────────────────────────────────────────────────

/**
 * GET /
 * Lightweight root route for health checks.
 */
app.get("/", (_req, res) => {
  res.ok({
    service: "srm-academia-api",
    backend: "go",
    health: "/status",
  });
});

/**
 * GET /status
 * Server health + active session count.
 */
app.get("/status", (_req, res) => {
  const { command, args, source } = getAcademiaScraperRuntime();
  const active = Object.entries(sessions).map(([email, s]) => ({
    email,
    idleSec: Math.floor((Date.now() - s.lastActive) / 1000),
  }));
  res.ok({
    backend: "go",
    scraperCommand: command,
    scraperArgs: args,
    scraperSource: source,
    activeSessions: active.length,
    sessions: active,
  });
});

/**
 * POST /login
 * Body: { email, password }
 * Logs in via Go scraper and stores the resulting session cookies.
 * Passwords are used only for login and NEVER stored.
 */
app.post("/login", loginLimiter, async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password)
    return res.fail(400, "email and password are required");

  if (!email.toLowerCase().endsWith("@srmist.edu.in"))
    return res.fail(400, "Only @srmist.edu.in email addresses are allowed.");

  if (!sessions[email] && Object.keys(sessions).length >= MAX_USERS) {
    log("LOGIN", `Max users reached — rejected ${email}`);
    return res.fail(503, "Max users reached. Try again later.");
  }

  if (sessions[email]) {
    touch(email);
    log("LOGIN", `Reused existing session for ${email}`);
    return res.ok({ message: "Session already active" });
  }

  try {
    log("LOGIN", `Authenticating ${email} via Go scraper`);

    const { parsed } = await runGoPayload(email, {
      mode: "login",
      email,
      password,
    }, "login");

    const cookieCount = Array.isArray(parsed.cookies)
      ? parsed.cookies.length
      : (parsed.cookieNames?.length ?? 0);

    const traversedWarnings = (parsed.redirectSummary || []).some((step) =>
      /sessions-reminder|block-sessions|signin-block/.test(
        `${step.url || ""} ${step.location || ""}`.toLowerCase()
      )
    );
    if (traversedWarnings) {
      log("LOGIN", `Handled SRM warning/interstitial flow for ${email}`);
    }

    if (!(parsed.success && parsed.classification === GO_CLASS_AUTHENTICATED && cookieCount > 0)) {
      const status = parsed.classification === "invalid_credentials" ? 401 : 500;
      log("LOGIN", `Go login failed for ${email}: ${parsed.error || parsed.classification || "unknown error"}`);
      return res.fail(status, parsed.error || "Login failed");
    }

    sessions[email] = {
      cookies: parsed.cookies || [],
      lastActive: Date.now(),
      backend: "go",
      cache: {},
      meta: {
        classification: parsed.classification,
        cookieNames: parsed.cookieNames || [],
        finalUrl: parsed.finalUrl || "",
      },
    };

    log("LOGIN", `Login success for ${email}`);
    warmAcademiaSession(email);
    return res.ok({ message: "Login successful", cookieCount });
  } catch (err) {
    log("LOGIN", `Error for ${email}: ${err.message}`);
    return res.fail(500, err.message);
  }
});

/**
 * POST /logout
 * Body: { email }
 */
app.post("/logout", async (req, res) => {
  const { email } = req.body;
  if (!email) return res.fail(400, "email is required");
  await destroySession(email, "logged out");
  res.ok({ message: "Session destroyed" });
});

/**
 * GET /attendance?email=
 */
app.get("/attendance", async (req, res) => {
  const { email } = req.query;
  if (!email) return res.fail(400, "email query param is required");
  if (!sessions[email]) return res.fail(401, "No active session. Please login first.");

  try {
    const s = sessions[email];
    if (hasCachedSection(s, "attendance")) return res.ok({ attendance: s.cache.attendance });

    await hydrateGoSession(email, { sections: ["attendance"] });
    return res.ok({ attendance: s.cache.attendance });
  } catch (err) {
    if (err.expired) return res.fail(401, "Session expired. Please login again.");
    log("ATTENDANCE", `Error for ${email}: ${err.message}`);
    return res.fail(500, err.message);
  }
});

/**
 * GET /marks?email=
 */
app.get("/marks", async (req, res) => {
  const { email } = req.query;
  if (!email) return res.fail(400, "email query param is required");
  if (!sessions[email]) return res.fail(401, "No active session. Please login first.");

  try {
    const s = sessions[email];
    if (hasCachedSection(s, "marks")) {
      s.cache.marks = normalizeMarksRecords(s.cache.marks);
      return res.ok({ marks: s.cache.marks });
    }

    await hydrateGoSession(email, { sections: ["marks"] });
    s.cache.marks = normalizeMarksRecords(s.cache.marks);
    return res.ok({ marks: s.cache.marks });
  } catch (err) {
    if (err.expired) return res.fail(401, "Session expired. Please login again.");
    log("MARKS", `Error for ${email}: ${err.message}`);
    return res.fail(500, err.message);
  }
});

/**
 * GET /timetable?email=
 * Also returns advisors (Faculty Advisor, Academic Advisor).
 */
app.get("/timetable", async (req, res) => {
  const { email } = req.query;
  if (!email) return res.fail(400, "email query param is required");
  if (!sessions[email]) return res.fail(401, "No active session. Please login first.");

  try {
    const s = sessions[email];
    if (hasCachedSection(s, "timetable")) {
      warmTimetableFacultyPhotoUrls(email, "TIMETABLE");
      return res.ok({ timetable: s.cache.timetable });
    }

    await hydrateGoSession(email, { sections: ["timetable"] });
    warmTimetableFacultyPhotoUrls(email, "TIMETABLE");
    return res.ok({ timetable: s.cache.timetable });
  } catch (err) {
    if (err.expired) return res.fail(401, "Session expired. Please login again.");
    log("TIMETABLE", `Error for ${email}: ${err.message}`);
    return res.fail(500, err.message);
  }
});

/**
 * GET /student?email=
 */
app.get("/student", async (req, res) => {
  const { email } = req.query;
  if (!email) return res.fail(400, "email query param is required");
  if (!sessions[email]) return res.fail(401, "No active session. Please login first.");

  try {
    const s = sessions[email];

    if (hasCachedSection(s, "studentInfo")) {
      if (needsGoStudentPhotoRefresh(s)) {
        try {
          await refreshGoStudentInfo(email);
        } catch (refreshErr) {
          log("PHOTO", `student info refresh failed for ${email}: ${refreshErr.message}`);
        }
      }
      if (needsStudentPhotoFallback(s)) {
        try {
          await ensureUsableStudentPhoto(email);
        } catch (photoErr) {
          log("PHOTO", `student photo fallback failed for ${email}: ${photoErr.message}`);
        }
      }
      if (!s.cache.studentInfo.PhotoUrl && s.cache.photo) {
        s.cache.studentInfo.PhotoUrl = s.cache.photo;
      }
      return res.ok({ studentInfo: s.cache.studentInfo });
    }

    await hydrateGoSession(email, { sections: ["studentInfo"] });
    if (needsStudentPhotoFallback(s)) {
      try {
        await ensureUsableStudentPhoto(email);
      } catch (photoErr) {
        log("PHOTO", `student photo fallback failed for ${email}: ${photoErr.message}`);
      }
    }
    if (s.cache.studentInfo && !s.cache.studentInfo.PhotoUrl && s.cache.photo) {
      s.cache.studentInfo.PhotoUrl = s.cache.photo;
    }
    return res.ok({ studentInfo: s.cache.studentInfo });
  } catch (err) {
    if (err.expired) return res.fail(401, "Session expired. Please login again.");
    log("STUDENT", `Error for ${email}: ${err.message}`);
    return res.fail(500, err.message);
  }
});

/**
 * GET /calendar?email=&sem=odd|even
 */
app.get("/calendar", async (req, res) => {
  const { email, sem = "even" } = req.query;
  if (!email) return res.fail(400, "email query param is required");
  if (!sessions[email]) return res.fail(401, "No active session. Please login first.");
  if (sem !== "odd" && sem !== "even")
    return res.fail(400, 'sem must be "odd" or "even"');

  try {
    const s = sessions[email];
    const cacheKey = `calendar_${sem}`;
    if (hasCachedCalendar(s, sem)) return res.ok({ calendar: s.cache[cacheKey] });

    await hydrateGoSession(email, { calendarSems: [sem] });
    return res.ok({ calendar: s.cache[cacheKey] });
  } catch (err) {
    if (err.expired) return res.fail(401, "Session expired. Please login again.");
    log("CALENDAR", `Error for ${email}: ${err.message}`);
    return res.fail(500, err.message);
  }
});

/**
 * GET /init?email=&sem=odd|even
 * Fast initial load: fetches student + timetable + calendar in parallel.
 * Returns all three at once so the dashboard can render immediately.
 */
app.get("/init", async (req, res) => {
  const { email, sem = "even" } = req.query;
  if (!email) return res.fail(400, "email query param is required");
  if (!sessions[email]) return res.fail(401, "No active session. Please login first.");

  try {
    const s = sessions[email];
    const calKey = `calendar_${sem}`;

    if (s.cache.studentInfo && s.cache.timetable && s.cache[calKey]) {
      warmTimetableFacultyPhotoUrls(email, "INIT");
      if (needsStudentPhotoFallback(s)) {
        try {
          await ensureUsableStudentPhoto(email);
        } catch (photoErr) {
          log("PHOTO", `init photo fallback failed for ${email}: ${photoErr.message}`);
        }
      }
      if (!s.cache.studentInfo.PhotoUrl && s.cache.photo) {
        s.cache.studentInfo.PhotoUrl = s.cache.photo;
      }
      return res.ok({
        studentInfo: s.cache.studentInfo,
        timetable: s.cache.timetable,
        calendar: s.cache[calKey],
      });
    }

    await hydrateGoSession(email, {
      sections: [
        ...(hasCachedSection(s, "studentInfo") ? [] : ["studentInfo"]),
        ...(hasCachedSection(s, "timetable") ? [] : ["timetable"]),
      ],
      calendarSems: hasCachedCalendar(s, sem) ? [] : [sem],
    });
    warmTimetableFacultyPhotoUrls(email, "INIT");

    if (needsStudentPhotoFallback(s)) {
      try {
        await ensureUsableStudentPhoto(email);
      } catch (photoErr) {
        log("PHOTO", `init photo fallback failed for ${email}: ${photoErr.message}`);
      }
    }
    if (s.cache.studentInfo && !s.cache.studentInfo.PhotoUrl && s.cache.photo) {
      s.cache.studentInfo.PhotoUrl = s.cache.photo;
    }

    const payload = {
      studentInfo: s.cache.studentInfo,
      timetable: s.cache.timetable,
      calendar: s.cache[calKey],
    };
    setImmediate(() => warmFacultyCache(s.cache.timetable));
    return res.ok(payload);
  } catch (err) {
    if (err.expired) return res.fail(401, "Session expired. Please login again.");
    log("INIT", `Error for ${email}: ${err.message}`);
    return res.fail(500, err.message);
  }
});

/**
 * GET /summary?email=
 * Dashboard-ready snapshot in one request.
 */
app.get("/summary", async (req, res) => {
  const { email } = req.query;
  if (!email) return res.fail(400, "email query param is required");
  if (!sessions[email]) return res.fail(401, "No active session. Please login first.");

  try {
    const s = sessions[email];
    await hydrateGoSession(email, {
      sections: [
        ...(hasCachedSection(s, "studentInfo") ? [] : ["studentInfo"]),
        ...(hasCachedSection(s, "attendance") ? [] : ["attendance"]),
        ...(hasCachedSection(s, "timetable") ? [] : ["timetable"]),
      ],
      calendarSems: ["odd", "even"].filter((sem) => !hasCachedCalendar(s, sem)),
    });

    warmTimetableFacultyPhotoUrls(email, "SUMMARY");
    const activeSession = sessions[email];
    if (!activeSession) throw Object.assign(new Error("Session expired. Please login again."), { expired: true });
    const summary = buildAcademiaSummary(email, activeSession);
    return res.ok(summary);
  } catch (err) {
    if (err.expired) return res.fail(401, "Session expired. Please login again.");
    log("SUMMARY", `Error for ${email}: ${err.message}`);
    return res.fail(500, err.message);
  }
});

/**
 * GET /all?email=
 * Fetches student info, attendance, marks and timetable in one call.
 */
app.get("/all", async (req, res) => {
  const { email } = req.query;
  if (!email) return res.fail(400, "email query param is required");
  if (!sessions[email]) return res.fail(401, "No active session. Please login first.");

  try {
    const s = sessions[email];
    await hydrateGoSession(email, {
      sections: [
        ...(hasCachedSection(s, "studentInfo") ? [] : ["studentInfo"]),
        ...(hasCachedSection(s, "attendance") ? [] : ["attendance"]),
        ...(hasCachedSection(s, "marks") ? [] : ["marks"]),
        ...(hasCachedSection(s, "timetable") ? [] : ["timetable"]),
      ],
    });
    warmTimetableFacultyPhotoUrls(email, "ALL");

    if (needsStudentPhotoFallback(s)) {
      try {
        await ensureUsableStudentPhoto(email);
      } catch (photoErr) {
        log("PHOTO", `all photo fallback failed for ${email}: ${photoErr.message}`);
      }
    }

    return res.ok({
      studentInfo: s.cache.studentInfo,
      attendance: s.cache.attendance,
      marks: normalizeMarksRecords(s.cache.marks),
      timetable: s.cache.timetable,
    });
  } catch (err) {
    if (err.expired) return res.fail(401, "Session expired. Please login again.");
    log("ALL", `Error for ${email}: ${err.message}`);
    return res.fail(500, err.message);
  }
});

/**
 * GET /schedule?email=[&dayOrder=N]
 * Returns today's classes (or a specific day order if dayOrder=N is supplied).
 */
app.get("/schedule", async (req, res) => {
  const { email, dayOrder } = req.query;
  if (!email) return res.fail(400, "email query param is required");
  if (!sessions[email]) return res.fail(401, "No active session. Please login first.");
  const override = dayOrder && /^[1-9]$/.test(dayOrder) ? dayOrder : null;

  try {
    const s = sessions[email];

    if (override) {
      await hydrateGoSession(email, {
        sections: hasCachedSection(s, "timetable") ? [] : ["timetable"],
      });
      warmTimetableFacultyPhotoUrls(email, "SCHEDULE");
      const schedule = buildScheduleFromData({
        timetable: s.cache.timetable,
        overrideDayOrder: override,
      });
      return res.ok({ schedule });
    }

    await hydrateGoSession(email, {
      sections: [
        ...(hasCachedSection(s, "studentInfo") ? [] : ["studentInfo"]),
        ...(hasCachedSection(s, "timetable") ? [] : ["timetable"]),
      ],
    });
    warmTimetableFacultyPhotoUrls(email, "SCHEDULE");

    const semNum = parseInt(s.cache.studentInfo?.Semester || "1", 10);
    const semType = semNum % 2 === 0 ? "even" : "odd";
    await hydrateGoSession(email, {
      calendarSems: hasCachedCalendar(s, semType) ? [] : [semType],
    });

    const schedule = buildScheduleFromData({
      studentInfo: s.cache.studentInfo,
      timetable: s.cache.timetable,
      calendar: s.cache[`calendar_${semType}`],
    });
    return res.ok({ schedule });
  } catch (err) {
    if (err.expired) return res.fail(401, "Session expired. Please login again.");
    log("SCHEDULE", `Error for ${email}: ${err.message}`);
    return res.fail(500, err.message);
  }
});

/**
 * GET /faculty-photo?url=https://www.srmist.edu.in/wp-content/...
 * Proxies faculty images with the correct Referer to bypass hotlink protection.
 */
app.get("/faculty-photo", async (req, res) => {
  const { url } = req.query;
  if (!url || !url.startsWith("https://www.srmist.edu.in/"))
    return res.fail(400, "Invalid or missing url param");

  try {
    const imgRes = await fetch(url, {
      headers: {
        "Referer": "https://www.srmist.edu.in/",
        "User-Agent": "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36",
        "Accept": "image/avif,image/webp,image/apng,image/*,*/*;q=0.8",
      },
    });
    if (!imgRes.ok) return res.fail(imgRes.status, "Image fetch failed");

    const contentType = imgRes.headers.get("content-type") || "image/jpeg";
    res.setHeader("Content-Type", contentType);
    res.setHeader("Cache-Control", "public, max-age=86400");
    res.setHeader("Cross-Origin-Resource-Policy", "cross-origin");
    const buf = await imgRes.arrayBuffer();
    res.send(Buffer.from(buf));
  } catch (err) {
    log("PHOTO", `Proxy error for ${url}: ${err.message}`);
    res.fail(502, "Could not fetch image");
  }
});

/**
 * GET /student-photo?email=
 * Proxies the student profile photo from the Zoho previewengine.
 * The photo is on previewengine-accl.zoho.com (different from academia.srmist.edu.in)
 * so the browser cannot send session cookies to it directly. This endpoint fetches
 * it server-side using the stored session cookies and streams bytes back.
 */
app.get("/student-photo", async (req, res) => {
  const { email } = req.query;
  if (!email) return res.fail(400, "email query param is required");

  const s = sessions[email];
  if (!s) return res.fail(401, "No active session. Please login first.");

  if (needsGoStudentPhotoRefresh(s)) {
    try {
      await refreshGoStudentInfo(email);
    } catch (refreshErr) {
      log("PHOTO", `student-photo refresh failed for ${email}: ${refreshErr.message}`);
    }
  }

  if (needsStudentPhotoFallback(s)) {
    try {
      await ensureUsableStudentPhoto(email);
    } catch (photoErr) {
      log("PHOTO", `student-photo fallback failed for ${email}: ${photoErr.message}`);
    }
  }

  const photoUrl =
    s.cache?.studentInfo?.PhotoUrl ||
    s.cache?.photo ||
    null;

  if (!photoUrl) {
    return res.fail(404, "No student photo available. Try re-fetching your profile.");
  }

  // If already a data URI, decode and send directly
  if (photoUrl.startsWith("data:")) {
    const commaIdx = photoUrl.indexOf(",");
    const mimeMatch = photoUrl.match(/^data:([^;]+);base64,/);
    const contentType = mimeMatch ? mimeMatch[1] : "image/jpeg";
    const b64 = commaIdx >= 0 ? photoUrl.slice(commaIdx + 1) : "";
    res.setHeader("Content-Type", contentType);
    res.setHeader("Cache-Control", "public, max-age=3600");
    return res.send(Buffer.from(b64, "base64"));
  }

  if (!isStudentPhotoProxyUrl(photoUrl)) {
    return res.fail(400, "Photo URL is not a supported student photo URL.");
  }

  try {
    touch(email);

    let cookieHeader = "";
    if (Array.isArray(s.cookies) && s.cookies.length > 0) {
      cookieHeader = s.cookies.map((c) => `${c.name}=${c.value}`).join("; ");
    }

    const imgRes = await fetch(photoUrl, {
      headers: {
        "Cookie": cookieHeader,
        "Referer": "https://academia.srmist.edu.in/",
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36",
        "Accept": "image/avif,image/webp,image/apng,image/*,*/*;q=0.8",
      },
    });

    if (!imgRes.ok) {
      log("PHOTO", `student-photo proxy got ${imgRes.status} for ${email}`);
      return res.fail(imgRes.status, `Photo request returned ${imgRes.status}`);
    }

    const contentType = imgRes.headers.get("content-type") || "image/jpeg";
    if (!contentType.startsWith("image/")) {
      log("PHOTO", `student-photo non-image response "${contentType}" for ${email}`);
      return res.fail(502, "Photo endpoint did not return an image. Session may be expired.");
    }

    res.setHeader("Content-Type", contentType);
    res.setHeader("Cache-Control", "public, max-age=3600");
    res.setHeader("Cross-Origin-Resource-Policy", "cross-origin");
    const buf = await imgRes.arrayBuffer();
    log("PHOTO", `student-photo proxy OK for ${email} (${buf.byteLength} bytes)`);
    return res.send(Buffer.from(buf));
  } catch (err) {
    log("PHOTO", `student-photo proxy error for ${email}: ${err.message}`);
    return res.fail(502, "Could not fetch student photo.");
  }
});

// ─── Faculty proxy ─────────────────────────────────────────────────────────────



function nameToSlug(rawName) {
  return rawName
    .replace(/\(.*?\)/g, "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

const facultyCache = new Map();
const FACULTY_CACHE_TTL = 60 * 60 * 1000; // 1 hour
const SCRAPER_URL = process.env.SCRAPER_URL || "http://localhost:8080";
const SCRAPER_KEY = process.env.SCRAPER_KEY || "";
const scraperHeaders = () => (SCRAPER_KEY ? { "X-Scraper-Key": SCRAPER_KEY } : {});

function facultyNameCacheKey(rawName) {
  const cleanName = String(rawName || "").replace(/\(.*?\)/g, "").trim();
  if (!cleanName) return "";
  return cleanName.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
}

function getFreshFacultyCacheEntry(rawName) {
  const cacheKey = facultyNameCacheKey(rawName);
  if (!cacheKey) return null;
  const cached = facultyCache.get(cacheKey);
  if (!cached) return null;
  if (Date.now() - cached.fetchedAt >= FACULTY_CACHE_TTL) return null;
  return cached;
}

async function fetchFacultyProfileForTimetable(rawName, email) {
  const params = new URLSearchParams({ name: rawName });
  if (email) params.set("email", email);

  const res = await fetch(`http://127.0.0.1:${PORT}/faculty?${params.toString()}`, {
    headers: { "User-Agent": "faculty-photo-attach/1.0" },
  });
  if (!res.ok) return null;

  const payload = await res.json().catch(() => null);
  if (!payload?.success || !payload.faculty) return null;
  return payload.faculty;
}

async function ensureTimetableFacultyPhotoUrls(email) {
  const session = sessions[email];
  if (!session?.cache?.timetable?.courses?.length) return session?.cache?.timetable || null;

  const alreadyEnriched = session.cache.timetable.courses.every((course) =>
    !course.facultyName || hasOwn(course, "facultyPhotoUrl")
  );
  if (alreadyEnriched) return session.cache.timetable;

  if (session.timetableFacultyPhotoPromise) {
    return session.timetableFacultyPhotoPromise;
  }

  session.timetableFacultyPhotoPromise = (async () => {
    const timetable = session.cache.timetable;
    const uniqueNames = [...new Set(timetable.courses.map((course) => course.facultyName).filter(Boolean))];

    const entries = await Promise.all(uniqueNames.map(async (name) => {
      const cached = getFreshFacultyCacheEntry(name);
      if (cached) {
        return [name, cached.data?.photo_url || ""];
      }

      try {
        const faculty = await fetchFacultyProfileForTimetable(name, email);
        return [name, faculty?.photo_url || ""];
      } catch {
        return [name, ""];
      }
    }));

    const photoByName = Object.fromEntries(entries);
    session.cache.timetable = {
      ...timetable,
      courses: timetable.courses.map((course) => ({
        ...course,
        facultyPhotoUrl: course.facultyName ? (photoByName[course.facultyName] || "") : "",
      })),
    };

    return session.cache.timetable;
  })();

  try {
    return await session.timetableFacultyPhotoPromise;
  } finally {
    delete session.timetableFacultyPhotoPromise;
  }
}

function warmTimetableFacultyPhotoUrls(email, tag = "FACULTY") {
  setImmediate(() => {
    ensureTimetableFacultyPhotoUrls(email).catch((err) => {
      log(tag, `Background timetable photo enrichment failed for ${email}: ${err.message}`);
    });
  });
}

// Warms the faculty cache in the background for all teachers in a timetable.
// Calls our own /faculty endpoint (which has full slug fallback logic) instead
// of the Go scraper search directly — so ALL teachers get pre-cached, not just
// those found via WordPress search.
function warmFacultyCache(timetable) {
  if (!timetable?.courses?.length) return;
  const names = [...new Set(timetable.courses.map(c => c.facultyName).filter(Boolean))];
  if (!names.length) return;
  log("FACULTY", `Warming cache for ${names.length} teacher(s) in background`);

  names.forEach((rawName, i) => {
    setTimeout(async () => {
      // Check if already cached — skip if so
      const cleanName = rawName.replace(/\(.*?\)/g, "").trim();
      const cacheKey = facultyNameCacheKey(rawName);
      if (facultyCache.has(cacheKey)) return;

      try {
        // Call our own /faculty route — it has all the slug fallback logic built in
        const r = await fetch(
          `http://localhost:${PORT}/faculty?name=${encodeURIComponent(rawName)}`,
          { headers: { "User-Agent": "warm-up/1.0" } }
        );
        if (r.ok) {
          const d = await r.json();
          if (d.success && d.faculty) {
            log("FACULTY", `✓ Warm: ${cleanName} → photo=${d.faculty.photo_url ? "yes" : "none"}`);
          }
          // /faculty already populated facultyCache internally — nothing extra needed
        }
      } catch { /* best-effort — ignore errors */ }
    }, i * 200); // 200ms stagger to avoid thundering herd
  });
}

/**
 * GET /faculty?name=Dr.S.Aruna%20(101257)&email=user@srmist.edu.in
 * Proxies to the Go faculty scraper at localhost:8080.
 * No session required — SRM faculty pages are public.
 */
app.get("/faculty", async (req, res) => {
  let rawName = req.query.name;
  const email = req.query.email;
  if (!rawName) return res.fail(400, "name query param is required");

  rawName = rawName.replace(/<[^>]*>/g, "").trim();
  if (rawName.length > 200) return res.fail(400, "name param too long");
  if (!rawName) return res.fail(400, "name param is invalid");

  const cleanName = rawName.replace(/\(.*?\)/g, "").trim();
  // Strip title prefix (Dr./Prof./etc.)
  const noTitle = cleanName.replace(/^(prof|mrs|ms|mr|dr)\.?\s*/i, "").trim();
  // Remove single-letter dotted initials like "H." at the START only
  // "H.Karthikeyan" → "Karthikeyan", but "Monica Bhavani M" → "Monica Bhavani M" (unchanged)
  const hasLeadingInitial = /^[A-Z]\./.test(noTitle);
  const searchName = noTitle
    .replace(/^([A-Z]\.)+\s*/g, "")  // strip leading "H." or "H.K." etc.
    .replace(/\./g, " ")              // remaining dots → spaces
    .trim();
  // Build search terms: for "H.Karthikeyan" → ["Karthikeyan", "Karthikeyan"] (same, deduplicated)
  //                      for "Monica Bhavani M" → ["Monica Bhavani M", "Bhavani"] (full name first)
  const longestWord = searchName.split(/\s+/).sort((a, b) => b.length - a.length)[0] || searchName;
  // Always try full searchName first; only use longestWord as extra fallback when there are 2+ words
  const searchTerms = (() => {
    const terms = [searchName];
    if (hasLeadingInitial && longestWord !== searchName) terms.push(longestWord); // "H.Karthikeyan" → also try "Karthikeyan"
    if (!hasLeadingInitial && searchName.includes(" ")) terms.push(longestWord);  // "Monica Bhavani M" → also try "Bhavani"
    return [...new Set(terms)];
  })();

  // Use cleanName for slug (employee ID already stripped) so slug candidates are correct
  const naiveSlug = nameToSlug(cleanName);
  if (!naiveSlug) return res.fail(400, "Could not derive a slug from the given name");

  const cacheKey = facultyNameCacheKey(cleanName);

  const cached = facultyCache.get(cacheKey);
  if (cached && Date.now() - cached.fetchedAt < FACULTY_CACHE_TTL) {
    if (cached.data === null) return res.fail(404, "Faculty not found");
    return res.ok({ faculty: cached.data });
  }

  // Deduplicate concurrent requests for the same teacher
  if (!global.facultyInFlight) global.facultyInFlight = new Map();
  if (global.facultyInFlight.has(cacheKey)) {
    try {
      const data = await global.facultyInFlight.get(cacheKey);
      if (data === null) return res.fail(404, "Faculty not found");
      return res.ok({ faculty: data });
    } catch {
      // If the in-flight promise rejected, we'll try again below (shouldn't happen)
    }
  }

  // Define the work as a promise so we can cache it in-flight
  const fetchFacultyWork = async () => {
    let selectedProfile = null;

    try {
      let profiles = [];
      for (const term of searchTerms) {
        const searchRes = await fetch(`${SCRAPER_URL}/api/search-profiles?name=${encodeURIComponent(term)}`, { headers: scraperHeaders() });
        if (searchRes.ok) {
          const data = await searchRes.json();
          profiles = data.profiles || [];
          log("FACULTY", `Search "${term}" → ${profiles.length} result(s) for "${cleanName}"`);
          if (profiles.length > 0) break;
        }
      }

      if (profiles.length === 1) {
        selectedProfile = profiles[0];
      } else if (profiles.length > 1) {
        const normalizeName = (n) =>
          (n || "").toLowerCase()
            .replace(/^(prof|mrs|ms|mr|dr)\.?\s*/i, "")
            .replace(/[^a-z\s]/g, "")
            .split(/\s+/).filter(Boolean).join(" ");
        const targetNorm = normalizeName(cleanName);

        let candidates = profiles.filter((p) => normalizeName(p.name) === targetNorm);
        if (candidates.length === 0) candidates = profiles;

        if (candidates.length === 1) {
          selectedProfile = candidates[0];
        } else {
          let studentContext = "";
          if (email && sessions[email]?.cache?.studentInfo) {
            const si = sessions[email].cache.studentInfo;
            studentContext = [si.Department, si.Program, si.Section].filter(Boolean).join(" ");
          }

          if (studentContext) {
            const ctxWords = studentContext.toLowerCase().split(/\W+/).filter((w) => w.length > 3);
            let bestScore = 0;
            let bestMatch = null;
            for (const p of candidates) {
              const combinedCtx = [p.department, p.campus].filter(Boolean).join(" ");
              const deptWords = combinedCtx.toLowerCase().split(/\W+/).filter((w) => w.length > 3);
              const score = deptWords.filter((w) => ctxWords.some((cw) => cw.includes(w) || w.includes(cw))).length;
              if (score > bestScore) { bestScore = score; bestMatch = p; }
            }
            if (bestMatch && bestScore > 0) selectedProfile = bestMatch;
          }

          if (!selectedProfile) selectedProfile = candidates[0];
        }
      }
    } catch (searchErr) {
      log("FACULTY", `Search failed for "${cleanName}": ${searchErr.message} — falling back to slug`);
    }

    if (!selectedProfile) {
      // SRM slugs vary wildly — try multiple permutations before giving up
      const TITLE_PREFIXES = ["dr", "mr", "mrs", "prof"];
      const parts = noTitle.split(/[\s.]+/).filter(Boolean);
      const trailingInitial = parts.length > 1 && parts[parts.length - 1].length === 1
        ? parts[parts.length - 1].toLowerCase() : null;
      const bodyParts = (trailingInitial ? parts.slice(0, -1) : parts).map(p => p.toLowerCase());
      const bodySlug = bodyParts.join("-");

      const slugCandidates = [...new Set([
        // 1. Naive slug (e.g. kaviyaraj-r, dr-monica-bhavani-m)
        naiveSlug,
        // 2. All title prefixes + body + trailing initial  → mr-kaviyaraj-r ✓
        ...trailingInitial ? TITLE_PREFIXES.map(t => `${t}-${bodySlug}-${trailingInitial}`) : [],
        // 3. All title prefixes + trailing initial + body  → dr-m-monica-bhavani ✓
        ...trailingInitial ? TITLE_PREFIXES.map(t => `${t}-${trailingInitial}-${bodySlug}`) : [],
        // 4. No prefix + body + trailing initial           → kaviyaraj-r, monica-bhavani-m
        trailingInitial ? `${bodySlug}-${trailingInitial}` : null,
        // 5. No prefix + initial + body                    → r-kaviyaraj
        trailingInitial ? `${trailingInitial}-${bodySlug}` : null,
        // 6. All title prefixes + body (no initial)        → dr-kaviyaraj, mr-kaviyaraj
        ...TITLE_PREFIXES.map(t => `${t}-${bodySlug}`),
        // 7. Body only (no title, no initial)              → kaviyaraj, monica-bhavani
        bodySlug,
        // 8. rawName dots→spaces variation
        nameToSlug(rawName.replace(/\./g, " ").trim()),
      ])].filter(Boolean);

      log("FACULTY", `Trying ${slugCandidates.length} slug(s) for "${cleanName}": ${slugCandidates.join(", ")}`);

      for (const slug of slugCandidates) {
        try {
          const goRes = await fetch(`${SCRAPER_URL}/api/faculty/${slug}`, { headers: scraperHeaders() });
          if (goRes.ok) {
            selectedProfile = await goRes.json();
            log("FACULTY", `Found "${cleanName}" via slug: ${slug}`);
            break;
          }
        } catch (_) { /* try next */ }
      }

      if (!selectedProfile) {
        // Return null so the outer promise wrapper can handle the 404 for all waiters
        return null;
      }
    }

    if (selectedProfile) {
      const queryTokens = searchName.toLowerCase().split(/\s+/).filter((w) => w.length > 1);
      const profileName = (selectedProfile.name || "").toLowerCase()
        .replace(/^(prof|mrs|ms|mr|dr)\.?\s*/i, "");
      const profileTokens = profileName.split(/[^a-z]+/).filter((w) => w.length > 1);
      const matchCount = queryTokens.filter((t) => profileTokens.some((pt) => pt.includes(t) || t.includes(pt))).length;
      const minRequired = Math.min(2, queryTokens.length);

      if (matchCount < minRequired) {
        // Return null so the in-flight promise resolves to null
        return null;
      }
    }

    return selectedProfile;
  };

  try {
    // Start the work and store the promise in the global map
    const workPromise = fetchFacultyWork();
    global.facultyInFlight.set(cacheKey, workPromise);
    
    // Wait for the result
    const selectedProfile = await workPromise;
    
    // Cleanup the in-flight map
    global.facultyInFlight.delete(cacheKey);

    if (!selectedProfile) {
      facultyCache.set(cacheKey, { data: null, fetchedAt: Date.now() });
      return res.fail(404, "Faculty not found");
    }

    const cacheEntry = { data: selectedProfile, fetchedAt: Date.now() };
    facultyCache.set(cacheKey, cacheEntry);
    facultyCache.set(naiveSlug, cacheEntry);

    return res.ok({ faculty: selectedProfile });
  } catch (err) {
    global.facultyInFlight.delete(cacheKey); // cleanup on error
    log("FACULTY", `Error fetching "${cleanName}": ${err.message}`);
    return res.fail(502, "Faculty scraper unavailable. Make sure the Go server is running on port 8080.");
  }
});

// ─── Startup ──────────────────────────────────────────────────────────────────

function start() {
  const runtime = getAcademiaScraperRuntime();
  log("SERVER", `Go scraper: ${runtime.command}${runtime.args?.length ? ` ${runtime.args.join(" ")}` : ""} (source: ${runtime.source})`);

  app.listen(PORT, "0.0.0.0", () => {
    log("SERVER", `API server running on http://0.0.0.0:${PORT}`);
    log("SERVER", "Endpoints:");
    log("SERVER", "  POST /login              { email, password }");
    log("SERVER", "  GET  /init               ?email=&sem=odd|even");
    log("SERVER", "  GET  /attendance         ?email=");
    log("SERVER", "  GET  /marks              ?email=");
    log("SERVER", "  GET  /timetable          ?email=");
    log("SERVER", "  GET  /student            ?email=");
    log("SERVER", "  GET  /calendar           ?email=&sem=odd|even");
    log("SERVER", "  GET  /summary            ?email=");
    log("SERVER", "  GET  /schedule           ?email=");
    log("SERVER", "  GET  /all                ?email=");
    log("SERVER", "  GET  /student-photo      ?email=");
    log("SERVER", "  GET  /faculty-photo      ?url=");
    log("SERVER", "  GET  /faculty            ?name=&email=");
    log("SERVER", "  POST /logout             { email }");
    log("SERVER", "  GET  /status");
  });

  for (const sig of ["SIGINT", "SIGTERM"]) {
    process.on(sig, () => {
      log("SERVER", `${sig} received — shutting down...`);
      for (const email of Object.keys(sessions)) {
        destroySession(email, "server shutdown");
      }
      process.exit(0);
    });
  }
}

start();
