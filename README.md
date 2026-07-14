# 🏥 Healthcare Appointment & Follow-up Manager

> Full-stack healthcare appointment management platform — Unthinkable Solutions Engineering Assignment

**🔗 Live Application:** [appoitment-management-platform-ten.vercel.app](https://appoitment-management-platform-ten.vercel.app/)

---

## Table of Contents
1. [Setup Guide](#setup-guide)
2. [Environment Variables (.env.example)](#environment-variables)
3. [API Documentation](#api-documentation)
4. [Database Schema](#database-schema)
5. [LLM Prompts](#llm-prompts)
6. [Google Calendar Setup](#google-calendar-setup)

---

## Setup Guide

### Prerequisites
- Node.js v18+
- A free [Supabase](https://supabase.com) project
- A [Google Cloud](https://console.cloud.google.com) project with the Calendar API enabled
- A [Groq](https://console.groq.com) API key
- A Gmail account with an [App Password](https://myaccount.google.com/apppasswords) generated

### 1. Clone the Repository
```bash
git clone https://github.com/YOUR_USERNAME/YOUR_REPO.git
cd YOUR_REPO
```

### 2. Database Setup (Supabase)
1. Create a new project at [supabase.com](https://supabase.com).
2. Navigate to **SQL Editor** → **New Query**.
3. Paste and run the full contents of `/backend/dataBase/Schema.sql`.
4. Run the following trigger to auto-create user profiles on signup:

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

5. In your Supabase Dashboard → **Authentication** → **URL Configuration**, set:
   - **Site URL**: your frontend URL (e.g., `https://your-app.vercel.app`)

### 3. Backend Setup
```bash
cd backend
cp .env.example .env
# Fill in all values in .env (see Environment Variables section)
npm install
node index.js
```
The server starts on `http://localhost:5000`. On startup it automatically:
- Seeds the default Admin account
- Starts all background cron jobs

**Default Admin Credentials:**
- Email: `avinash.bhurke23@vit.edu`
- Password: `admin`

### 4. Frontend Setup
```bash
cd frontend
# Create .env with the variables shown below
npm install
npm run dev
```
The app runs on `http://localhost:5173`.

---

## Environment Variables

### Backend (`/backend/.env.example`)
```env
PORT=5000

# Supabase Configuration
SUPABASE_URL=your_supabase_project_url
SUPABASE_ANON_KEY=your_supabase_anon_key
SUPABASE_SERVICE_ROLE_KEY=your_supabase_service_role_key

# Groq LLM Configuration
GROQ_API_KEY=your_groq_api_key
GROQ_MODEL=llama-3.1-70b-versatile

# Google Calendar OAuth 2.0
GOOGLE_CLIENT_ID=your_google_oauth_client_id
GOOGLE_CLIENT_SECRET=your_google_oauth_client_secret
GOOGLE_REDIRECT_URI=http://localhost:5000/api/auth/google/callback

# Email (Nodemailer via Gmail SMTP)
EMAIL_HOST=smtp.gmail.com
EMAIL_PORT=587
EMAIL_USER=your_sending_email@gmail.com
EMAIL_PASS=your_gmail_app_password
EMAIL_FROM=your_sending_email@gmail.com
```

### Frontend (`/frontend/.env`)
```env
VITE_SUPABASE_URL=your_supabase_project_url
VITE_SUPABASE_ANON_KEY=your_supabase_anon_key
VITE_API_BASE_URL=http://localhost:5000/api
```

---

## API Documentation

All protected routes require the header: `Authorization: Bearer <supabase_jwt_token>`

The JWT is obtained automatically by the Supabase JS client on the frontend after login. For testing with tools like Postman, copy the token from `supabase.auth.getSession()`.

### Auth Routes (`/api/auth`)

| Method | Endpoint | Auth Required | Description |
|---|---|---|---|
| GET | `/api/auth/google/url` | Doctor JWT | Returns the Google OAuth consent URL for the authenticated doctor |
| GET | `/api/auth/google/callback` | None (redirect) | Handles the OAuth callback, saves tokens, redirects to doctor dashboard |

### Admin Routes (`/api/admin`)

| Method | Endpoint | Auth Required | Description |
|---|---|---|---|
| GET | `/api/admin/doctors` | Admin JWT | Fetch all doctors with their approval status |
| POST | `/api/admin/doctors` | Admin JWT | Create a new doctor account. Body: `{ email, password, full_name, specialisation, phone }` |
| PUT | `/api/admin/doctors/:id/approve` | Admin JWT | Approve or reject a doctor. Body: `{ status: "approved" \| "rejected" }` |
| POST | `/api/admin/leaves` | Admin JWT | Record a doctor leave day. Body: `{ doctor_id, leave_date, reason }` |

### Doctor Routes (`/api/doctor`)

| Method | Endpoint | Auth Required | Description |
|---|---|---|---|
| PUT | `/api/doctor/profile` | Doctor JWT | Update profile fields like specialisation, working_hours, slot_duration_mins |
| POST | `/api/doctor/slots` | Doctor JWT | Generate available slots. Body: `{ start_date, end_date }` |
| GET | `/api/doctor/appointments` | Doctor JWT | Fetch all appointments including patient symptoms and LLM triage |
| POST | `/api/doctor/appointments/:id/notes` | Doctor JWT | Submit post-visit clinical notes and prescriptions |

### Patient Routes (`/api/patient`)

| Method | Endpoint | Auth Required | Description |
|---|---|---|---|
| GET | `/api/patient/doctors` | Patient JWT | Search available doctors. Query: `?specialisation=Cardiologist` |
| GET | `/api/patient/doctors/:doctorId/slots` | Patient JWT | Fetch available slots for a specific doctor on a given date |
| POST | `/api/patient/appointments/book` | Patient JWT | Book a slot. Body: `{ slot_id }`. Places a 5-minute hold first |
| POST | `/api/patient/appointments/:id/symptoms` | Patient JWT | Submit symptoms. Body: `{ symptoms: "string" }`. Triggers LLM triage |
| GET | `/api/patient/appointments` | Patient JWT | Fetch all past and upcoming appointments |

---

## Database Schema

The full schema is in `/backend/dataBase/Schema.sql`. Below is an overview of the key tables:

```
users               Core profile table linked 1:1 to Supabase auth.users
patients            Patient-specific profile (DOB, gender, phone)
doctors             Doctor profile (specialisation, working_hours JSONB, approval_status)
doctor_leaves       Leave days recorded by the admin
slots               Bookable time units (status: available | held | booked | cancelled)
appointments        Links a patient to a doctor slot (status: scheduled | completed | cancelled)
prescriptions       Doctor's post-visit notes, medications, and follow-up instructions
medication_reminders Scheduled reminders generated from prescriptions
notifications       Queue-based system for email and calendar event delivery
google_oauth_tokens Stores per-doctor Google OAuth tokens (access + refresh)
```

**Key Design Choices:**
- `btree_gist` extension + exclusion constraints prevent overlapping slot inserts at the database level
- Enum types enforce valid status values on every status column
- `slots.held_by` + `slots.held_until` implement the 5-minute booking hold mechanism
- `ON DELETE RESTRICT` on `doctors/patients → users` prevents deleting accounts with appointment history

---

## LLM Prompts

The system uses the **Groq API with Llama 3.1 70B** for two AI-powered features. The model is configured with `temperature: 0.2` and `response_format: json_object` to ensure deterministic, structured JSON output.

### Prompt 1: Pre-Visit Symptom Triage
**Triggered when:** A patient submits their symptoms before an appointment.
**Purpose:** Classify urgency, extract chief complaint, and generate suggested doctor questions.

```
System: You are a helpful and clinical medical AI. Output only valid JSON.

User:
You are a medical AI assistant. Analyze the following patient symptoms.
Provide the output in valid JSON format exactly matching this structure:
{
  "urgency_level": "Low" | "Medium" | "High",
  "chief_complaint": "String summarizing the main issue",
  "suggested_questions": ["Question 1", "Question 2", "Question 3"]
}
Only output the JSON object, nothing else.

Symptoms:
"<patient_symptom_text>"
```

**Example Output:**
```json
{
  "urgency_level": "Medium",
  "chief_complaint": "Persistent headache and blurred vision for 3 days",
  "suggested_questions": [
    "Have you experienced any nausea or vomiting?",
    "Is the headache localized or affecting the entire head?",
    "Have you had any recent head injuries or changes in blood pressure?"
  ]
}
```

### Prompt 2: Post-Visit Summary Generation
**Triggered when:** A doctor submits post-visit clinical notes.
**Purpose:** Translate clinical jargon into a patient-friendly summary with actionable steps.

```
System: You are a helpful medical assistant that explains clinical terms simply to patients. Output only valid JSON.

User:
You are a medical AI assistant. Convert the following clinical notes from a doctor into a patient-friendly summary.
Provide the output in valid JSON format exactly matching this structure:
{
  "patient_friendly_summary": "Clear, jargon-free explanation of the visit and diagnosis",
  "medication_schedule_summary": "Simple text explaining when to take medications (if any)",
  "follow_up_steps": "Actionable next steps for the patient"
}
Only output the JSON object, nothing else.

Doctor Notes:
"<doctor_clinical_notes>"
```

---

## Google Calendar Setup

Each doctor individually links their own Google Calendar. Follow these steps:

### Step 1: Create Google Cloud Credentials
1. Go to [Google Cloud Console](https://console.cloud.google.com) and create a new project (or select an existing one).
2. Navigate to **APIs & Services** → **Library** and enable the **Google Calendar API**.
3. Navigate to **APIs & Services** → **Credentials** → **Create Credentials** → **OAuth 2.0 Client ID**.
4. Choose **Web Application** as the application type.
5. Under **Authorized redirect URIs**, add:
   - `http://localhost:5000/api/auth/google/callback` (for local development)
   - `https://your-backend.onrender.com/api/auth/google/callback` (for production)
6. Copy the **Client ID** and **Client Secret** into your `.env` file.

### Step 2: Configure the OAuth Consent Screen
1. Go to **APIs & Services** → **OAuth consent screen**.
2. Set the publishing status to **Testing** during development.
3. Add the email addresses of doctors who will test the integration under **Test Users**.
4. To allow any doctor to connect without whitelisting, publish the app (requires Google verification for the Calendar scope).

### Step 3: Doctor Flow (In-App)
1. Doctor logs in and navigates to their dashboard.
2. Clicks **"Connect Google Calendar"**.
3. Is redirected to Google's consent screen and approves Calendar access.
4. Google redirects back to `/api/auth/google/callback` with a one-time `code`.
5. The backend exchanges the code for an `access_token` and `refresh_token`, which are stored in the `google_oauth_tokens` table.
6. All future appointment bookings for this doctor automatically create Google Calendar events.

### Step 4: Production Deployment Notes
- Update `GOOGLE_REDIRECT_URI` in your Render environment variables to the production callback URL.
- Add the same production callback URL to your Google Cloud Console's Authorized redirect URIs.
- The `refresh_token` is stored so access is maintained long-term without requiring the doctor to re-authenticate.
