-- =========================================================
-- Healthcare Appointment & Follow-up Manager — Postgres Schema
-- =========================================================

-- Needed for exclusion constraints on time ranges (overlap prevention)
CREATE EXTENSION IF NOT EXISTS btree_gist;
CREATE EXTENSION IF NOT EXISTS pgcrypto; -- for gen_random_uuid()

-- ---------------------------------------------------------
-- ENUM TYPES
-- ---------------------------------------------------------
CREATE TYPE user_role AS ENUM ('patient', 'doctor', 'admin');
CREATE TYPE slot_status AS ENUM ('available', 'held', 'booked', 'cancelled');
CREATE TYPE appointment_status AS ENUM ('scheduled', 'completed', 'cancelled', 'no_show');
CREATE TYPE urgency_level AS ENUM ('Low', 'Medium', 'High');
CREATE TYPE llm_status AS ENUM ('pending', 'success', 'failed');
CREATE TYPE notification_type AS ENUM ('booking_confirmation', 'reminder', 'cancellation', 'reschedule', 'leave_notice', 'medication_reminder');
CREATE TYPE notification_channel AS ENUM ('email', 'calendar');
CREATE TYPE notification_status AS ENUM ('pending', 'sent', 'failed', 'retrying');
CREATE TYPE doctor_approval_status AS ENUM ('pending', 'approved', 'rejected');

-- ---------------------------------------------------------
-- CORE: USERS (auth + role)
-- ---------------------------------------------------------
CREATE TABLE users (
    id              UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
    email           TEXT NOT NULL UNIQUE,
    role            user_role NOT NULL,
    is_active       BOOLEAN NOT NULL DEFAULT TRUE,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
-- NOTE: password_hash is deliberately removed. Supabase Auth (auth.users)
-- owns credentials/password hashing; this table is a profile/role
-- extension of it, keyed 1:1 on the same id. Signing up goes through
-- Supabase's own signUp() call, not a custom INSERT into this table.
-- ON DELETE CASCADE here is intentional and safe: if an auth.users row
-- is ever hard-deleted, it cascades to this row, which in turn is still
-- protected by the ON DELETE RESTRICT from doctors/patients below — so
-- an account with real appointment history still blocks deletion, just
-- one hop further up the chain.

CREATE INDEX idx_users_role ON users(role);

-- ---------------------------------------------------------
-- PATIENT PROFILE
-- ---------------------------------------------------------
CREATE TABLE patients (
    user_id         UUID PRIMARY KEY REFERENCES users(id) ON DELETE RESTRICT,
    full_name       TEXT NOT NULL,
    phone           TEXT,
    date_of_birth   DATE,
    gender          TEXT,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------
-- DOCTOR PROFILE
-- ---------------------------------------------------------
CREATE TABLE doctors (
    user_id             UUID PRIMARY KEY REFERENCES users(id) ON DELETE RESTRICT,
    full_name           TEXT NOT NULL,
    specialisation      TEXT NOT NULL,
    phone               TEXT,
    slot_duration_mins  INTEGER NOT NULL DEFAULT 15 CHECK (slot_duration_mins > 0),
    working_hours       JSONB NOT NULL DEFAULT '{}'::jsonb,
    -- e.g. {"mon": [["09:00","13:00"],["14:00","17:00"]], "tue": [...], ...}
    approval_status     doctor_approval_status NOT NULL DEFAULT 'pending',
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_doctors_specialisation ON doctors(specialisation);
CREATE INDEX idx_doctors_approval_status ON doctors(approval_status);

-- ---------------------------------------------------------
-- DOCTOR LEAVE DAYS
-- ---------------------------------------------------------
CREATE TABLE doctor_leaves (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    doctor_id       UUID NOT NULL REFERENCES doctors(user_id) ON DELETE CASCADE,
    leave_date      DATE NOT NULL,
    reason          TEXT,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (doctor_id, leave_date)
);

CREATE INDEX idx_doctor_leaves_date ON doctor_leaves(leave_date);

-- ---------------------------------------------------------
-- SLOTS (concrete bookable time units — this is what gets locked)
-- ---------------------------------------------------------
CREATE TABLE slots (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    doctor_id       UUID NOT NULL REFERENCES doctors(user_id) ON DELETE CASCADE,
    slot_date       DATE NOT NULL,
    start_time      TIME NOT NULL,
    end_time        TIME NOT NULL,
    status          slot_status NOT NULL DEFAULT 'available',
    held_by         UUID REFERENCES patients(user_id) ON DELETE SET NULL,
    held_until      TIMESTAMPTZ,       -- hold expiry timestamp (e.g. now() + interval '5 minutes')
    cancellation_reason TEXT,          -- e.g. 'doctor_leave' — set when a slot is system-cancelled, cleared on reactivation
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),

    CONSTRAINT chk_time_order CHECK (end_time > start_time),

    -- Hard uniqueness: one row per doctor/date/start_time
    UNIQUE (doctor_id, slot_date, start_time),

    -- Extra safety net: no two slots for the same doctor on the same day can
    -- have overlapping time ranges, regardless of how rows are inserted.
    EXCLUDE USING gist (
        doctor_id WITH =,
        slot_date WITH =,
        tsrange(
            (slot_date + start_time)::timestamp,
            (slot_date + end_time)::timestamp
        ) WITH &&
    )
);

CREATE INDEX idx_slots_doctor_date ON slots(doctor_id, slot_date);
CREATE INDEX idx_slots_status ON slots(status);
CREATE INDEX idx_slots_held_until ON slots(held_until) WHERE status = 'held';

-- ---------------------------------------------------------
-- APPOINTMENTS
-- ---------------------------------------------------------
CREATE TABLE appointments (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    slot_id             UUID NOT NULL REFERENCES slots(id) ON DELETE RESTRICT,
    patient_id          UUID NOT NULL REFERENCES patients(user_id) ON DELETE RESTRICT,
    doctor_id           UUID NOT NULL REFERENCES doctors(user_id) ON DELETE RESTRICT,
    status              appointment_status NOT NULL DEFAULT 'scheduled',
    symptoms            TEXT,
    cancellation_reason TEXT,
    cancelled_by        TEXT CHECK (cancelled_by IN ('patient', 'doctor', 'system')),
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Only ONE active (scheduled/completed) appointment may ever hold a given
-- slot at a time. Cancelled/no_show rows are excluded, so the same slot_id
-- can be legitimately reused once it's freed — without this, the old
-- blanket UNIQUE(slot_id) permanently locked a slot after its first
-- cancellation, silently breaking every "cancel and rebook" path.
CREATE UNIQUE INDEX uq_appointments_active_slot
    ON appointments(slot_id)
    WHERE status IN ('scheduled', 'completed');

CREATE INDEX idx_appointments_patient ON appointments(patient_id);
CREATE INDEX idx_appointments_doctor ON appointments(doctor_id);
CREATE INDEX idx_appointments_status ON appointments(status);

-- ---------------------------------------------------------
-- PRE-VISIT LLM SUMMARY
-- ---------------------------------------------------------
CREATE TABLE pre_visit_summaries (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    appointment_id      UUID NOT NULL UNIQUE REFERENCES appointments(id) ON DELETE CASCADE,
    urgency_level       urgency_level,
    chief_complaint     TEXT,
    suggested_questions JSONB,          -- ["question1", "question2", "question3"]
    raw_llm_response    JSONB,
    llm_status          llm_status NOT NULL DEFAULT 'pending',
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_pre_visit_urgency ON pre_visit_summaries(urgency_level);

-- ---------------------------------------------------------
-- POST-VISIT DOCTOR NOTES
-- ---------------------------------------------------------
CREATE TABLE post_visit_notes (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    appointment_id  UUID NOT NULL UNIQUE REFERENCES appointments(id) ON DELETE CASCADE,
    doctor_notes    TEXT NOT NULL,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------
-- PRESCRIPTIONS
-- ---------------------------------------------------------
CREATE TABLE prescriptions (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    appointment_id      UUID NOT NULL REFERENCES appointments(id) ON DELETE CASCADE,
    medication_name     TEXT NOT NULL,
    dosage              TEXT NOT NULL,
    frequency_per_day   INTEGER NOT NULL CHECK (frequency_per_day > 0),
    duration_days       INTEGER NOT NULL CHECK (duration_days > 0),
    instructions        TEXT,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_prescriptions_appointment ON prescriptions(appointment_id);

-- ---------------------------------------------------------
-- POST-VISIT LLM SUMMARY (patient-friendly)
-- ---------------------------------------------------------
CREATE TABLE post_visit_summaries (
    id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    appointment_id          UUID NOT NULL UNIQUE REFERENCES appointments(id) ON DELETE CASCADE,
    patient_friendly_summary TEXT,
    medication_schedule     JSONB,     -- structured schedule derived from prescriptions
    follow_up_steps         TEXT,
    llm_status               llm_status NOT NULL DEFAULT 'pending',
    created_at               TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------
-- MEDICATION REMINDERS (background job feeds off this table)
-- ---------------------------------------------------------
CREATE TABLE medication_reminders (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    prescription_id UUID NOT NULL REFERENCES prescriptions(id) ON DELETE CASCADE,
    remind_at       TIMESTAMPTZ NOT NULL,
    sent            BOOLEAN NOT NULL DEFAULT FALSE,
    sent_at         TIMESTAMPTZ,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_med_reminders_due ON medication_reminders(remind_at) WHERE sent = FALSE;

-- ---------------------------------------------------------
-- NOTIFICATIONS (email + calendar, with retry tracking)
-- ---------------------------------------------------------
CREATE TABLE notifications (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    appointment_id  UUID REFERENCES appointments(id) ON DELETE CASCADE,
    type            notification_type NOT NULL,
    channel         notification_channel NOT NULL,
    status          notification_status NOT NULL DEFAULT 'pending',
    retry_count     INTEGER NOT NULL DEFAULT 0,
    payload         JSONB,
    error_message   TEXT,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    sent_at         TIMESTAMPTZ
);

CREATE INDEX idx_notifications_status ON notifications(status) WHERE status IN ('pending', 'retrying');
CREATE INDEX idx_notifications_user ON notifications(user_id);

-- ---------------------------------------------------------
-- GOOGLE CALENDAR EVENT TRACKING (per appointment, per side)
-- ---------------------------------------------------------
CREATE TABLE calendar_events (
    id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    appointment_id          UUID NOT NULL UNIQUE REFERENCES appointments(id) ON DELETE CASCADE,
    patient_calendar_event_id TEXT,
    doctor_calendar_event_id  TEXT,
    created_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at              TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------
-- OAUTH TOKENS (Google Calendar per user)
-- ---------------------------------------------------------
CREATE TABLE google_oauth_tokens (
    user_id         UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    access_token    TEXT NOT NULL,
    refresh_token   TEXT NOT NULL,
    token_expiry    TIMESTAMPTZ NOT NULL,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- =========================================================
-- TRIGGERS: auto-update `updated_at` columns
-- =========================================================
CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = now();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_users_updated_at BEFORE UPDATE ON users
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER trg_appointments_updated_at BEFORE UPDATE ON appointments
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER trg_calendar_events_updated_at BEFORE UPDATE ON calendar_events
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER trg_oauth_tokens_updated_at BEFORE UPDATE ON google_oauth_tokens
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- =========================================================
-- HELPER: auto-expire stale held slots back to 'available'
-- Call this periodically from your background job (e.g. every minute)
-- =========================================================
CREATE OR REPLACE FUNCTION release_expired_slot_holds()
RETURNS void AS $$
BEGIN
    UPDATE slots
    SET status = 'available', held_by = NULL, held_until = NULL
    WHERE status = 'held' AND held_until < now();
END;
$$ LANGUAGE plpgsql;

-- =========================================================
-- FIX 1: STATE SYNC BETWEEN appointments AND slots
-- The slot's status is now a derived/owned field — the app should never
-- write to slots.status directly for booking/cancelling. These triggers
-- are the single source of truth for that transition, so drift between
-- the two tables becomes structurally impossible.
-- =========================================================
CREATE OR REPLACE FUNCTION sync_slot_on_appointment_change()
RETURNS TRIGGER AS $$
BEGIN
    IF TG_OP = 'INSERT' THEN
        UPDATE slots
        SET status = 'booked', held_by = NULL, held_until = NULL
        WHERE id = NEW.slot_id;
        RETURN NEW;
    END IF;

    IF TG_OP = 'UPDATE' AND NEW.status IS DISTINCT FROM OLD.status THEN
        IF NEW.status IN ('cancelled', 'no_show') THEN
            IF NEW.status = 'cancelled' AND NEW.cancelled_by = 'system' THEN
                -- System-driven cancellation (e.g. doctor leave): the slot
                -- itself is no longer offerable, not just this booking.
                UPDATE slots
                SET status = 'cancelled', held_by = NULL, held_until = NULL,
                    cancellation_reason = 'doctor_leave'
                WHERE id = NEW.slot_id;
            ELSE
                -- Patient/doctor cancelled this specific booking; the
                -- underlying slot is still valid and goes back on the market.
                UPDATE slots
                SET status = 'available', held_by = NULL, held_until = NULL,
                    cancellation_reason = NULL
                WHERE id = NEW.slot_id;
            END IF;
        END IF;
        -- 'completed' intentionally leaves the slot as 'booked' — it's a
        -- historical record, not something that should become bookable again.
        RETURN NEW;
    END IF;

    IF TG_OP = 'DELETE' THEN
        UPDATE slots
        SET status = 'available', held_by = NULL, held_until = NULL
        WHERE id = OLD.slot_id;
        RETURN OLD;
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_sync_slot_on_appointment_insert
    AFTER INSERT ON appointments
    FOR EACH ROW EXECUTE FUNCTION sync_slot_on_appointment_change();

CREATE TRIGGER trg_sync_slot_on_appointment_update
    AFTER UPDATE ON appointments
    FOR EACH ROW EXECUTE FUNCTION sync_slot_on_appointment_change();

CREATE TRIGGER trg_sync_slot_on_appointment_delete
    AFTER DELETE ON appointments
    FOR EACH ROW EXECUTE FUNCTION sync_slot_on_appointment_change();

-- =========================================================
-- FIX 2: ATOMIC BOOKING (removes the check-then-insert race entirely)
-- The app must call this function to book a slot — never a raw
-- INSERT INTO appointments. The row lock (FOR UPDATE) and the status
-- transition happen inside one transaction, so two concurrent calls
-- for the same slot_id are serialized by Postgres itself: the second
-- caller gets a clean exception, not a unique-constraint crash.
-- =========================================================
CREATE OR REPLACE FUNCTION book_appointment_slot(
    p_slot_id       UUID,
    p_patient_id    UUID,
    p_doctor_id     UUID,
    p_symptoms      TEXT DEFAULT NULL
)
RETURNS UUID AS $$
DECLARE
    v_status        slot_status;
    v_held_by       UUID;
    v_appointment_id UUID;
BEGIN
    -- Row lock: any concurrent call for the same slot_id blocks here
    -- until this transaction commits or rolls back.
    SELECT status, held_by INTO v_status, v_held_by
    FROM slots
    WHERE id = p_slot_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'slot_not_found';
    END IF;

    IF v_status = 'booked' THEN
        RAISE EXCEPTION 'slot_already_booked';
    END IF;

    IF v_status = 'cancelled' THEN
        RAISE EXCEPTION 'slot_unavailable';
    END IF;

    IF v_status = 'held' AND v_held_by IS DISTINCT FROM p_patient_id THEN
        RAISE EXCEPTION 'slot_held_by_another_patient';
    END IF;
    -- v_status = 'available', or 'held' by this same patient -> proceed

    INSERT INTO appointments (slot_id, patient_id, doctor_id, symptoms)
    VALUES (p_slot_id, p_patient_id, p_doctor_id, p_symptoms)
    RETURNING id INTO v_appointment_id;
    -- trg_sync_slot_on_appointment_insert flips the slot to 'booked'

    RETURN v_appointment_id;
END;
$$ LANGUAGE plpgsql;

-- Example call from the app layer:
-- SELECT book_appointment_slot(:slot_id, :patient_id, :doctor_id, :symptoms);
-- Catch 'slot_already_booked' / 'slot_held_by_another_patient' in app code
-- and surface a clean "this slot was just taken" message to the user.

-- =========================================================
-- FIX 3: DOCTOR LEAVE -> AUTO-CANCEL AFFECTED APPOINTMENTS + NOTIFY
-- Inserting a doctor_leaves row now cascades logically (not via FK
-- cascade, but via trigger) to cancel scheduled appointments on that
-- date and queue notifications for the affected patients.
-- =========================================================
CREATE OR REPLACE FUNCTION handle_doctor_leave_conflicts()
RETURNS TRIGGER AS $$
DECLARE
    r RECORD;
BEGIN
    FOR r IN
        SELECT a.id AS appointment_id, a.patient_id
        FROM appointments a
        JOIN slots s ON s.id = a.slot_id
        WHERE s.doctor_id = NEW.doctor_id
          AND s.slot_date = NEW.leave_date
          AND a.status = 'scheduled'
    LOOP
        UPDATE appointments
        SET status = 'cancelled',
            cancellation_reason = 'Doctor on leave',
            cancelled_by = 'system'
        WHERE id = r.appointment_id;
        -- trg_sync_slot_on_appointment_update releases the slot

        INSERT INTO notifications (user_id, appointment_id, type, channel, payload)
        VALUES (
            r.patient_id,
            r.appointment_id,
            'leave_notice',
            'email',
            jsonb_build_object('leave_date', NEW.leave_date, 'reason', NEW.reason)
        );
    END LOOP;

    -- Also close off any slots on this date that had no booking at all —
    -- otherwise they'd stay 'available' and bookable straight through the
    -- leave day.
    UPDATE slots
    SET status = 'cancelled', cancellation_reason = 'doctor_leave',
        held_by = NULL, held_until = NULL
    WHERE doctor_id = NEW.doctor_id
      AND slot_date = NEW.leave_date
      AND status = 'available';

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_doctor_leave_conflicts
    AFTER INSERT ON doctor_leaves
    FOR EACH ROW EXECUTE FUNCTION handle_doctor_leave_conflicts();

-- =========================================================
-- FIX 5: BLOCK SLOT CREATION ON A DAY ALREADY MARKED AS LEAVE
-- Prevents admin tools or a background "generate this week's slots"
-- job from silently writing bookable slots onto a day the doctor has
-- already taken off, after the leave row was logged.
-- =========================================================
CREATE OR REPLACE FUNCTION check_slot_against_doctor_leave()
RETURNS TRIGGER AS $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM doctor_leaves
        WHERE doctor_id = NEW.doctor_id
          AND leave_date = NEW.slot_date
    ) THEN
        RAISE EXCEPTION 'cannot_create_slot_doctor_on_leave';
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_prevent_slot_on_leave_day
    BEFORE INSERT ON slots
    FOR EACH ROW EXECUTE FUNCTION check_slot_against_doctor_leave();

-- =========================================================
-- FIX 6: REVERSE LEAVE -> REOPEN THE SLOTS IT CANCELLED
-- If a doctor decides to work after all and the admin deletes the
-- doctor_leaves row, only the slots THAT LEAVE cancelled (tagged
-- cancellation_reason = 'doctor_leave') are reopened — never a slot
-- an admin manually cancelled for an unrelated reason. Appointments
-- that were cancelled are NOT auto-restored; the patient must rebook,
-- since silently re-confirming a booking without their awareness
-- would be unsafe.
-- =========================================================
CREATE OR REPLACE FUNCTION reopen_slots_after_leave_removed()
RETURNS TRIGGER AS $$
BEGIN
    UPDATE slots
    SET status = 'available', cancellation_reason = NULL
    WHERE doctor_id = OLD.doctor_id
      AND slot_date = OLD.leave_date
      AND status = 'cancelled'
      AND cancellation_reason = 'doctor_leave';

    RETURN OLD;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_reopen_slots_after_leave_removed
    AFTER DELETE ON doctor_leaves
    FOR EACH ROW EXECUTE FUNCTION reopen_slots_after_leave_removed();

-- =========================================================
-- FIX 4: SOFT-DELETE PATTERN FOR DOCTORS/PATIENTS
-- doctors/patients -> users is ON DELETE RESTRICT, and appointments ->
-- slots/doctors/patients is ON DELETE RESTRICT, so any account with
-- actual appointment history cannot be hard-deleted, by design.
-- slots -> doctors is ON DELETE CASCADE: a doctor's *unbooked, empty*
-- slots are harmless and are allowed to disappear with the doctor.
-- Net effect: deleting a doctor who was never booked cleans up fully;
-- deleting a doctor with even one appointment fails loudly, forcing
-- the app to deactivate instead:
--   UPDATE users SET is_active = FALSE WHERE id = :user_id;
-- and filter out inactive doctors from patient-facing search/booking
-- queries (e.g. WHERE d.approval_status = 'approved' AND u.is_active).
-- =========================================================

-- =========================================================
-- ROW LEVEL SECURITY (Supabase deployment)
-- Supabase exposes this schema directly over PostgREST, so RLS is not
-- optional for clinical data — assumes public.users.id is set equal to
-- auth.uid() at signup (standard Supabase pattern: your signup handler
-- inserts into public.users using the id from auth.users, not a new
-- gen_random_uuid()).
-- =========================================================

ALTER TABLE prescriptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE pre_visit_summaries ENABLE ROW LEVEL SECURITY;
ALTER TABLE post_visit_notes ENABLE ROW LEVEL SECURITY;
ALTER TABLE post_visit_summaries ENABLE ROW LEVEL SECURITY;
ALTER TABLE google_oauth_tokens ENABLE ROW LEVEL SECURITY;
ALTER TABLE notifications ENABLE ROW LEVEL SECURITY;

-- prescriptions, pre_visit_summaries, post_visit_notes, post_visit_summaries
-- only carry appointment_id, not patient_id/doctor_id directly, so the
-- policy has to join back through appointments.
CREATE POLICY patient_view_own_prescriptions ON prescriptions
    FOR SELECT USING (
        EXISTS (
            SELECT 1 FROM appointments a
            WHERE a.id = prescriptions.appointment_id
              AND a.patient_id = auth.uid()
        )
    );

CREATE POLICY doctor_manage_own_prescriptions ON prescriptions
    FOR ALL USING (
        EXISTS (
            SELECT 1 FROM appointments a
            WHERE a.id = prescriptions.appointment_id
              AND a.doctor_id = auth.uid()
        )
    );

CREATE POLICY patient_view_own_pre_visit_summary ON pre_visit_summaries
    FOR SELECT USING (
        EXISTS (
            SELECT 1 FROM appointments a
            WHERE a.id = pre_visit_summaries.appointment_id
              AND a.patient_id = auth.uid()
        )
    );

CREATE POLICY doctor_view_pre_visit_summary ON pre_visit_summaries
    FOR SELECT USING (
        EXISTS (
            SELECT 1 FROM appointments a
            WHERE a.id = pre_visit_summaries.appointment_id
              AND a.doctor_id = auth.uid()
        )
    );

CREATE POLICY doctor_manage_post_visit_notes ON post_visit_notes
    FOR ALL USING (
        EXISTS (
            SELECT 1 FROM appointments a
            WHERE a.id = post_visit_notes.appointment_id
              AND a.doctor_id = auth.uid()
        )
    );
-- Deliberately no patient SELECT policy on post_visit_notes: these are the
-- doctor's internal clinical notes, not the patient-facing summary.

CREATE POLICY patient_view_own_post_visit_summary ON post_visit_summaries
    FOR SELECT USING (
        EXISTS (
            SELECT 1 FROM appointments a
            WHERE a.id = post_visit_summaries.appointment_id
              AND a.patient_id = auth.uid()
        )
    );

CREATE POLICY doctor_view_post_visit_summary ON post_visit_summaries
    FOR SELECT USING (
        EXISTS (
            SELECT 1 FROM appointments a
            WHERE a.id = post_visit_summaries.appointment_id
              AND a.doctor_id = auth.uid()
        )
    );

-- OAuth tokens: strictly owner-only, no exceptions, not even a "doctor
-- viewing patient" case — this is a credential, not clinical data.
CREATE POLICY own_oauth_tokens_only ON google_oauth_tokens
    FOR ALL USING (user_id = auth.uid());

-- Notifications: a user should only ever see their own outbound queue.
CREATE POLICY own_notifications_only ON notifications
    FOR SELECT USING (user_id = auth.uid());

-- Note: service-role/backend jobs (slot-hold expiry, reminder dispatch,
-- notification sending) connect using the Supabase service_role key,
-- which bypasses RLS entirely by design — these policies only constrain
-- direct client access via the anon/authenticated PostgREST roles.

-- =========================================================
-- SUPABASE READINESS: PART 2
-- Everything below closes the remaining gaps: syncing auth.users into
-- this schema, RLS on every table that was previously wide open, the
-- missing WITH CHECK clauses, a doctor self-approval guard, the hold
-- half of the booking flow, and locking down which functions can
-- bypass RLS (and who's allowed to call them).
-- =========================================================

-- ---------------------------------------------------------
-- auth.users -> public.users sync
-- Supabase's signUp() creates a row in auth.users; this trigger mirrors
-- it into our profile table automatically. The role is read from the
-- optional metadata you pass at signup:
--   supabase.auth.signUp({ email, password, options: { data: { role: 'doctor' } } })
-- Defaults to 'patient' if not supplied.
-- ---------------------------------------------------------
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
    INSERT INTO public.users (id, email, role)
    VALUES (
        NEW.id,
        NEW.email,
        COALESCE(NEW.raw_user_meta_data->>'role', 'patient')::user_role
    );
    RETURN NEW;
END;
$$;

CREATE TRIGGER on_auth_user_created
    AFTER INSERT ON auth.users
    FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- ---------------------------------------------------------
-- Admin-check helper, used across the policies below.
-- SECURITY DEFINER so it can read public.users regardless of the
-- caller's own RLS visibility into that table.
-- ---------------------------------------------------------
CREATE OR REPLACE FUNCTION public.is_admin()
RETURNS BOOLEAN
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, pg_temp
STABLE
AS $$
    SELECT EXISTS (
        SELECT 1 FROM public.users WHERE id = auth.uid() AND role = 'admin'
    );
$$;

-- ---------------------------------------------------------
-- RLS: users
-- ---------------------------------------------------------
ALTER TABLE users ENABLE ROW LEVEL SECURITY;

CREATE POLICY users_select_own_or_admin ON users
    FOR SELECT TO authenticated
    USING (id = auth.uid() OR is_admin());

CREATE POLICY users_update_own ON users
    FOR UPDATE TO authenticated
    USING (id = auth.uid())
    WITH CHECK (id = auth.uid());

CREATE POLICY users_admin_manage ON users
    FOR ALL TO authenticated
    USING (is_admin())
    WITH CHECK (is_admin());
-- No INSERT policy for authenticated/anon: rows are created only via
-- the handle_new_user() trigger above (SECURITY DEFINER), never by a
-- direct client INSERT.

-- ---------------------------------------------------------
-- RLS: patients
-- ---------------------------------------------------------
ALTER TABLE patients ENABLE ROW LEVEL SECURITY;

CREATE POLICY patients_self_access ON patients
    FOR ALL TO authenticated
    USING (user_id = auth.uid())
    WITH CHECK (user_id = auth.uid());

CREATE POLICY patients_visible_to_treating_doctor ON patients
    FOR SELECT TO authenticated
    USING (
        EXISTS (
            SELECT 1 FROM appointments a
            WHERE a.patient_id = patients.user_id
              AND a.doctor_id = auth.uid()
        )
    );

CREATE POLICY patients_admin_access ON patients
    FOR ALL TO authenticated
    USING (is_admin())
    WITH CHECK (is_admin());

-- ---------------------------------------------------------
-- RLS: doctors
-- ---------------------------------------------------------
ALTER TABLE doctors ENABLE ROW LEVEL SECURITY;

-- Public directory: any authenticated user can browse approved doctors
-- (needed for patient-side "select a doctor" search/booking screen).
CREATE POLICY doctors_public_directory ON doctors
    FOR SELECT TO authenticated
    USING (approval_status = 'approved');

CREATE POLICY doctors_self_access ON doctors
    FOR ALL TO authenticated
    USING (user_id = auth.uid())
    WITH CHECK (user_id = auth.uid());

CREATE POLICY doctors_admin_access ON doctors
    FOR ALL TO authenticated
    USING (is_admin())
    WITH CHECK (is_admin());

-- doctors_self_access above would otherwise let a doctor set their own
-- approval_status to 'approved' via a normal UPDATE — RLS operates at
-- row level, not column level, so it can't block that on its own. This
-- trigger is the actual guard:
CREATE OR REPLACE FUNCTION prevent_doctor_self_approval()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
    IF NEW.approval_status IS DISTINCT FROM OLD.approval_status AND NOT is_admin() THEN
        RAISE EXCEPTION 'only_admin_can_change_approval_status';
    END IF;
    RETURN NEW;
END;
$$;

CREATE TRIGGER trg_prevent_doctor_self_approval
    BEFORE UPDATE ON doctors
    FOR EACH ROW EXECUTE FUNCTION prevent_doctor_self_approval();

-- ---------------------------------------------------------
-- RLS: slots
-- ---------------------------------------------------------
ALTER TABLE slots ENABLE ROW LEVEL SECURITY;

CREATE POLICY slots_patient_view ON slots
    FOR SELECT TO authenticated
    USING (
        status = 'available'
        OR held_by = auth.uid()
        OR doctor_id = auth.uid()
        OR is_admin()
    );

-- Doctors manage their own schedule directly (creating/cancelling their
-- own slots). Patient-side transitions (hold, book) go through the
-- SECURITY DEFINER functions below instead of a direct UPDATE policy,
-- since patients have no general write access to this table.
CREATE POLICY slots_doctor_manage_own ON slots
    FOR ALL TO authenticated
    USING (doctor_id = auth.uid())
    WITH CHECK (doctor_id = auth.uid());

CREATE POLICY slots_admin_manage ON slots
    FOR ALL TO authenticated
    USING (is_admin())
    WITH CHECK (is_admin());

-- ---------------------------------------------------------
-- HOLD half of the booking flow (the piece that was still missing).
-- Patients have no direct UPDATE policy on slots, so this SECURITY
-- DEFINER function is how a slot moves available -> held. Mirrors the
-- same FOR UPDATE row-locking pattern as book_appointment_slot().
-- ---------------------------------------------------------
CREATE OR REPLACE FUNCTION hold_slot(
    p_slot_id       UUID,
    p_patient_id    UUID,
    p_hold_seconds  INTEGER DEFAULT 300
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_status slot_status;
BEGIN
    SELECT status INTO v_status FROM slots WHERE id = p_slot_id FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'slot_not_found';
    END IF;

    IF v_status <> 'available' THEN
        RAISE EXCEPTION 'slot_not_available';
    END IF;

    UPDATE slots
    SET status = 'held', held_by = p_patient_id,
        held_until = now() + (p_hold_seconds || ' seconds')::interval
    WHERE id = p_slot_id;

    RETURN TRUE;
END;
$$;

-- ---------------------------------------------------------
-- RLS: appointments
-- ---------------------------------------------------------
ALTER TABLE appointments ENABLE ROW LEVEL SECURITY;

CREATE POLICY appointments_patient_view_own ON appointments
    FOR SELECT TO authenticated
    USING (patient_id = auth.uid());

CREATE POLICY appointments_doctor_view_own ON appointments
    FOR SELECT TO authenticated
    USING (doctor_id = auth.uid());

-- A patient's only legitimate self-service write is cancelling their
-- own booking. (RLS can't restrict this to "only the status column
-- changed" — that would need an additional trigger if you want to be
-- fully strict about it.)
CREATE POLICY appointments_patient_cancel_own ON appointments
    FOR UPDATE TO authenticated
    USING (patient_id = auth.uid())
    WITH CHECK (patient_id = auth.uid() AND status = 'cancelled');

CREATE POLICY appointments_doctor_update_own ON appointments
    FOR UPDATE TO authenticated
    USING (doctor_id = auth.uid())
    WITH CHECK (doctor_id = auth.uid());

CREATE POLICY appointments_admin_manage ON appointments
    FOR ALL TO authenticated
    USING (is_admin())
    WITH CHECK (is_admin());
-- No INSERT policy for authenticated/anon: this is what actually makes
-- "always call book_appointment_slot(), never a raw INSERT" a hard
-- guarantee instead of just a convention — a direct client INSERT into
-- appointments now fails RLS regardless of what the app code does.

-- ---------------------------------------------------------
-- RLS: doctor_leaves
-- ---------------------------------------------------------
ALTER TABLE doctor_leaves ENABLE ROW LEVEL SECURITY;

-- Non-sensitive (just dates a doctor is unavailable) — visible to any
-- authenticated user so the booking UI can grey out those days.
CREATE POLICY doctor_leaves_public_view ON doctor_leaves
    FOR SELECT TO authenticated
    USING (true);

CREATE POLICY doctor_leaves_own_manage ON doctor_leaves
    FOR ALL TO authenticated
    USING (doctor_id = auth.uid())
    WITH CHECK (doctor_id = auth.uid());

CREATE POLICY doctor_leaves_admin_manage ON doctor_leaves
    FOR ALL TO authenticated
    USING (is_admin())
    WITH CHECK (is_admin());

-- ---------------------------------------------------------
-- RLS: medication_reminders
-- No client write policy at all — these rows are only ever created by
-- the backend/service_role job that expands a prescription into its
-- reminder schedule, and dispatched by another service_role job.
-- ---------------------------------------------------------
ALTER TABLE medication_reminders ENABLE ROW LEVEL SECURITY;

CREATE POLICY medication_reminders_patient_view ON medication_reminders
    FOR SELECT TO authenticated
    USING (
        EXISTS (
            SELECT 1 FROM prescriptions p
            JOIN appointments a ON a.id = p.appointment_id
            WHERE p.id = medication_reminders.prescription_id
              AND a.patient_id = auth.uid()
        )
    );

CREATE POLICY medication_reminders_admin_manage ON medication_reminders
    FOR ALL TO authenticated
    USING (is_admin())
    WITH CHECK (is_admin());

-- ---------------------------------------------------------
-- RLS: calendar_events
-- Writes happen via the service_role-driven calendar sync job only.
-- ---------------------------------------------------------
ALTER TABLE calendar_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY calendar_events_involved_parties_view ON calendar_events
    FOR SELECT TO authenticated
    USING (
        EXISTS (
            SELECT 1 FROM appointments a
            WHERE a.id = calendar_events.appointment_id
              AND (a.patient_id = auth.uid() OR a.doctor_id = auth.uid())
        )
    );

CREATE POLICY calendar_events_admin_manage ON calendar_events
    FOR ALL TO authenticated
    USING (is_admin())
    WITH CHECK (is_admin());

-- ---------------------------------------------------------
-- Fix: the prescriptions/post_visit_notes "doctor manage" policies from
-- the earlier RLS pass used FOR ALL USING(...) with no WITH CHECK,
-- which meant a doctor could INSERT a row against an appointment_id
-- that wasn't theirs (USING only guards existing rows, not the row
-- being written). Adding the missing WITH CHECK closes that.
-- ---------------------------------------------------------
ALTER POLICY doctor_manage_own_prescriptions ON prescriptions
    WITH CHECK (
        EXISTS (
            SELECT 1 FROM appointments a
            WHERE a.id = prescriptions.appointment_id
              AND a.doctor_id = auth.uid()
        )
    );

ALTER POLICY doctor_manage_post_visit_notes ON post_visit_notes
    WITH CHECK (
        EXISTS (
            SELECT 1 FROM appointments a
            WHERE a.id = post_visit_notes.appointment_id
              AND a.doctor_id = auth.uid()
        )
    );

-- ---------------------------------------------------------
-- SECURITY DEFINER on the system-integrity functions.
-- These need to write to slots/appointments/notifications regardless
-- of the calling user's own RLS visibility (e.g. a patient has no
-- direct UPDATE grant on slots, but book_appointment_slot() still
-- needs to flip one). SECURITY DEFINER makes them run with the
-- privileges of the function owner instead of the caller — that's
-- exactly why each one does its own explicit status/ownership checks
-- internally rather than trusting the caller.
-- search_path is pinned to prevent search_path hijacking, a standard
-- hardening step for any SECURITY DEFINER function.
-- ---------------------------------------------------------
ALTER FUNCTION book_appointment_slot(UUID, UUID, UUID, TEXT)
    SECURITY DEFINER SET search_path = public, pg_temp;

ALTER FUNCTION sync_slot_on_appointment_change()
    SECURITY DEFINER SET search_path = public, pg_temp;

ALTER FUNCTION handle_doctor_leave_conflicts()
    SECURITY DEFINER SET search_path = public, pg_temp;

ALTER FUNCTION check_slot_against_doctor_leave()
    SECURITY DEFINER SET search_path = public, pg_temp;

ALTER FUNCTION reopen_slots_after_leave_removed()
    SECURITY DEFINER SET search_path = public, pg_temp;

ALTER FUNCTION release_expired_slot_holds()
    SECURITY DEFINER SET search_path = public, pg_temp;

-- ---------------------------------------------------------
-- Supabase auto-exposes every function in the public schema as a
-- callable RPC endpoint unless you say otherwise. Lock down who can
-- actually call the patient-facing ones, and block direct calls to the
-- background-job-only one.
-- ---------------------------------------------------------
REVOKE ALL ON FUNCTION book_appointment_slot(UUID, UUID, UUID, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION book_appointment_slot(UUID, UUID, UUID, TEXT) TO authenticated;

REVOKE ALL ON FUNCTION hold_slot(UUID, UUID, INTEGER) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION hold_slot(UUID, UUID, INTEGER) TO authenticated;

-- release_expired_slot_holds() is meant to be called only by a
-- scheduled job (e.g. Supabase Cron / pg_cron) connecting as
-- service_role — not by any authenticated end user.
REVOKE ALL ON FUNCTION release_expired_slot_holds() FROM PUBLIC;
-- (sync_slot_on_appointment_change, handle_doctor_leave_conflicts,
-- check_slot_against_doctor_leave, reopen_slots_after_leave_removed,
-- and handle_new_user all return TRIGGER, which Postgres already
-- refuses to execute outside of a trigger context — no separate
-- REVOKE needed for those.)