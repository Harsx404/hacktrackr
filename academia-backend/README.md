# SRM Academia Dashboard

A full-stack tool that logs into [SRM Academia](https://academia.srmist.edu.in) and presents attendance, marks, timetable, schedule, calendar, and faculty profiles in a clean Material Design 3 dashboard.

> **Why Playwright?** SRM's portal is protected by Zoho WAF which blocks requests based on TLS fingerprints. Playwright drives a real Chromium browser, bypassing the WAF entirely.

---

## Features

- **Schedule** — Today's classes with day-order lookup from the academic calendar
- **Attendance** — Per-subject attendance with a built-in Margin Predictor (plan leaves or catch-up classes)
- **Marks** — Internal assessment marks
- **Timetable** — Full weekly timetable with registered courses and advisors
- **Calendar** — Academic calendar (Even + Odd semester)
- **Faculty Profiles** — Click any faculty name to view their photo, designation, department, email, research interests, and courses in a modal — powered by a Go scraper

---

## Project Structure

```
├── server.js                  # Express API — session management, scraping proxy, faculty proxy
├── fetch_data.js              # Playwright page scrapers
├── login_playwright.js        # Playwright login automation
├── config.js                  # Base URLs
├── start.ps1                  # One-command launcher (all 3 servers)
├── faculty-scraper/           # Go service — scrapes SRM faculty profile pages
│   ├── main.go
│   ├── go.mod
│   ├── api/handlers.go
│   ├── models/faculty.go
│   └── scraper/scraper.go
└── srm-frontend/              # React 19 + Vite 7 + Tailwind v4
    └── src/
        ├── pages/             # LoginPage, DashboardPage
        └── components/        # AttendanceCard, MarksCard, TimetableCard,
                               # ScheduleCard, CalendarCard, FacultyModal, Spinner
```

---

## Prerequisites

- **Node.js** 20+
- **Go** 1.21+ — for the faculty scraper ([download](https://go.dev/dl/))
- **Chromium** — installed automatically by Playwright

---

## Setup

```bash
# 1. Clone
git clone https://github.com/Harsx404/srm-academia-dashboard.git
cd srm-academia-dashboard

# 2. Backend dependencies
npm install
npx playwright install chromium

# 3. Frontend dependencies
cd srm-frontend && npm install && cd ..

# 4. Faculty scraper dependencies
cd faculty-scraper && go mod download && cd ..
```

---

## Running

### One command (Windows)

```powershell
.\start.ps1
```

Opens 3 separate windows:

| Window | Service | Port |
|--------|---------|------|
| Go faculty scraper | `go run ./faculty-scraper` | 8080 |
| Node API server | `node server.js` | 3000 |
| Vite dev server | `npx vite` | 5173 |

Then open **http://localhost:5173**.

### Stop all servers

```powershell
Stop-Process -Name "node","go" -Force -ErrorAction SilentlyContinue
```

---

## Deploying

### Frontend (Vercel)

Set this environment variable in Vercel:

```bash
VITE_API_URL=https://your-render-service.onrender.com
```

The frontend now uses the same base URL for both API calls and proxied faculty images, so a single `VITE_API_URL` is enough in production.

### Backend (Render)

Deploy the repo root as a **Docker Web Service** using the root `Dockerfile`.

This Docker image now starts:

- the Node/Playwright API on Render's public port
- the Go faculty scraper internally on `localhost:8080`

Recommended Render settings:

- **Health check path:** `/status`
- **Environment variable:** `ALLOWED_ORIGINS=https://your-frontend.vercel.app`

If you use multiple frontend domains, set them as a comma-separated list:

```bash
ALLOWED_ORIGINS=https://your-frontend.vercel.app,https://your-custom-domain.com
```

You do **not** need a second hosted service for `faculty-scraper` when using this Dockerfile.

---

## API Endpoints

### Session endpoints (require login)

| Method | Path | Description |
|--------|------|-------------|
| POST | `/login` | Authenticate and create a session |
| POST | `/logout` | Destroy the session |
| GET | `/init?email=&sem=` | Student info + timetable + calendar in parallel (fast load) |
| GET | `/attendance?email=` | Attendance records |
| GET | `/marks?email=` | Internal assessment marks |
| GET | `/timetable?email=` | Weekly timetable + advisors |
| GET | `/student?email=` | Student name, reg number, photo, etc. |
| GET | `/calendar?email=&sem=` | Academic calendar (`sem=even` or `sem=odd`) |
| GET | `/schedule?email=` | Today's classes (computed from timetable + calendar) |
| GET | `/all?email=` | All data in one request |
| GET | `/status` | Server health + active session count |

### Public endpoints (no login required)

| Method | Path | Description |
|--------|------|-------------|
| GET | `/faculty?name=` | Faculty profile (proxied from Go scraper, 1hr cache) |
| GET | `/faculty-photo?url=` | Proxy SRM faculty images (bypasses hotlink protection) |

**Login body:**
```json
{ "email": "your@srmist.edu.in", "password": "yourpassword" }
```

Sessions expire after **30 minutes** of inactivity. Maximum **8 concurrent users**.

---

## Faculty Scraper

The Go service at `faculty-scraper/` scrapes public SRM faculty profile pages.

```
GET http://localhost:8080/api/faculty/{slug}
GET http://localhost:8080/api/slug?name=Dr. S. Aruna
```

**Response fields:** `name`, `photo_url`, `designation`, `department`, `email`, `campus`, `experience`, `research_interest`, `courses`, `education`, `publications`, `awards`, `workshops`, `work_experience`, `memberships`, `responsibilities`, `profile_url`

**How name → slug works:**
- `"Dr.S.Aruna (101257)"` → strip employee ID → lowercase → replace non-alphanumeric → `"dr-s-aruna"`

---

## Architecture

```
Browser (React)
    │ click faculty name
    ▼
FacultyModal → GET /api/faculty?name=...
    ▼
Express /faculty  (nameToSlug + 1hr cache)
    ↓
Go scraper :8080
    ↓
srmist.edu.in/faculty/{slug}/  (public, no auth)
```

Faculty images are served via `/faculty-photo?url=` which proxies from Node with `Referer: https://www.srmist.edu.in/`, bypassing SRM's hotlink protection.

---

## Tech Stack

| Layer | Technology |
|-------|------------|
| Login + Scraping | Playwright 1.44 + Chromium |
| API | Express 5 + Node.js ESM |
| Faculty Scraper | Go 1.21 + Colly v2 |
| Frontend | React 19 + Vite 7 + Tailwind v4 |
| Routing | react-router-dom |
| Design | Material Design 3 dark theme |
