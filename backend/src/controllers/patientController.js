const { asyncHandler } = require('../middlewares/errorMiddleware');
const supabase = require('../config/supabase');
const llmService = require('../services/llmService');

exports.searchDoctors = asyncHandler(async (req, res) => {
    const { specialisation } = req.query;

    let query = supabase
        .from('doctors')
        .select(`
            user_id, full_name, specialisation, phone, 
            working_hours, slot_duration_mins,
            users!inner (is_active)
        `)
        .eq('approval_status', 'approved')
        .eq('users.is_active', true);

    if (specialisation) {
        query = query.ilike('specialisation', `%${specialisation}%`);
    }

    const { data, error } = await query;
    if (error) throw error;
    res.status(200).json({ success: true, data });
});

exports.getDoctorSlots = asyncHandler(async (req, res) => {
    const { doctorId } = req.params;
    const { date } = req.query;

    if (!date) {
        return res.status(400).json({ success: false, error: 'Date query param is required' });
    }

    const { data, error } = await supabase
        .from('slots')
        .select('*')
        .eq('doctor_id', doctorId)
        .eq('slot_date', date)
        .in('status', ['available']);

    if (error) throw error;
    res.status(200).json({ success: true, data });
});

exports.bookAppointment = asyncHandler(async (req, res) => {
    const { slot_id, doctor_id, symptoms } = req.body;
    const patient_id = req.user.id;

    if (!slot_id || !doctor_id) {
        return res.status(400).json({ success: false, error: 'Slot ID and Doctor ID are required' });
    }

    // Call the Postgres function for atomic booking
    // This expects the function book_appointment_slot(p_slot_id, p_patient_id, p_doctor_id, p_symptoms)
    const { data, error } = await supabase.rpc('book_appointment_slot', {
        p_slot_id: slot_id,
        p_patient_id: patient_id,
        p_doctor_id: doctor_id,
        p_symptoms: symptoms || null
    });

    if (error) {
        if (error.message.includes('slot_already_booked')) {
            return res.status(409).json({ success: false, error: 'Slot is already booked' });
        }
        throw error;
    }

    const appointmentId = data;

    // Queue booking confirmation notification
    await supabase.from('notifications').insert([{
        user_id: patient_id,
        appointment_id: appointmentId,
        type: 'booking_confirmation',
        channel: 'email',
        payload: { message: "Your appointment has been booked." }
    }]);

    // Same for calendar event if needed
    await supabase.from('notifications').insert([{
        user_id: patient_id,
        appointment_id: appointmentId,
        type: 'booking_confirmation',
        channel: 'calendar',
        payload: { summary: "Doctor Appointment", startTime: new Date().toISOString(), endTime: new Date(Date.now() + 15*60000).toISOString() }
    }]);

    res.status(201).json({ success: true, message: 'Appointment booked successfully', appointmentId });
});

exports.submitSymptoms = asyncHandler(async (req, res) => {
    const { appointmentId } = req.params;
    const { symptoms } = req.body;
    const patient_id = req.user.id;

    // Verify appointment belongs to patient
    const { data: appointment, error: apptError } = await supabase
        .from('appointments')
        .select('id')
        .eq('id', appointmentId)
        .eq('patient_id', patient_id)
        .single();

    if (apptError || !appointment) {
        return res.status(404).json({ success: false, error: 'Appointment not found or not authorized' });
    }

    // Update symptoms in appointment
    await supabase
        .from('appointments')
        .update({ symptoms })
        .eq('id', appointmentId);

    // Call LLM
    try {
        const llmSummary = await llmService.generatePreVisitSummary(symptoms);
        
        await supabase
            .from('pre_visit_summaries')
            .upsert({
                appointment_id: appointmentId,
                urgency_level: llmSummary.urgency_level,
                chief_complaint: llmSummary.chief_complaint,
                suggested_questions: llmSummary.suggested_questions,
                raw_llm_response: llmSummary,
                llm_status: 'success'
            });

    } catch (error) {
        await supabase
            .from('pre_visit_summaries')
            .upsert({
                appointment_id: appointmentId,
                llm_status: 'failed'
            });
    }

    res.status(200).json({ success: true, message: 'Symptoms submitted and summary generated' });
});

exports.getAppointments = asyncHandler(async (req, res) => {
    const patient_id = req.user.id;

    const { data, error } = await supabase
        .from('appointments')
        .select(`
            *,
            doctors (full_name, specialisation, phone),
            slots (slot_date, start_time, end_time),
            post_visit_summaries (*)
        `)
        .eq('patient_id', patient_id)
        .order('created_at', { ascending: false });

    if (error) throw error;
    res.status(200).json({ success: true, data });
});
