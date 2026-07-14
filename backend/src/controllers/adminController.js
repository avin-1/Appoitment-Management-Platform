const { asyncHandler } = require('../middlewares/errorMiddleware');
const supabase = require('../config/supabase');

exports.getAllDoctors = asyncHandler(async (req, res) => {
    const { data, error } = await supabase
        .from('doctors')
        .select(`
            user_id, full_name, specialisation, phone, 
            slot_duration_mins, approval_status, created_at,
            users!inner (email, is_active)
        `);

    if (error) throw error;
    res.status(200).json({ success: true, data });
});

exports.approveDoctor = asyncHandler(async (req, res) => {
    const { id } = req.params;
    const { status } = req.body; // 'approved' or 'rejected'

    if (!['approved', 'rejected', 'pending'].includes(status)) {
        return res.status(400).json({ success: false, error: 'Invalid approval status' });
    }

    // Because doctor self-approval is prevented by a trigger, this works 
    // since we use the Service Role Key here (which acts as superadmin).
    const { data, error } = await supabase
        .from('doctors')
        .update({ approval_status: status })
        .eq('user_id', id)
        .select()
        .single();

    if (error) throw error;
    res.status(200).json({ success: true, data });
});

exports.addLeave = asyncHandler(async (req, res) => {
    const { doctor_id, leave_date, reason } = req.body;

    if (!doctor_id || !leave_date) {
        return res.status(400).json({ success: false, error: 'Doctor ID and Leave Date are required' });
    }

    // This will trigger trg_doctor_leave_conflicts inside the DB
    // automatically cancelling existing 'scheduled' appointments and 
    // creating notifications for patients.
    const { data, error } = await supabase
        .from('doctor_leaves')
        .insert([{ doctor_id, leave_date, reason }])
        .select()
        .single();

    if (error) throw error;
    res.status(201).json({ success: true, data });
});

exports.createDoctor = asyncHandler(async (req, res) => {
    const { email, password, full_name, specialisation, phone, slot_duration_mins, working_hours } = req.body;

    if (!email || !password || !full_name || !specialisation) {
        return res.status(400).json({ success: false, error: 'Email, password, full name, and specialisation are required' });
    }

    // 1. Create user in Supabase Auth (automatically triggers public.users creation)
    const { data: authData, error: authError } = await supabase.auth.admin.createUser({
        email,
        password,
        email_confirm: true,
        user_metadata: {
            role: 'doctor',
            full_name
        }
    });

    if (authError) throw authError;

    const newUserId = authData.user.id;

    // 2. Insert profile into public.doctors
    const { data: doctorData, error: doctorError } = await supabase
        .from('doctors')
        .insert([{
            user_id: newUserId,
            full_name,
            specialisation,
            phone: phone || null,
            slot_duration_mins: slot_duration_mins || 15,
            working_hours: working_hours || {},
            approval_status: 'approved'
        }])
        .select()
        .single();

    if (doctorError) {
        // Rollback auth user if doctor profile creation fails
        await supabase.auth.admin.deleteUser(newUserId);
        throw doctorError;
    }

    res.status(201).json({ success: true, data: doctorData });
});

