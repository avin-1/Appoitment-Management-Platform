const supabase = require('./src/config/supabase');

const clearDatabase = async () => {
    try {
        console.log('Fetching all users from Supabase Auth...');
        const { data: { users }, error } = await supabase.auth.admin.listUsers();

        if (error) {
            throw error;
        }

        console.log(`Found ${users.length} users.`);

        let deletedCount = 0;
        for (const user of users) {
            // Keep the admin user
            if (user.email === 'avinash.bhurke23@vit.edu') {
                console.log(`Skipping admin user: ${user.email}`);
                continue;
            }

            console.log(`Deleting user records for: ${user.email} (${user.id})`);
            
            // Delete from child tables first because schema uses ON DELETE RESTRICT
            await supabase.from('patients').delete().eq('user_id', user.id);
            await supabase.from('doctors').delete().eq('user_id', user.id);
            await supabase.from('google_oauth_tokens').delete().eq('user_id', user.id);
            await supabase.from('users').delete().eq('id', user.id);

            const { error: deleteError } = await supabase.auth.admin.deleteUser(user.id);
            
            if (deleteError) {
                console.error(`Failed to delete ${user.email}:`, deleteError);
            } else {
                deletedCount++;
            }
        }

        console.log(`\nSuccessfully deleted ${deletedCount} users.`);
        console.log('Due to ON DELETE CASCADE rules in your schema, all associated profiles in public.users, public.doctors, and public.patients have also been removed.');
        
    } catch (err) {
        console.error('Error clearing database:', err);
    }
};

clearDatabase();
