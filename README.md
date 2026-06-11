# Everything AI Tutor — Full-Stack MVP

A working full-stack build of the AI Tutor: **Laravel API + Python (FastAPI) AI service + React (Vite) frontend + Google Gemini**, with three roles — **Admin, Student, Parent**. Architecture follows the spec docs in this repo (`AI_Tutor_MASTER_PROMPT.md`, `AI_Tutor_Architecture.md`, `AI_Tutor_Chat_Page_Spec.md`, `AI_Tutor_Token_Management.md`).

The MVP delivers the core adaptive loop from the vision doc:

> **Learn → Assess → Gap analysis → Re-teach the gaps → Re-assess → Mastery**

## Repository layout

```
AI Tutor MVP/
├── ai-service/     Python FastAPI AI service — ALL LLM calls live here
├── backend/        Laravel 11 API (overlay files + setup.sh) — system of record
├── frontend/       React + Vite SPA (Tailwind, role-based)
├── preview.html    Standalone design preview (no build needed)
└── README.md       ← you are here
```

> The earlier `src/` + `preview.html` were the static design pass. The **canonical app is now `frontend/`** (wired to the backend). `preview.html` is kept as a quick visual reference.

---

## What each role can do

| Role | Capabilities |
|------|--------------|
| **Student** | Hero tutor chat (3-pane: tutor modes · conversation · live "tutor's mind" panel), mini-assessments, concept-level EWMA mastery, live misconception tracking, adaptive re-teach loop, next-step plans, AI credit meter, progress snapshot. |
| **Parent**  | Link children by email, child mastery/accuracy/gaps, plain-language AI weekly summary, child AI-usage (credits) view, recent assessments. |
| **Admin**   | Platform stats, user management, curriculum management, AI usage & billing (token ledger, ₹ cost, plans editor, model rates, credit grants). |

---

## Architecture (per `AI_Tutor_Architecture.md`)

```
React SPA ── HTTPS/JSON ──> Laravel API (system of record, orchestration, token gate)
                                │ REST (internal)
                                ▼
                       Python AI service (FastAPI)
                       chat · assess · grade · gap · plan · report
                                │
                                ▼
                            Gemini (or mock)
```

- **All LLM calls live in the Python service** (`ai-service/`). Laravel never calls a model directly when `AI_SERVICE_URL` is set; without it, Laravel falls back to its built-in Gemini client so bare `php artisan serve` still works.
- Every AI response returns **real token counts**, which Laravel meters into a `token_ledger` (cost) and per-student credit counters (quota).

## The adaptive loop (how the AI works)

1. **Tutor chat** — each turn goes through `/ai/chat/turn` with the student's memory, concept mastery and open misconceptions. The model returns the reply **plus structured meta** (concept tags, detected/resolved misconception, mastery signal, next step) that drives the live "tutor's mind" panel. Modes: Teach / Socratic / Quiz / Exam-drill / ELI10.
2. **Mini-assessment** — `/ai/assessment/generate` produces diagnostic MCQs (misconception distractors); attempt 2+ targets the open gaps with fresh questions.
3. **Concept mastery** — every answer updates an EWMA score per concept (α≈0.4). A topic is mastered only when **every** concept passes (≥80%, confidence ≥2) — never an average.
4. **Gap analysis** — wrong answers go to `/ai/gap/analyze`, which returns gaps **with root cause** (the broken prerequisite), persisted as `knowledge_gaps`.
5. **Re-teach loop** — the chat session state machine (`learning → assessing → mastered | relearning`) seeds attempt n+1 with the last gap so the tutor re-teaches it *differently*; auto-relearn caps at 3 attempts.
6. **Token management** — a `TokenGate` middleware enforces daily/monthly credit quotas per plan (402 + upsell when spent); a post-call meter writes real tokens + ₹ cost to the ledger. Students see **credits, never raw tokens**.

If `GEMINI_API_KEY` is missing or `GEMINI_MOCK=true`, both the AI service and the Laravel fallback return deterministic mock responses so the **entire flow runs with zero external calls**.

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
POST /api/tutor/sessions                start a topic-scoped chat (resumes by default)
POST /api/tutor/sessions/{id}/stream    send a message → streamed AI reply + live mind
GET  /api/tutor/sessions/{id}/mind      "tutor's mind": mastery, misconceptions, next step
PATCH /api/tutor/sessions/{id}/mode     Teach | Socratic | Quiz | Exam | ELI10
POST /api/assessments/generate          AI mini-assessment (gap-targeted on retry)
POST /api/assessments/{id}/submit       score + EWMA mastery + AI gap detection
POST /api/plans/generate                AI next-step plan
GET  /api/progress | /api/usage         progress snapshot · credit meter

# Parent (role:parent)
GET  /api/parent/children
GET  /api/parent/children/{child}/report   includes plain-language AI summary
GET  /api/parent/children/{child}/usage    child AI credits (never raw tokens)
POST /api/parent/children/link

# Admin (role:admin)
GET  /api/admin/stats | /api/admin/users
GET  /api/admin/usage                      tokens, credits, ₹ cost, top consumers
GET/POST/PATCH /api/admin/plans            plan editor (limits, weights) — no redeploy
GET/POST /api/admin/model-rates            provider pricing
POST /api/admin/users/{id}/grant-credits   top-ups with audit trail

# Internal: Laravel -> AI service (ai-service/, port 8001)
POST /ai/chat/turn  /ai/assessment/generate  /ai/assessment/grade
POST /ai/gap/analyze  /ai/plan/build  /ai/report/parent
```

Auth is token-based (Laravel Sanctum). Role access is enforced by the `role:` middleware.

---

## 🔐 Security note

Your Gemini API key was shared in chat and is currently in `backend/.env` for local dev only.
`.env` is gitignored, but **rotate that key** at https://aistudio.google.com/app/apikey before any real deployment, and keep production keys in server env vars.

## Mobile reuse

The API is plain JSON + bearer tokens, so the same endpoints power a React Native / Flutter app — no backend changes needed.
