# Everything AI Tutor — Full-Stack MVP

A working full-stack build of the AI Tutor: **Laravel API + React (Vite) frontend + Google Gemini-powered AI**, with three roles — **Admin, Student, Parent**.

The MVP delivers the core learning loop from the vision doc:

> **Ask → AI explains → Mini-assessment → Gap detection → Learning plan → Progress**

## Repository layout

```
AI Tutor MVP/
├── backend/        Laravel 11 API (overlay files + setup.sh)
├── frontend/       React + Vite SPA (Tailwind, role-based)
├── preview.html    Standalone design preview (no build needed)
└── README.md       ← you are here
```

> The earlier `src/` + `preview.html` were the static design pass. The **canonical app is now `frontend/`** (wired to the backend). `preview.html` is kept as a quick visual reference.

---

## What each role can do

| Role | Capabilities |
|------|--------------|
| **Student** | Topic-wise AI tutor chat, mini-assessments, AI gap detection, personalized next-step plans, progress snapshot. |
| **Parent**  | Link children by email, view each child's mastery/accuracy/gaps, mastery-over-time chart, recent assessments. |
| **Admin**   | Platform stats, signups chart, user management (search/filter, enable/disable), curriculum management. |

---

## The learning loop (how the AI works)

1. **Tutor chat** — `TutorService::explain()` builds a pedagogical, topic-scoped prompt (step-by-step, examples, common mistakes, a comprehension check) and calls Gemini.
2. **Mini-assessment** — `generateAssessment()` asks Gemini for diagnostic MCQs (JSON), each probing a sub-concept with a misconception distractor.
3. **Gap detection** — on submit, wrong answers are sent back to Gemini (`detectGaps()`) which returns concepts + severity + recommendations, persisted as `knowledge_gaps`.
4. **Learning plan** — `buildLearningPlan()` turns open gaps into 3–4 short next-step tasks. Completing a task can auto-resolve the matching gap and nudge mastery.
5. **Progress** — `ProgressService` keeps a rolling daily snapshot (mastery, accuracy, streak) shown to students and parents.

If `GEMINI_API_KEY` is missing or `GEMINI_MOCK=true`, the backend returns deterministic mock responses so the **entire flow runs with zero external calls**.

---

## ▶️ Quickest way to run — Docker (one command)

No need to install PHP, Composer, or Node — Docker supplies them.

```bash
cd "AI Tutor MVP"
cp .env.example .env          # then paste your Gemini key into .env
docker compose up --build
```

Then open **http://localhost:5173**. The backend auto-migrates + seeds on first boot.
Demo logins (password `password`): `admin@tuto.ai`, `student@tuto.ai`, `parent@tuto.ai`.

> To run with **no API key**, set `GEMINI_MOCK=true` in `.env` — the whole flow works on mock AI.

---

## ▶️ Run locally on macOS — one script (installs PHP + Node for you)

If you'd rather not use Docker, this script installs PHP/Composer/Node via Homebrew
(if missing), sets up the backend, and starts both servers:

```bash
bash "$HOME/Documents/AI Tutor/AI Tutor MVP/run-mac.sh"
```

It opens http://localhost:5173 automatically. Press Ctrl+C to stop.
(If you don't have Homebrew, the script prints the one line to install it first.)

---

## Prerequisites (fully manual)

- PHP **8.2+** and Composer
- Node **18+** and npm

## 1) Backend (Laravel + SQLite)

```bash
cd "AI Tutor MVP/backend"
chmod +x setup.sh
./setup.sh           # scaffolds Laravel 11, overlays these files, migrates + seeds
cd .laravel
php artisan serve    # http://localhost:8000
```

`setup.sh` creates a fresh Laravel app in `backend/.laravel`, copies in the app code (models, controllers, services, routes, migrations, seeders, config, `.env`), then runs `migrate:fresh --seed` on SQLite.

> Prefer manual setup? `composer create-project laravel/laravel:^11.0 .laravel`, then `php artisan install:api`, copy `app/`, `routes/`, `database/`, `config/gemini.php`, `config/cors.php`, `bootstrap/app.php`, `.env` over the defaults, `touch database/database.sqlite`, `php artisan key:generate`, `php artisan migrate --seed`.

## 2) Frontend (React + Vite)

```bash
cd "AI Tutor MVP/frontend"
npm install
npm run dev          # http://localhost:5173 (proxies /api to :8000)
```

## Demo accounts (password: `password`)

| Role | Email |
|------|-------|
| Admin | `admin@tuto.ai` |
| Student | `student@tuto.ai` |
| Parent | `parent@tuto.ai` (linked to the two student accounts) |

The login screen has one-tap demo buttons for each.

---

## API surface (selected)

```
POST /api/register | /api/login | /api/logout      (auth)
GET  /api/me                                         (current user)
GET  /api/curriculum                                 (subject→chapter→topic tree)

# Student (role:student)
POST /api/tutor/sessions            start a topic-scoped chat
POST /api/tutor/sessions/{id}/send  send a message → AI reply
POST /api/assessments/generate      AI mini-assessment
POST /api/assessments/{id}/submit   score + AI gap detection
POST /api/plans/generate            AI next-step plan
GET  /api/progress                  progress snapshot

# Parent (role:parent)
GET  /api/parent/children
GET  /api/parent/children/{child}/report
POST /api/parent/children/link

# Admin (role:admin)
GET  /api/admin/stats | /api/admin/users
PATCH /api/admin/users/{user}/active
```

Auth is token-based (Laravel Sanctum). Role access is enforced by the `role:` middleware.

---

## 🔐 Security note

Your Gemini API key was shared in chat and is currently in `backend/.env` for local dev only.
`.env` is gitignored, but **rotate that key** at https://aistudio.google.com/app/apikey before any real deployment, and keep production keys in server env vars.

## Mobile reuse

The API is plain JSON + bearer tokens, so the same endpoints power a React Native / Flutter app — no backend changes needed.
