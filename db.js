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

const db = new pg.Client({
  host: process.env.PG_HOST,
  user: process.env.PG_USER,
  database: process.env.PG_DATABASE,
  password: process.env.PG_PASSWORD,
  port: process.env.PG_PORT || 5433,
});

try {
  await db.connect();
  console.log("Database connected successfully");
} catch (err) {
  console.error("Database connection error:", err);
  process.exit(1);
}

export default db;
