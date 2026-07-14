# 🏥 Healthcare Appointment & Follow-up Manager

> A full-stack, production-ready healthcare appointment management platform built as part of the Unthinkable Solutions engineering assignment.

**🔗 Live Application:** [appoitment-management-platform-ten.vercel.app](https://appoitment-management-platform-ten.vercel.app/)

**👤 Demo Credentials (Admin):**
- Email: `avinash.bhurke23@vit.edu`
- Password: `admin`

---

## 📋 Table of Contents

- [Overview](#overview)
- [Tech Stack](#tech-stack)
- [Features](#features)
- [System Architecture](#system-architecture)
- [Database Schema](#database-schema)
- [API Reference](#api-reference)
- [Local Setup](#local-setup)
- [CI/CD Pipeline](#cicd-pipeline)
- [Design Decisions & Tradeoffs](#design-decisions--tradeoffs)
- [Challenges & Solutions](#challenges--solutions)
- [Security Hardening](#security-hardening)

---

## Overview

This platform manages the full lifecycle of a healthcare appointment — from patient registration and doctor onboarding, through booking with intelligent slot management, to post-visit prescription and medication reminders. It is designed with a three-tier role architecture (Admin, Doctor, Patient) and integrates with Google Calendar and an AI LLM layer for symptom triage.

---

## Tech Stack

### Backend
| Layer | Technology | Rationale |
|---|---|---|
| Runtime | Node.js + Express 5 | Non-blocking I/O, well-suited for real-time slot management |
| Database | Supabase (PostgreSQL) | Managed Postgres with built-in Auth, RLS, and real-time capabilities |
| Auth | Supabase Auth (JWT) | Eliminates custom auth boilerplate, production-grade security |
| Email | Nodemailer (SMTP) | Direct control over transactional email delivery |
| Calendar | Google Calendar API (OAuth 2.0) | First-class integration with doctor's existing calendar |
| AI/LLM | Groq SDK (Llama 3.1 70B) | Ultra-low latency inference for real-time symptom triage |
| Scheduler | node-cron | Lightweight in-process cron for notifications and slot cleanup |
| Deployment | Render (Free tier) | Native GitHub CI/CD, zero-config Node.js hosting |

### Frontend
| Layer | Technology |
|---|---|
| Framework | React + TypeScript + Vite |
| Routing | React Router v6 |
| Auth | Supabase JS Client |
| Styling | Vanilla CSS (Inter font, design system tokens) |
| Icons | Lucide React |
| Deployment | Vercel |

---

## Features

### 👩‍💼 Admin Portal
- Hardcoded default credentials (no public signup) for security
- Create doctor accounts with a single form
- Approve / Reject doctor applications
- Record doctor leave days (triggers automatic patient notifications)

### 👨‍⚕️ Doctor Portal
- Update professional profile (specialisation, working hours, slot duration)
- Generate time slots based on configurable working hours
- View all upcoming appointments with patient symptom summaries
- Submit post-visit notes and prescriptions
- Connect Google Calendar (OAuth 2.0) to sync appointments automatically

### 🧑‍🤝‍🧑 Patient Portal
- Self-registration (no admin required)
- Search and filter doctors by specialisation
- View real-time slot availability (with 5-minute hold locks to prevent race conditions)
- Book appointments
- Submit pre-appointment symptoms (processed by Groq LLM for urgency triage)
- View full appointment history

### ⚙️ Background Automation (Cron Jobs)
- **Every 1 minute:** Release expired slot holds back to available
- **Every 1 minute:** Process the notification queue (emails + calendar events)
- **Every 5 minutes:** Fire medication reminders from active prescriptions

---

## System Architecture

```
┌─────────────────────────────────────────────┐
│              Vercel (Frontend)               │
│   React + TypeScript + Vite                  │
│   Role-based routing: /patient /doctor /admin│
└────────────────────┬────────────────────────┘
                     │ HTTPS + JWT Bearer Token
┌────────────────────▼────────────────────────┐
│              Render (Backend)                │
│   Express 5 REST API                         │
│   ├── /api/auth    (Google OAuth)            │
│   ├── /api/admin   (Admin CRUD)              │
│   ├── /api/doctor  (Doctor operations)       │
│   └── /api/patient (Patient bookings)        │
│   └── node-cron background jobs              │
└────────────────────┬────────────────────────┘
                     │ Supabase Client (Service Role Key)
┌────────────────────▼────────────────────────┐
│              Supabase (Database)             │
│   PostgreSQL + Row Level Security            │
│   auth.users → public.users → doctors/patients│
│   Slots, Appointments, Prescriptions         │
│   Notifications Queue, Google OAuth Tokens   │
└─────────────────────────────────────────────┘
           │                        │
  ┌────────▼────────┐    ┌──────────▼──────────┐
  │   Groq API      │    │  Google Calendar API │
  │ Llama 3.1 70B   │    │  OAuth 2.0 per user  │
  │ Symptom Triage  │    │  Per-Doctor tokens   │
  └─────────────────┘    └─────────────────────┘
```

---

## Database Schema

The PostgreSQL schema (`/backend/dataBase/Schema.sql`) is production-grade with:

- **ENUM types** for all status fields (slot_status, appointment_status, urgency_level, etc.)
- **Exclusion constraints** using `btree_gist` to prevent overlapping slot bookings at the DB level
- **Cascade rules** carefully chosen:
  - `auth.users → public.users` — CASCADE (deleting an auth user cleans their profile)
  - `users → doctors/patients` — RESTRICT (prevents deletion of accounts with appointment history)
- **A Supabase trigger** (`on_auth_user_created`) auto-populates `public.users` and `public.patients` rows on every signup

Key tables: `users`, `patients`, `doctors`, `slots`, `appointments`, `prescriptions`, `medication_reminders`, `notifications`, `google_oauth_tokens`

---

## API Reference

All protected routes require: `Authorization: Bearer <supabase_jwt_token>`

### Auth Routes (`/api/auth`)
| Method | Endpoint | Auth | Description |
|---|---|---|---|
| GET | `/api/auth/google/url` | Doctor JWT | Get Google OAuth consent URL |
| GET | `/api/auth/google/callback` | None | Google OAuth callback handler |

### Admin Routes (`/api/admin`)
| Method | Endpoint | Auth | Description |
|---|---|---|---|
| GET | `/api/admin/doctors` | Admin JWT | List all doctors with approval status |
| POST | `/api/admin/doctors` | Admin JWT | Create a new doctor account |
| PUT | `/api/admin/doctors/:id/approve` | Admin JWT | Approve or reject a doctor |
| POST | `/api/admin/leaves` | Admin JWT | Record a doctor leave day |

### Doctor Routes (`/api/doctor`)
| Method | Endpoint | Auth | Description |
|---|---|---|---|
| PUT | `/api/doctor/profile` | Doctor JWT | Update working hours and profile |
| POST | `/api/doctor/slots` | Doctor JWT | Generate slots for a date range |
| GET | `/api/doctor/appointments` | Doctor JWT | View all appointments |
| POST | `/api/doctor/appointments/:id/notes` | Doctor JWT | Submit post-visit notes and prescriptions |

### Patient Routes (`/api/patient`)
| Method | Endpoint | Auth | Description |
|---|---|---|---|
| GET | `/api/patient/doctors` | Patient JWT | Search/filter available doctors |
| GET | `/api/patient/doctors/:doctorId/slots` | Patient JWT | View available slots |
| POST | `/api/patient/appointments/book` | Patient JWT | Book a slot (5-min hold) |
| POST | `/api/patient/appointments/:id/symptoms` | Patient JWT | Submit symptoms (triggers LLM triage) |
| GET | `/api/patient/appointments` | Patient JWT | View appointment history |

---

## Local Setup

### Prerequisites
- Node.js v18+
- A Supabase project (free tier works)
- Google Cloud project with Calendar API and OAuth 2.0 Client
- Groq API key

### Backend
```bash
cd backend
cp .env.example .env
# Fill in your credentials in .env
npm install
node index.js
```

### Frontend
```bash
cd frontend
cp .env.example .env
# Set VITE_SUPABASE_URL, VITE_SUPABASE_ANON_KEY, VITE_API_BASE_URL
npm install
npm run dev
```

### Database Setup
1. Run the full SQL from `/backend/dataBase/Schema.sql` in your Supabase SQL Editor.
2. Run the following trigger in the Supabase SQL Editor to enable auto-profile creation on signup:

```sql
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  INSERT INTO public.users (id, email, role)
  VALUES (NEW.id, NEW.email, COALESCE(NEW.raw_user_meta_data->>'role', 'patient')::user_role)
  ON CONFLICT (id) DO NOTHING;

  IF (COALESCE(NEW.raw_user_meta_data->>'role', 'patient') = 'patient') THEN
    INSERT INTO public.patients (user_id, full_name)
    VALUES (NEW.id, COALESCE(NEW.raw_user_meta_data->>'full_name', NEW.email))
    ON CONFLICT (user_id) DO NOTHING;
  END IF;
  RETURN NEW;
END; $$;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE PROCEDURE public.handle_new_user();
```

### Environment Variables

**Backend (`.env`)**
```env
PORT=5000
SUPABASE_URL=your_supabase_url
SUPABASE_ANON_KEY=your_anon_key
SUPABASE_SERVICE_ROLE_KEY=your_service_role_key
GROQ_API_KEY=your_groq_api_key
GROQ_MODEL=llama-3.1-70b-versatile
GOOGLE_CLIENT_ID=your_google_client_id
GOOGLE_CLIENT_SECRET=your_google_client_secret
GOOGLE_REDIRECT_URI=http://localhost:5000/api/auth/google/callback
EMAIL_HOST=smtp.gmail.com
EMAIL_PORT=587
EMAIL_USER=your_email@gmail.com
EMAIL_PASS=your_app_password
EMAIL_FROM=your_email@gmail.com
```

**Frontend (`.env`)**
```env
VITE_SUPABASE_URL=your_supabase_url
VITE_SUPABASE_ANON_KEY=your_anon_key
VITE_API_BASE_URL=http://localhost:5000/api
```

---

## CI/CD Pipeline

Both services auto-deploy via Git push with zero manual steps:

| Service | Platform | Trigger | Build |
|---|---|---|---|
| Backend | Render | Push to `main` (webhook) | `npm install` then `npm start` |
| Frontend | Vercel | Push to `main` (webhook) | `npm install && npm run build` serving `/dist` |

Render automatically detects the repository changes and redeploys the backend. Vercel detects frontend changes and rebuilds the static site. All environment secrets are managed through each platform's dashboard — nothing sensitive is ever committed to the repository.

---

## Design Decisions & Tradeoffs

### 1. Supabase Auth over Custom JWT
**Decision:** Use Supabase's built-in auth instead of rolling a custom bcrypt + JWT system.
**Benefit:** Eliminates entire classes of security vulnerabilities (timing attacks, improper hashing), provides PKCE, session management, email verification, and rate limiting for free.
**Tradeoff:** We are coupled to Supabase's auth system. Migrating to a different auth provider in the future would require a data migration of `auth.users`.

### 2. Backend Service Role Key vs. Frontend Anon Key
**Decision:** All database mutations go through the Express backend using the `SUPABASE_SERVICE_ROLE_KEY` (which bypasses RLS). The frontend only holds the `ANON_KEY`.
**Benefit:** Business logic and authorization rules are enforced server-side, not on the client. The frontend cannot manipulate data directly.
**Tradeoff:** Every operation requires an extra network hop to our backend, adding ~50ms of latency compared to direct client-to-Supabase calls. This is an acceptable tradeoff for security.

### 3. Slot-Hold Mechanism (Optimistic Locking via DB)
**Decision:** When a patient starts booking a slot, it is immediately set to `held` status with a `held_until` timestamp (5 minutes). A cron job releases expired holds every minute.
**Benefit:** Prevents the double booking race condition that would occur if two patients booked the same slot simultaneously.
**Tradeoff:** A patient could hold a slot and abandon the booking for up to 5 minutes, blocking other patients. A truly real-time system would use WebSockets; the cron-based approach is simpler and sufficient for this scale.

### 4. In-Process Cron Jobs (node-cron) vs. External Queue
**Decision:** Use `node-cron` running inside the Express server process for background jobs.
**Benefit:** Zero additional infrastructure. No Redis, no separate worker process, no message broker to manage.
**Tradeoff:** If the Express server restarts (which Render's free tier does after inactivity), pending cron jobs are missed until the next scheduled fire. A production system at scale should use a dedicated queue (BullMQ + Redis) or a managed service (AWS SQS). For this assignment the simplicity is appropriate.

### 5. Per-Doctor OAuth Tokens vs. Service Account
**Decision:** Each doctor individually authenticates with their own Google account and their token is stored in the `google_oauth_tokens` table.
**Benefit:** Events are created on the doctor's own calendar, using their identity. No need to share a single service account calendar across all doctors.
**Tradeoff:** Requires doctors to individually go through the OAuth consent flow. A service account approach would be invisible to doctors but would require a shared calendar.

### 6. Groq for LLM (vs. OpenAI/Gemini)
**Decision:** Use Groq's hosted Llama 3.1 inference for symptom triage.
**Benefit:** Groq's hardware provides significantly lower inference latency (~10x faster than OpenAI at equivalent model size). The free tier is generous enough for the assignment scope.
**Tradeoff:** The Llama 3.1 70B model is extremely capable but may not match GPT-4o on nuanced clinical reasoning. For a real medical product, a validated HIPAA-compliant model would be required.

---

## Challenges & Solutions

### Challenge 1: Database Constraint Errors on User Deletion
When trying to delete a user from Supabase Auth, the API was returning a cryptic 500 Internal Server Error. The full error object revealed it was a PostgreSQL foreign key violation because the `patients` table uses `ON DELETE RESTRICT`.
**Solution:** Updated the deletion script to manually delete child table records (`patients` then `google_oauth_tokens` then `public.users`) in the correct dependency order before calling the Auth API to delete the auth record.

### Challenge 2: Google OAuth `invalid_grant` + Credential Leakage in Logs
After the first successful OAuth handshake, the server was logging the entire Google API client configuration — including the authorization code and client credentials — directly to the console.
**Solution:** The root cause was `console.error(error)` logging the raw Gaxios error object which contains the full HTTP request config. Fixed by changing all error logs to `console.error(error.message)`. The `invalid_grant` itself was because the one-time-use authorization code had already been exchanged and was replayed after a server restart.

### Challenge 3: Supabase Email Rate Limiting in Testing
The free Supabase tier enforces a strict limit of 3 confirmation emails per hour, causing 429 errors during repeated account creation during development.
**Solution:** Configured a Custom SMTP server (Gmail App Password) in the Supabase Dashboard, bypassing their shared email relay entirely.

### Challenge 4: TypeScript Build Failures on Vercel
The Vite/TypeScript build was failing with: (a) a typo `maxStatus` instead of `maxHeight` in an inline style object, caught by TypeScript's strict CSS type checking; and (b) unused `React` imports treated as hard errors by `noUnusedLocals`.
**Solution:** Fixed the CSS property typo and removed the unused React imports from dashboard components (not needed since React 17's new JSX transform).

### Challenge 5: Single-Page App Routing on Static Hosts
Refreshing the page on `/doctor` or `/admin` returned a 404 because the static file server tried to serve a file at that path.
**Solution:** Configured Vercel to rewrite all requests to `/index.html`, which then lets React Router handle the routing client-side.

---

## Security Hardening

- ✅ **No credentials in logs** — All error handlers log `error.message` only, never the raw error object
- ✅ **Secrets in environment variables** — `.env` is in `.gitignore`; production secrets live in platform dashboards
- ✅ **Server-side authorization** — Every API route is guarded by `protect` (validates JWT) and `authorize(role)` middleware
- ✅ **Service Role Key is backend-only** — The frontend only holds the public Anon Key
- ✅ **Admin account is seeded, not publicly signable** — No public endpoint allows signing up as admin
- ✅ **DB constraints enforce data integrity** — Enum types, exclusion constraints, and FK restrictions at the Postgres layer
