const supabase = require('../config/supabase');

/**
 * Middleware to protect routes. Verifies the JWT token from Supabase.
 */
exports.protect = async (req, res, next) => {
    try {
        let token;
        if (req.headers.authorization && req.headers.authorization.startsWith('Bearer')) {
            token = req.headers.authorization.split(' ')[1];
        }

        if (!token) {
            return res.status(401).json({ success: false, error: 'Not authorized to access this route' });
        }

        // Verify token with Supabase
        const { data: { user }, error } = await supabase.auth.getUser(token);

        if (error || !user) {
            return res.status(401).json({ success: false, error: 'Not authorized to access this route' });
        }

        // Fetch user role from public.users table
        const { data: userProfile, error: profileError } = await supabase
            .from('users')
            .select('id, email, role, is_active')
            .eq('id', user.id)
            .single();

        if (profileError || !userProfile) {
            // Self-healing fallback: create the profile in public.users if missing
            const userRole = user.email === 'avinash.bhurke23@vit.edu'
                ? 'admin'
                : (user.user_metadata?.role || 'patient');

            const { data: newProfile, error: insertError } = await supabase
                .from('users')
                .insert([{
                    id: user.id,
                    email: user.email,
                    role: userRole,
                    is_active: true
                }])
                .select()
                .single();

            if (insertError || !newProfile) {
                return res.status(401).json({ success: false, error: 'User profile not found and auto-creation failed' });
            }
            
            // Also ensure Doctor profile exists if their role is doctor
            if (userRole === 'doctor') {
                await supabase.from('doctors').insert([{
                    user_id: user.id,
                    full_name: user.user_metadata?.full_name || 'Doctor',
                    specialisation: 'General',
                    approval_status: 'approved'
                }]);
            }

            req.user = newProfile;
        } else {
            if (!userProfile.is_active) {
                return res.status(401).json({ success: false, error: 'User account is deactivated' });
            }
            req.user = userProfile;
        }
        next();
    } catch (error) {
        console.error("Auth Middleware Error:", error);
        res.status(401).json({ success: false, error: 'Not authorized to access this route' });
    }
};

/**
 * Middleware to restrict access based on user role.
 * @param  {...String} roles - Allowed roles e.g., 'admin', 'doctor', 'patient'
 */
exports.authorize = (...roles) => {
    return (req, res, next) => {
        if (!req.user || !roles.includes(req.user.role)) {
            return res.status(403).json({ 
                success: false, 
                error: `User role ${req.user ? req.user.role : 'Unknown'} is not authorized to access this route` 
            });
        }
        next();
    };
};
