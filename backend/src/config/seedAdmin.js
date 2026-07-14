const supabase = require('./supabase');

const seedAdmin = async () => {
    const adminEmail = 'avinash.bhurke23@vit.edu';
    const adminPassword = 'admin'; // Use the password requested by the user

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
            if (error.message.includes('already been registered')) {
                console.log('✅ Default Admin account already exists.');
            } else {
                console.error('❌ Error seeding admin:', error.message);
            }
        } else {
            console.log('✅ Default Admin account created successfully! You can now log in.');
            console.log(`   Email: ${adminEmail}`);
            console.log(`   Password: ${adminPassword}`);
        }
    } catch (err) {
        console.error('Exception seeding admin:', err);
    }
};

module.exports = seedAdmin;
