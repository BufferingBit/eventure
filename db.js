import pg from "pg";
import dotenv from "dotenv";

dotenv.config();

// Verify database environment variables
function verifyDbEnvVariables() {
  if (process.env.NODE_ENV === 'production') {
    if (!process.env.DATABASE_URL) {
      console.error('Missing DATABASE_URL environment variable');
      process.exit(1);
    }
  } else {
    const required = ['PG_HOST', 'PG_USER', 'PG_DATABASE', 'PG_PASSWORD'];
    const missing = required.filter(key => !process.env[key]);
    
    if (missing.length > 0) {
      console.error('Missing required database environment variables:', missing.join(', '));
      console.error('Please check your .env file');
      process.exit(1);
    }
  }
}

verifyDbEnvVariables();

const pool = new pg.Pool(
  process.env.NODE_ENV === 'production'
    ? {
        connectionString: process.env.DATABASE_URL,
        ssl: {
          rejectUnauthorized: false
        }
      }
    : {
        host: process.env.PG_HOST,
        user: process.env.PG_USER,
        database: process.env.PG_DATABASE,
        password: process.env.PG_PASSWORD,
        port: process.env.PG_PORT || 5432
      }
);

pool.on('error', (err) => {
  console.error('Unexpected error on idle client', err);
  process.exit(-1);
});

const query = (text, params) => pool.query(text, params);

export default {
  pool,
  query

