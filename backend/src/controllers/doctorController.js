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
    // Basic slot generator for a given date
    const { date } = req.body;
    const doctorId = req.user.id;

    if (!date) {
        return res.status(400).json({ success: false, error: 'Date is required' });
    }

    // 1. Get Doctor's working hours
    const { data: doctor, error: docError } = await supabase
        .from('doctors')
        .select('working_hours, slot_duration_mins')
        .eq('user_id', doctorId)
        .single();

    if (docError) throw docError;

    // A complete slot generation logic would calculate start and end times based on working_hours
    // and insert into slots table. Assuming working_hours like: {"mon": [["09:00", "13:00"]]}
    // This requires parsing the date, finding the day of the week, and creating slots.
    // For simplicity, we assume the frontend sends the specific slots to create, 
    // or we implement a basic generator.
    
    // As a placeholder, we expect frontend to send the slots array
    const { slots } = req.body; // Array of { start_time, end_time }
    
    if (!slots || !Array.isArray(slots)) {
        return res.status(400).json({ success: false, error: 'Array of slots {start_time, end_time} is required' });
    }

    const slotsToInsert = slots.map(s => ({
        doctor_id: doctorId,
        slot_date: date,
        start_time: s.start_time,
        end_time: s.end_time,
        status: 'available'
    }));

    const { data, error } = await supabase
        .from('slots')
        .insert(slotsToInsert)
        .select();

    if (error) throw error;

    res.status(201).json({ success: true, data });
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
