const { asyncHandler } = require('../middlewares/errorMiddleware');
const supabase = require('../config/supabase');
const llmService = require('../services/llmService');

exports.updateProfile = asyncHandler(async (req, res) => {
    const { working_hours, slot_duration_mins, specialisation } = req.body;
    const doctorId = req.user.id;

    const updates = {};
    if (working_hours) updates.working_hours = working_hours;
    if (slot_duration_mins) updates.slot_duration_mins = slot_duration_mins;
    if (specialisation) updates.specialisation = specialisation;

    const { data, error } = await supabase
        .from('doctors')
        .update(updates)
        .eq('user_id', doctorId)
        .select()
        .single();

    if (error) throw error;
    res.status(200).json({ success: true, data });
});

exports.generateSlots = asyncHandler(async (req, res) => {
    const { start_date, end_date } = req.body;
    const doctorId = req.user.id;

    if (!start_date || !end_date) {
        return res.status(400).json({ success: false, error: 'start_date and end_date are required' });
    }

    // 1. Get Doctor's working hours and slot duration
    const { data: doctor, error: docError } = await supabase
        .from('doctors')
        .select('working_hours, slot_duration_mins')
        .eq('user_id', doctorId)
        .single();

    if (docError) throw docError;

    const duration = doctor.slot_duration_mins || 15;
    const workingHours = doctor.working_hours || {};

    const start = new Date(start_date);
    const end = new Date(end_date);
    const slotsToInsert = [];

    const daysMap = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];

    // Loop through each day from start_date to end_date
    for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
        const dayOfWeek = daysMap[d.getDay()];
        const ranges = workingHours[dayOfWeek];

        if (!ranges || !Array.isArray(ranges) || ranges.length === 0) {
            continue; // Day off
        }

        const dateStr = d.toISOString().split('T')[0];

        // For each working time range on this day (e.g. ["09:00", "13:00"])
        for (const [startTimeStr, endTimeStr] of ranges) {
            let [startHr, startMin] = startTimeStr.split(':').map(Number);
            let [endHr, endMin] = endTimeStr.split(':').map(Number);

            let currentTotalMins = startHr * 60 + startMin;
            const endTotalMins = endHr * 60 + endMin;

            while (currentTotalMins + duration <= endTotalMins) {
                const sHr = Math.floor(currentTotalMins / 60).toString().padStart(2, '0');
                const sMin = (currentTotalMins % 60).toString().padStart(2, '0');
                
                const eTotalMins = currentTotalMins + duration;
                const eHr = Math.floor(eTotalMins / 60).toString().padStart(2, '0');
                const eMin = (eTotalMins % 60).toString().padStart(2, '0');

                slotsToInsert.push({
                    doctor_id: doctorId,
                    slot_date: dateStr,
                    start_time: `${sHr}:${sMin}:00`,
                    end_time: `${eHr}:${eMin}:00`,
                    status: 'available'
                });

                currentTotalMins += duration;
            }
        }
    }

    if (slotsToInsert.length === 0) {
        return res.status(400).json({ success: false, error: 'No slots generated. Check working hours.' });
    }

    // Use ON CONFLICT DO NOTHING in case some slots already exist to prevent crashing
    const { data, error } = await supabase
        .from('slots')
        .insert(slotsToInsert)
        .select();

    // Supabase insert without on_conflict does not support DO NOTHING natively via JS client easily 
    // without specifying constraint. If duplicates occur, it throws. 
    // For safety, assuming slots are unique enough or handled by DB exclusion constraint.
    if (error) {
        if (error.message.includes('conflicting key value violates exclusion constraint')) {
            return res.status(409).json({ success: false, error: 'Some slots conflict with existing ones. Clear existing slots or try different dates.' });
        }
        throw error;
    }

    res.status(201).json({ success: true, count: slotsToInsert.length, message: `${slotsToInsert.length} slots generated.` });
});

exports.getAppointments = asyncHandler(async (req, res) => {
    const doctorId = req.user.id;

    const { data, error } = await supabase
        .from('appointments')
        .select(`
            *,
            patients (full_name, phone, gender, date_of_birth),
            slots (slot_date, start_time, end_time),
            pre_visit_summaries (*)
        `)
        .eq('doctor_id', doctorId)
        .order('created_at', { ascending: false });

    if (error) throw error;
    res.status(200).json({ success: true, data });
});

exports.submitPostVisitNotes = asyncHandler(async (req, res) => {
    const { appointmentId } = req.params;
    const { notes, prescriptions } = req.body;
    const doctorId = req.user.id;

    // Verify appointment belongs to doctor
    const { data: appointment, error: apptError } = await supabase
        .from('appointments')
        .select('id, status')
        .eq('id', appointmentId)
        .eq('doctor_id', doctorId)
        .single();

    if (apptError || !appointment) {
        return res.status(404).json({ success: false, error: 'Appointment not found or not authorized' });
    }

    // 1. Save Doctor Notes
    const { error: notesError } = await supabase
        .from('post_visit_notes')
        .upsert({ appointment_id: appointmentId, doctor_notes: notes });

    if (notesError) throw notesError;

    // 2. Save Prescriptions if any
    if (prescriptions && prescriptions.length > 0) {
        const prescsToInsert = prescriptions.map(p => ({
            appointment_id: appointmentId,
            medication_name: p.medication_name,
            dosage: p.dosage,
            frequency_per_day: p.frequency_per_day,
            duration_days: p.duration_days,
            instructions: p.instructions
        }));

        const { data: insertedPresc, error: prescError } = await supabase
            .from('prescriptions')
            .insert(prescsToInsert)
            .select();

        if (prescError) throw prescError;

        // Schedule medication reminders
        const reminders = [];
        insertedPresc.forEach(p => {
            const startDate = new Date();
            // simple logic: divide 24h by frequency for interval
            const intervalHours = 24 / p.frequency_per_day;
            for (let i = 0; i < p.frequency_per_day * p.duration_days; i++) {
                const remindAt = new Date(startDate.getTime() + (i * intervalHours * 60 * 60 * 1000));
                reminders.push({
                    prescription_id: p.id,
                    remind_at: remindAt.toISOString(),
                });
            }
        });

        if (reminders.length > 0) {
            await supabase.from('medication_reminders').insert(reminders);
        }
    }

    // 3. Generate Patient-Friendly Summary via LLM
    try {
        const llmSummary = await llmService.generatePostVisitSummary(notes);
        
        await supabase
            .from('post_visit_summaries')
            .upsert({
                appointment_id: appointmentId,
                patient_friendly_summary: llmSummary.patient_friendly_summary,
                medication_schedule: { text: llmSummary.medication_schedule_summary },
                follow_up_steps: llmSummary.follow_up_steps,
                llm_status: 'success'
            });

    } catch (llmError) {
        await supabase
            .from('post_visit_summaries')
            .upsert({
                appointment_id: appointmentId,
                llm_status: 'failed'
            });
        console.error("LLM failed, marked as failed");
    }

    // Mark appointment as completed
    await supabase.from('appointments').update({ status: 'completed' }).eq('id', appointmentId);

    res.status(200).json({ success: true, message: 'Notes submitted and processed' });
});
