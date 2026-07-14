const cron = require('node-cron');
const supabase = require('../config/supabase');
const emailService = require('../services/emailService');
const calendarService = require('../services/calendarService');

const initCronJobs = () => {
    console.log('Initializing cron jobs...');

    // 1. Release expired slot holds every minute
    cron.schedule('* * * * *', async () => {
        try {
            const { error } = await supabase.rpc('release_expired_slot_holds');
            if (error) {
                console.error("Cron Error releasing expired slot holds:", error);
            }
        } catch (err) {
            console.error("Exception in release_expired_slot_holds cron:", err);
        }
    });

    // 2. Process pending notifications (Emails and Calendar Events) every minute
    cron.schedule('* * * * *', async () => {
        try {
            // Fetch pending or retrying notifications, limit 50 per batch
            const { data: notifications, error } = await supabase
                .from('notifications')
                .select(`
                    id, type, channel, payload, retry_count, user_id,
                    users ( email )
                `)
                .in('status', ['pending', 'retrying'])
                .limit(50);

            if (error) throw error;

            for (const notice of notifications) {
                let success = false;
                let errorMessage = null;

                try {
                    if (notice.channel === 'email') {
                        const emailAddress = notice.users?.email;
                        if (emailAddress) {
                            const subject = getSubjectForType(notice.type);
                            const text = buildEmailBody(notice.type, notice.payload);
                            success = await emailService.sendEmail(emailAddress, subject, text);
                        } else {
                            errorMessage = 'No email address found for user';
                        }
                    } else if (notice.channel === 'calendar') {
                        if (notice.type === 'booking_confirmation') {
                            const eventDetails = buildCalendarEventDetails(notice.payload);
                            const res = await calendarService.createEvent(notice.user_id, eventDetails);
                            if (res) {
                                success = true;
                                // Need to store the event ID? We'll rely on the calendar_events table
                                // managed elsewhere, or update it here.
                            }
                        } else if (notice.type === 'cancellation') {
                            // notice.payload should contain eventId
                            if (notice.payload.eventId) {
                                success = await calendarService.deleteEvent(notice.user_id, notice.payload.eventId);
                            }
                        }
                    }
                } catch (e) {
                    errorMessage = e.message;
                }

                if (success) {
                    await supabase.from('notifications').update({
                        status: 'sent',
                        sent_at: new Date().toISOString(),
                        error_message: null
                    }).eq('id', notice.id);
                } else {
                    const nextRetryCount = notice.retry_count + 1;
                    const newStatus = nextRetryCount >= 3 ? 'failed' : 'retrying';
                    
                    await supabase.from('notifications').update({
                        status: newStatus,
                        retry_count: nextRetryCount,
                        error_message: errorMessage || 'Unknown error'
                    }).eq('id', notice.id);
                }
            }
        } catch (err) {
            console.error("Exception in notification processor cron:", err);
        }
    });

    // 3. Medication Reminders - Runs every 5 minutes
    cron.schedule('*/5 * * * *', async () => {
        try {
            const now = new Date().toISOString();
            
            const { data: reminders, error } = await supabase
                .from('medication_reminders')
                .select(`
                    id, remind_at,
                    prescriptions (
                        medication_name, dosage, instructions,
                        appointments (
                            patient_id
                        )
                    )
                `)
                .eq('sent', false)
                .lte('remind_at', now);

            if (error) throw error;

            for (const reminder of reminders) {
                const patientId = reminder.prescriptions?.appointments?.patient_id;
                
                // Get patient email
                const { data: patient } = await supabase
                    .from('users')
                    .select('email')
                    .eq('id', patientId)
                    .single();

                if (patient?.email) {
                    const medName = reminder.prescriptions.medication_name;
                    const dosage = reminder.prescriptions.dosage;
                    const instructions = reminder.prescriptions.instructions;

                    const text = `It is time to take your medication: ${medName} (${dosage}).\nInstructions: ${instructions}`;
                    
                    const success = await emailService.sendEmail(patient.email, `Medication Reminder: ${medName}`, text);
                    
                    if (success) {
                        await supabase.from('medication_reminders').update({
                            sent: true,
                            sent_at: new Date().toISOString()
                        }).eq('id', reminder.id);
                    }
                }
            }
        } catch (err) {
            console.error("Exception in medication reminder cron:", err);
        }
    });
};

function getSubjectForType(type) {
    const subjects = {
        'booking_confirmation': 'Appointment Confirmation',
        'reminder': 'Appointment Reminder',
        'cancellation': 'Appointment Cancelled',
        'reschedule': 'Appointment Rescheduled',
        'leave_notice': 'Important Update: Doctor Leave Notice',
        'medication_reminder': 'Medication Reminder'
    };
    return subjects[type] || 'Notification from your Clinic';
}

function buildEmailBody(type, payload) {
    if (type === 'leave_notice') {
        return `Hello, your upcoming appointment on ${payload.leave_date} has been cancelled because the doctor is on leave. Reason: ${payload.reason || 'Not specified'}. Please log in to rebook.`;
    }
    return JSON.stringify(payload, null, 2); // Fallback for simple testing
}

function buildCalendarEventDetails(payload) {
    // Expected payload: { summary, description, startTime, endTime }
    return {
        summary: payload.summary || 'Doctor Appointment',
        description: payload.description || 'Healthcare Appointment',
        start: { dateTime: payload.startTime, timeZone: 'UTC' },
        end: { dateTime: payload.endTime, timeZone: 'UTC' }
    };
}

module.exports = { initCronJobs };
