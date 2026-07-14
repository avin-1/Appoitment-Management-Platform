const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseServiceKey) {
  console.error("Missing Supabase configuration in .env");
}

// Initialize Supabase client with the Service Role Key
// This allows the backend to bypass RLS when performing admin actions or background jobs.
// For routes that require user context, we will pass the user's JWT or rely on RLS where applicable,
// but for our backend controller operations we often act on behalf of the system.
const supabase = createClient(supabaseUrl, supabaseServiceKey, {
  auth: {
    autoRefreshToken: false,
    persistSession: false
  }
});

module.exports = supabase;

//Supabase completed 
