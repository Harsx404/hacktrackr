# HackTrackr: Architecture & Development Phases

## 📌 Project Overview
HackTrackr is a mobile application built with React Native and Expo. It leverages a local Supabase instance for Authentication and PostgreSQL database management with strict Row-Level Security (RLS). The app's unique value proposition is its AI-powered text parsing—utilizing Google's Gemini 1.5 Flash—to extract hackathon details, deadlines, and deliverables directly from unstructured text blobs (such as MLH or Devfolio web copy).

---

## 🏗️ System Architecture

### 1. Frontend (Mobile App)
* **Framework:** React Native + Expo (SDK 55)
* **Routing:** Expo Router (File-based navigation: `app/(tabs)`)
* **Styling:** Custom StyleSheet utilizing a unified dark-mode design system (`src/theme.ts`), focusing on high contrast, stark typography, and accessibility.
* **Icons & Utils:** `lucide-react-native` for scalable SVGs; `date-fns` for timeline formatting.

### 2. Backend & Database (BaaS)
* **Provider:** Supabase (Local/Docker)
* **Database:** PostgreSQL
* **Security:** Row Level Security (RLS) is fully enabled. No database reads or writes can occur without a valid authenticated user token matching the `user_id` column.
* **Typing:** Strongly typed Database schemas generated dynamically via Supabase CLI (`src/types/supabase-types.ts`).

### 3. Artificial Intelligence Engine
* **Provider:** Google Generative AI (Gemini 1.5)
* **Implementation:** Specialized utility (`src/services/aiService.ts`) applying strict `responseSchema` enforcements.
* **Flow:** Unstructured Text -> Gemini -> Strongly Typed JSON (`ParsedHackathonData`) -> UI Preview -> Supabase relational inserts.

---

## 🗄️ Database Schema Representation

The PostgreSQL instance requires relational structures bound to `auth.users`:

* **`hackathons`**: Core entity (name, deadline, team_size, status).
* **`tasks`**: Granular breakdown of work needed for the hackathon (title, status, due_date) mapping to `hackathon_id`.
* **`checklist_items`**: Deliverables required for submission (video demo, github repo) mapping to `hackathon_id`.
* **`milestones`**: High-level timeline dates mapping to `hackathon_id`.

---

## 🚀 Development Phases

### ✅ Phase 1: Project Initialization & Foundation
* Scaffold Expo Router template.
* Establish standard styling theme based on the UI design inspiration.
* Stand up local Supabase instance via Docker.
* Create and run initial Postgres migrations (`init_schema.sql`).
* Generate TypeScript types directly from the local database.

### ✅ Phase 2: AI Parsing Engine
* Integrate `@google/generative-ai`.
* Build prompt instructions forcing Gemini to output structured JSON matching the database schema properties.
* Validate parsing speed and accuracy.

### ✅ Phase 3: Core UI Implementation
* **Dashboard (`app/(tabs)/index.tsx`)**: Mock horizontal hackathon cards and visual styling.
* **Add Hackathon Screen (`app/(tabs)/two.tsx`)**: Build the AI prompt text-area and the result preview card.
* Wire up Expo Router to navigate smoothly between views.

### ✅ Phase 4: Database Insertion & Logic Linking
* Hook the "Confirm & Add" button in the UI to the `supabase-js` client.
* Build out the linked insertion loop establishing the primary `hackathon` record, retrieving the new ID, and cascading insertions into `tasks` and `checklist_items`.

### 🔄 Phase 5: Authentication (Currently Pending)
* Since RLS is enabled, anonymous writes throw authorization errors.
* **Next Steps:** Build out a Login / Sign-up overlay or dedicated route (`app/auth.tsx`).
* Connect `supabase.auth.signInWithPassword` and `signUp`.
* Persist session state so `supabase.auth.getUser()` securely resolves.

### ⏳ Phase 6: Dynamic Dashboard Hydration
* Remove mock data from `app/(tabs)/index.tsx`.
* Implement a `useEffect` data fetch relying on `supabase.from('hackathons').select('*')`.
* Real-time subscription (optional) to update cards when db changes.

### ⏳ Phase 7: Hackathon Detail & Management Views
* Create a dynamic route (`app/hackathon/[id].tsx`) to view an individual hackathon.
* Add toggles to complete `tasks` and `checklist_items` (firing Supabase `UPDATE` functions).
* Add ability to manually add or edit timelines.

### ⏳ Phase 8: Polish, Notifications & Deployment
* Set up internal push notifications (warning user 24hrs before deadlines).
* Finalize icon assets and splash screens.
* Prepare for EAS Build (APK/AAB/IPA).
