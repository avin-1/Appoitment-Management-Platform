# System Design Write-up
## Healthcare Appointment & Follow-up Manager

---

## 1. Double-Booking Prevention

The core challenge of any appointment system is ensuring two patients cannot book the same doctor slot simultaneously. A naive implementation that checks availability and then books in two separate steps creates a race condition: both patients pass the availability check before either has committed the booking.

This system uses a **two-layer defence**.

**Layer 1 — Database Exclusion Constraints.** The `slots` table was designed with a `btree_gist` PostgreSQL extension and an exclusion constraint on `(doctor_id, slot_date, start_time, end_time)`. This means the database itself will reject any `INSERT` or `UPDATE` that would create two rows with overlapping time ranges for the same doctor. This is a hard constraint enforced at the storage level, completely independent of application code, and makes double-booking physically impossible regardless of how many concurrent requests arrive.

**Layer 2 — Slot Status Enum.** Every slot has a `status` column typed as a Postgres ENUM: `available | held | booked | cancelled`. The booking endpoint updates a slot from `available` to `booked` in a single atomic `UPDATE ... WHERE status = 'available'` statement. If two requests race for the same slot, only one UPDATE can match the `WHERE status = 'available'` clause. The second will update zero rows, and the backend returns a conflict error to that patient.

---

## 2. Slot Hold Mechanism

When a patient begins the booking flow, they need a short window to confirm their selection without the slot disappearing from under them. However, reserving a slot indefinitely while a user deliberates would starve other patients.

When a patient calls `POST /api/patient/appointments/book`, the backend immediately updates the slot row:

```sql
UPDATE slots
SET status = 'held', held_by = :patientId, held_until = now() + interval '5 minutes'
WHERE id = :slotId AND status = 'available';
```

The slot is now `held` for exactly 5 minutes. Only this specific patient can complete the booking by confirming, which transitions the slot to `booked`. If the patient abandons the page or takes too long, a cron job running every minute executes a stored procedure:

```sql
UPDATE slots
SET status = 'available', held_by = NULL, held_until = NULL
WHERE status = 'held' AND held_until < now();
```

This releases all expired holds back to `available`, making them bookable by other patients. The design gives patients enough time to confirm while capping the maximum lock duration. The 5-minute window is configurable and was chosen as a balance between user experience and slot availability.

---

## 3. Doctor Leave & Conflict Handling

When an admin records a doctor's leave day, the system must handle existing booked appointments for that day, not just prevent new ones.

The `POST /api/admin/leaves` endpoint does the following in a single transaction:

**Step 1 — Record the leave.** A row is inserted into `doctor_leaves` with the doctor ID, date, and reason.

**Step 2 — Cancel affected slots.** All `available` and `held` slots for that doctor on the leave date are set to `cancelled`. This prevents any new bookings from being placed.

**Step 3 — Cancel existing appointments.** All appointments with `scheduled` status that map to slots on that date are also set to `cancelled`.

**Step 4 — Queue notifications.** For each cancelled appointment, a notification record is inserted into the `notifications` table with type `leave_notice` and a payload containing the patient ID, cancelled date, and the admin-provided reason. The notification processor (detailed below) picks these up within one minute and sends an email to each affected patient informing them their appointment has been cancelled and encouraging them to rebook.

This approach ensures patients are never left without notice, and doctors and admins have full visibility into the chain of effects triggered by a single leave entry.

---

## 4. Notification Failure Handling

A notification that silently fails with no retry is unacceptable in a healthcare context — a missed medication reminder or booking confirmation can have real consequences.

The system uses a **queue-with-retry pattern** entirely within Postgres, avoiding the operational overhead of an external message broker.

Every notification starts as a row in the `notifications` table with `status = 'pending'`, a `retry_count = 0`, and a `channel` of either `email` or `calendar`.

A cron job runs every minute and fetches up to 50 rows where `status IN ('pending', 'retrying')`. For each notification it attempts delivery:

- **Email channel:** Sends via Nodemailer (Gmail SMTP). On success, the row is updated to `status = 'sent'` with a `sent_at` timestamp.
- **Calendar channel:** Calls the Google Calendar API using the doctor's stored OAuth token. On success, the row is updated to `sent`.

**On failure**, the cron job increments `retry_count` and sets `status = 'retrying'`. The notification re-enters the queue and will be retried on the next cron tick. After 3 failed attempts, `status` is set to `failed` and `error_message` is populated with the exception details. Failed notifications are never deleted, giving administrators a full audit trail to diagnose delivery issues (e.g., expired SMTP credentials or a revoked Google token).

This pattern provides at-least-once delivery guarantees with bounded retries. The per-minute polling interval means in the worst case a notification is delivered 60 seconds after it was queued, which is appropriate for the appointment confirmation use case.

---

## Summary Table

| Concern | Mechanism | Where Enforced |
|---|---|---|
| Double booking | Exclusion constraint + atomic UPDATE with WHERE clause | PostgreSQL + Backend |
| Slot hold | 5-minute `held_until` timestamp, released by cron | PostgreSQL + node-cron |
| Leave conflict | Cascade cancel slots/appointments + queue notifications | Backend (transaction) |
| Notification failure | Retry queue (max 3) with `retry_count` + `error_message` | PostgreSQL + node-cron |
