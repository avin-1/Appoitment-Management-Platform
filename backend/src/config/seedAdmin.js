const supabase = require('./supabase');

const seedAdmin = async () => {
    const adminEmail = process.env.ADMIN_EMAIL;
    const adminPassword = process.env.ADMIN_PASSWORD;

    if (!adminEmail || !adminPassword) {
        console.warn('⚠️  ADMIN_EMAIL or ADMIN_PASSWORD not set in environment. Skipping admin seed.');
        return;
    }

    try {
        console.log('Checking for default admin account...');

        const { data, error } = await supabase.auth.admin.createUser({
            email: adminEmail,
            password: adminPassword,
            email_confirm: true,
            user_metadata: {
                role: 'admin',
                full_name: 'System Administrator'
            }
        });

        if (error) {
            if (error.message.includes('already been registered') || error.message.includes('already exists')) {
                console.log('✅ Default Admin account already exists.');
            } else {
                console.error('❌ Error seeding admin:', error.message);
            }
        } else {
            console.log('✅ Default Admin account created successfully!');
        }
    } catch (err) {
        console.error('Exception seeding admin:', err.message);
    }
};

module.exports = seedAdmin;
