import pg from "pg";
import dotenv from "dotenv";

// Load environment variables
dotenv.config();

// Verify database environment variables
function verifyDbEnvVariables() {
  const required = ['PG_HOST', 'PG_USER', 'PG_DATABASE', 'PG_PASSWORD'];
  const missing = required.filter(key => !process.env[key]);
  
  if (missing.length > 0) {
    console.error('Missing required database environment variables:', missing.join(', '));
    console.error('Please check your .env file');
    process.exit(1);
  }
}

// Verify environment variables before proceeding
verifyDbEnvVariables();

// Create a pool instead of a single client
const pool = new pg.Pool({
  host: process.env.PG_HOST,
  user: process.env.PG_USER,
  database: process.env.PG_DATABASE,
  password: process.env.PG_PASSWORD,
  port: process.env.PG_PORT || 5433,
});

// Helper function for queries
const query = (text, params) => pool.query(text, params);

export default {
  pool,
  query
};

