import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';

dotenv.config();

// Verify Supabase environment variables
function verifySupabaseEnvVariables() {
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_KEY) {
    console.error('Missing SUPABASE_URL or SUPABASE_KEY environment variable');
    process.exit(1);
  }
}

verifySupabaseEnvVariables();

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);

/**
 * Query helper to mimic pg.Pool.query(text, params)
 * Only supports basic SELECT/INSERT/UPDATE/DELETE with $1, $2... params
 */
const query = async (text, params = []) => {
  // Supabase client does not support raw SQL with params directly,
  // but you can use the rpc() or from().select() etc. methods.
  // For advanced SQL, use the SQL editor in Supabase or call a function.
  // For now, we use the SQL endpoint for raw queries (service key required for writes).
  const { data, error } = await supabase.rpc('execute_sql', { sql: text, params });
  if (error) throw error;
  return { rows: data };
};

export default {
  supabase,
  query
};
